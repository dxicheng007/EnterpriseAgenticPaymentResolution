import {
  CompiledArtifactSchema, CustomerProfileSchema, MutationOperationSchema, SourceEventSchema, ValidatorIdSchema,
  canonicalJson, hashArtifact, hashEvent, hashPlan, hashTargetSnapshot, targetRecordId,
  type CompiledArtifact, type CustomerProfile, type EconomicIdentity, type FieldLineage, type Hash, type Hold, type Id,
  type IsoInstant, type MutationPlan, type PlanOutcome, type Scope, type SourceEvent, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { fundingIdFor } from '@eapr/finance/allocations';
import { indexReversals } from '@eapr/finance/reversals';
import { FinanceError, sameScope, validateTarget, type FinancialRecord } from '@eapr/finance/validate';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import { compare, sourceContractHashes } from './canonicalize.js';
import { blocker, executableDiagnostics, profileDiagnostics } from './compile.js';
import { executeMapping, MappingError, validateSourcePayload } from './operations.js';

type Lineage = Omit<FieldLineage, 'operationIndex'>;
type Candidate = { inputIndex: number; event: SourceEvent; operation: FinancialMutation; lineage: Lineage[] };

export type BatchStopReason =
  'artifact_binding' | 'input_limit' | 'target_invalid' | 'target_scope' | 'delivery_conflict' | 'source_guard' | 'plan_invalid';
export type SourceBlocker = { sourceRef: Id; code: 'IDENTITY_SCOPE' | 'SEMANTIC_VERSION'; causingInputIndexes: number[] };
export type ClassificationBinding = {
  artifactHash: Hash; profileHash: Hash; scope: Scope; expectedTargetVersion: number; targetSnapshotHash: Hash; asOf: IsoInstant;
};
export type EventRef = { sourceRef: Id; eventId: Id; streamId: Id; sequence: number; contentHash: Hash };
export type TypedPrerequisite = {
  relation: 'allocation_funding' | 'allocation_invoice' | 'reversal_original';
  scope: Scope; identity: EconomicIdentity; targetRecordId: Id;
  presence: { kind: 'target' } | { kind: 'candidate'; providerInputIndexes: number[] } | { kind: 'missing' };
};
export type MappedIdentity = { scope: Scope; identity: EconomicIdentity; targetRecordId: Id; prerequisites: TypedPrerequisite[] };
export type ExistingRecordRef = { identity: EconomicIdentity; targetRecordId: Id; sourceEventId: Id; sourceRecordVersion: number };
export type InputClassification = { inputIndex: number } & (
  | { disposition: 'held'; event: EventRef | null; holdIndexes: number[]; mapped: MappedIdentity | null; groupIndex: number | null }
  | { disposition: 'semantic_observed'; event: EventRef; scope: Scope }
  | { disposition: 'financial_new'; event: EventRef; mapped: MappedIdentity; groupIndex: number; planIndex: number; operationIndex: number }
  | { disposition: 'financial_replay'; event: EventRef; mapped: MappedIdentity; groupIndex: number; existing: ExistingRecordRef }
  | { disposition: 'financial_coalesced'; event: EventRef; mapped: MappedIdentity; groupIndex: number; producerInputIndex: number }
  | { disposition: 'delivery_repeat'; event: EventRef; primaryInputIndex: number }
);
export type DependencyGroupClassification = { inputIndexes: number[]; disposition: 'accepted' | 'held'; holdIndexes: number[] };
export type BatchClassificationV1 = {
  schemaVersion: '1';
  outcome: PlanOutcome;
  details:
    | { kind: 'not_classified'; reason: BatchStopReason; holdIndexes: number[]; sourceBlockers: SourceBlocker[] }
    | {
      kind: 'classified'; binding: ClassificationBinding; items: InputClassification[];
      groups: DependencyGroupClassification[]; sourceBlockers: SourceBlocker[];
    };
};

const eventRef = (event: SourceEvent): EventRef => ({
  sourceRef: event.sourceRef, eventId: event.id, streamId: event.streamId, sequence: event.sequence, contentHash: event.contentHash,
});

const operationName = {
  invoice: 'insert_invoice',
  payment: 'insert_payment',
  credit: 'insert_credit',
  allocation: 'add_allocation',
  reversal: 'full_reverse',
} as const;

function hold(
  events: SourceEvent[], code: string, message: string, scope?: Scope, dependencies: string[] = [], paths: string[] = [],
): Hold {
  const eventIds = [...new Set(events.map(event => event.id))];
  return {
    eventIds, ...(scope ? { scope } : {}), code, dependencies,
    diagnostics: [blocker(code, message, eventIds, paths)],
  };
}

function compareEvents(a: SourceEvent, b: SourceEvent) {
  return compare(a.sourceRef, b.sourceRef) || compare(a.streamId, b.streamId) ||
    a.sequence - b.sequence || compare(a.id, b.id);
}

function materialize(
  artifact: CompiledArtifact, profile: CustomerProfile, event: SourceEvent, inputIndex: number,
): Candidate | null {
  const { normalizedPlan } = artifact;
  const contract = normalizedPlan.sourceContracts.find(value => value.resource === event.resource);
  const stream = normalizedPlan.capture.find(value => value.streamId === event.streamId);
  if (!contract || !stream?.resources.includes(event.resource) || contract.schemaVersion !== event.schemaVersion ||
    contract.kind !== event.kind) {
    throw new MappingError('SOURCE_SCHEMA', 'Event does not match its pinned source resource and stream', '/resource');
  }
  validateSourcePayload(contract, event);
  if (event.kind === 'semantic_change') return null;
  const mapping = normalizedPlan.mappings.find(value => value.resource === event.resource && value.kind === event.kind);
  if (!mapping) throw new MappingError('SOURCE_SCHEMA', 'Financial resource has no permitted mapping', '/resource');
  const identity = {
    sourceRef: event.sourceRef, sellerEntityId: profile.scope.sellerEntityId, kind: event.kind, recordId: event.recordId,
  };
  const id = targetRecordId(identity);
  const record = {
    id, identity, scope: profile.scope, kind: event.kind,
    sourceRecordVersion: event.recordVersion, sourceEventId: event.id,
  };
  const profileInputs = [profile.id, profile.hash];
  function derived(targetField: string, sourcePaths: string[], derivationInputs: string[] = [event.id]): Lineage {
    return { targetField, sourceEventIds: [event.id], sourcePaths, evidenceRefs: [], mapping: null, derivationInputs };
  }
  const lineage: Lineage[] = [
    derived('/id', ['/sourceRef', '/rawIdentity/sellerEntityId', '/kind', '/recordId'], [event.id, ...profileInputs]),
    derived('/identity/sourceRef', ['/sourceRef']),
    derived('/identity/sellerEntityId', ['/rawIdentity/sellerEntityId'], [event.id, ...profileInputs]),
    derived('/identity/kind', ['/kind']),
    derived('/identity/recordId', ['/recordId']),
    derived('/scope/companyId', ['/rawIdentity/companyId'], [event.id, ...profileInputs]),
    derived('/scope/sellerEntityId', ['/rawIdentity/sellerEntityId'], [event.id, ...profileInputs]),
    derived('/scope/accountId', ['/rawIdentity/sourceAccountId'], [event.id, ...profileInputs]),
    derived('/kind', ['/kind']),
    derived('/sourceRecordVersion', ['/recordVersion']),
    derived('/sourceEventId', ['/id']),
  ];
  const fields = Object.entries(mapping.fields).map(([target, op]) => {
    const { value, ...detail } = executeMapping(op, target, event, profile);
    if (target === 'effectiveAt') {
      if (value !== event.effectiveAt) throw new MappingError('EFFECTIVE_MISMATCH', 'Mapped effective time differs from the event', '/effectiveAt');
      detail.sourcePaths.push('/effectiveAt');
    }
    if (op.op === 'existing_invoice_lookup' && typeof value === 'string') {
      detail.derivationInputs.push(targetRecordId({ ...identity, kind: 'invoice', recordId: value }));
    }
    lineage.push({ targetField: '/' + target, sourceEventIds: [event.id], mapping: op, ...detail });
    return [target, value];
  });
  const operation = MutationOperationSchema.safeParse({
    op: operationName[event.kind], record: { ...record, ...Object.fromEntries(fields) },
  });
  if (!operation.success || operation.data.op === 'ensure_account' || operation.data.op === 'ensure_customer' ||
    operation.data.op === 'ensure_billing_configuration') {
    throw new MappingError('MAPPING_VALUE', 'Mapped record is invalid', '/payload');
  }
  return { inputIndex, event, operation: operation.data, lineage: lineage.sort((a, b) => compare(a.targetField, b.targetField)) };
}

function resultPlan(
  artifact: CompiledArtifact, profile: CustomerProfile, target: TargetState, candidates: Candidate[], accepted: SourceEvent[],
): MutationPlan {
  const operations = candidates.map(candidate => candidate.operation);
  const plan = {
    scope: target.scope, artifactHash: artifact.hash, profileHash: profile.hash, expectedTargetVersion: target.version,
    eventIds: accepted.sort(compareEvents).map(event => event.id), operations,
    expectedBalanceCents: computeBalance(projectTarget(target, operations), target.asOf), asOf: target.asOf,
    lineage: candidates.flatMap(({ lineage }, operationIndex) => lineage.map(item => ({ ...item, operationIndex }))),
  };
  return { ...plan, hash: hashPlan(plan) };
}

type Prerequisite = Pick<TypedPrerequisite, 'relation' | 'identity'> & { targetId: Id; sourceId: Id };

function prerequisites(record: FinancialRecord): Prerequisite[] {
  function reference(relation: TypedPrerequisite['relation'], kind: EconomicIdentity['kind'], recordId: Id): Prerequisite {
    const identity = { ...record.identity, kind, recordId };
    return { relation, identity, targetId: targetRecordId(identity), sourceId: recordId };
  }
  if (record.kind === 'allocation') {
    return [
      reference('allocation_funding', record.fundingKind, record.fundingRecordId),
      reference('allocation_invoice', 'invoice', record.invoiceRecordId),
    ];
  }
  if (record.kind === 'reversal') {
    return [reference('reversal_original', record.reversedKind, record.reversedRecordId)];
  }
  return [];
}

function mappedIdentity(
  record: FinancialRecord, persisted: ReadonlyMap<Id, FinancialRecord>, providers: ReadonlyMap<Id, number[]>,
): MappedIdentity {
  const scope = record.scope;
  const requirements = prerequisites(record).map(({ relation, identity, targetId }): TypedPrerequisite => {
    const providerInputIndexes = providers.get(targetId);
    const presence: TypedPrerequisite['presence'] = persisted.has(targetId) ? { kind: 'target' }
      : providerInputIndexes ? { kind: 'candidate', providerInputIndexes }
      : { kind: 'missing' };
    return { relation, scope, identity, targetRecordId: targetId, presence };
  });
  return {
    scope, identity: record.identity, targetRecordId: record.id,
    prerequisites: requirements.sort((a, b) => compare(a.relation, b.relation) || compare(canonicalJson(a.identity), canonicalJson(b.identity))),
  };
}

function dependencyGroups(candidates: Candidate[], existing: ReadonlyMap<string, FinancialRecord>): Candidate[][] {
  const parents = new Map<string, string>();
  function root(id: string): string {
    let current = id;
    while (parents.has(current)) current = parents.get(current)!;
    if (id !== current) parents.set(id, current);
    return current;
  }
  function link(record: FinancialRecord) {
    for (const { targetId } of prerequisites(record)) {
      const left = root(record.id);
      const right = root(targetId);
      if (left !== right) parents.set(left, right);
    }
  }
  // Existing allocation edges also connect proposals competing for invoice capacity or reversed funding.
  for (const record of existing.values()) link(record);
  for (const { operation } of candidates) link(operation.record);

  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = root(candidate.operation.record.id);
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function economics({ sourceEventId: _event, sourceRecordVersion: _version, ...record }: FinancialRecord) {
  return canonicalJson(record);
}

type GroupResult =
  | { ok: true; inserted: Candidate[]; replays: Map<Candidate, FinancialRecord>; coalesced: Map<Candidate, Candidate> }
  | { ok: false; hold: Hold };

const orderRank = { insert_invoice: 0, insert_payment: 0, insert_credit: 0, add_allocation: 1, full_reverse: 2 };

function validateGroup(
  group: Candidate[], target: ReturnType<typeof validateTarget>,
): GroupResult {
  const { state, records: persisted, reversals } = target;
  const eventList = group.map(candidate => candidate.event);
  const pending = new Map<string, Candidate>();
  const replays = new Map<Candidate, FinancialRecord>();
  const coalesced = new Map<Candidate, Candidate>();
  for (const candidate of group) {
    const record = candidate.operation.record;
    const persistedPrior = persisted.get(record.id);
    const pendingPrior = pending.get(record.id);
    const prior = persistedPrior ?? pendingPrior?.operation.record;
    if (prior) {
      if (economics(prior) !== economics(record)) {
        return { ok: false, hold: hold(eventList, 'ECONOMIC_CONFLICT', 'Economic identity has conflicting content', state.scope) };
      }
      if (persistedPrior) replays.set(candidate, persistedPrior);
      else if (pendingPrior) coalesced.set(candidate, pendingPrior);
    } else {
      pending.set(record.id, candidate);
    }
  }

  const inserted = [...pending.values()];
  const missing = new Set<string>();
  const dependencies = new Set<string>();
  for (const { operation } of inserted) {
    for (const requirement of prerequisites(operation.record)) {
      dependencies.add(requirement.sourceId);
      if (!persisted.has(requirement.targetId) && !pending.has(requirement.targetId)) missing.add(requirement.sourceId);
    }
  }
  if (missing.size) {
    return {
      ok: false, hold: hold(eventList, 'DEPENDENCY_MISSING', 'A scoped prerequisite is missing', state.scope, [...missing].sort()),
    };
  }
  if (inserted.length) {
    const records = new Map(persisted);
    for (const { operation } of inserted) records.set(operation.record.id, operation.record);
    try {
      const newReversals = inserted.flatMap(({ operation }) => operation.op === 'full_reverse' ? [operation.record] : []);
      const groupReversals = newReversals.length ? indexReversals([...reversals.values(), ...newReversals], records) : reversals;
      for (const { operation } of inserted) {
        if (operation.op !== 'add_allocation') continue;
        const reversal = groupReversals.get(fundingIdFor(operation.record));
        if (reversal && reversal.effectiveAt <= operation.record.effectiveAt) {
          throw new FinanceError('FUNDING_REVERSED', 'New allocation cannot use funding at or after its full reversal');
        }
      }
      validateTarget(projectTarget(state, inserted.map(candidate => candidate.operation)));
    } catch (error) {
      if (!(error instanceof FinanceError)) throw error;
      return { ok: false, hold: hold(eventList, error.code, error.message, state.scope, [...dependencies].sort()) };
    }
  }
  return { ok: true, inserted, replays, coalesced };
}

type Occurrence =
  | { kind: 'held'; holdIndex: number }
  | { kind: 'valid'; event: SourceEvent; key: string };

const deliveryKey = (event: SourceEvent) => event.sourceRef + '/' + event.id;

function parseEvents(inputs: SourceEvent[]) {
  const eventByDelivery = new Map<string, SourceEvent>();
  const seen = new Map<string, SourceEvent>();
  const conflicts = new Map<string, SourceEvent>();
  const holds: Hold[] = [];
  const invalid: { event: SourceEvent; index: number }[] = [];
  const occurrences: Occurrence[] = [];
  const firstIndex = new Map<string, number>();
  let inputIndex = 0;
  for (const input of inputs) {
    const index = inputIndex++;
    try {
      canonicalJson(input);
      const event = SourceEventSchema.parse(input);
      const key = deliveryKey(event);
      const first = seen.get(key);
      if (first && first.contentHash !== event.contentHash) conflicts.set(key, first);
      seen.set(key, event);
      if (hashEvent(event) !== event.contentHash) {
        invalid.push({ event, index });
        continue;
      }
      eventByDelivery.set(key, event);
      if (!firstIndex.has(key)) firstIndex.set(key, index);
      occurrences[index] = { kind: 'valid', event, key };
    } catch {
      occurrences[index] = { kind: 'held', holdIndex: holds.length };
      holds.push(hold([], 'SOURCE_SCHEMA', 'Invalid source event envelope'));
    }
  }
  for (const { event, index } of invalid.sort((a, b) => compareEvents(a.event, b.event))) {
    const key = deliveryKey(event);
    if (eventByDelivery.has(key)) conflicts.set(key, event);
    else {
      occurrences[index] = { kind: 'held', holdIndex: holds.length };
      holds.push(hold([event], 'SOURCE_HASH_CONFLICT', 'Event content hash differs'));
    }
  }
  return {
    events: [...eventByDelivery.values()].sort(compareEvents), holds, occurrences, firstIndex,
    conflicts: [...conflicts.entries()].sort(([a], [b]) => compare(a, b)).map(([, event]) => event),
  };
}

function bindingIsValid(artifact: CompiledArtifact, profile: CustomerProfile) {
  const normalized = artifact.normalizedPlan;
  return artifact.sourceRef === normalized.sourceRef && artifact.hash === hashArtifact(artifact) &&
    canonicalJson(sourceContractHashes(normalized)) === canonicalJson([...artifact.sourceContractHashes].sort((a, b) => compare(a.resource, b.resource))) &&
    artifact.requiredProfileHashes.includes(profile.hash) &&
    ValidatorIdSchema.options.every(validator => normalized.validators.includes(validator)) &&
    !profileDiagnostics([profile], artifact.sourceRef).length && !executableDiagnostics(normalized, [profile]).length;
}

function evaluateBatch(
  artifactInput: CompiledArtifact, profileInput: CustomerProfile, inputs: SourceEvent[], targetInput: TargetState,
): BatchClassificationV1 {
  const blocked = (
    reason: BatchStopReason, code: string, message: string, events: SourceEvent[] = [], scope?: Scope,
    sourceBlockers: SourceBlocker[] = [],
  ): BatchClassificationV1 => ({
    schemaVersion: '1', outcome: { plans: [], holds: [hold(events, code, message, scope)] },
    details: { kind: 'not_classified', reason, holdIndexes: [0], sourceBlockers },
  });
  let artifact: CompiledArtifact;
  let profile: CustomerProfile;
  try {
    canonicalJson(artifactInput);
    canonicalJson(profileInput);
    artifact = CompiledArtifactSchema.parse(artifactInput);
    profile = CustomerProfileSchema.parse(profileInput);
    if (!bindingIsValid(artifact, profile)) {
      return blocked('artifact_binding', 'ARTIFACT_BINDING', 'Artifact executable, source contracts or reviewed profile are inconsistent');
    }
  } catch {
    return blocked('artifact_binding', 'ARTIFACT_BINDING', 'Artifact or reviewed profile is invalid');
  }
  if (!Array.isArray(inputs) || inputs.length > artifact.normalizedPlan.limits.maxRecordsPerCycle) {
    return blocked('input_limit', 'CYCLE_LIMIT', 'Batch exceeds the executable cycle limit');
  }
  const { events, conflicts, holds, occurrences, firstIndex } = parseEvents(inputs);
  if (conflicts.length) return blocked('delivery_conflict', 'DELIVERY_CONFLICT', 'Delivery identity has conflicting content hashes', conflicts);

  let target: ReturnType<typeof validateTarget>;
  try {
    target = validateTarget(targetInput);
  } catch (error) {
    if (!(error instanceof FinanceError)) throw error;
    return blocked('target_invalid', error.code, error.message, events);
  }
  if (!sameScope(target.state.scope, profile.scope)) {
    return blocked('target_scope', 'TARGET_SCOPE', 'Target scope differs from the profile', events);
  }
  const sameCompany = (event: SourceEvent) =>
    event.sourceRef === profile.sourceRef && event.rawIdentity.companyId === profile.scope.companyId;
  const sourceEvents = events.filter(sameCompany);
  const missingGoverningIdentity = (event: SourceEvent) =>
    !event.rawIdentity.sellerEntityId || event.kind === 'semantic_change' && !event.rawIdentity.sourceAccountId;
  const unscoped = sourceEvents.filter(missingGoverningIdentity);
  if (unscoped.length) {
    const code = unscoped.some(event => event.kind === 'semantic_change') ? 'SEMANTIC_VERSION' : 'IDENTITY_SCOPE';
    const causingInputIndexes = occurrences.flatMap((occurrence, index) =>
      occurrence.kind === 'valid' && sameCompany(occurrence.event) && missingGoverningIdentity(occurrence.event) ? [index] : [],
    );
    return blocked('source_guard', code, 'Unscoped identity or semantic revision pauses source application', sourceEvents, undefined, [{
      sourceRef: profile.sourceRef, code, causingInputIndexes,
    }]);
  }

  const ownSeller = (event: SourceEvent) => sameCompany(event) && event.rawIdentity.sellerEntityId === profile.scope.sellerEntityId;
  const ownAccount = (event: SourceEvent) => ownSeller(event) &&
    profile.sourceAccountIds.includes(event.rawIdentity.sourceAccountId ?? '');
  const changedSemantics = new Set(sourceEvents.filter(event =>
    ownAccount(event) && event.kind === 'semantic_change' && event.semanticVersion !== profile.semanticVersion,
  ).map(event => event.rawIdentity.sourceAccountId));

  const candidates: Candidate[] = [];
  const priorDeliveries = new Map([...target.records.values()].map(record =>
    [record.identity.sourceRef + '/' + record.sourceEventId, record.id],
  ));
  const representatives: InputClassification[] = [];
  const heldBy = (inputIndex: number, event: SourceEvent, next: Hold) => {
    representatives[inputIndex] = {
      inputIndex, disposition: 'held', event: eventRef(event), holdIndexes: [holds.length], mapped: null, groupIndex: null,
    };
    holds.push(next);
  };
  for (const event of events) {
    const key = deliveryKey(event);
    const inputIndex = firstIndex.get(key)!;
    if (!ownSeller(event)) {
      heldBy(inputIndex, event, hold([event], 'IDENTITY_SCOPE', 'Source, company or seller is outside the reviewed profile'));
    } else if (!ownAccount(event)) {
      heldBy(inputIndex, event, hold([event], 'UNKNOWN_ACCOUNT', 'Source account has no approved identity in this profile'));
    } else if (event.semanticVersion !== profile.semanticVersion || changedSemantics.has(event.rawIdentity.sourceAccountId)) {
      heldBy(inputIndex, event, hold([event], 'SEMANTIC_VERSION', 'Event semantic revision is not reviewed', profile.scope));
    } else {
      try {
        const mapped = materialize(artifact, profile, event, inputIndex);
        if (!mapped) {
          representatives[inputIndex] = { inputIndex, disposition: 'semantic_observed', event: eventRef(event), scope: profile.scope };
          continue;
        }
        const priorId = priorDeliveries.get(key);
        if (priorId && priorId !== mapped.operation.record.id) {
          return blocked('delivery_conflict', 'DELIVERY_CONFLICT', 'Delivery identity conflicts with an existing target record', [event], profile.scope);
        }
        candidates.push(mapped);
      } catch (error) {
        if (!(error instanceof MappingError)) throw error;
        heldBy(inputIndex, event, hold([event], error.code, error.message, profile.scope, [], [error.path]));
      }
    }
  }

  const accepted: SourceEvent[] = [];
  const inserted: Candidate[] = [];
  const groups = dependencyGroups(candidates, target.records).map(group => {
    const result = validateGroup(group, target);
    const holdIndexes: number[] = [];
    if (result.ok) {
      inserted.push(...result.inserted);
      accepted.push(...group.map(candidate => candidate.event));
    } else {
      holdIndexes.push(holds.length);
      holds.push(result.hold);
    }
    return { group, result, holdIndexes };
  });

  let plans: MutationPlan[] = [];
  if (inserted.length) {
    inserted.sort((left, right) =>
      orderRank[left.operation.op] - orderRank[right.operation.op] || compareEvents(left.event, right.event),
    );
    try {
      plans = [resultPlan(artifact, profile, target.state, inserted, accepted)];
    } catch (error) {
      if (!(error instanceof FinanceError)) throw error;
      const final = hold(accepted, error.code, error.message, profile.scope);
      return {
        schemaVersion: '1', outcome: { plans: [], holds: [...holds, final] },
        details: { kind: 'not_classified', reason: 'plan_invalid', holdIndexes: [holds.length], sourceBlockers: [] },
      };
    }
  }

  const operationIndexes = new Map(inserted.map((candidate, operationIndex) => [candidate, operationIndex]));
  const providers = new Map<Id, number[]>();
  for (const { inputIndex, operation } of candidates) {
    const indexes = providers.get(operation.record.id) ?? [];
    indexes.push(inputIndex);
    providers.set(operation.record.id, indexes);
  }
  for (const indexes of providers.values()) indexes.sort((a, b) => a - b);

  const groupDetails = groups.map(({ group, result, holdIndexes }, groupIndex): DependencyGroupClassification => {
    for (const candidate of group) {
      const { inputIndex, event, operation } = candidate;
      const trace = { inputIndex, event: eventRef(event), mapped: mappedIdentity(operation.record, target.records, providers), groupIndex };
      if (!result.ok) {
        representatives[inputIndex] = { ...trace, disposition: 'held', holdIndexes };
        continue;
      }
      const existing = result.replays.get(candidate);
      const producer = result.coalesced.get(candidate);
      if (existing) {
        representatives[inputIndex] = {
          ...trace, disposition: 'financial_replay',
          existing: {
            identity: existing.identity, targetRecordId: existing.id, sourceEventId: existing.sourceEventId,
            sourceRecordVersion: existing.sourceRecordVersion,
          },
        };
      } else if (producer) {
        representatives[inputIndex] = { ...trace, disposition: 'financial_coalesced', producerInputIndex: producer.inputIndex };
      } else {
        representatives[inputIndex] = {
          ...trace, disposition: 'financial_new', planIndex: 0, operationIndex: operationIndexes.get(candidate)!,
        };
      }
    }
    return {
      inputIndexes: group.map(candidate => candidate.inputIndex).sort((a, b) => a - b),
      disposition: result.ok ? 'accepted' : 'held', holdIndexes,
    };
  });

  const items = occurrences.map((occurrence, inputIndex): InputClassification => {
    if (occurrence.kind === 'held') {
      return { inputIndex, disposition: 'held', event: null, holdIndexes: [occurrence.holdIndex], mapped: null, groupIndex: null };
    }
    const primaryInputIndex = firstIndex.get(occurrence.key)!;
    if (primaryInputIndex === inputIndex) return representatives[inputIndex];
    return { inputIndex, disposition: 'delivery_repeat', event: eventRef(occurrence.event), primaryInputIndex };
  });

  return {
    schemaVersion: '1', outcome: { plans, holds },
    details: {
      kind: 'classified',
      binding: {
        artifactHash: artifact.hash, profileHash: profile.hash, scope: target.state.scope,
        expectedTargetVersion: target.state.version, targetSnapshotHash: hashTargetSnapshot(target.state), asOf: target.state.asOf,
      },
      items, groups: groupDetails, sourceBlockers: [],
    },
  };
}

export function planBatch(
  artifact: CompiledArtifact, profile: CustomerProfile, inputs: SourceEvent[], target: TargetState,
): PlanOutcome {
  return evaluateBatch(artifact, profile, inputs, target).outcome;
}

/** Same evaluation as planBatch plus a per-input trace; never a receipt or authority. */
export function classifyBatch(
  artifact: CompiledArtifact, profile: CustomerProfile, inputs: SourceEvent[], target: TargetState,
): BatchClassificationV1 {
  return evaluateBatch(artifact, profile, inputs, target);
}
