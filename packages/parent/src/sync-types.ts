import { z } from 'zod';
import {
  BootstrapManifestSchema, CaptureLaneV1Schema, CaptureStreamSchema, CommittedAuthorityIdentityV1Schema,
  CursorSchema, HashSchema, IdSchema, IsoInstantSchema, NonnegativeIntegerSchema, RawSourceEventSchema,
  SemanticPreflightSchema, SyncReceiptSchema, VersionSchema, canonicalJson, hashCanonical, hashEvent, hashManifest,
  strict, unique, type RawSourceEvent, type SyncReceipt,
} from '@eapr/contracts';

const historyLimit = 1000;
const bounded = <T extends z.ZodType>(schema: T) => z.array(schema).max(historyLimit);
const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);

export const SyncEventRefSchema = strict({
  sourceRef: IdSchema, eventId: IdSchema, streamId: IdSchema, sequence: VersionSchema, contentHash: HashSchema,
});

export function syncEventRef({ sourceRef, id: eventId, streamId, sequence, contentHash }: RawSourceEvent) {
  return { sourceRef, eventId, streamId, sequence, contentHash };
}

export const ReceiptOriginSchema = z.union([
  strict({ kind: z.literal('initial'), recordId: IdSchema, importKey: IdSchema, receipt: SyncReceiptSchema }),
  strict({ kind: z.literal('sync'), recordId: IdSchema, receipt: SyncReceiptSchema }),
]).refine(origin => origin.receipt.targetRecordIds.includes(origin.recordId), 'Origin receipt must contain its record');

const memberShape = {
  event: SyncEventRefSchema, recordId: IdSchema, origin: ReceiptOriginSchema,
  disposition: z.enum(['new', 'replay', 'coalesced']),
};
export const UnitMemberSchema = strict(memberShape)
  .refine(member => member.recordId === member.origin.recordId, 'Origin must bind the member record');
export const SyncEventOutcomeSchema = strict({
  identity: CommittedAuthorityIdentityV1Schema, lane: CaptureLaneV1Schema, unitHash: HashSchema, ...memberShape,
}).refine(({ identity, lane, event, recordId, origin }) =>
  event.sourceRef === lane.sourceRef && recordId === origin.recordId &&
  identity.activationId === origin.receipt.activationId && equal(identity.scope, origin.receipt.scope),
'Event outcome must bind its lane and original receipt');

const checkpoint = strict({
  streamId: IdSchema, transport: z.enum(['api', 'semantic']), baselineCursor: CursorSchema,
  captureCursor: CursorSchema, capturedPages: CursorSchema, lastCapturedAt: IsoInstantSchema.nullable(),
});
const applicationHead = strict({
  streamId: IdSchema, baselineCursor: CursorSchema, appliedThrough: CursorSchema, lastUnitHash: HashSchema.nullable(),
});
const positionShape = {
  sourceRef: IdSchema, streamId: IdSchema, sequence: VersionSchema, eventId: IdSchema,
};
const position = strict(positionShape);
const inbox = strict({ ...positionShape, manifestHash: HashSchema, afterCursor: CursorSchema });
const delivery = strict({ event: RawSourceEventSchema, digest: HashSchema });
const page = strict({
  sourceRef: IdSchema, manifestHash: HashSchema, streamId: IdSchema, afterCursor: CursorSchema, nextCursor: CursorSchema,
  eventCount: VersionSchema.max(historyLimit), digest: HashSchema, capturedAt: IsoInstantSchema,
});
const baseline = strict({
  importKey: IdSchema, receiptId: IdSchema, activationDigest: HashSchema, bundleDigest: HashSchema,
  approvedSnapshotHash: HashSchema, approvedTargetVersion: NonnegativeIntegerSchema,
});
const historyUnit = strict({
  unitHash: HashSchema, auditDigest: HashSchema, streamId: IdSchema, fromCursor: CursorSchema, throughCursor: CursorSchema,
  beforeTargetVersion: NonnegativeIntegerSchema, beforeSnapshotHash: HashSchema,
  afterTargetVersion: NonnegativeIntegerSchema, afterSnapshotHash: HashSchema, receiptId: IdSchema.nullable(),
});
const historyOutcome = strict({
  event: SyncEventRefSchema, recordId: IdSchema, unitHash: HashSchema, disposition: memberShape.disposition, digest: HashSchema,
});
const historyOrigin = strict({
  recordId: IdSchema, initialImportKey: IdSchema.nullable(), initialReceiptId: IdSchema.nullable(),
  syncReceiptId: IdSchema.nullable(), receiptDigest: HashSchema,
}).refine(row => row.syncReceiptId === null
  ? row.initialImportKey !== null && row.initialReceiptId !== null
  : row.initialImportKey === null && row.initialReceiptId === null);

