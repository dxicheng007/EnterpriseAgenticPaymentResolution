import { MappingError, validateSourcePayload } from '@eapr/compiler/operations';
import {
  classifyBatch, type BatchClassificationV1, type BatchStopReason, type ClassificationBinding, type EventRef,
  type InputClassification, type MappedIdentity, type TypedPrerequisite,
} from '@eapr/compiler/plan-batch';
import {
  MutationPlanSchema, canonicalJson, hashCanonical, hashPlan, hashTargetSnapshot, targetRecordId, type CaptureIncidentSummaryV1, type CaptureLaneV1, type ChangePage,
  type CommittedAuthorityIdentityV1, type CurrentAuthorityV1, type Cursor, type EconomicIdentity, type Hash,
  type Hold, type Id, type IsoInstant, type MutationPlan, type RawIdentity, type RawSourceEvent, type Scope, type SourceContract,
} from '@eapr/contracts';
import { financialRecords, type FinancialRecord } from '@eapr/finance/validate';
import type { StoredActivation } from '@eapr/parent/activation-store';
import type { StoredTarget } from '@eapr/parent/snapshots';
import {
  ReceiptOriginSchema, syncEventRef, type CoverageCut, type ReceiptOrigin, type SyncEventOutcome, type SyncUnitAudit,
} from '@eapr/parent/sync-store';
import { selectedProfile } from '../activation-validation.js';
import type { readCaptureLane } from './capture-store.js';
import { compareInbox, DependencyError, dependencyOrder, MAX_INBOX_EVENTS } from './dependencies.js';

export type ContractBinding = {
  sourceRef: Id; companyId: Id; streamId: Id; resource: Id; sourceContractHash: Hash;
};
export type ContractConsumer = { identity: CommittedAuthorityIdentityV1; artifactHash: Hash };
export type ContractCheck = {
  event: RawSourceEvent; binding: ContractBinding; contract: SourceContract; consumers: ContractConsumer[];
};

type EnvelopeFailure = { field: '/resource' | '/streamId' | '/kind' | '/schemaVersion'; expected: Id };
type ContractDisposition =
  | { result: 'passed' }
  | { result: 'mapping_blocked'; code: 'schema_mapping'; origin: 'envelope'; failures: EnvelopeFailure[] }
  | { result: 'mapping_blocked'; code: 'schema_mapping'; origin: 'compiler_payload';
      compilerCode: 'SOURCE_SCHEMA'; path: string }
  | { result: 'unexamined'; compilerCode: string | null; path: string | null };

export type ContractObservation = {
  event: EventRef; binding: ContractBinding; consumers: ContractConsumer[];
} & ContractDisposition;

export type ContractGuardResult = {
  sourceContractChecksComplete: boolean; observations: ContractObservation[];
  blockedConsumers: ContractConsumer[];
  incompleteReason: 'source_contract_validation' | 'limit' | null;
};

const maxContractObservations = 8_000;
const maxCanonicalValueBytes = 1_048_576;
const maxCanonicalDiagnosticBytes = 16_777_216;
const earlyPayloadCodes = new Set(['MONEY_FORMAT', 'MONEY_SCALE', 'MONEY_RANGE', 'SOURCE_DATE']);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function orderedConsumers(consumers: ReadonlyMap<string, ContractConsumer>): ContractConsumer[] {
  return [...consumers].sort(([left], [right]) => compareText(left, right)).map(([, consumer]) => consumer);
}

function validateContractCheck({ event, binding, contract }: ContractCheck): ContractDisposition {
  const envelopeFields: readonly [EnvelopeFailure['field'], Id, Id][] = [
    ['/resource', event.resource, binding.resource],
    ['/streamId', event.streamId, binding.streamId],
    ['/kind', event.kind, contract.kind],
    ['/schemaVersion', event.schemaVersion, contract.schemaVersion],
  ];
  const failures = envelopeFields
    .filter(([, actual, expected]) => actual !== expected)
    .map(([field, , expected]) => ({ field, expected }));
  if (failures.length) return { result: 'mapping_blocked', code: 'schema_mapping', origin: 'envelope', failures };

  try {
    validateSourcePayload(contract, event);
  } catch (error) {
    if (error instanceof MappingError && error.code === 'SOURCE_SCHEMA') {
      return { result: 'mapping_blocked', code: 'schema_mapping', origin: 'compiler_payload', compilerCode: error.code, path: error.path };
    }
    if (error instanceof MappingError && earlyPayloadCodes.has(error.code)) {
      return { result: 'unexamined', compilerCode: error.code, path: error.path };
    }
    return { result: 'unexamined', compilerCode: null, path: null };
  }
  return { result: 'passed' };
}

