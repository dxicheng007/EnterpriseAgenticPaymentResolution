import type { PoolClient } from 'pg';
import {
  ActivationBundleV2Schema, ActivationRequestSchema, canonicalJson, CustomerActivationSchema, hashArtifact, hashBundleV2,
  hashBootstrapVerificationResult, hashCanonical, hashEvent, hashFinancialAttestation, hashFinancialReport,
  hashFinancialReservation, hashManifest, hashPlan, hashProfile, hashReviewPackage, hashTargetSnapshot, HashSchema, IdSchema,
  targetRecordId,
  MutationPlanSchema, RawSourceEventSchema, ReviewerContextSchema, ScopeSchema, SyncReceiptSchema, TargetStateSchema, unique,
  type ActivationBundleV2, type ActivationRequest, type CustomerActivation, type FieldLineage, type MutationOperation,
  type MutationPlan, type RawSourceEvent, type ReviewerContext, type Scope, type SyncReceipt, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { financialRecords, sameScope, type FinancialRecord } from '@eapr/finance/validate';
import { publishActivity } from '@eapr/storage/activity';
import { projectBootstrapTarget } from './bootstrap.js';
import { lockParentKeys, requireImportIdentityLocks, type ImportIdentityLocks } from './persistence.js';
import {
  decodeCanonical, encodeCanonical, readStoredTarget, readVersion, scopeOf, scopeValues, validateSnapshot,
  type ScopeRow, type StoredTarget,
} from './snapshots.js';

type ImportContents = {
  request: ActivationRequest; reviewer: ReviewerContext; bundle: ActivationBundleV2; plan: MutationPlan;
  activation: CustomerActivation; receipt: SyncReceipt; recordedTarget: TargetState; plannerTarget: TargetState;
};
export type ValidatedFirstImport = ImportContents & { approvedTarget: TargetState; identityLocks: ImportIdentityLocks };
type ImportRow = ScopeRow & {
  idempotency_key: string; activation_id: string; receipt_id: string; bundle_hash: string; plan_hash: string;
  recorded_snapshot_hash: string; planner_snapshot_hash: string; approved_snapshot_hash: string; target_version: string;
} & Record<EncodedField | `${EncodedField}_digest`, string>;

const schemas = {
  request: ActivationRequestSchema, reviewer: ReviewerContextSchema, bundle: ActivationBundleV2Schema,
  plan: MutationPlanSchema, activation: CustomerActivationSchema, receipt: SyncReceiptSchema,
  recorded_target: TargetStateSchema, planner_target: TargetStateSchema,
} as const;
type EncodedField = keyof typeof schemas;

export type StoredActivation = ImportContents & {
  approvedTarget: StoredTarget; requestHash: string; bundleHash: string;
};
export type ReceiptExpectation = { scope: Scope; requestHash: string; bundleHash: string };
export type ReceiptAssociation = { status: 'absent' | 'conflict' } | { status: 'exact'; stored: StoredActivation };

function assertImport(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error('Inconsistent first import ' + field);
}

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

function parseContents(input: ImportContents): ImportContents {
  return {
    request: schemas.request.parse(input.request), reviewer: schemas.reviewer.parse(input.reviewer),
    bundle: schemas.bundle.parse(input.bundle), plan: schemas.plan.parse(input.plan),
    activation: schemas.activation.parse(input.activation), receipt: schemas.receipt.parse(input.receipt),
    recordedTarget: validateSnapshot(input.recordedTarget), plannerTarget: validateSnapshot(input.plannerTarget),
  };
}

function resolvePointer(record: object, pointer: string): unknown {
  let value: unknown = record;
  for (const segment of pointer.split('/').slice(1)) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function checkLineage(plan: MutationPlan, lineage: FieldLineage) {
  const operation = plan.operations[lineage.operationIndex];
  assertImport(operation && resolvePointer(operation.record, lineage.targetField) !== undefined, 'lineage operation or pointer');
}

type FinancialOperation = Extract<MutationOperation, { op: 'insert_invoice' | 'insert_payment' | 'insert_credit' | 'add_allocation' | 'full_reverse' }>;
type MetadataOperation = Exclude<MutationOperation, FinancialOperation>;
function isFinancial(operation: MutationOperation): operation is FinancialOperation {
  return 'identity' in operation.record;
}

function validateImport(contents: ImportContents, approved: TargetState) {
  const { request, reviewer, bundle, plan, activation, receipt, recordedTarget, plannerTarget } = contents;
  const { scope } = activation;
  const { manifest, artifact, reviewPackage } = bundle;
  const profile = bundle.profiles.find(candidate => candidate.hash === plan.profileHash);
  assertImport(equal(request, bundle.request) && equal(reviewer, bundle.reviewer) && equal(plan, bundle.previewPlan),
    'canonical request, reviewer or plan');
  assertImport(bundle.hash === hashBundleV2(bundle) && plan.hash === hashPlan(plan) &&
    artifact.hash === hashArtifact(artifact) && manifest.hash === hashManifest(manifest) &&
    reviewPackage.hash === hashReviewPackage(reviewPackage) && profile && hashProfile(profile) === profile.hash, 'domain hash');
  assertImport([plan.scope, reviewPackage.scope, profile.scope, receipt.scope, recordedTarget.scope, plannerTarget.scope, approved.scope]
    .every(candidate => sameScope(scope, candidate)) && manifest.companyId === scope.companyId &&
    profile.sourceRef === manifest.sourceRef, 'scope');
  assertImport(request.reviewPackageId === reviewPackage.id && request.expectedPackageHash === reviewPackage.hash &&
    request.expectedArtifactHash === artifact.hash && request.expectedProfileHash === profile.hash &&
    request.expectedTargetVersion === plan.expectedTargetVersion && reviewPackage.expectedTargetVersion === plan.expectedTargetVersion &&
    reviewPackage.artifactHash === artifact.hash && reviewPackage.profileHash === profile.hash &&
    reviewPackage.manifestHash === manifest.hash && reviewPackage.previewPlanHash === plan.hash, 'review bindings');

  const { bootstrapVerification, financialAttestation, verificationReport, snapshot, bootstrapEvents } = bundle;
  assertImport(unique(bootstrapEvents, event => event.id) &&
    bootstrapEvents.every(event => event.contentHash === hashEvent(event)), 'captured delivery hash or ID');
  const eventsHash = hashCanonical([...bootstrapEvents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const proofBinding = bootstrapVerification.binding;
  assertImport(bootstrapVerification.hash === hashBootstrapVerificationResult(bootstrapVerification) &&
    bootstrapVerification.planHash === plan.hash && sameScope(proofBinding.scope, scope) &&
    proofBinding.artifactHash === artifact.hash && proofBinding.profileHash === profile.hash &&
    proofBinding.manifestId === manifest.id && proofBinding.manifestHash === manifest.hash &&
    proofBinding.snapshotId === snapshot.id && proofBinding.snapshotHash === snapshot.contentHash &&
    proofBinding.eventsHash === eventsHash && proofBinding.targetSnapshotHash === hashTargetSnapshot(plannerTarget) &&
    proofBinding.expectedTargetVersion === plan.expectedTargetVersion && proofBinding.asOf === plan.asOf, 'bootstrap proof bindings');
  const { reservation } = financialAttestation;
  const { capture } = reservation;
  assertImport(financialAttestation.hash === hashFinancialAttestation(financialAttestation) &&
    reservation.hash === hashFinancialReservation(reservation) && reservation.artifactHash === artifact.hash &&
    capture.companyId === scope.companyId && capture.sourceRef === manifest.sourceRef && capture.manifestId === manifest.id &&
    capture.manifestHash === manifest.hash && capture.snapshotId === snapshot.id && capture.snapshotHash === snapshot.contentHash &&
    capture.snapshotObjectHash === hashCanonical(snapshot) && capture.eventsHash === eventsHash &&
    snapshot.sourceRef === manifest.sourceRef && snapshot.manifestId === manifest.id &&
    financialAttestation.reportHash === hashFinancialReport(verificationReport) &&
    financialAttestation.reportId === verificationReport.id && reviewPackage.verificationReportId === verificationReport.id &&
    verificationReport.artifactHash === artifact.hash && verificationReport.manifestHash === manifest.hash,
  'financial proof bindings');

  const cursors = manifest.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter }))
    .sort((a, b) => a.streamId < b.streamId ? -1 : a.streamId > b.streamId ? 1 : 0);
  assertImport(activation.epoch === 1 && activation.status === 'active' &&
    activation.artifactHash === artifact.hash && activation.artifactHash === plan.artifactHash &&
    activation.profileHash === profile.hash && activation.manifestHash === manifest.hash &&
    activation.reviewerId === reviewer.reviewerId && equal(activation.baselineCursors, cursors) &&
    equal([...activation.allowedKinds].sort(), [...artifact.normalizedPlan.allowedKinds].sort()), 'activation bindings');

  assertImport(recordedTarget.version === plan.expectedTargetVersion && plan.asOf === manifest.asOf &&
    equal({ ...recordedTarget, asOf: plan.asOf }, plannerTarget), 'recorded and planner targets');
  const records = plan.operations.filter(isFinancial).map(operation => operation.record);
  assertImport(records.length > 0 && unique(records, record => record.id) && unique(plan.eventIds, id => id),
    'nonempty distinct financial effects and deliveries');
  const projected = validateSnapshot({ ...projectBootstrapTarget(plannerTarget, plan.operations), version: plannerTarget.version + 1 });
  assertImport(equal(projected, approved), 'approved target differs from projected plan');
  assertImport(receipt.activationId === activation.id && receipt.epoch === activation.epoch &&
    receipt.artifactHash === artifact.hash && receipt.planHash === plan.hash &&
    equal(receipt.eventIds, plan.eventIds) && equal(receipt.targetRecordIds, records.map(record => record.id)) &&
    receipt.beforeBalanceCents === computeBalance(plannerTarget, plan.asOf) &&
    receipt.afterBalanceCents === computeBalance(approved, plan.asOf) &&
    receipt.afterBalanceCents === plan.expectedBalanceCents, 'receipt bindings or balances');

  const byId = new Map(bootstrapEvents.map(event => [event.id, event]));
  const events = plan.eventIds.map(id => {
    const event = byId.get(id);
    assertImport(event && event.sourceRef === manifest.sourceRef, 'selected delivery');
    return event;
  });
  const selected = new Map(events.map(event => [event.id, event]));
  const projectedById = new Map(financialRecords(approved).map(record => [record.id, record]));
  const matchesEvent = (record: FinancialRecord, event: RawSourceEvent) =>
    event.kind === record.kind && event.recordId === record.identity.recordId && event.sourceRef === record.identity.sourceRef &&
    event.rawIdentity.sellerEntityId === scope.sellerEntityId && event.rawIdentity.companyId === scope.companyId;
  assertImport(records.every(record => {
    const event = selected.get(record.sourceEventId);
    return event && matchesEvent(record, event) && event.recordVersion === record.sourceRecordVersion;
  }) && events.every(event => {
    if (event.kind === 'semantic_change') return false;
    const record = projectedById.get(targetRecordId({
      sourceRef: event.sourceRef, sellerEntityId: scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
    }));
    return record && matchesEvent(record, event);
  }), 'financial delivery membership');
  plan.lineage.forEach(lineage => checkLineage(plan, lineage));
  return { records, events };
}

async function decodeImport(client: PoolClient, row: ImportRow): Promise<StoredActivation> {
  function read<T>(field: EncodedField, schema: { parse(input: unknown): T }): T {
    return decodeCanonical(schema, row[field], row[`${field}_digest`]);
  }
  const contents = {
    request: read('request', schemas.request), reviewer: read('reviewer', schemas.reviewer),
    bundle: read('bundle', schemas.bundle), plan: read('plan', schemas.plan),
    activation: read('activation', schemas.activation), receipt: read('receipt', schemas.receipt),
    recordedTarget: read('recorded_target', schemas.recorded_target), plannerTarget: read('planner_target', schemas.planner_target),
  };
  const scope = scopeOf(row);
  assertImport(sameScope(scope, contents.activation.scope) && row.activation_id === contents.activation.id &&
    row.receipt_id === contents.receipt.id && row.idempotency_key === contents.request.idempotencyKey &&
    row.plan_hash === contents.plan.hash && row.bundle_hash === contents.bundle.hash &&
    row.recorded_snapshot_hash === hashTargetSnapshot(contents.recordedTarget) &&
    row.planner_snapshot_hash === hashTargetSnapshot(contents.plannerTarget), 'stored indexes');
  const approvedTarget = await readStoredTarget(client, scope, row.approved_snapshot_hash);
  assertImport(approvedTarget && approvedTarget.records.version === readVersion(row.target_version), 'stored approved snapshot');
  validateImport(contents, approvedTarget.records);
  return { ...contents, approvedTarget, requestHash: row.request_digest, bundleHash: row.bundle_hash };
}

export async function readStoredActivation(client: PoolClient, input: Scope): Promise<StoredActivation | null> {
  const scope = ScopeSchema.parse(input);
  const { rows: [row] } = await client.query<ImportRow>(
    'SELECT * FROM runtime_activation_imports WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3',
    scopeValues(scope),
  );
  return row ? decodeImport(client, row) : null;
}

export async function lookupReceiptAssociation(
  client: PoolClient, key: string, expected: ReceiptExpectation,
): Promise<ReceiptAssociation> {
  const row = await readImportByKey(client, IdSchema.parse(key));
  const scope = ScopeSchema.parse(expected.scope);
  const requestHash = HashSchema.parse(expected.requestHash);
  const bundleHash = HashSchema.parse(expected.bundleHash);
  if (!row) return { status: 'absent' };
  if (!sameScope(scope, scopeOf(row)) || row.request_digest !== requestHash || row.bundle_hash !== bundleHash) {
    return { status: 'conflict' };
  }
  return { status: 'exact', stored: await decodeImport(client, row) };
}

async function readImportByKey(client: PoolClient, key: string) {
  const { rows: [row] } = await client.query<ImportRow>(
    'SELECT * FROM runtime_activation_imports WHERE idempotency_key = $1', [key],
  );
  return row;
}

declare const scopeLockBrand: unique symbol;
export type LockedFirstImport = {
  readonly [scopeLockBrand]: true;
  readonly target: StoredTarget | null;
  readonly existingActivation: StoredActivation | null;
  readonly keyOccupied: boolean;
};
const scopesLocked = new WeakMap<LockedFirstImport, { client: PoolClient; scope: Scope; key: string }>();

/** Locks scope, global request key, then current target. The caller owns transaction lifetime. */
export async function lockFirstImport(client: PoolClient, input: Scope, inputKey: string): Promise<LockedFirstImport> {
  const scope = ScopeSchema.parse(input);
  const key = IdSchema.parse(inputKey);
  const values = scopeValues(scope);
  await lockParentKeys(client, [canonicalJson(['parent-scope', scope.accountId])]);
  await client.query(
    'INSERT INTO parent_scopes (account_id, company_id, seller_entity_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', values,
  );
  const { rows: [row] } = await client.query<ScopeRow>('SELECT * FROM parent_scopes WHERE account_id = $1', [scope.accountId]);
  assertImport(row && sameScope(scope, scopeOf(row)), 'scope mapping');
  await lockParentKeys(client, [canonicalJson(['parent-import-key', key])]);
  await client.query(
    'SELECT 1 FROM parent_targets WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3 FOR UPDATE', values,
  );
  const target = await readStoredTarget(client, scope);
  const existingActivation = await readStoredActivation(client, scope);
  const keyOccupied = !!await readImportByKey(client, key);
  const locked = { target, existingActivation, keyOccupied } as LockedFirstImport;
  scopesLocked.set(locked, { client, scope, key });
  return locked;
}

async function insertAggregate(client: PoolClient, contents: ImportContents, approved: TargetState) {
  const { activation, receipt, request, bundle, plan, reviewer, recordedTarget, plannerTarget } = contents;
  const encoded = { request, reviewer, bundle, plan, activation, receipt, recorded_target: recordedTarget, planner_target: plannerTarget };
  const fields = Object.keys(schemas) as EncodedField[];
  const values = [
    ...scopeValues(activation.scope), request.idempotencyKey, activation.id, receipt.id, bundle.hash, plan.hash,
    hashTargetSnapshot(recordedTarget), hashTargetSnapshot(plannerTarget), hashTargetSnapshot(approved), approved.version,
    ...fields.flatMap(field => encodeCanonical(encoded[field])),
  ];
  await client.query(
    `INSERT INTO runtime_activation_imports
       (account_id, company_id, seller_entity_id, idempotency_key, activation_id, receipt_id, bundle_hash, plan_hash,
        recorded_snapshot_hash, planner_snapshot_hash, approved_snapshot_hash, target_version,
        ${fields.flatMap(field => [field, field + '_digest']).join(', ')})
     VALUES (${values.map((_, index) => '$' + (index + 1)).join(', ')})`, values,
  );
}

const metadataFamilies = {
  ensure_customer: 'customer', ensure_account: 'account', ensure_billing_configuration: 'billing_configuration',
} as const;

async function ensureMetadata(client: PoolClient, scope: Scope, operation: MetadataOperation) {
  const { record } = operation;
  const family = metadataFamilies[operation.op];
  const key = [...scopeValues(scope), family, record.id];
  const [canonical, digest] = encodeCanonical(record);
  const { rows: [existing] } = await client.query<{ canonical: string; digest: string }>(
    `SELECT canonical, digest FROM parent_metadata
     WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3 AND family = $4 AND record_id = $5`, key,
  );
  if (existing) {
    assertImport(existing.canonical === canonical && existing.digest === digest, 'existing metadata bytes');
    return;
  }
  await client.query(
    `INSERT INTO parent_metadata (account_id, company_id, seller_entity_id, family, record_id, customer_id, canonical, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...key, 'parentCustomerId' in record ? record.parentCustomerId : null, canonical, digest],
  );
}

async function insertEconomicOutcome(client: PoolClient, record: FinancialRecord, key: string, receiptId: string) {
  const { identity } = record;
  const columns = [...scopeValues(record.scope), identity.sourceRef, record.kind, identity.recordId, record.id];
  const existing = await client.query(
    `SELECT 1 FROM parent_financial_records
     WHERE record_id = $1 OR (source_ref, seller_entity_id, kind, source_record_id) = ($2, $3, $4, $5)`,
    [record.id, identity.sourceRef, identity.sellerEntityId, identity.kind, identity.recordId],
  );
  assertImport(!existing.rowCount, 'global economic identity already exists');
  await client.query(
    `INSERT INTO parent_financial_records
       (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id,
        source_record_version, event_id, canonical, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [...columns, record.sourceRecordVersion, record.sourceEventId, ...encodeCanonical(record)],
  );
  await client.query(
    `INSERT INTO runtime_economic_outcomes
       (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id, idempotency_key, receipt_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [...columns, key, receiptId],
  );
}

async function insertDeliveryOutcome(client: PoolClient, scope: Scope, event: RawSourceEvent, key: string, receiptId: string) {
  const delivery = [event.sourceRef, event.id];
  const [canonical, digest] = encodeCanonical(event);
  const { rows: [existing] } = await client.query<{ canonical: string; digest: string; content_hash: string }>(
    'SELECT canonical, digest, content_hash FROM runtime_deliveries WHERE source_ref = $1 AND event_id = $2', delivery,
  );
  if (existing) {
    assertImport(existing.canonical === canonical && existing.digest === digest && existing.content_hash === event.contentHash,
      'existing delivery bytes');
  } else {
    await client.query(
      'INSERT INTO runtime_deliveries (source_ref, event_id, content_hash, canonical, digest) VALUES ($1, $2, $3, $4, $5)',
      [...delivery, event.contentHash, canonical, digest],
    );
  }
  await client.query(
    `INSERT INTO runtime_delivery_outcomes
       (account_id, company_id, seller_entity_id, source_ref, event_id, idempotency_key, receipt_id, outcome)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'applied')`, [...scopeValues(scope), ...delivery, key, receiptId],
  );
}

async function insertApprovedSnapshot(client: PoolClient, state: TargetState, previous: StoredTarget | null) {
  const scope = scopeValues(state.scope);
  const hash = hashTargetSnapshot(state);
  await client.query(
    `INSERT INTO parent_snapshots
       (account_id, company_id, seller_entity_id, target_version, snapshot_hash, recorded_as_of, canonical, digest)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [...scope, state.version, hash, state.asOf, ...encodeCanonical(state)],
  );
  const result = previous
    ? await client.query(
      `UPDATE parent_targets SET target_version = $4, snapshot_hash = $5
       WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3
         AND target_version = $6 AND snapshot_hash = $7`,
      [...scope, state.version, hash, previous.records.version, previous.snapshotHash],
    )
    : await client.query(
      `INSERT INTO parent_targets (account_id, company_id, seller_entity_id, target_version, snapshot_hash)
       VALUES ($1, $2, $3, $4, $5)`, [...scope, state.version, hash],
    );
  if (result.rowCount !== 1) throw new Error('Stored target changed during first import');
}

/**
 * Stores the caller's validated first import in its open transaction using locks from this attempt.
 * The transaction owner must let a rejected import abort the entire callback.
 */
export async function persistFirstImport(
  client: PoolClient, locked: LockedFirstImport, input: ValidatedFirstImport,
): Promise<StoredActivation> {
  const bound = scopesLocked.get(locked);
  assertImport(bound?.client === client, 'scope lock');
  const contents = parseContents(input);
  const { activation, request, receipt, plan, recordedTarget } = contents;
  const { scope } = activation;
  const key = request.idempotencyKey;
  assertImport(sameScope(bound.scope, scope) && bound.key === key, 'locked scope or request key');
  const association = await lookupReceiptAssociation(client, key, {
    scope, requestHash: hashCanonical(request), bundleHash: contents.bundle.hash,
  });
  if (association.status === 'exact') {
    assertImport(equal(request, association.stored.request) && equal(contents.bundle, association.stored.bundle),
      'replay request or bundle bytes');
    return association.stored;
  }
  assertImport(association.status === 'absent' && !await readStoredActivation(client, scope), 'existing activation or key');
  const previous = await readStoredTarget(client, scope);
  assertImport(previous ? equal(previous.records, recordedTarget) :
    recordedTarget.version === 0 && financialRecords(recordedTarget).length === 0 &&
      !recordedTarget.customers.length && !recordedTarget.accounts.length && !recordedTarget.billingConfigurations.length,
  'baseline does not match stored target');

  const approvedTarget = validateSnapshot(input.approvedTarget);
  const { records, events } = validateImport(contents, approvedTarget);
  requireImportIdentityLocks(client, input.identityLocks, records.map(record => record.identity), events);
  await insertApprovedSnapshot(client, approvedTarget, previous);
  await insertAggregate(client, contents, approvedTarget);
  for (const operation of plan.operations) {
    if (!isFinancial(operation)) await ensureMetadata(client, scope, operation);
  }
  for (const record of records) await insertEconomicOutcome(client, record, key, receipt.id);
  for (const event of events) await insertDeliveryOutcome(client, scope, RawSourceEventSchema.parse(event), key, receipt.id);
  for (const [ordinal, lineage] of plan.lineage.entries()) {
    await client.query(
      `INSERT INTO runtime_import_lineage
         (account_id, company_id, seller_entity_id, idempotency_key, receipt_id,
          ordinal, operation_index, target_pointer, canonical, digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [...scopeValues(scope), key, receipt.id, ordinal, lineage.operationIndex, lineage.targetField, ...encodeCanonical(lineage)],
    );
  }
  await publishActivity(client, {
    stream: 'runtime', phase: 'run', type: 'customer.activated', scope, at: receipt.committedAt,
    payload: { receiptId: receipt.id, artifactHash: activation.artifactHash, manifestHash: activation.manifestHash,
      planHash: plan.hash, snapshotHash: hashTargetSnapshot(approvedTarget), status: 'active' },
  });
  const stored = await readStoredActivation(client, scope);
  assertImport(stored, 'stored activation is unavailable');
  return stored;
}
