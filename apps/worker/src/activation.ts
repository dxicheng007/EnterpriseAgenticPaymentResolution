import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  CustomerActivationSchema, SyncReceiptSchema, TargetStateSchema, hashCanonical, hashTargetSnapshot,
  type ActivationBundleV2, type ActivationTrustPolicyV1, type InternalActivationRequest, type ScopedReceiptQuery,
  type SemanticPreflight, type Scope,
} from '@eapr/contracts';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import { computeBalance } from '@eapr/finance/balance';
import { checkedAdd } from '@eapr/finance/validate';
import { lockFirstImport, lookupReceiptAssociation, persistFirstImport, readStoredActivation,
  type ReceiptAssociation,
} from '@eapr/parent/activation-store';
import { projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { lockImportIdentities } from '@eapr/parent/persistence';
import { withTransaction } from '@eapr/storage/transaction';
import type { Clock } from '@eapr/storage/control-db';
import type { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { lookupActivationPost } from './activation-repository.js';
import { ActivationError, compare, equal, selectedProfile, validateActivationBundle, validateSemantics } from './activation-validation.js';

function replay(association: ReceiptAssociation) {
  if (association.status === 'conflict') throw new ActivationError(409, 'IDEMPOTENCY_CONFLICT');
  if (association.status === 'exact') return { receipt: association.stored.receipt, replayed: true };
}

const alreadyActive = () => new ActivationError(409, 'ALREADY_ACTIVE');

export function createWorkerActivation({ db, clock, policy, registered, readBundle, observe }: {
  db: Pool; clock: Clock; policy: ActivationTrustPolicyV1 | undefined;
  registered: ReturnType<typeof createRegisteredScopeReader>;
  readBundle: (hash: string) => Promise<ActivationBundleV2>;
  observe: (sourceRef: string) => Promise<SemanticPreflight>;
}) {
  async function read<T>(query: (client: PoolClient) => Promise<T>) {
    const client = await db.connect();
    try { return await query(client); } finally { client.release(); }
  }

  async function activate(input: InternalActivationRequest) {
    const lookup = () => read(client => lookupActivationPost(client, input)).then(replay);
    const committed = await lookup();
    if (committed) return committed;

    let candidate: ActivationBundleV2 | undefined;
    let prepared: ReturnType<typeof validateActivationBundle>;
    let knownScope: Scope | undefined;
    try {
      candidate = await readBundle(input.bundleHash).catch(() => {
        throw new ActivationError(409, 'ACTIVATION_BUNDLE_MISMATCH');
      });
      if (candidate.request.idempotencyKey !== input.idempotencyKey || candidate.hash !== input.bundleHash) {
        throw new ActivationError(409, 'ACTIVATION_BUNDLE_MISMATCH');
      }
      const profile = selectedProfile(candidate);
      knownScope = profile.scope;
      if (await read(client => readStoredActivation(client, profile.scope))) throw alreadyActive();
      prepared = validateActivationBundle(candidate, policy);
      const member = (await registered.readSnapshot()).resolveRegisteredScope(profile.scope.accountId);
      if (!member) throw new ActivationError(404, 'REGISTERED_SCOPE_NOT_FOUND');
      if (!equal(member.profile, profile) || !equal(member.manifest, prepared.bundle.manifest)) {
        throw new ActivationError(409, 'ACTIVATION_POLICY_MISMATCH');
      }
      validateSemantics(prepared.bundle, profile, await observe(prepared.bundle.manifest.sourceRef));
    } catch (error) {
      const winner = await lookup();
      if (winner) return winner;
      const scope = knownScope;
      if (scope && await read(client => readStoredActivation(client, scope))) {
        const exact = await lookup();
        if (exact) return exact;
        throw alreadyActive();
      }
      throw error;
    }

    const { bundle, profile } = prepared;
    const { scope } = profile;
    const { request, artifact, manifest, reviewer, bootstrapVerification } = bundle;
    const key = input.idempotencyKey;
    const expected = { scope, requestHash: hashCanonical(request), bundleHash: input.bundleHash };
    return withTransaction(db, async client => {
      const locked = await lockFirstImport(client, scope, key);
      if (locked.keyOccupied) {
        const association = await lookupReceiptAssociation(client, key, expected);
        if (association.status === 'exact' && (!equal(association.stored.request, request) ||
            !equal(association.stored.bundle, bundle))) throw new ActivationError(409, 'IDEMPOTENCY_CONFLICT');
        const original = replay(association);
        if (!original) throw new Error('Locked activation association disappeared');
        return original;
      }
      if (locked.existingActivation) throw alreadyActive();

      const recordedTarget = locked.target?.records ?? TargetStateSchema.parse({
        scope, version: 0, asOf: manifest.asOf, invoices: [], payments: [], credits: [], allocations: [],
        reversals: [], customers: [], accounts: [], billingConfigurations: [],
      });
      const plannerTarget = { ...recordedTarget, asOf: manifest.asOf };
      if (plannerTarget.version !== request.expectedTargetVersion ||
          hashTargetSnapshot(plannerTarget) !== bootstrapVerification.binding.targetSnapshotHash) {
        throw new ActivationError(409, 'TARGET_STALE');
      }
      const { plans } = planBootstrap(artifact, profile, bundle.bootstrapEvents, plannerTarget);
      const [plan] = plans;
      const records = plan?.operations.flatMap(operation => 'identity' in operation.record ? [operation.record] : []);
      if (plans.length !== 1 || !plan || !records?.length || !equal(plan, bundle.previewPlan) ||
          plan.hash !== bundle.reviewPackage.previewPlanHash || plan.hash !== bootstrapVerification.planHash) {
        throw new ActivationError(409, 'REVIEW_NOT_READY');
      }
      const events = new Map(bundle.bootstrapEvents.map(event => [event.id, event]));
      const deliveries = plan.eventIds.map(id => {
        const event = events.get(id);
        if (!event) throw new ActivationError(409, 'ACTIVATION_BUNDLE_MISMATCH');
        return event;
      });
      const identityLocks = await lockImportIdentities(client, records.map(record => record.identity), deliveries);
      const approvedTarget = {
        ...projectBootstrapTarget(plannerTarget, plan.operations), version: checkedAdd(plannerTarget.version, 1),
      };
      const approvedAt = clock().toISOString();
      const activation = CustomerActivationSchema.parse({
        id: 'activation:' + randomUUID(), scope, artifactHash: artifact.hash, profileHash: profile.hash, manifestHash: manifest.hash,
        baselineCursors: manifest.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter }))
          .sort((a, b) => compare(a.streamId, b.streamId)),
        allowedKinds: artifact.normalizedPlan.allowedKinds, limits: artifact.normalizedPlan.limits,
        reviewerId: reviewer.reviewerId, epoch: 1, status: 'active', approvedAt,
      });
      const receipt = SyncReceiptSchema.parse({
        id: 'receipt:' + randomUUID(), scope, activationId: activation.id, epoch: 1, artifactHash: artifact.hash,
        planHash: plan.hash, eventIds: plan.eventIds, targetRecordIds: records.map(record => record.id),
        beforeBalanceCents: computeBalance(plannerTarget, manifest.asOf),
        afterBalanceCents: computeBalance(approvedTarget, manifest.asOf), status: 'applied', committedAt: approvedAt,
      });
      const stored = await persistFirstImport(client, locked, {
        bundle, request, reviewer, plan, activation, receipt, recordedTarget, plannerTarget, approvedTarget, identityLocks,
      });
      return { receipt: stored.receipt, replayed: false };
    });
  }

  return {
    activate,
    async receipt(key: string, query: ScopedReceiptQuery) {
      const result = replay(await read(client => lookupReceiptAssociation(client, key, {
        scope: query.scope, requestHash: query.expectedRequestHash, bundleHash: query.expectedBundleHash,
      })));
      if (!result) throw new ActivationError(404, 'RECEIPT_NOT_FOUND');
      return result;
    },
  };
}