export const CoverageCutSchema = strict({
  identity: CommittedAuthorityIdentityV1Schema, lane: CaptureLaneV1Schema,
  manifest: BootstrapManifestSchema, capture: z.array(CaptureStreamSchema).max(2),
  manifestDigest: HashSchema, captureDigest: HashSchema, initialActivationId: IdSchema, initializedAt: IsoInstantSchema,
  baseline, checkpoints: z.array(checkpoint).max(2), applicationHeads: z.array(applicationHead).max(2),
  positions: bounded(position), inbox: bounded(inbox), deliveries: bounded(delivery), pages: bounded(page),
  historyUnits: bounded(historyUnit), historyOutcomes: bounded(historyOutcome), historyOrigins: bounded(historyOrigin),
  guards: strict({
    overflow: z.boolean(), extraLane: z.boolean(), undeclaredStream: z.boolean(), nonselectedPostBaseline: z.boolean(),
    outOfCut: z.boolean(), incident: z.boolean(), unmatchedLegacyHistory: z.boolean(),
  }),
});

const unitKeyShape = {
  identity: CommittedAuthorityIdentityV1Schema, lane: CaptureLaneV1Schema, streamId: IdSchema,
  expectedEpoch: VersionSchema, expectedTargetVersion: NonnegativeIntegerSchema, beforeSnapshotHash: HashSchema,
  asOf: IsoInstantSchema, coverageHash: HashSchema, planHash: HashSchema.nullable(),
};
const unitKey = strict(unitKeyShape);

export function hashSyncUnit(key: z.infer<typeof unitKey>) {
  return hashCanonical(unitKey.parse(key));
}

function orderedById<T>(rows: readonly T[], key: (row: T) => string) {
  return rows.every((row, index) => index === 0 || key(rows[index - 1]!) < key(row));
}

