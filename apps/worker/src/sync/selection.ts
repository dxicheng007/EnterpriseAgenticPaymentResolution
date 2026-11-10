import { MappingError, validateSourcePayload } from '@eapr/compiler/operations';
import type { EventRef } from '@eapr/compiler/plan-batch';
import {
  canonicalJson, type CommittedAuthorityIdentityV1, type Hash, type Id, type RawSourceEvent, type SourceContract,
} from '@eapr/contracts';
import { syncEventRef } from '@eapr/parent/sync-store';
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
