import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import {
  AuthorityResumeObservationV1Schema, AuthorityStatusCommandV1Schema, AuthorityStatusResultV1Schema,
  CommittedAuthorityIdentityV1Schema, CurrentAuthorityV1Schema, IdSchema, IsoInstantSchema, ReviewerContextSchema,
  canonicalJson, hashCanonical,
  type AuthorityResumeObservationV1, type AuthorityStatusCommandV1, type AuthorityStatusResultV1,
  type CommittedAuthorityIdentityV1, type CurrentAuthorityV1, type Hash, type Id, type IsoInstant,
  type ReviewerContext, type Scope,
} from '@eapr/contracts';
import { FinanceError } from '@eapr/finance/validate';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { BootstrapProjectionError } from '@eapr/parent/bootstrap';
import { lockParentKeys } from '@eapr/parent/persistence';
import { decodeCanonical, encodeCanonical, readVersion, scopeOf, scopeValues, type ScopeRow } from '@eapr/parent/snapshots';
import { publishActivity } from '@eapr/storage/activity';
import { freezeJson } from '../../../../packages/storage/src/activation-files.js';
import { ActivationError, equal, selectedProfile, validateSemantics } from '../activation-validation.js';
import { authorityError } from './current-authority-errors.js';

type ImportRef = ScopeRow & { initial_import_key: string; initial_receipt_id: string };
type HeadRow = ImportRef & {
  grant_canonical: string; grant_digest: string; status: string; epoch: string; changed_at: string;
};
type CommandRow = ImportRef & {
  idempotency_key: string; reviewer_id: string; binding_digest: string;
  command_canonical: string; command_digest: string; reviewer_canonical: string; reviewer_digest: string;
  result_canonical: string; result_digest: string; resume_canonical: string | null; resume_digest: string | null;
};
type StoredAuthorityCommand = {
  command: AuthorityStatusCommandV1; reviewer: ReviewerContext; bindingDigest: Hash;
  result: AuthorityStatusResultV1; resume: AuthorityResumeObservationV1 | null;
  commandDigest: Hash; reviewerDigest: Hash; resultDigest: Hash; resumeDigest: Hash | null;
};
export type AuthoritySnapshot = {
  stored: StoredActivation;
  state: CurrentAuthorityV1;
  command: StoredAuthorityCommand | null;
};

function requireStorage(condition: unknown): asserts condition {
  if (!condition) throw authorityError('AUTHORITY_STORAGE_INVALID');
}

function storageValue<T>(decode: () => T): T {
  try {
    return decode();
  } catch {
    throw authorityError('AUTHORITY_STORAGE_INVALID');
  }
}

async function readCommittedGrant(client: PoolClient, scope: Scope) {
  try {
    return await readStoredActivation(client, scope);
  } catch (error) {
    // The existing reader combines SQL and decoding. Preserve SQL/internal failures,
    // including retriable SQL states, while translating its known decode failures.
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof FinanceError ||
        error instanceof BootstrapProjectionError || (error instanceof Error && (
          error.message.startsWith('Inconsistent first import ') || [
            'Stored canonical digest differs', 'Stored JSON is not canonical', 'Invalid stored BIGINT',
            'Invalid stored account or customer association', 'Stored snapshot bindings differ',
          ].includes(error.message)
        ))) throw authorityError('AUTHORITY_STORAGE_INVALID');
    throw error;
  }
}

function initialState(stored: StoredActivation): CurrentAuthorityV1 {
  const { scope, id: activationId, artifactHash, profileHash, manifestHash, approvedAt } = stored.activation;
  return storageValue(() => CurrentAuthorityV1Schema.parse({
    schemaVersion: '1', identity: { scope, activationId, bundleHash: stored.bundleHash },
    sourceRef: stored.bundle.manifest.sourceRef, artifactHash, profileHash, manifestHash,
    status: 'active', epoch: 1, changedAt: approvedAt,
  }));
}

function importRef(stored: StoredActivation) {
  return [...scopeValues(stored.activation.scope), stored.request.idempotencyKey, stored.receipt.id];
}

function rowRef(row: ImportRef) {
  return [row.account_id, row.company_id, row.seller_entity_id, row.initial_import_key, row.initial_receipt_id];
}

async function commandRow(client: PoolClient, accountId: Id, key: Id) {
  const { rows: [row] } = await client.query<CommandRow>(
    'SELECT * FROM runtime_authority_commands WHERE account_id = $1 AND idempotency_key = $2', [accountId, key],
  );
  return row;
}

