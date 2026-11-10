import type { Pool } from 'pg';
import { z } from 'zod';
import {
  AuthorityResumeObservationV1Schema, AuthorityStatusCommandV1Schema, CommittedAuthorityIdentityV1Schema,
  IdSchema, ReviewerContextSchema, SemanticPreflightSchema, hashCanonical, strict,
  type AuthorityResumeObservationV1, type AuthorityStatusCommandV1, type AuthorityStatusResponseV1,
  type CommittedAuthorityIdentityV1, type CurrentAuthorityV1, type Hash, type Id,
  type ReviewerContext, type SemanticPreflight,
} from '@eapr/contracts';
import type { Clock } from '@eapr/storage/control-db';
import { withTransaction } from '@eapr/storage/transaction';
import { freezeJson } from '../../../../packages/storage/src/activation-files.js';
import { ActivationError, equal, selectedProfile, validateSemantics } from '../activation-validation.js';
import { AuthorityError, authorityError } from './current-authority-errors.js';
import {
  commitAuthorityStatus, lockCurrentAuthority, lookupAuthorityCommand, readAuthoritySnapshot, type AuthoritySnapshot,
} from './current-authority-store.js';

export type AuthorityAdmissionGrants = {
  reviewer: ReviewerContext;
  allowedAccountIds: Id[];
  allowedSourceRefs: Id[];
};

/**
 * Trusted composition vouches for a server-managed reviewer session, account/source
 * grants, and mutation origin/CSRF checks as applicable. Future worker ingress must
 * authenticate the control channel before vouching for forwarded reviewer context.
 * Admission after the final check is trusted through the short runtime transaction
 * and its bounded retries. This port does not join session changes to runtime SQL.
 */
export type TrustedAuthorityAdmission<RequestContext> = {
  authorize(request: RequestContext, mode: 'read' | 'mutation'): Promise<AuthorityAdmissionGrants>;
};

const grantsSchema = strict({
  reviewer: ReviewerContextSchema, allowedAccountIds: z.array(IdSchema), allowedSourceRefs: z.array(IdSchema),
});
type Subject = Pick<CurrentAuthorityV1, 'identity' | 'sourceRef'>;
type Input = CommittedAuthorityIdentityV1 | AuthorityStatusCommandV1;
type Call = { token: object; nonce: symbol };
type RequestAdmission = {
  nonce: symbol; input: Input; hash: Hash; grants: AuthorityAdmissionGrants;
  subject?: Subject; refreshed: boolean;
};
const admitted = new WeakMap<object, RequestAdmission>();

function bindingHash(input: Input, reviewerId: Id) {
  return 'action' in input ? hashCanonical({ command: input, reviewerId }) : hashCanonical(input);
}

function requestAdmission({ token, nonce }: Call) {
  const entry = admitted.get(token);
  if (!entry || entry.nonce !== nonce || entry.hash !== bindingHash(entry.input, entry.grants.reviewer.reviewerId)) {
    throw authorityError('AUTHORITY_FORBIDDEN');
  }
  return entry;
}

function requireSubjectGrant(grants: AuthorityAdmissionGrants, subject: Subject) {
  if (!grants.allowedAccountIds.includes(subject.identity.scope.accountId) ||
      !grants.allowedSourceRefs.includes(subject.sourceRef)) throw authorityError('AUTHORITY_FORBIDDEN');
}

function bindSubject(call: Call, { identity, sourceRef }: CurrentAuthorityV1) {
  const entry = requestAdmission(call);
  const subject = freezeJson({ identity, sourceRef });
  requireSubjectGrant(entry.grants, subject);
  entry.subject = subject;
}

function requireSubject(call: Call, { identity, sourceRef }: CurrentAuthorityV1, refreshed = false) {
  const entry = requestAdmission(call);
  const subject = { identity, sourceRef };
  requireSubjectGrant(entry.grants, subject);
  if (!entry.subject || !equal(entry.subject, subject) || (refreshed && !entry.refreshed)) {
    throw authorityError('AUTHORITY_FORBIDDEN');
  }
  return entry;
}

function snapshotReplay(call: Call, snapshot: AuthoritySnapshot, refreshed = false): AuthorityStatusResponseV1 | undefined {
  const entry = requireSubject(call, snapshot.state, refreshed);
  const association = snapshot.command;
  if (!association) return;
  if (association.bindingDigest !== entry.hash || association.reviewer.reviewerId !== entry.grants.reviewer.reviewerId ||
      !equal(association.command, entry.input)) throw authorityError('AUTHORITY_IDEMPOTENCY_CONFLICT');
  return { result: association.result, replayed: true };
}

