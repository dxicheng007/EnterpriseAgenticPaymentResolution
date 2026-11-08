import {
  CompiledArtifactSchema, CustomerProfileSchema, MutationOperationSchema, SourceEventSchema, ValidatorIdSchema,
  canonicalJson, hashArtifact, hashEvent, hashPlan, targetRecordId,
  type CompiledArtifact, type CustomerProfile, type FieldLineage, type Hold, type MutationPlan,
  type PlanOutcome, type Scope, type SourceEvent, type TargetState,
} from '@eapr/contracts';
import { computeBalance } from '@eapr/finance/balance';
import { fundingIdFor, invoiceIdFor } from '@eapr/finance/allocations';
import { indexReversals } from '@eapr/finance/reversals';
import { FinanceError, referenceId, sameScope, validateTarget, type FinancialRecord } from '@eapr/finance/validate';
import { projectTarget, type FinancialMutation } from '@eapr/parent/state';
import { compare, sourceContractHashes } from './canonicalize.js';
import { blocker, executableDiagnostics, profileDiagnostics } from './compile.js';
import { executeMapping, MappingError, validateSourcePayload } from './operations.js';

type Lineage = Omit<FieldLineage, 'operationIndex'>;
type Candidate = { event: SourceEvent; operation: FinancialMutation; lineage: Lineage[] };

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
  artifact: CompiledArtifact, profile: CustomerProfile, event: SourceEvent,
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
  return { event, operation: operation.data, lineage: lineage.sort((a, b) => compare(a.targetField, b.targetField)) };
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

type Prerequisite = { targetId: string; sourceId: string };