/** Checks the verified applicability join before any account routing or acknowledgment filtering. */
export function checkSourceContracts(checks: readonly ContractCheck[]): ContractGuardResult {
  const observations: ContractObservation[] = [];
  const blocked = new Map<string, ContractConsumer>();
  const finish = (incompleteReason: ContractGuardResult['incompleteReason']): ContractGuardResult => ({
    sourceContractChecksComplete: incompleteReason === null,
    observations, blockedConsumers: orderedConsumers(blocked), incompleteReason,
  });

  const pairs = new Map<string, {
    check: ContractCheck; event: EventRef; bindingKey: string; consumers: Map<string, ContractConsumer>;
  }>();
  for (const check of checks) {
    const { sourceRef, id } = check.event;
    const bindingKey = canonicalJson(check.binding);
    const key = canonicalJson([sourceRef, id, bindingKey]);
    let pair = pairs.get(key);
    if (!pair) {
      if (pairs.size === maxContractObservations) return finish('limit');
      pair = { check, event: syncEventRef(check.event), bindingKey, consumers: new Map() };
      pairs.set(key, pair);
    }
    for (const { identity, artifactHash } of check.consumers) {
      pair.consumers.set(canonicalJson([identity, artifactHash]), { identity, artifactHash });
    }
  }

  const ordered = [...pairs.values()].sort((left, right) =>
    compareInbox(left.event, right.event) || compareText(left.event.sourceRef, right.event.sourceRef) ||
    compareText(left.bindingKey, right.bindingKey));
  let diagnosticBytes = 0;
  for (const { check, event, consumers } of ordered) {
    const disposition = validateContractCheck(check);
    const observation: ContractObservation = {
      event, binding: check.binding, consumers: orderedConsumers(consumers), ...disposition,
    };
    const bytes = Buffer.byteLength(canonicalJson(observation));
    if (bytes > maxCanonicalValueBytes || diagnosticBytes + bytes > maxCanonicalDiagnosticBytes) return finish('limit');
    diagnosticBytes += bytes;
    observations.push(observation);

    if (observation.result === 'unexamined') return finish('source_contract_validation');
    if (observation.result === 'mapping_blocked') {
      for (const [key, consumer] of consumers) blocked.set(key, consumer);
    }
  }
  return finish(null);
}

export type SelectionInput = { sourceRef: Id; asOf: IsoInstant };
export type SelectionSubject = {
  identity: CommittedAuthorityIdentityV1; stored: StoredActivation; authority: CurrentAuthorityV1;
  target: StoredTarget; origins: ReceiptOrigin[]; units: SyncUnitAudit[]; outcomes: SyncEventOutcome[];
  heads: CoverageCut['applicationHeads'];
};
export type SelectionLane = {
  lane: CaptureLaneV1; binding: NonNullable<Awaited<ReturnType<typeof readCaptureLane>>>;
  checkpoints: CoverageCut['checkpoints']; positions: CoverageCut['positions']; inbox: CoverageCut['inbox'];
  pages: { page: ChangePage; digest: Hash; capturedAt: IsoInstant }[];
  incidents: { incidentHash: Hash; streamId: Id; summary: CaptureIncidentSummaryV1 }[];
};
export type GlobalClaim = {
  scope: Scope; identity: EconomicIdentity; targetRecordId: Id; record: FinancialRecord; origin: ReceiptOrigin;
};
export type EvidenceFamily = 'import' | 'authority' | 'target' | 'lane' | 'checkpoint' | 'position' | 'delivery' |
  'page' | 'inbox' | 'incident' | 'unit' | 'outcome' | 'origin' | 'receipt' | 'financial' | 'metadata' |
  'application_head';
export type SelectionEvidence = { family: EvidenceFamily; key: string[]; digest: Hash; bytes: number };
export type SelectionCut = {
  input: SelectionInput; subjects: SelectionSubject[]; lanes: SelectionLane[];
  deliveries: { event: RawSourceEvent; digest: Hash }[]; globalClaims: GlobalClaim[]; evidence: SelectionEvidence[];
};
export type IncompleteReason = 'limit' | 'timeout' | 'unsupported_transport' | 'uninitialized_capture' | 'uncovered_stream' |
  'unknown_source_binding' | 'unsupported_history' | 'source_contract_validation' | 'no_committed_subjects';

type BlockerCode = 'source_identity' | 'source_semantics' | 'schema_mapping' | 'unknown_account' | 'ambiguous_mapping' |
  'inactive_authority' | 'dependency_missing' | 'dependency_invalid' | 'dependency_cycle' | 'group_limit' |
  'earlier_hold' | 'global_economic_conflict' | 'capture_incident_unresolved' | 'classifier_blocked';
export type SelectionBlocker = {
  level: 'source' | 'mapping' | 'subject' | 'raw_identity'; code: BlockerCode;
  identities: CommittedAuthorityIdentityV1[]; rawIdentity: RawIdentity | null; events: EventRef[];
  incidentRefs: SelectionEvidence[]; bindings: ContractBinding[]; missing: TypedPrerequisite[];
  compilerHolds: Hold[]; classifierStopReason: BatchStopReason | null;
};
export type RouteObservation = {
  event: EventRef; rawIdentity: RawIdentity;
  disposition: 'known' | 'unknown_account' | 'source_identity' | 'ambiguous_mapping' | 'unknown_source_binding';
  identities: CommittedAuthorityIdentityV1[];
  applicability: {
    identity: CommittedAuthorityIdentityV1; lane: CaptureLaneV1; baselineCursor: Cursor | null;
    captureCursor: Cursor | null; applicable: boolean;
  }[];
};

function selectionBlocker(
  level: SelectionBlocker['level'], code: BlockerCode,
  facts: Partial<Omit<SelectionBlocker, 'level' | 'code'>>,
): SelectionBlocker {
  return {
    level, code, identities: [], rawIdentity: null, events: [], incidentRefs: [], bindings: [],
    missing: [], compilerHolds: [], classifierStopReason: null, ...facts,
  };
}

const identityKey = (identity: CommittedAuthorityIdentityV1) => canonicalJson(identity);
const laneKey = ({ sourceRef, manifestHash }: CaptureLaneV1) => canonicalJson([sourceRef, manifestHash]);
const membershipKey = ({ sourceRef, streamId, sequence, eventId }: Omit<EventRef, 'contentHash'>) =>
  canonicalJson([sourceRef, streamId, sequence, eventId]);