/** Validates the complete bounded witness that a terminal unit retained at commit. */
function validCoverage(audit: z.infer<typeof auditShape>) {
  const { coverage: cut, identity, lane, streamId, members } = audit;
  if (!equal(cut.identity, identity) || !equal(cut.lane, lane) || Object.values(cut.guards).some(Boolean) ||
      cut.manifest.sourceRef !== lane.sourceRef || cut.manifest.hash !== lane.manifestHash ||
      cut.manifest.companyId !== identity.scope.companyId || cut.manifest.hash !== hashManifest(cut.manifest) ||
      cut.manifestDigest !== hashCanonical(cut.manifest) || cut.captureDigest !== hashCanonical(cut.capture) ||
      cut.capture.length !== 2 || cut.checkpoints.length !== 2 || cut.manifest.streams.length !== 2 ||
      !orderedById(cut.capture, row => row.streamId) || !orderedById(cut.checkpoints, row => row.streamId) ||
      !orderedById(cut.applicationHeads, row => row.streamId)) return false;

  const financial = cut.checkpoints.find(row => row.streamId === streamId && row.transport === 'api');
  const semantic = cut.checkpoints.find(row => row.transport === 'semantic');
  if (!financial || !semantic || semantic.captureCursor !== semantic.baselineCursor) return false;

  const heads = new Map(cut.applicationHeads.map(head => [head.streamId, head]));
  const head = heads.get(streamId);
  const from = Number(audit.fromCursor);
  const through = Number(audit.throughCursor);
  const baselineCursor = Number(financial.baselineCursor);
  const retained = through - baselineCursor;
  if (audit.fromCursor !== (head?.appliedThrough ?? financial.baselineCursor) || audit.throughCursor !== financial.captureCursor ||
      from < baselineCursor || through <= from || retained > historyLimit || members.length !== through - from ||
      cut.positions.length !== retained || cut.inbox.length !== retained || cut.deliveries.length !== retained ||
      cut.historyOutcomes.length !== from - baselineCursor || Number(financial.capturedPages) !== cut.pages.length) return false;

  if (!cut.checkpoints.every(row => {
    const currentHead = heads.get(row.streamId);
    return row.transport === cut.capture.find(stream => stream.streamId === row.streamId)?.transport &&
      row.baselineCursor === cut.manifest.streams.find(stream => stream.streamId === row.streamId)?.resumeAfter &&
      (row.captureCursor === row.baselineCursor) === (row.capturedPages === '0') &&
      (row.captureCursor === row.baselineCursor) === (row.lastCapturedAt === null) &&
      (!currentHead || (currentHead.baselineCursor === row.baselineCursor &&
        (currentHead.appliedThrough === currentHead.baselineCursor) === (currentHead.lastUnitHash === null) &&
        (row.transport === 'api' || currentHead.appliedThrough === row.baselineCursor)));
  }) || cut.applicationHeads.some(row => row.streamId !== streamId && row.streamId !== semantic.streamId)) return false;

  const events = cut.deliveries.map(row => row.event);
  const declared = cut.capture.find(row => row.streamId === streamId)!;
  if (!unique(events, event => event.id) || !events.every((event, index) => {
    const member = cut.inbox[index]!;
    const expected = { sourceRef: lane.sourceRef, streamId, sequence: baselineCursor + index + 1, eventId: event.id };
    return event.sourceRef === lane.sourceRef && event.streamId === streamId && event.sequence === expected.sequence &&
      event.kind !== 'semantic_change' && event.rawIdentity.companyId === identity.scope.companyId &&
      event.rawIdentity.sellerEntityId === identity.scope.sellerEntityId && declared.resources.includes(event.resource) &&
      event.contentHash === hashEvent(event) && cut.deliveries[index]!.digest === hashCanonical(event) &&
      equal(cut.positions[index], expected) && member.manifestHash === lane.manifestHash &&
      equal(member, { ...expected, manifestHash: lane.manifestHash, afterCursor: member.afterCursor });
  })) return false;

  let pageCursor = baselineCursor;
  for (const page of cut.pages) {
    const end = Number(page.nextCursor);
    if (page.sourceRef !== lane.sourceRef || page.manifestHash !== lane.manifestHash || page.streamId !== streamId ||
        Number(page.afterCursor) !== pageCursor || end > through || end - pageCursor !== page.eventCount ||
        page.eventCount > declared.pageSize) return false;
    const firstIndex = pageCursor - baselineCursor;
    const lastIndex = end - baselineCursor;
    if (cut.inbox.slice(firstIndex, lastIndex).some(row => row.afterCursor !== page.afterCursor) ||
        page.digest !== hashCanonical({
          sourceRef: lane.sourceRef, streamId, after: page.afterCursor, next: page.nextCursor,
          complete: true, events: events.slice(firstIndex, lastIndex),
        })) return false;
    pageCursor = end;
  }
  if (pageCursor !== through || cut.pages.at(-1)?.capturedAt !== financial.lastCapturedAt ||
      !members.every((member, index) => equal(member.event, syncEventRef(events[from - baselineCursor + index]!)))) return false;

  const origins = new Set(cut.historyOrigins.map(row => row.recordId));
  const units = new Map(cut.historyUnits.map(row => [row.unitHash, row]));
  if (!orderedById(cut.historyOrigins, row => row.recordId) || units.size !== cut.historyUnits.length ||
      origins.size !== new Set(cut.historyOutcomes.map(row => row.recordId)).size ||
      !cut.historyOutcomes.every((row, index) => {
        const unit = units.get(row.unitHash);
        return equal(row.event, syncEventRef(events[index]!)) && origins.has(row.recordId) && unit !== undefined &&
          row.event.sequence > Number(unit.fromCursor) && row.event.sequence <= Number(unit.throughCursor);
      })) return false;
  let frontier = baselineCursor;
  let version = cut.baseline.approvedTargetVersion;
  let snapshotHash = cut.baseline.approvedSnapshotHash;
  for (const unit of cut.historyUnits) {
    if (unit.streamId !== streamId || Number(unit.fromCursor) !== frontier ||
        Number(unit.throughCursor) <= frontier || Number(unit.throughCursor) > from ||
        unit.beforeTargetVersion !== version || unit.beforeSnapshotHash !== snapshotHash ||
        (unit.receiptId === null
          ? unit.afterTargetVersion !== version || unit.afterSnapshotHash !== snapshotHash
          : unit.afterTargetVersion !== version + 1)) return false;
    frontier = Number(unit.throughCursor);
    version = unit.afterTargetVersion;
    snapshotHash = unit.afterSnapshotHash;
  }
  return frontier === from && version === audit.expectedTargetVersion && snapshotHash === audit.beforeSnapshotHash &&
    (cut.historyUnits.at(-1)?.unitHash ?? null) === (head?.lastUnitHash ?? null);
}