async function headRow(client: PoolClient, accountId: Id, lock: boolean) {
  const { rows: [row] } = await client.query<HeadRow>(
    'SELECT * FROM runtime_authority_heads WHERE account_id = $1' + (lock ? ' FOR UPDATE' : ''), [accountId],
  );
  return row;
}

function decodeHead(row: HeadRow, stored: StoredActivation, initial: CurrentAuthorityV1): CurrentAuthorityV1 {
  return storageValue(() => {
    const grant = decodeCanonical(CurrentAuthorityV1Schema, row.grant_canonical, row.grant_digest);
    requireStorage(equal(rowRef(row), importRef(stored)) && equal(grant, initial));
    const epoch = readVersion(row.epoch);
    requireStorage(Number.isSafeInteger(epoch) && epoch > 0);
    const state = CurrentAuthorityV1Schema.parse({ ...grant, status: row.status, epoch, changedAt: row.changed_at });
    requireStorage(state.changedAt === row.changed_at && (epoch > 1 || equal(state, initial)));
    return state;
  });
}

function matchesPins(state: CurrentAuthorityV1, pins: CurrentAuthorityV1) {
  return equal(state.identity, pins.identity) && state.sourceRef === pins.sourceRef &&
    state.artifactHash === pins.artifactHash && state.profileHash === pins.profileHash && state.manifestHash === pins.manifestHash;
}

function decodeCommand(row: CommandRow, stored: StoredActivation, state: CurrentAuthorityV1): StoredAuthorityCommand {
  return storageValue(() => {
    requireStorage(equal(rowRef(row), importRef(stored)));
    const command = decodeCanonical(AuthorityStatusCommandV1Schema, row.command_canonical, row.command_digest);
    const reviewer = decodeCanonical(ReviewerContextSchema, row.reviewer_canonical, row.reviewer_digest);
    const result = decodeCanonical(AuthorityStatusResultV1Schema, row.result_canonical, row.result_digest);
    const { resume_canonical: resumeCanonical, resume_digest: resumeDigest } = row;
    requireStorage((resumeCanonical === null) === (resumeDigest === null));
    const resume = resumeCanonical === null || resumeDigest === null ? null
      : decodeCanonical(AuthorityResumeObservationV1Schema, resumeCanonical, resumeDigest);
    requireStorage(equal(command.identity, state.identity) && matchesPins(result.state, state) &&
      row.idempotency_key === command.idempotencyKey && command.idempotencyKey === result.idempotencyKey &&
      reviewer.reviewerId === row.reviewer_id && result.action === command.action &&
      result.beforeEpoch === command.expectedEpoch && result.state.epoch <= state.epoch &&
      (result.state.epoch !== state.epoch || equal(result.state, state)) &&
      hashCanonical({ command, reviewerId: reviewer.reviewerId }) === row.binding_digest &&
      (resume !== null) === (result.action === 'resume' && result.changed));
    if (resume) validateSemantics(stored.bundle, selectedProfile(stored.bundle), resume.observation);
    return { command, reviewer, result, resume, bindingDigest: row.binding_digest, commandDigest: row.command_digest,
      reviewerDigest: row.reviewer_digest, resultDigest: row.result_digest, resumeDigest };
  });
}

async function decodeAssociation(
  client: PoolClient, row: CommandRow, stored: StoredActivation, state: CurrentAuthorityV1,
): Promise<StoredAuthorityCommand> {
  const association = decodeCommand(row, stored, state);
  const { result } = association;
  if (!result.changed && result.state.epoch < state.epoch) {
    // A historic no-op retains the changedAt (and status) of its actual preceding state.
    if (result.state.epoch === 1) {
      requireStorage(equal(result.state, initialState(stored)));
    } else {
      const { rows } = await client.query<CommandRow>(
        `SELECT * FROM runtime_authority_commands WHERE account_id = $1
          AND parent_index_projection(result_canonical)->'changed' = 'true'::jsonb
          AND parent_index_projection(result_canonical) #> '{state,epoch}' = to_jsonb($2::bigint)
          LIMIT 2`, [state.identity.scope.accountId, result.state.epoch],
      );
      requireStorage(rows.length === 1 && equal(decodeCommand(rows[0]!, stored, state).result.state, result.state));
    }
  }
  return association;
}