function routingSubjects(cut: SelectionCut) {
  const lanes = new Map(cut.lanes.map(lane => [laneKey(lane.lane), lane]));
  return [...cut.subjects].sort((left, right) => compareText(identityKey(left.identity), identityKey(right.identity))).map(subject => {
    const { activation, bundle } = subject.stored;
    const { artifact } = bundle;
    const profile = selectedProfile(bundle);
    // A ready cut has the exact committed lane and validated checkpoints/membership.
    const lane = lanes.get(laneKey({ schemaVersion: '1', sourceRef: profile.sourceRef, manifestHash: activation.manifestHash }))!;
    const baselines = new Map(activation.baselineCursors.map(row => [row.streamId, row.resumeAfter]));
    const checkpoints = new Map(lane.checkpoints.map(row => [row.streamId, row.captureCursor]));
    const members = new Set(lane.inbox.filter(row => row.manifestHash === lane.lane.manifestHash).map(membershipKey));
    const streams = new Map(artifact.normalizedPlan.capture.map(row => [row.streamId, new Set(row.resources)]));
    const contracts = new Map(artifact.normalizedPlan.sourceContracts.map(contract => [contract.resource, contract]));
    const contractHashes = new Map(artifact.sourceContractHashes.map(row => [row.resource, row.hash]));
    return { subject, artifact, profile, lane: lane.lane, baselines, checkpoints, members, streams, contracts, contractHashes,
      inputs: [] as RawSourceEvent[] };
  });
}

type RoutingDelivery = { event: RawSourceEvent; ref: EventRef };

function compareEventRefs(left: EventRef, right: EventRef) {
  return compareInbox(left, right) || compareText(left.sourceRef, right.sourceRef);
}

/** Joins the full per-subject captured corpus before any account filtering. */
function checkApplicableSourceContracts(deliveries: RoutingDelivery[], subjects: ReturnType<typeof routingSubjects>) {
  const checks: ContractCheck[] = [];
  let unresolvedBinding = false;
  const applicability = deliveries.map(({ event, ref }) => {
    const key = membershipKey(ref);
    let sameCompany = false;
    let provenBinding = false;
    const rows = subjects.map(subjectFacts => {
      const { subject, lane, baselines, checkpoints, members, streams, contracts, contractHashes, inputs, profile, artifact } = subjectFacts;
      const { identity } = subject;
      const baselineCursor = baselines.get(event.streamId) ?? null;
      const captureCursor = checkpoints.get(event.streamId) ?? null;
      const companyId = profile.scope.companyId;
      const sameSourceCompany = event.sourceRef === profile.sourceRef && event.rawIdentity.companyId === companyId;
      sameCompany ||= sameSourceCompany;
      const inLane = sameSourceCompany && baselineCursor !== null && captureCursor !== null &&
        event.sequence > Number(baselineCursor) && event.sequence <= Number(captureCursor) && members.has(key);
      const contract = contracts.get(event.resource);
      const sourceContractHash = contractHashes.get(event.resource);
      const approved = streams.get(event.streamId)?.has(event.resource) && contract && sourceContractHash;
      if (inLane && !approved) unresolvedBinding = true;
      if (sameSourceCompany && baselineCursor !== null && approved && (inLane || event.sequence <= Number(baselineCursor))) {
        provenBinding = true;
      }
      if (inLane && approved) {
        inputs.push(event);
        checks.push({
          event, contract,
          binding: { sourceRef: profile.sourceRef, companyId, streamId: event.streamId, resource: contract.resource, sourceContractHash },
          consumers: [{ identity, artifactHash: artifact.hash }],
        });
      }
      return { identity, lane, baselineCursor, captureCursor, applicable: Boolean(inLane && approved) };
    });
    unresolvedBinding ||= sameCompany && !provenBinding;
    return rows;
  });

  const checked = checkSourceContracts(checks);
  const guard: ContractGuardResult = unresolvedBinding && checked.incompleteReason === null
    ? { ...checked, sourceContractChecksComplete: false, incompleteReason: 'source_contract_validation' }
    : checked;
  return { guard, applicability };
}

