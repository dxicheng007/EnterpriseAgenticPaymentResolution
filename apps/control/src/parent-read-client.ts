import {
  ActivationStateV1Schema, ConnectionStateV1Schema, hashTargetSnapshot, IdSchema, ParentReadQuerySchema, ParentViewSchema,
  type ParentReadQuery, type Scope,
} from '@eapr/contracts';
import type { TargetReader } from '@eapr/compiler/preview-adapters';
import { sameScope } from '@eapr/finance/validate';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { ParentReadError } from '../../worker/src/routes/parent.js';

type Grants = { allowedAccountIds: readonly string[]; allowedSourceRefs: readonly string[] };

export function createParentReadClient(baseUrl: string, serviceToken: string, registryRoot: string) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== baseUrl || !serviceToken) {
    throw new Error('Parent read requires a configured local worker origin and service credential');
  }
  const registry = createRegisteredScopeReader({ registryRoot });

  async function resolve(accountId: string, grants: Grants, expectedScope?: Scope) {
    if (!IdSchema.safeParse(accountId).success) throw new ParentReadError(400);
    if (!grants.allowedAccountIds.includes(accountId)) throw new ParentReadError(403);
    const member = await registry.readSnapshot().then(snapshot => snapshot.resolveRegisteredScope(accountId))
      .catch(() => { throw new ParentReadError(503); });
    if (!member) throw new ParentReadError(404);
    if (!grants.allowedSourceRefs.includes(member.profile.sourceRef) ||
        (expectedScope && !sameScope(expectedScope, member.entry.scope))) throw new ParentReadError(403);
    return member.entry.scope;
  }

  async function get(route: '/internal/parent/' | '/internal/activations/' | '/internal/connections/', scope: Scope, query?: ParentReadQuery) {
    try {
      const url = new URL(route + encodeURIComponent(scope.accountId), origin);
      if (query?.asOf !== undefined) url.searchParams.set('asOf', query.asOf);
      if (query?.snapshotHash !== undefined) url.searchParams.set('snapshotHash', query.snapshotHash);
      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + serviceToken },
        signal: AbortSignal.timeout(2000), redirect: 'error',
      });
      const { status } = response;
      if (status !== 200) {
        await response.body?.cancel();
        throw new ParentReadError(status === 400 || status === 401 || status === 403 || status === 404 ? status : 503);
      }
      return await response.json() as unknown;
    } catch (error) {
      if (error instanceof ParentReadError) throw error;
      throw new ParentReadError(503);
    }
  }

  async function readParent(accountId: string, input: ParentReadQuery, grants: Grants, expectedScope?: Scope) {
    const query = ParentReadQuerySchema.safeParse(input);
    if (!query.success) throw new ParentReadError(400);
    const scope = await resolve(accountId, grants, expectedScope);
    const view = ParentViewSchema.safeParse(await get('/internal/parent/', scope, query.data));
    if (!view.success || !sameScope(scope, view.data.scope) || hashTargetSnapshot(view.data.records) !== view.data.snapshotHash ||
        (query.data.snapshotHash !== undefined && query.data.snapshotHash !== view.data.snapshotHash) ||
        (query.data.asOf !== undefined && query.data.asOf !== view.data.asOf)) throw new ParentReadError(503);
    return view.data;
  }

  const readTarget: TargetReader['readTarget'] = async (scope, asOf, grants) => {
    const view = await readParent(scope.accountId, { asOf }, grants, scope);
    return { ...view.records, asOf: view.asOf };
  };

  return {
    readParent,
    readTarget,
    async readActivation(accountId: string, grants: Grants) {
      const scope = await resolve(accountId, grants);
      const state = ActivationStateV1Schema.safeParse(await get('/internal/activations/', scope));
      if (!state.success || !sameScope(scope, state.data.scope)) throw new ParentReadError(503);
      return state.data;
    },
    async readConnection(accountId: string, grants: Grants) {
      const scope = await resolve(accountId, grants);
      const state = ConnectionStateV1Schema.safeParse(await get('/internal/connections/', scope));
      if (!state.success || !sameScope(scope, state.data.scope)) throw new ParentReadError(503);
      return state.data;
    },
  };
}

export type ParentReadClient = ReturnType<typeof createParentReadClient>;