async function resolveSnapshot(
  client: PoolClient, identity: CommittedAuthorityIdentityV1, key: Id | undefined, lock: boolean,
): Promise<AuthoritySnapshot> {
  const { accountId } = identity.scope;
  const occupied = key === undefined ? undefined : await commandRow(client, accountId, key);
  const subjectScope = occupied ? storageValue(() => scopeOf(occupied)) : identity.scope;
  const stored = await readCommittedGrant(client, subjectScope);
  if (occupied) requireStorage(stored && equal(rowRef(occupied), importRef(stored)));
  if (!stored) throw authorityError('AUTHORITY_NOT_FOUND');
  const initial = initialState(stored);
  if (!occupied && !equal(identity, initial.identity)) throw authorityError('AUTHORITY_NOT_FOUND');

  let head = await headRow(client, accountId, lock);
  if (!head) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM runtime_authority_commands WHERE account_id = $1 LIMIT 1', [accountId],
    );
    requireStorage(!occupied && rowCount === 0);
    if (!lock) return { stored, state: initial, command: null };
    await client.query(
      `INSERT INTO runtime_authority_heads
        (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id,
         grant_canonical, grant_digest, status, epoch, changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [...importRef(stored), ...encodeCanonical(initial), initial.status, initial.epoch, initial.changedAt],
    );
    head = await headRow(client, accountId, true);
    requireStorage(head);
  }
  const state = decodeHead(head, stored, initial);
  const command = occupied ? await decodeAssociation(client, occupied, stored, state) : null;
  return { stored, state, command };
}

export async function readAuthoritySnapshotInTransaction(
  client: PoolClient, input: CommittedAuthorityIdentityV1,
): Promise<AuthoritySnapshot> {
  const identity = CommittedAuthorityIdentityV1Schema.parse(input);
  return resolveSnapshot(client, identity, undefined, false);
}

export async function readAuthoritySnapshot(
  db: Pool, input: CommittedAuthorityIdentityV1, key?: Id,
): Promise<AuthoritySnapshot> {
  const identity = CommittedAuthorityIdentityV1Schema.parse(input);
  const commandKey = key === undefined ? undefined : IdSchema.parse(key);
  const client = await db.connect();
  let discard = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = await resolveSnapshot(client, identity, commandKey, false);
    await client.query('COMMIT');
    return snapshot;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}

declare const headLockBrand: unique symbol;
export type LockedCurrentAuthority = {
  readonly [headLockBrand]: true;
  readonly stored: Readonly<StoredActivation>;
  readonly state: Readonly<CurrentAuthorityV1>;
};
const locks = new WeakMap<LockedCurrentAuthority, { client: PoolClient; key: Id | undefined }>();

/** Acquire afresh inside each transaction attempt and use only while its locks are held. */
export async function lockCurrentAuthority(
  client: PoolClient, input: CommittedAuthorityIdentityV1, key?: Id,
): Promise<LockedCurrentAuthority> {
  const identity = CommittedAuthorityIdentityV1Schema.parse(input);
  const commandKey = key === undefined ? undefined : IdSchema.parse(key);
  await lockParentKeys(client, [canonicalJson(['parent-scope', identity.scope.accountId])]);
  const { stored, state } = await resolveSnapshot(client, identity, commandKey, true);
  const locked = freezeJson({ stored, state }) as LockedCurrentAuthority;
  locks.set(locked, { client, key: commandKey });
  return locked;
}

function requireLock(client: PoolClient, locked: LockedCurrentAuthority) {
  const binding = locks.get(locked);
  if (binding?.client !== client) throw authorityError('AUTHORITY_UNAVAILABLE');
  return binding;
}

export async function lookupAuthorityCommand(
  client: PoolClient, locked: LockedCurrentAuthority, input: AuthorityStatusCommandV1, inputReviewerId: Id,
): Promise<AuthorityStatusResultV1 | null> {
  const binding = requireLock(client, locked);
  const command = AuthorityStatusCommandV1Schema.parse(input);
  const reviewerId = IdSchema.parse(inputReviewerId);
  if (binding.key !== command.idempotencyKey || command.identity.scope.accountId !== locked.state.identity.scope.accountId) {
    throw authorityError('AUTHORITY_UNAVAILABLE');
  }
  const row = await commandRow(client, locked.state.identity.scope.accountId, command.idempotencyKey);
  if (!row) return null;
  const association = await decodeAssociation(client, row, locked.stored, locked.state);
  if (association.bindingDigest !== hashCanonical({ command, reviewerId }) ||
      association.reviewer.reviewerId !== reviewerId || !equal(association.command, command)) {
    throw authorityError('AUTHORITY_IDEMPOTENCY_CONFLICT');
  }
  return association.result;
}

const target = { pause: 'paused', resume: 'active', revoke: 'revoked' } as const;
const activity = { pause: 'connection.paused', resume: 'system.status', revoke: 'connection.revoked' } as const;

export async function commitAuthorityStatus(client: PoolClient, locked: LockedCurrentAuthority, input: {
  command: AuthorityStatusCommandV1; reviewer: ReviewerContext;
  resume: AuthorityResumeObservationV1 | null; committedAt: IsoInstant;
}): Promise<AuthorityStatusResultV1> {
  const command = AuthorityStatusCommandV1Schema.parse(input.command);
  const reviewer = ReviewerContextSchema.parse(input.reviewer);
  const resume = input.resume === null ? null : AuthorityResumeObservationV1Schema.parse(input.resume);
  const committedAt = IsoInstantSchema.parse(input.committedAt);
  const replay = await lookupAuthorityCommand(client, locked, command, reviewer.reviewerId);
  if (replay) return replay;
  const before = locked.state;
  if (!equal(before.identity, command.identity) || before.epoch !== command.expectedEpoch) {
    throw authorityError('AUTHORITY_STALE');
  }
  if (before.status === 'revoked' && command.action !== 'revoke') throw authorityError('AUTHORITY_REVOKED');

  const status = target[command.action];
  const changed = status !== before.status;
  if (changed && before.epoch === Number.MAX_SAFE_INTEGER) throw authorityError('AUTHORITY_EPOCH_EXHAUSTED');
  if (changed && command.action === 'resume') {
    if (!resume) throw authorityError('AUTHORITY_STALE');
    try {
      validateSemantics(locked.stored.bundle, selectedProfile(locked.stored.bundle), resume.observation);
    } catch (error) {
      if (error instanceof ActivationError && error.code === 'SOURCE_SEMANTICS_MISMATCH') {
        throw authorityError('AUTHORITY_SEMANTICS_MISMATCH');
      }
      throw error;
    }
  } else if (resume) {
    throw authorityError('AUTHORITY_STALE');
  }

  const state = changed ? { ...before, status, epoch: before.epoch + 1, changedAt: committedAt } : before;
  const result = AuthorityStatusResultV1Schema.parse({
    schemaVersion: '1', identity: command.identity, idempotencyKey: command.idempotencyKey, action: command.action,
    beforeStatus: before.status, beforeEpoch: before.epoch, state, changed, committedAt,
  });
  if (changed) {
    await client.query(
      'UPDATE runtime_authority_heads SET status = $2, epoch = $3, changed_at = $4 WHERE account_id = $1',
      [state.identity.scope.accountId, state.status, state.epoch, state.changedAt],
    );
  }
  await client.query(
    `INSERT INTO runtime_authority_commands
       (account_id, company_id, seller_entity_id, initial_import_key, initial_receipt_id,
        idempotency_key, reviewer_id, binding_digest, command_canonical, command_digest,
        reviewer_canonical, reviewer_digest, result_canonical, result_digest, resume_canonical, resume_digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [...importRef(locked.stored), command.idempotencyKey, reviewer.reviewerId,
      hashCanonical({ command, reviewerId: reviewer.reviewerId }), ...encodeCanonical(command), ...encodeCanonical(reviewer),
      ...encodeCanonical(result), ...(resume ? encodeCanonical(resume) : [null, null])],
  );
  if (changed) {
    const { artifactHash, profileHash, manifestHash } = state;
    await publishActivity(client, { stream: 'runtime', phase: 'run', scope: state.identity.scope, at: committedAt,
      type: activity[command.action], payload: { status, artifactHash, profileHash, manifestHash } });
    locks.delete(locked);
  }
  return result;
}

/** The caller must still hold the live transaction and its scope/head locks. */
export function assertActiveAuthority(client: PoolClient, locked: LockedCurrentAuthority, expectedEpoch: number): CurrentAuthorityV1 {
  requireLock(client, locked);
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch <= 0) throw authorityError('AUTHORITY_INPUT_INVALID');
  if (locked.state.status !== 'active') throw authorityError('AUTHORITY_INACTIVE');
  if (locked.state.epoch !== expectedEpoch) throw authorityError('AUTHORITY_STALE');
  return locked.state;
}
