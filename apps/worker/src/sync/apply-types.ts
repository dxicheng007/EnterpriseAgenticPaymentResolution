import { z } from 'zod';
import {
  CaptureLaneV1Schema, CommittedAuthorityIdentityV1Schema, HashSchema, IdSchema, IsoInstantSchema,
  MutationPlanSchema, NonnegativeIntegerSchema, RawSourceEventSchema, VersionSchema,
  canonicalJson, hashCanonical, hashEvent, hashManifest, hashPlan, strict, targetRecordId, unique,
  type MutationPlan,
} from '@eapr/contracts';
import { CoverageCutSchema, hashSyncUnit, syncEventRef, type CoverageCut } from '@eapr/parent/sync-store';

export type SyncApplyCode =
  | 'SYNC_BINDING_MISMATCH' | 'SYNC_TARGET_STALE' | 'SYNC_PLAN_MISMATCH' | 'SYNC_INVALID_PLAN'
  | 'SYNC_COVERAGE_UNSUPPORTED' | 'SYNC_COVERAGE_CHANGED' | 'SYNC_STORAGE_INVALID' | 'SYNC_NO_PENDING'
  | 'SYNC_SOURCE_UNAVAILABLE';

export class SyncApplyError extends Error {
  constructor(readonly code: SyncApplyCode) {
    super(code);
    this.name = 'SyncApplyError';
  }
}

export const syncHistoryLimit = 1000;
export const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

export function requireSync(condition: unknown, code: SyncApplyCode = 'SYNC_STORAGE_INVALID'): asserts condition {
  if (!condition) throw new SyncApplyError(code);
}

const ordered = <T>(rows: T[], key: (row: T) => string) =>
  rows.every((row, index) => index === 0 || key(rows[index - 1]!) < key(row));

