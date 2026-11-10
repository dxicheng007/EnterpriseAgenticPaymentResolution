import { MappingError, validateSourcePayload } from '@eapr/compiler/operations';
import {
  classifyBatch, type BatchClassificationV1, type BatchStopReason, type EventRef, type TypedPrerequisite,
} from '@eapr/compiler/plan-batch';
import {
  canonicalJson, type CaptureIncidentSummaryV1, type CaptureLaneV1, type ChangePage,
  type CommittedAuthorityIdentityV1, type CurrentAuthorityV1, type Cursor, type EconomicIdentity, type Hash,
  type Hold, type Id, type IsoInstant, type RawIdentity, type RawSourceEvent, type Scope, type SourceContract,
} from '@eapr/contracts';
import type { FinancialRecord } from '@eapr/finance/validate';
import type { StoredActivation } from '@eapr/parent/activation-store';
import type { StoredTarget } from '@eapr/parent/snapshots';
import {
  syncEventRef, type CoverageCut, type ReceiptOrigin, type SyncEventOutcome, type SyncUnitAudit,
} from '@eapr/parent/sync-store';
import { selectedProfile } from '../activation-validation.js';
import type { readCaptureLane } from './capture-store.js';
import { compareInbox } from './dependencies.js';

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