export function routeSelectionCut(cut: SelectionCut): {
  routes: RouteObservation[]; guard: ContractGuardResult; blockers: SelectionBlocker[];
  classifications: { identity: CommittedAuthorityIdentityV1; full: BatchClassificationV1 }[];
  incompleteReason: IncompleteReason | null;
} {
  if (!cut.subjects.length) return {
    routes: [], guard: checkSourceContracts([]), blockers: [], classifications: [], incompleteReason: 'no_committed_subjects',
  };

  const subjects = routingSubjects(cut);
  const deliveries = cut.deliveries.map(({ event }) => ({ event, ref: syncEventRef(event) }))
    .sort((left, right) => compareEventRefs(left.ref, right.ref));
  const { guard, applicability } = checkApplicableSourceContracts(deliveries, subjects);
  const identities = subjects.map(({ subject }) => subject.identity);
  const companies = new Set<string>();
  const sellers = new Set<string>();
  const accounts = new Map<string, CommittedAuthorityIdentityV1[]>();
  for (const { subject, profile } of subjects) {
    const { companyId, sellerEntityId } = profile.scope;
    const company = [profile.sourceRef, companyId];
    const seller = [...company, sellerEntityId];
    companies.add(canonicalJson(company));
    sellers.add(canonicalJson(seller));
    for (const account of profile.sourceAccountIds) {
      const key = canonicalJson([...seller, account]);
      const matches = accounts.get(key) ?? [];
      matches.push(subject.identity);
      accounts.set(key, matches);
    }
  }
  const routes = deliveries.map(({ event, ref }, index): RouteObservation => {
    const { rawIdentity } = event;
    const { companyId, sellerEntityId, sourceAccountId } = rawIdentity;
    const company = [event.sourceRef, companyId];
    const seller = [...company, sellerEntityId ?? null];
    const matches = sourceAccountId ? accounts.get(canonicalJson([...seller, sourceAccountId])) ?? [] : [];
    let disposition: RouteObservation['disposition'] = 'unknown_source_binding';
    if (companies.has(canonicalJson(company))) {
      if (!sellerEntityId) disposition = 'source_identity';
      else if (sellers.has(canonicalJson(seller))) {
        disposition = matches.length > 1 ? 'ambiguous_mapping' : matches.length === 1 ? 'known' : 'unknown_account';
      }
    }
    return { event: ref, rawIdentity, disposition, identities: matches, applicability: applicability[index]! };
  });

  const blockers: SelectionBlocker[] = [];
  const sourceGuards = new Map<string, SelectionBlocker>();
  const sourceGuardEvents = new Set<string>();
  const known = new Map<string, string>();
  const knownBySubject = new Map<string, EventRef[]>();
  for (const route of routes) {
    const { disposition, event, rawIdentity } = route;
    if (disposition === 'known') {
      const key = identityKey(route.identities[0]!);
      known.set(membershipKey(event), key);
      const events = knownBySubject.get(key) ?? [];
      events.push(event);
      knownBySubject.set(key, events);
    }
    if (disposition === 'unknown_account') blockers.push(selectionBlocker('raw_identity', disposition, { rawIdentity, events: [event] }));
    if (disposition === 'ambiguous_mapping') {
      blockers.push(selectionBlocker('source', disposition, { rawIdentity, identities: route.identities, events: [event] }));
    }
  }
  for (const observation of guard.observations) {
    if (observation.result === 'mapping_blocked') blockers.push(selectionBlocker('mapping', 'schema_mapping', {
      identities: observation.consumers.map(row => row.identity), events: [observation.event], bindings: [observation.binding],
    }));
  }

  const classifications = subjects.map(({ subject, artifact, profile, inputs }) => {
    const { identity, authority, target } = subject;
    const subjectKey = identityKey(identity);
    if (authority.status !== 'active') blockers.push(selectionBlocker('subject', 'inactive_authority', {
      identities: [identity], events: knownBySubject.get(subjectKey) ?? [],
    }));

    const full = classifyBatch(artifact, profile, inputs, { ...target.records, asOf: cut.input.asOf });
    const { details, outcome } = full;
    if (details.kind === 'not_classified') {
      const compilerHolds = details.holdIndexes.map(index => outcome.holds[index]!);
      for (const source of details.sourceBlockers) {
        const events = source.causingInputIndexes.map(index => syncEventRef(inputs[index]!));
        for (const event of events) sourceGuardEvents.add(membershipKey(event));
        const code = source.code === 'IDENTITY_SCOPE' ? 'source_identity' : 'source_semantics';
        const key = canonicalJson([code, events]);
        const existing = sourceGuards.get(key);
        if (existing) {
          for (const hold of compilerHolds) {
            if (!existing.compilerHolds.some(value => canonicalJson(value) === canonicalJson(hold))) existing.compilerHolds.push(hold);
          }
        } else {
          sourceGuards.set(key, selectionBlocker('source', code, {
            identities, events, compilerHolds, classifierStopReason: details.reason,
          }));
        }
      }
      if (!details.sourceBlockers.length) {
        const ids = new Set(compilerHolds.flatMap(hold => hold.eventIds));
        blockers.push(selectionBlocker('subject', 'classifier_blocked', {
          identities: [identity], events: inputs.filter(event => ids.has(event.id)).map(syncEventRef),
          compilerHolds, classifierStopReason: details.reason,
        }));
      }
    } else {
      const events: EventRef[] = [];
      const compilerHolds: Hold[] = [];
      for (const item of details.items) {
        if (item.disposition !== 'held' || !item.event || inputs[item.inputIndex]?.kind !== 'semantic_change' ||
          known.get(membershipKey(item.event)) !== subjectKey) continue;
        const holds = item.holdIndexes.map(index => outcome.holds[index]!).filter(hold => hold.code === 'SEMANTIC_VERSION');
        if (holds.length) {
          events.push(item.event);
          compilerHolds.push(...holds);
        }
      }
      if (events.length) blockers.push(selectionBlocker('subject', 'source_semantics', { identities: [identity], events, compilerHolds }));
    }
    return { identity, full };
  });

  blockers.push(...sourceGuards.values());
  for (const route of routes) {
    if (route.disposition === 'source_identity' && !sourceGuardEvents.has(membershipKey(route.event))) {
      blockers.push(selectionBlocker('source', route.disposition, { identities, rawIdentity: route.rawIdentity, events: [route.event] }));
    }
  }
  const limited = classifications.some(({ full: { details } }) => details.kind === 'not_classified' && details.reason === 'input_limit');
  const incompleteReason = limited ? 'limit' : routes.some(route => route.disposition === 'unknown_source_binding')
    ? 'unknown_source_binding' : guard.incompleteReason;
  return { routes, guard, blockers, classifications, incompleteReason };
}

export type DependencyWitness = {
  consumer: EventRef; prerequisite: TypedPrerequisite;
  resolution: { kind: 'target'; record: FinancialRecord; origin: ReceiptOrigin } |
    { kind: 'candidate'; providers: { event: EventRef; group: EventRef[] }[] } |
    { kind: 'missing'; mappedIndexHash: Hash };
};
export type ProposedGroup = {
  identity: CommittedAuthorityIdentityV1; observedEpoch: number;
  targetVersion: number; targetSnapshotHash: Hash; seed: EventRef;
  members: EventRef[]; orderedMembers: EventRef[];
  classifierBinding: ClassificationBinding; dependencies: DependencyWitness[];
  plan: MutationPlan | null; replayOrigins: ReceiptOrigin[]; witnessHash: Hash;
};

type GroupSelection = {
  proposal: Omit<ProposedGroup, 'witnessHash'> | null; blockers: SelectionBlocker[];
  full: BatchClassificationV1 | null; selected: BatchClassificationV1 | null; dependencies: DependencyWitness[];
};
type Classified = Extract<BatchClassificationV1['details'], { kind: 'classified' }>;
type MappedItem = InputClassification & { event: EventRef; mapped: MappedIdentity; groupIndex: number };
type TypedKey = Pick<MappedIdentity, 'scope' | 'identity' | 'targetRecordId'>;