export function createCurrentAuthority<RequestContext>({ db, clock, admission, observe }: {
  db: Pool; clock: Clock;
  admission: TrustedAuthorityAdmission<RequestContext>;
  observe: (sourceRef: Id) => Promise<SemanticPreflight>;
}): {
  read(request: RequestContext, identity: CommittedAuthorityIdentityV1): Promise<CurrentAuthorityV1>;
  command(request: RequestContext, command: AuthorityStatusCommandV1): Promise<AuthorityStatusResponseV1>;
} {
  async function authorize(request: RequestContext, mode: 'read' | 'mutation') {
    let raw: unknown;
    try {
      raw = await admission.authorize(request, mode);
    } catch (error) {
      if (error instanceof AuthorityError && (
        (error.statusCode === 401 && error.code === 'AUTHORITY_UNAUTHORIZED') ||
        (error.statusCode === 403 && error.code === 'AUTHORITY_FORBIDDEN')
      )) throw authorityError(error.code);
      throw authorityError('AUTHORITY_UNAVAILABLE');
    }
    try {
      return freezeJson(grantsSchema.parse(raw));
    } catch {
      throw authorityError('AUTHORITY_FORBIDDEN');
    }
  }

  async function withAdmission<T extends Input, Result>(
    request: RequestContext, mode: 'read' | 'mutation', raw: T, schema: { parse(value: unknown): T },
    run: (call: Call, input: T) => Promise<Result>,
  ) {
    try {
      const grants = await authorize(request, mode);
      let input: T;
      try {
        input = freezeJson(schema.parse(raw));
      } catch {
        throw authorityError('AUTHORITY_INPUT_INVALID');
      }
      const parsed: Input = input;
      const { accountId } = ('action' in parsed ? parsed.identity : parsed).scope;
      if (!grants.allowedAccountIds.includes(accountId)) throw authorityError('AUTHORITY_FORBIDDEN');
      const call = { token: Object.freeze({}), nonce: Symbol() };
      admitted.set(call.token, { nonce: call.nonce, input, hash: bindingHash(input, grants.reviewer.reviewerId),
        grants, refreshed: false });
      try {
        return await run(call, input);
      } finally {
        admitted.delete(call.token);
      }
    } catch (error) {
      throw error instanceof AuthorityError ? error : authorityError('AUTHORITY_UNAVAILABLE');
    }
  }

  async function refresh(request: RequestContext, call: Call, state: CurrentAuthorityV1) {
    const entry = requireSubject(call, state);
    const fresh = await authorize(request, 'mutation');
    requireSubjectGrant(fresh, state);
    if (!equal(fresh.reviewer, entry.grants.reviewer)) throw authorityError('AUTHORITY_FORBIDDEN');
    requestAdmission(call).refreshed = true;
  }

  async function observeResume({ stored, state }: AuthoritySnapshot) {
    const { bundle } = stored;
    const profile = selectedProfile(bundle);
    const startedAt = clock().toISOString();
    let observation: SemanticPreflight;
    try {
      observation = SemanticPreflightSchema.parse(await observe(state.sourceRef));
    } catch {
      throw authorityError('AUTHORITY_SEMANTICS_UNAVAILABLE');
    }
    const resume = AuthorityResumeObservationV1Schema.parse({ observation, startedAt, completedAt: clock().toISOString() });
    try {
      validateSemantics(bundle, profile, resume.observation);
    } catch (error) {
      if (error instanceof ActivationError && error.code === 'SOURCE_SEMANTICS_MISMATCH') {
        throw authorityError('AUTHORITY_SEMANTICS_MISMATCH');
      }
      throw error;
    }
    return resume;
  }

  return {
    read(request, raw) {
      return withAdmission(request, 'read', raw, CommittedAuthorityIdentityV1Schema, async (call, identity) => {
        const { state } = await readAuthoritySnapshot(db, identity);
        bindSubject(call, state);
        requireSubject(call, state);
        return state;
      });
    },
    command(request, raw) {
      return withAdmission(request, 'mutation', raw, AuthorityStatusCommandV1Schema, async (call, command) => {
        const { identity, idempotencyKey, expectedEpoch, action } = command;
        const snapshot = await readAuthoritySnapshot(db, identity, idempotencyKey);
        bindSubject(call, snapshot.state);
        const replay = snapshotReplay(call, snapshot);
        if (replay) return replay;
        if (snapshot.state.epoch !== expectedEpoch) throw authorityError('AUTHORITY_STALE');
        if (snapshot.state.status === 'revoked' && action !== 'revoke') throw authorityError('AUTHORITY_REVOKED');

        let resume: AuthorityResumeObservationV1 | null = null;
        if (snapshot.state.status === 'paused' && action === 'resume') {
          if (expectedEpoch === Number.MAX_SAFE_INTEGER) throw authorityError('AUTHORITY_EPOCH_EXHAUSTED');
          try {
            resume = await observeResume(snapshot);
          } catch (error) {
            if (!(error instanceof AuthorityError) ||
                (error.code !== 'AUTHORITY_SEMANTICS_UNAVAILABLE' && error.code !== 'AUTHORITY_SEMANTICS_MISMATCH')) throw error;
            await refresh(request, call, snapshot.state);
            const current = await readAuthoritySnapshot(db, identity, idempotencyKey);
            const winner = snapshotReplay(call, current, true);
            if (winner) return winner;
            throw error;
          }
        }

        await refresh(request, call, snapshot.state);
        return await withTransaction(db, async client => {
          const locked = await lockCurrentAuthority(client, identity, idempotencyKey);
          const { grants: { reviewer } } = requireSubject(call, locked.state, true);
          const existing = await lookupAuthorityCommand(client, locked, command, reviewer.reviewerId);
          if (existing) return { result: existing, replayed: true };
          const result = await commitAuthorityStatus(client, locked, {
            command, reviewer, resume, committedAt: clock().toISOString(),
          });
          return { result, replayed: false };
        });
      });
    },
  };
}