/** Cross-check the independent indexes retained in a cut and return its exact unapplied subject. */
export function validateCoverage(cut: CoverageCut) {
  const { identity, lane, manifest, capture, checkpoints, guards } = cut;
  requireSync(!guards.outOfCut && !guards.unmatchedLegacyHistory);
  requireSync(!guards.overflow && !guards.extraLane && !guards.undeclaredStream &&
    !guards.nonselectedPostBaseline && !guards.incident, 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(manifest.sourceRef === lane.sourceRef && manifest.hash === lane.manifestHash &&
    manifest.companyId === identity.scope.companyId && manifest.hash === hashManifest(manifest) &&
    cut.manifestDigest === hashCanonical(manifest) && cut.captureDigest === hashCanonical(capture));
  const api = capture.find(stream => stream.transport === 'api');
  const semantic = capture.find(stream => stream.transport === 'semantic');
  requireSync(capture.length === 2 && manifest.streams.length === 2 && api && semantic &&
    !manifest.files.some(file => file.kind === 'event_csv'), 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(checkpoints.length === 2 && ordered(capture, row => row.streamId) &&
    ordered(checkpoints, row => row.streamId) && ordered(cut.applicationHeads, row => row.streamId));

  const heads = new Map(cut.applicationHeads.map(row => [row.streamId, row]));
  for (const stream of capture) {
    const checkpoint = checkpoints.find(row => row.streamId === stream.streamId);
    const baseline = manifest.streams.find(row => row.streamId === stream.streamId)?.resumeAfter;
    requireSync(checkpoint && checkpoint.transport === stream.transport && checkpoint.baselineCursor === baseline &&
      Number(checkpoint.captureCursor) >= Number(checkpoint.baselineCursor) &&
      (checkpoint.captureCursor === baseline) === (checkpoint.capturedPages === '0') &&
      (checkpoint.captureCursor === baseline) === (checkpoint.lastCapturedAt === null));
    const head = heads.get(stream.streamId);
    requireSync(!head || (head.baselineCursor === baseline && Number(head.appliedThrough) >= Number(baseline) &&
      Number(head.appliedThrough) <= Number(checkpoint.captureCursor) &&
      (head.appliedThrough === baseline) === (head.lastUnitHash === null)));
    requireSync(stream.transport === 'api' || checkpoint.captureCursor === baseline, 'SYNC_COVERAGE_UNSUPPORTED');
  }
  requireSync(cut.applicationHeads.every(row => checkpoints.some(checkpoint => checkpoint.streamId === row.streamId)));

  const streamId = api.streamId;
  const checkpoint = checkpoints.find(row => row.streamId === streamId)!;
  const head = heads.get(streamId);
  const baseline = Number(checkpoint.baselineCursor);
  const from = Number(head?.appliedThrough ?? checkpoint.baselineCursor);
  const through = Number(checkpoint.captureCursor);
  const retained = through - baseline;
  requireSync(retained <= syncHistoryLimit, 'SYNC_COVERAGE_UNSUPPORTED');
  requireSync(cut.positions.length === retained && cut.inbox.length === retained && cut.deliveries.length === retained &&
    cut.historyOutcomes.length === from - baseline && Number(checkpoint.capturedPages) === cut.pages.length);

  const events = cut.deliveries.map(row => row.event);
  requireSync(unique(events, event => event.id));
  for (const [index, event] of events.entries()) {
    const inbox = cut.inbox[index]!;
    const expected = { sourceRef: lane.sourceRef, streamId, sequence: baseline + index + 1, eventId: event.id };
    requireSync(event.sourceRef === lane.sourceRef && event.streamId === streamId && event.sequence === expected.sequence &&
      event.rawIdentity.companyId === identity.scope.companyId && api.resources.includes(event.resource) &&
      event.contentHash === hashEvent(event) && cut.deliveries[index]!.digest === hashCanonical(event) &&
      equal(cut.positions[index], expected) && equal(inbox, { ...expected, manifestHash: lane.manifestHash, afterCursor: inbox.afterCursor }));
    requireSync(event.kind !== 'semantic_change' && event.rawIdentity.sellerEntityId === identity.scope.sellerEntityId,
      'SYNC_COVERAGE_UNSUPPORTED');
  }

  let cursor = baseline;
  for (const page of cut.pages) {
    const end = Number(page.nextCursor);
    const members = events.slice(cursor - baseline, end - baseline);
    requireSync(page.sourceRef === lane.sourceRef && page.manifestHash === lane.manifestHash && page.streamId === streamId &&
      Number(page.afterCursor) === cursor && end <= through && end - cursor === page.eventCount &&
      page.eventCount <= api.pageSize && cut.inbox.slice(cursor - baseline, end - baseline).every(row => row.afterCursor === page.afterCursor) &&
      page.digest === hashCanonical({
        sourceRef: lane.sourceRef, streamId, after: page.afterCursor, next: page.nextCursor, complete: true, events: members,
      }));
    cursor = end;
  }
  requireSync(cursor === through && (cut.pages.at(-1)?.capturedAt ?? null) === checkpoint.lastCapturedAt);

  const units = new Map(cut.historyUnits.map(unit => [unit.unitHash, unit]));
  const originIds = new Set(cut.historyOrigins.map(origin => origin.recordId));
  requireSync(units.size === cut.historyUnits.length && ordered(cut.historyOrigins, origin => origin.recordId) &&
    originIds.size === new Set(cut.historyOutcomes.map(outcome => outcome.recordId)).size);
  for (const [index, outcome] of cut.historyOutcomes.entries()) {
    const unit = units.get(outcome.unitHash);
    requireSync(unit && equal(outcome.event, syncEventRef(events[index]!)) && originIds.has(outcome.recordId) &&
      outcome.event.sequence > Number(unit.fromCursor) && outcome.event.sequence <= Number(unit.throughCursor));
  }
  cursor = baseline;
  let beforeVersion = cut.baseline.approvedTargetVersion;
  let beforeHash = cut.baseline.approvedSnapshotHash;
  for (const unit of cut.historyUnits) {
    requireSync(unit.streamId === streamId && Number(unit.fromCursor) === cursor && Number(unit.throughCursor) > cursor &&
      Number(unit.throughCursor) <= from && unit.beforeTargetVersion === beforeVersion && unit.beforeSnapshotHash === beforeHash &&
      (unit.receiptId === null
        ? unit.afterTargetVersion === beforeVersion && unit.afterSnapshotHash === beforeHash
        : unit.afterTargetVersion === beforeVersion + 1));
    cursor = Number(unit.throughCursor);
    beforeVersion = unit.afterTargetVersion;
    beforeHash = unit.afterSnapshotHash;
  }
  requireSync(cursor === from && (cut.historyUnits.at(-1)?.unitHash ?? null) === (head?.lastUnitHash ?? null));
  return { streamId, beforeVersion, beforeHash, events: events.slice(from - baseline) };
}

export function validatePlanIndexes(plan: MutationPlan, subject: {
  identity: CoverageCut['identity']; expectedTargetVersion: number; asOf: string; events: CoverageCut['deliveries'][number]['event'][];
}) {
  const { identity, expectedTargetVersion, asOf, events } = subject;
  const inputById = new Map(events.map(event => [event.id, event]));
  requireSync(plan.hash === hashPlan(plan) && equal(plan.scope, identity.scope) && plan.expectedTargetVersion === expectedTargetVersion &&
    plan.asOf === asOf && equal(plan.eventIds, events.map(event => event.id)) && plan.operations.length > 0 &&
    plan.operations.length <= events.length && unique(plan.operations, operation => operation.record.id) &&
    unique(plan.operations, operation => 'sourceEventId' in operation.record ? operation.record.sourceEventId : ''), 'SYNC_INVALID_PLAN');
  for (const { record } of plan.operations) {
    requireSync('identity' in record, 'SYNC_INVALID_PLAN');
    const event = inputById.get(record.sourceEventId);
    requireSync(event && record.sourceRecordVersion === event.recordVersion && equal(record.scope, identity.scope) &&
      equal(record.identity, { sourceRef: event.sourceRef, sellerEntityId: identity.scope.sellerEntityId, kind: event.kind, recordId: event.recordId }) &&
      record.id === targetRecordId(record.identity), 'SYNC_INVALID_PLAN');
  }
  const bound = new Set<number>();
  for (const line of plan.lineage) {
    const operation = plan.operations[line.operationIndex];
    requireSync(operation && 'sourceEventId' in operation.record && line.sourceEventIds.includes(operation.record.sourceEventId) &&
      line.sourceEventIds.every(id => inputById.has(id)), 'SYNC_INVALID_PLAN');
    let value: unknown = operation.record;
    for (const segment of line.targetField.slice(1).split('/')) {
      const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
      requireSync(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'SYNC_INVALID_PLAN');
      value = (value as Record<string, unknown>)[key];
    }
    bound.add(line.operationIndex);
  }
  requireSync(bound.size === plan.operations.length, 'SYNC_INVALID_PLAN');
}

export const PreparedSyncUnitSchema = strict({
  identity: CommittedAuthorityIdentityV1Schema, lane: CaptureLaneV1Schema, streamId: IdSchema,
  expectedEpoch: VersionSchema, expectedTargetVersion: NonnegativeIntegerSchema, beforeSnapshotHash: HashSchema,
  asOf: IsoInstantSchema, coverage: CoverageCutSchema, coverageHash: HashSchema,
  events: z.array(RawSourceEventSchema).min(1).max(syncHistoryLimit), plan: MutationPlanSchema.nullable(),
}).refine(subject => {
  try {
    const { identity, lane, streamId, expectedTargetVersion, beforeSnapshotHash, coverage, coverageHash, events, plan } = subject;
    const selected = validateCoverage(coverage);
    requireSync(equal(identity, coverage.identity) && equal(lane, coverage.lane) && streamId === selected.streamId &&
      expectedTargetVersion === selected.beforeVersion && beforeSnapshotHash === selected.beforeHash &&
      coverageHash === hashCanonical(coverage) && equal(events, selected.events));
    if (plan) validatePlanIndexes(plan, subject);
    return true;
  } catch {
    return false;
  }
}, 'Invalid prepared synchronization subject');

export type PreparedSyncUnit = z.infer<typeof PreparedSyncUnitSchema>;

export function hashPreparedUnit(subject: PreparedSyncUnit) {
  const { identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash, plan } = subject;
  return hashSyncUnit({
    identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash, planHash: plan?.hash ?? null,
  });
}