class SelectionStorageError extends Error {
  readonly code = 'SELECTION_STORAGE_INVALID';

  constructor() {
    super('Selection storage or classification is inconsistent');
    this.name = 'SelectionStorageError';
  }
}

function consistent(condition: unknown): asserts condition {
  if (!condition) throw new SelectionStorageError();
}

const equal = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
const sameIndexes = (left: readonly number[], right: readonly number[]) =>
  equal([...left].sort((a, b) => a - b), [...right].sort((a, b) => a - b));
const typedKey = ({ scope, identity, targetRecordId }: TypedKey) => canonicalJson([scope, identity, targetRecordId]);
const globalKey = ({ identity, targetRecordId }: Omit<TypedKey, 'scope'>) => canonicalJson([identity, targetRecordId]);
const recordKey = (record: FinancialRecord) => typedKey({ ...record, targetRecordId: record.id });

function originalReceipts(subject: SelectionSubject) {
  const origins = new Map<Id, ReceiptOrigin>();
  for (const origin of subject.origins) {
    consistent(!origins.has(origin.recordId));
    origins.set(origin.recordId, origin);
  }
  const approved = new Map(financialRecords(subject.stored.approvedTarget.records).map(record => [record.id, record]));
  const checked = new Set<Id>();
  return (record: FinancialRecord): ReceiptOrigin => {
    const origin = origins.get(record.id);
    consistent(origin);
    if (checked.has(record.id)) return origin;
    const { receipt } = origin;
    consistent(ReceiptOriginSchema.safeParse(origin).success && equal(receipt.scope, record.scope) &&
      receipt.activationId === subject.identity.activationId && receipt.artifactHash === subject.stored.activation.artifactHash &&
      receipt.eventIds.includes(record.sourceEventId));
    if (origin.kind === 'initial') {
      const prior = approved.get(record.id);
      consistent(prior && equal(prior, record) && origin.importKey === subject.stored.request.idempotencyKey &&
        equal(receipt, subject.stored.receipt));
    }
    checked.add(record.id);
    return origin;
  };
}

function subjectInputs(
  cut: SelectionCut, subject: SelectionSubject, routed: ReturnType<typeof routeSelectionCut>,
  originFor: ReturnType<typeof originalReceipts>,
) {
  const subjectKey = identityKey(subject.identity);
  const routes = new Map(routed.routes.map(route => [canonicalJson(route.event), route]));
  const outcomes = new Map(subject.outcomes.map(outcome => [canonicalJson(outcome.event), outcome]));
  const units = new Map(subject.units.map(unit => [unit.unitHash, unit]));
  const records = new Map(financialRecords(subject.target.records).map(record => [record.id, record]));
  consistent(outcomes.size === subject.outcomes.length && units.size === subject.units.length);
  const own = new Set<string>();
  const inputs = cut.deliveries.flatMap(({ event }) => {
    const ref = syncEventRef(event);
    const key = canonicalJson(ref);
    const route = routes.get(key);
    consistent(route);
    const applicability = route.applicability.find(row => identityKey(row.identity) === subjectKey);
    if (!applicability?.applicable) return [];
    const belongs = route.disposition === 'known' && route.identities.length === 1 && identityKey(route.identities[0]!) === subjectKey;
    if (belongs) own.add(key);
    if (event.kind === 'semantic_change') return [event];
    if (!belongs) return [];
    const outcome = outcomes.get(key);
    if (!outcome) return [event];
    const unit = units.get(outcome.unitHash);
    const record = records.get(outcome.recordId);
    consistent(unit && record && equal(outcome.identity, subject.identity) && equal(unit.identity, subject.identity) &&
      equal(outcome.lane, applicability.lane) && equal(unit.lane, applicability.lane) &&
      unit.members.some(member => equal(member.event, ref) && member.recordId === outcome.recordId &&
        member.disposition === outcome.disposition && equal(member.origin, outcome.origin)) &&
      equal(originFor(record), outcome.origin));
    return [];
  });
  inputs.sort((left, right) => compareEventRefs(syncEventRef(left), syncEventRef(right)));
  return { inputs, own };
}