const auditShape = strict({
  ...unitKeyShape, coverage: CoverageCutSchema,
  unitHash: HashSchema, fromCursor: CursorSchema, throughCursor: CursorSchema,
  afterTargetVersion: NonnegativeIntegerSchema, afterSnapshotHash: HashSchema,
  receiptId: IdSchema.nullable(), semanticObservation: SemanticPreflightSchema,
  committedAt: IsoInstantSchema, members: bounded(UnitMemberSchema).min(1),
});

export const SyncUnitAuditSchema = auditShape.refine(audit => {
  const {
    identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash, planHash,
    coverage, unitHash, afterTargetVersion, afterSnapshotHash, receiptId, semanticObservation, members,
  } = audit;
  if (semanticObservation.sourceRef !== lane.sourceRef || (receiptId === null) !== (planHash === null) ||
      coverageHash !== hashCanonical(coverage) || unitHash !== hashSyncUnit({
        identity, lane, streamId, expectedEpoch, expectedTargetVersion, beforeSnapshotHash, asOf, coverageHash, planHash,
      })) return false;
  if (receiptId === null
    ? afterTargetVersion !== expectedTargetVersion || afterSnapshotHash !== beforeSnapshotHash
    : afterTargetVersion !== expectedTargetVersion + 1) return false;
  if (!members.every(({ disposition, origin }) => equal(origin.receipt.scope, identity.scope) &&
      origin.receipt.activationId === identity.activationId && (disposition === 'replay'
        ? origin.kind === 'initial' || origin.receipt.id !== receiptId
        : origin.kind === 'sync' && origin.receipt.id === receiptId)) ||
      (receiptId !== null) !== members.some(member => member.disposition === 'new')) return false;
  return validCoverage(audit);
}, 'Invalid synchronization unit bindings');

export type ReceiptOrigin = z.infer<typeof ReceiptOriginSchema>;
export type UnitMember = z.infer<typeof UnitMemberSchema>;
export type SyncEventOutcome = z.infer<typeof SyncEventOutcomeSchema>;
export type CoverageCut = z.infer<typeof CoverageCutSchema>;
export type SyncUnitAudit = z.infer<typeof SyncUnitAuditSchema>;
export type ReplayResponse = {
  unitHash: string; replayed: boolean; receipts: SyncReceipt[];
  appliedThrough: { streamId: string; cursor: string }[];
};