function prerequisites(record: FinancialRecord): Prerequisite[] {
  if (record.kind === 'allocation') {
    return [
      { targetId: fundingIdFor(record), sourceId: record.fundingRecordId },
      { targetId: invoiceIdFor(record), sourceId: record.invoiceRecordId },
    ];
  }
  if (record.kind === 'reversal') {
    return [{
      targetId: referenceId(record, record.reversedKind, record.reversedRecordId),
      sourceId: record.reversedRecordId,
    }];
  }
  return [];
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

const orderRank = { insert_invoice: 0, insert_payment: 0, insert_credit: 0, add_allocation: 1, full_reverse: 2 };

function validateGroup(
  group: Candidate[], target: ReturnType<typeof validateTarget>,
): { ok: true; inserted: Candidate[] } | { ok: false; hold: Hold } {
  const { state, records: persisted, reversals } = target;
  const eventList = group.map(candidate => candidate.event);
  const pending = new Map<string, Candidate>();
  for (const candidate of group) {
    const record = candidate.operation.record;
    const prior = persisted.get(record.id) ?? pending.get(record.id)?.operation.record;
    if (prior) {
      if (economics(prior) !== economics(record)) {
        return { ok: false, hold: hold(eventList, 'ECONOMIC_CONFLICT', 'Economic identity has conflicting content', state.scope) };
      }
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
  return { ok: true, inserted };
}

function parseEvents(inputs: SourceEvent[]) {
  const eventByDelivery = new Map<string, SourceEvent>();
  const seen = new Map<string, SourceEvent>();
  const conflicts = new Map<string, SourceEvent>();
  const holds: Hold[] = [];
  const invalid: SourceEvent[] = [];
  for (const input of inputs) {
    try {
      canonicalJson(input);
      const event = SourceEventSchema.parse(input);
      const key = event.sourceRef + '/' + event.id;
      const first = seen.get(key);
      if (first && first.contentHash !== event.contentHash) conflicts.set(key, first);
      seen.set(key, event);
      if (hashEvent(event) !== event.contentHash) {
        invalid.push(event);
        continue;
      }
      eventByDelivery.set(key, event);
    } catch {
      holds.push(hold([], 'SOURCE_SCHEMA', 'Invalid source event envelope'));
    }
  }
  for (const event of invalid.sort(compareEvents)) {
    const key = event.sourceRef + '/' + event.id;
    if (eventByDelivery.has(key)) conflicts.set(key, event);
    else holds.push(hold([event], 'SOURCE_HASH_CONFLICT', 'Event content hash differs'));
  }
  return {
    events: [...eventByDelivery.values()].sort(compareEvents), holds,
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

export function planBatch(
  artifactInput: CompiledArtifact, profileInput: CustomerProfile, inputs: SourceEvent[], targetInput: TargetState,
): PlanOutcome {
  const blocked = (code: string, message: string, events: SourceEvent[] = [], scope?: Scope): PlanOutcome => ({
    plans: [], holds: [hold(events, code, message, scope)],
  });
  let artifact: CompiledArtifact;
  let profile: CustomerProfile;
  try {
    canonicalJson(artifactInput);
    canonicalJson(profileInput);
    artifact = CompiledArtifactSchema.parse(artifactInput);
    profile = CustomerProfileSchema.parse(profileInput);
    if (!bindingIsValid(artifact, profile)) {
      return blocked('ARTIFACT_BINDING', 'Artifact executable, source contracts or reviewed profile are inconsistent');
    }
  } catch {
    return blocked('ARTIFACT_BINDING', 'Artifact or reviewed profile is invalid');
  }
  if (!Array.isArray(inputs) || inputs.length > artifact.normalizedPlan.limits.maxRecordsPerCycle) {
    return blocked('CYCLE_LIMIT', 'Batch exceeds the executable cycle limit');
  }
  const { events, conflicts, holds } = parseEvents(inputs);
  if (conflicts.length) return blocked('DELIVERY_CONFLICT', 'Delivery identity has conflicting content hashes', conflicts);

  let target: ReturnType<typeof validateTarget>;
  try {
    target = validateTarget(targetInput);
  } catch (error) {
    if (!(error instanceof FinanceError)) throw error;
    return blocked(error.code, error.message, events);
  }
  if (!sameScope(target.state.scope, profile.scope)) {
    return blocked('TARGET_SCOPE', 'Target scope differs from the profile', events);
  }
  const sameCompany = (event: SourceEvent) =>
    event.sourceRef === profile.sourceRef && event.rawIdentity.companyId === profile.scope.companyId;
  const sourceEvents = events.filter(sameCompany);
  const unscoped = sourceEvents.filter(event =>
    !event.rawIdentity.sellerEntityId || event.kind === 'semantic_change' && !event.rawIdentity.sourceAccountId,
  );
  if (unscoped.length) {
    const code = unscoped.some(event => event.kind === 'semantic_change') ? 'SEMANTIC_VERSION' : 'IDENTITY_SCOPE';
    return blocked(code, 'Unscoped identity or semantic revision pauses source application', sourceEvents);
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
  for (const event of events) {
    if (!ownSeller(event)) {
      holds.push(hold([event], 'IDENTITY_SCOPE', 'Source, company or seller is outside the reviewed profile'));
    } else if (!ownAccount(event)) {
      holds.push(hold([event], 'UNKNOWN_ACCOUNT', 'Source account has no approved identity in this profile'));
    } else if (event.semanticVersion !== profile.semanticVersion || changedSemantics.has(event.rawIdentity.sourceAccountId)) {
      holds.push(hold([event], 'SEMANTIC_VERSION', 'Event semantic revision is not reviewed', profile.scope));
    } else {
      try {
        const mapped = materialize(artifact, profile, event);
        if (!mapped) continue;
        const priorId = priorDeliveries.get(event.sourceRef + '/' + event.id);
        if (priorId && priorId !== mapped.operation.record.id) {
          return blocked('DELIVERY_CONFLICT', 'Delivery identity conflicts with an existing target record', [event], profile.scope);
        }
        candidates.push(mapped);
      } catch (error) {
        if (!(error instanceof MappingError)) throw error;
        holds.push(hold([event], error.code, error.message, profile.scope, [], [error.path]));
      }
    }
  }

  const accepted: SourceEvent[] = [];
  const inserted: Candidate[] = [];
  for (const group of dependencyGroups(candidates, target.records)) {
    const result = validateGroup(group, target);
    if (!result.ok) {
      holds.push(result.hold);
      continue;
    }
    inserted.push(...result.inserted);
    accepted.push(...group.map(candidate => candidate.event));
  }
  if (!inserted.length) return { plans: [], holds };
  inserted.sort((left, right) =>
    orderRank[left.operation.op] - orderRank[right.operation.op] || compareEvents(left.event, right.event),
  );
  try {
    return { plans: [resultPlan(artifact, profile, target.state, inserted, accepted)], holds };
  } catch (error) {
    if (!(error instanceof FinanceError)) throw error;
    return { plans: [], holds: [...holds, hold(accepted, error.code, error.message, profile.scope)] };
  }
}