function classifierIndex(
  { details, outcome }: BatchClassificationV1 & { details: Classified },
  inputs: RawSourceEvent[], binding: ClassificationBinding,
) {
  const { items, groups } = details;
  consistent(equal(details.binding, binding) && items.length === inputs.length && details.sourceBlockers.length === 0);
  const seen = new Set<number>();
  for (const [groupIndex, group] of groups.entries()) {
    consistent(group.inputIndexes.length && (group.disposition === 'held') === (group.holdIndexes.length > 0));
    for (const inputIndex of group.inputIndexes) {
      const item = items[inputIndex];
      consistent(item && !seen.has(inputIndex) && 'groupIndex' in item && item.groupIndex === groupIndex && item.mapped &&
        (item.disposition === 'held') === (group.disposition === 'held'));
      if (item.disposition === 'held') consistent(equal(item.holdIndexes, group.holdIndexes));
      seen.add(inputIndex);
    }
  }
  const holdIndexes = new Set<number>();
  const primaryIndexes = new Map<string, number>();
  const representatives = new Map<string, MappedItem[]>();
  const mapped: MappedItem[] = [];
  for (const [index, item] of items.entries()) {
    const input = inputs[index]!;
    consistent(item.inputIndex === index && item.event && equal(item.event, syncEventRef(input)));
    const delivery = canonicalJson(item.event);
    const primaryIndex = primaryIndexes.get(delivery);
    if (item.disposition === 'delivery_repeat') {
      consistent(primaryIndex !== undefined && item.primaryInputIndex === primaryIndex);
      continue;
    }
    consistent(primaryIndex === undefined);
    primaryIndexes.set(delivery, index);
    if (item.disposition === 'semantic_observed') {
      consistent(input.kind === 'semantic_change' && equal(item.scope, binding.scope));
      continue;
    }
    if (item.disposition === 'held') {
      consistent(item.holdIndexes.length && new Set(item.holdIndexes).size === item.holdIndexes.length &&
        item.holdIndexes.every(holdIndex => outcome.holds[holdIndex]?.eventIds.includes(input.id)) &&
        (item.mapped === null) === (item.groupIndex === null));
      for (const holdIndex of item.holdIndexes) holdIndexes.add(holdIndex);
    }
    if (!item.mapped) continue;
    const { scope, identity, targetRecordId: id } = item.mapped;
    consistent(seen.has(index) && equal(scope, binding.scope) && input.kind === identity.kind &&
      input.sourceRef === identity.sourceRef && input.recordId === identity.recordId &&
      input.rawIdentity.sellerEntityId === identity.sellerEntityId && id === targetRecordId(identity));
    if (item.disposition === 'financial_coalesced') {
      const producer = items[item.producerInputIndex];
      consistent(producer?.disposition === 'financial_new' && producer.groupIndex === item.groupIndex &&
        typedKey(producer.mapped) === typedKey(item.mapped));
    }
    const entry = item as MappedItem;
    mapped.push(entry);
    const key = typedKey(entry.mapped);
    const providers = representatives.get(key) ?? [];
    providers.push(entry);
    representatives.set(key, providers);
  }
  consistent(holdIndexes.size === outcome.holds.length);
  return { items, groups, mapped, representatives };
}

function dependencyIndex(
  index: ReturnType<typeof classifierIndex>, subject: SelectionSubject, binding: ClassificationBinding,
  originFor: ReturnType<typeof originalReceipts>,
) {
  const target = new Map(financialRecords(subject.target.records).map(record => [recordKey(record), record]));
  const entries = index.mapped.map(({ inputIndex, event, mapped, groupIndex }) => ({
    inputIndex, event, scope: mapped.scope, identity: mapped.identity, targetRecordId: mapped.targetRecordId, groupIndex,
  }));
  let mappedIndexHash: Hash | undefined;
  const refs = (indexes: number[]) => indexes.map(inputIndex => index.items[inputIndex]!.event!).sort(compareEventRefs);
  const groupRefs = index.groups.map(group => refs(group.inputIndexes));
  const candidateProofs = new Map<string, Extract<DependencyWitness['resolution'], { kind: 'candidate' }>>();
  const byInput = new Map<number, DependencyWitness[]>();
  for (const item of index.mapped) {
    const dependencies = item.mapped.prerequisites.map((prerequisite): DependencyWitness => {
      consistent(equal(prerequisite.scope, item.mapped.scope) && prerequisite.identity.sourceRef === item.mapped.identity.sourceRef &&
        prerequisite.identity.sellerEntityId === item.mapped.identity.sellerEntityId &&
        prerequisite.targetRecordId === targetRecordId(prerequisite.identity));
      const key = typedKey(prerequisite);
      const record = target.get(key);
      const providers = index.representatives.get(key) ?? [];
      const { presence } = prerequisite;
      if (presence.kind === 'target') {
        consistent(record);
        return { consumer: item.event, prerequisite, resolution: { kind: 'target', record,
          origin: originFor(record) } };
      }
      consistent(!record);
      if (presence.kind === 'candidate') {
        consistent(providers.length && sameIndexes(presence.providerInputIndexes, providers.map(provider => provider.inputIndex)));
        let resolution = candidateProofs.get(key);
        if (!resolution) {
          resolution = { kind: 'candidate', providers: providers.map(provider => ({
            event: provider.event, group: groupRefs[provider.groupIndex]!,
          })) };
          candidateProofs.set(key, resolution);
        }
        return { consumer: item.event, prerequisite, resolution };
      }
      consistent(presence.kind === 'missing' && !providers.length && item.disposition === 'held');
      mappedIndexHash ??= hashCanonical({ binding, entries });
      return { consumer: item.event, prerequisite, resolution: { kind: 'missing', mappedIndexHash } };
    });
    byInput.set(item.inputIndex, dependencies);
  }
  return { target, byInput, refs };
}

function orderedDependencies(dependencies: DependencyWitness[]): DependencyWitness[] {
  const byKey = new Map<string, DependencyWitness>();
  for (const dependency of dependencies) {
    const key = canonicalJson([dependency.consumer, dependency.prerequisite]);
    const previous = byKey.get(key);
    consistent(!previous || equal(previous, dependency));
    byKey.set(key, dependency);
  }
  return [...byKey.values()].sort((left, right) =>
    compareText(canonicalJson(left.consumer), canonicalJson(right.consumer)) ||
    compareText(canonicalJson(left.prerequisite), canonicalJson(right.prerequisite)));
}

function conflictingClaim(
  claim: GlobalClaim | undefined, item: MappedItem, originFor: ReturnType<typeof originalReceipts>, record?: FinancialRecord,
) {
  if (!claim) return false;
  consistent(equal(claim.scope, claim.record.scope) && equal(claim.identity, claim.record.identity) &&
    claim.targetRecordId === claim.record.id && claim.origin.recordId === claim.record.id &&
    ReceiptOriginSchema.safeParse(claim.origin).success && equal(claim.origin.receipt.scope, claim.scope) &&
    claim.origin.receipt.eventIds.includes(claim.record.sourceEventId));
  if (!equal(claim.scope, item.mapped.scope)) return true;
  consistent(record && equal(record, claim.record) && equal(originFor(record), claim.origin));
  return false;
}

function selectedPlan(
  full: BatchClassificationV1, selected: BatchClassificationV1, items: MappedItem[],
  original: ReadonlyMap<string, MappedItem>, binding: ClassificationBinding, inputs: RawSourceEvent[],
): MutationPlan | null {
  const fresh = items.filter(item => item.disposition === 'financial_new');
  const { plans } = selected.outcome;
  if (!fresh.length) {
    consistent(!plans.length && items.length && items.every(item => item.disposition === 'financial_replay'));
    return null;
  }
  const plan = plans[0];
  consistent(plans.length === 1 && plan && MutationPlanSchema.safeParse(plan).success && plan.hash === hashPlan(plan) &&
    plan.artifactHash === binding.artifactHash && plan.profileHash === binding.profileHash &&
    equal(plan.scope, binding.scope) && plan.expectedTargetVersion === binding.expectedTargetVersion && plan.asOf === binding.asOf &&
    equal(plan.eventIds, items.map(item => item.event.eventId)) && plan.operations.length === fresh.length);
  const operationIndexes = new Map<number, number>();
  for (const item of fresh) {
    const before = original.get(canonicalJson(item.event));
    const operation = plan.operations[item.operationIndex];
    consistent(item.planIndex === 0 && operation && !operationIndexes.has(item.operationIndex) &&
      before?.disposition === 'financial_new');
    const priorPlan = full.outcome.plans[before.planIndex];
    const priorOperation = priorPlan?.operations[before.operationIndex];
    consistent(priorOperation && 'identity' in operation.record && recordKey(operation.record) === typedKey(item.mapped) &&
      operation.record.sourceEventId === item.event.eventId &&
      operation.record.sourceRecordVersion === inputs[item.inputIndex]?.recordVersion && equal(operation, priorOperation));
    const currentLineage = plan.lineage.filter(entry => entry.operationIndex === item.operationIndex);
    const priorLineage = priorPlan.lineage.filter(entry => entry.operationIndex === before.operationIndex);
    consistent(currentLineage.length && equal(currentLineage.map(entry => ({ ...entry, operationIndex: before.operationIndex })), priorLineage));
    operationIndexes.set(item.operationIndex, before.operationIndex);
  }
  consistent(plan.operations.every((_, index) => index === 0 || operationIndexes.get(index - 1)! < operationIndexes.get(index)!) &&
    plan.lineage.every((entry, index) => operationIndexes.has(entry.operationIndex) &&
      (index === 0 || plan.lineage[index - 1]!.operationIndex <= entry.operationIndex)));
  return plan;
}

export function selectSubjectGroup(
  cut: SelectionCut, identity: CommittedAuthorityIdentityV1, routed: ReturnType<typeof routeSelectionCut>,
): GroupSelection {
  const result: GroupSelection = { proposal: null, blockers: [], full: null, selected: null, dependencies: [] };
  const subjectKey = identityKey(identity);
  const subject = cut.subjects.find(value => identityKey(value.identity) === subjectKey);
  consistent(subject);
  if (routed.incompleteReason || !routed.guard.sourceContractChecksComplete || subject.authority.status !== 'active' ||
    routed.blockers.some(blocker => blocker.level === 'source' ||
      blocker.identities.some(value => identityKey(value) === subjectKey))) return result;

  const originFor = originalReceipts(subject);
  const { inputs, own } = subjectInputs(cut, subject, routed, originFor);
  const first = inputs.findIndex(event => event.kind !== 'semantic_change');
  if (first < 0) return result;
  const { artifact } = subject.stored.bundle;
  const profile = selectedProfile(subject.stored.bundle);
  const target = { ...subject.target.records, asOf: cut.input.asOf };
  const binding: ClassificationBinding = { artifactHash: artifact.hash, profileHash: profile.hash, scope: identity.scope,
    expectedTargetVersion: target.version, targetSnapshotHash: hashTargetSnapshot(target), asOf: target.asOf };
  const approvedLimit = Math.min(MAX_INBOX_EVENTS, subject.stored.activation.limits.maxRecordsPerCycle,
    artifact.normalizedPlan.limits.maxRecordsPerCycle);
  const seed = syncEventRef(inputs[first]!);
  const block = (code: BlockerCode, facts: Partial<Omit<SelectionBlocker, 'level' | 'code' | 'identities'>> = {}) => {
    result.blockers.push(selectionBlocker('subject', code, { identities: [identity], events: [seed], ...facts }));
  };
  if (inputs.length > approvedLimit) {
    block('group_limit', { events: inputs.map(syncEventRef) });
    return result;
  }

  const classify = (events: RawSourceEvent[]) => classifyBatch(artifact, profile, events, target);
  function stopped(batch: BatchClassificationV1, events: RawSourceEvent[]): boolean {
    if (batch.details.kind !== 'not_classified') return false;
    const { reason, holdIndexes } = batch.details;
    const compilerHolds = holdIndexes.map(index => batch.outcome.holds[index]);
    consistent(compilerHolds.every(hold => hold !== undefined));
    const ids = new Set(compilerHolds.flatMap(hold => hold.eventIds));
    block(reason === 'input_limit' ? 'group_limit' : 'classifier_blocked', {
      classifierStopReason: reason, compilerHolds, events: events.filter(event => ids.has(event.id)).map(syncEventRef),
    });
    return true;
  }

  const full = result.full = classify(inputs);
  if (stopped(full, inputs) || full.details.kind !== 'classified') return result;
  const index = classifierIndex({ ...full, details: full.details }, inputs, binding);
  const evidence = dependencyIndex(index, subject, binding, originFor);
  const closure = new Set<number>();
  const groups = new Set<number>();
  const seedItem = index.items[first]!;
  if ('groupIndex' in seedItem && seedItem.groupIndex !== null) groups.add(seedItem.groupIndex);
  else closure.add(first);
  for (const groupIndex of groups) {
    for (const inputIndex of index.groups[groupIndex]!.inputIndexes) {
      closure.add(inputIndex);
      for (const { prerequisite } of evidence.byInput.get(inputIndex) ?? []) {
        if (prerequisite.presence.kind !== 'candidate') continue;
        for (const provider of prerequisite.presence.providerInputIndexes) {
          const item = index.items[provider] as MappedItem;
          groups.add(item.groupIndex);
        }
      }
    }
  }
  const members = evidence.refs([...closure]);
  result.dependencies = orderedDependencies([...closure].flatMap(inputIndex => evidence.byInput.get(inputIndex) ?? []));
  const missing = result.dependencies.filter(edge => edge.resolution.kind === 'missing').map(edge => edge.prerequisite);
  const held = [...closure].flatMap(inputIndex => {
    const item = index.items[inputIndex]!;
    return item.disposition === 'held' ? item.holdIndexes : [];
  });
  const compilerHolds = [...new Set(held)].sort((a, b) => a - b).map(holdIndex => full.outcome.holds[holdIndex]!);
  const deferLater = () => {
    const events = inputs.flatMap((event, inputIndex) =>
      event.kind === 'semantic_change' || closure.has(inputIndex) || index.items[inputIndex]?.disposition === 'delivery_repeat'
        ? [] : [syncEventRef(event)]);
    if (events.length) block('earlier_hold', { events });
  };
  let order: number[];
  try {
    order = dependencyOrder([...closure].sort((a, b) => a - b).map(inputIndex => index.items[inputIndex]!));
  } catch (error) {
    if (!(error instanceof DependencyError) || error.code !== 'DEPENDENCY_CYCLE') throw error;
    block('dependency_cycle', { events: members, compilerHolds });
    deferLater();
    return result;
  }
  const groupItems = index.mapped.filter(item => closure.has(item.inputIndex));
  const claims = new Map<string, GlobalClaim>();
  for (const claim of cut.globalClaims) {
    const key = globalKey(claim);
    consistent(!claims.has(key));
    claims.set(key, claim);
  }
  const conflicts = groupItems.filter(item => conflictingClaim(
    claims.get(globalKey(item.mapped)), item, originFor, evidence.target.get(typedKey(item.mapped)),
  ));
  if (conflicts.length) block('global_economic_conflict', { events: conflicts.map(item => item.event) });
  if (compilerHolds.length) block(missing.length ? 'dependency_missing' : 'dependency_invalid', {
    events: members, missing, compilerHolds,
  });
  if (result.blockers.length) {
    deferLater();
    return result;
  }

  const selectedInputs = inputs.filter((event, inputIndex) => {
    const item = index.items[inputIndex]!;
    return event.kind === 'semantic_change' || closure.has(inputIndex) ||
      item.disposition === 'delivery_repeat' && closure.has(item.primaryInputIndex);
  });
  const selected = result.selected = classify(selectedInputs);
  if (stopped(selected, selectedInputs) || selected.details.kind !== 'classified') return result;
  const final = classifierIndex({ ...selected, details: selected.details }, selectedInputs, binding);
  const finalEvidence = dependencyIndex(final, subject, binding, originFor);
  const affectingHolds = final.items.flatMap(item =>
    item.disposition === 'held' && own.has(canonicalJson(item.event)) ? item.holdIndexes : []);
  if (affectingHolds.length) {
    block('dependency_invalid', { events: members,
      compilerHolds: [...new Set(affectingHolds)].sort((a, b) => a - b).map(index => selected.outcome.holds[index]!) });
    deferLater();
    return result;
  }
  consistent(final.groups.length === 1 && final.groups[0]!.disposition === 'accepted' &&
    equal(final.mapped.map(item => item.event), members) && order.length === members.length);
  // Compare compiler evidence across the two invocations using stable event refs, not invocation indexes.
  const original = new Map(groupItems.map(item => [canonicalJson(item.event), item]));
  const edges = (source: DependencyWitness[]) => source.map(({ prerequisite: { presence, ...key }, resolution }) => ({
    key, presence: presence.kind,
    resolution: resolution.kind === 'candidate' ? resolution.providers.map(provider => provider.event) : resolution,
  }));
  const replayOrigins = new Map<Id, ReceiptOrigin>();
  for (const item of final.mapped) {
    const before = original.get(canonicalJson(item.event));
    consistent(before && typedKey(before.mapped) === typedKey(item.mapped) && before.disposition === item.disposition);
    consistent(equal(edges(evidence.byInput.get(before.inputIndex)!), edges(finalEvidence.byInput.get(item.inputIndex)!)));
    if (item.disposition === 'financial_replay') {
      const record = evidence.target.get(typedKey(item.mapped));
      consistent(record && equal(item.existing, {
        identity: record.identity, targetRecordId: record.id, sourceEventId: record.sourceEventId,
        sourceRecordVersion: record.sourceRecordVersion,
      }));
      replayOrigins.set(record.id, originFor(record));
    }
    if (item.disposition === 'financial_coalesced') {
      consistent(before.disposition === 'financial_coalesced' &&
        equal(index.items[before.producerInputIndex]?.event, final.items[item.producerInputIndex]?.event));
    }
  }
  result.proposal = {
    identity, observedEpoch: subject.authority.epoch, targetVersion: target.version, targetSnapshotHash: subject.target.snapshotHash,
    seed, members, orderedMembers: order.map(inputIndex => index.items[inputIndex]!.event!),
    classifierBinding: selected.details.binding, dependencies: result.dependencies,
    plan: selectedPlan(full, selected, final.mapped, original, binding, selectedInputs),
    replayOrigins: [...replayOrigins.values()].sort((a, b) => compareText(a.recordId, b.recordId) || compareText(a.receipt.id, b.receipt.id)),
  };
  return result;
}
