import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import {
  SourceContractSchema, canonicalJson, hashCanonical, hashEvent, type RawSourceEvent, type SourceContract,
} from '@eapr/contracts';
import { baselineEventsA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { checkSourceContracts, type ContractCheck, type ContractConsumer } from '../src/sync/selection.js';

const compiled = compile(validSpecA, [profileA]);
if (!compiled.ok) throw new Error('Public guard fixture must compile');
const artifact = compiled.value;
const [invoice, payment, , allocation] = baselineEventsA;

function consumer(name: string, artifactHash = artifact.hash): ContractConsumer {
  return {
    identity: {
      scope: { ...profileA.scope, accountId: 'guard-account-' + name },
      activationId: 'guard-activation-' + name, bundleHash: hashCanonical({ name }),
    },
    artifactHash,
  };
}

const consumerA = consumer('a');
const consumerB = consumer('b');
const consumerC = consumer('c', hashCanonical('guard-artifact-c'));

function event(base: RawSourceEvent, patch: Partial<RawSourceEvent>): RawSourceEvent {
  const next = { ...base, ...patch };
  return { ...next, contentHash: hashEvent(next) };
}

function unknownAccount(base: RawSourceEvent): RawSourceEvent {
  return event(base, {
    rawIdentity: { ...base.rawIdentity, sourceAccountId: 'raw-new' },
    payload: { ...base.payload, account: 'raw-new' },
  });
}

function check(base: RawSourceEvent, consumers = [consumerA]): ContractCheck {
  const contract = artifact.normalizedPlan.sourceContracts.find(value => value.resource === base.resource);
  const contractPin = artifact.sourceContractHashes.find(value => value.resource === base.resource);
  const stream = artifact.normalizedPlan.capture.find(value => value.resources.includes(base.resource));
  if (!contract || !contractPin || !stream) throw new Error('Missing public guard fixture binding');
  return {
    event: base, contract, consumers,
    binding: {
      sourceRef: base.sourceRef, companyId: base.rawIdentity.companyId, streamId: stream.streamId,
      resource: contract.resource, sourceContractHash: contractPin.hash,
    },
  };
}

function withContract(row: ContractCheck, contract: SourceContract): ContractCheck {
  return {
    ...row, contract,
    binding: { ...row.binding, sourceContractHash: hashCanonical(contract) },
  };
}

function reference(row: ContractCheck, consumers = row.consumers) {
  const { sourceRef, id, streamId, sequence, contentHash } = row.event;
  return {
    event: { sourceRef, eventId: id, streamId, sequence, contentHash },
    binding: row.binding, consumers,
  };
}

function drift(base: RawSourceEvent, rename: boolean): RawSourceEvent {
  const { amount, ...rest } = base.payload;
  return event(base, { payload: rename ? { ...rest, gross_amount: amount } : rest });
}

test.each([
  { name: 'known, renamed', base: invoice, rename: true, path: '/payload' },
  { name: 'known, missing', base: invoice, rename: false, path: '/amount' },
  { name: 'unknown, renamed', base: unknownAccount(invoice), rename: true, path: '/payload' },
  { name: 'unknown, missing', base: unknownAccount(invoice), rename: false, path: '/amount' },
])('guard_payload_drift $name with unchanged schema blocks the exact binding consumers', ({ base, rename, path }) => {
  const row = { ...check(base, [consumerB, consumerA]), event: drift(base, rename) };
  expect(checkSourceContracts([row])).toEqual({
    sourceContractChecksComplete: true, incompleteReason: null, blockedConsumers: [consumerA, consumerB],
    observations: [{
      ...reference(row, [consumerA, consumerB]), result: 'mapping_blocked', code: 'schema_mapping',
      origin: 'compiler_payload', compilerCode: 'SOURCE_SCHEMA', path,
    }],
  });
});

test.each([
  { name: 'field type', base: invoice, payload: { ...invoice.payload, amount: 3000 }, path: '/amount' },
  { name: 'material enum', base: allocation, payload: { ...allocation.payload, funding_kind: 'private-enum-value' }, path: '/funding_kind' },
  { name: 'account identity', base: invoice, payload: { ...invoice.payload, account: 'private-other-account' }, path: '/payload' },
  { name: 'record identity', base: invoice, payload: { ...invoice.payload, id: 'private-other-record' }, path: '/payload' },
  { name: 'record version', base: invoice, payload: { ...invoice.payload, version: invoice.recordVersion + 1 }, path: '/payload' },
])('guard_payload_drift preserves the actual diagnostic for $name', ({ base, payload, path }) => {
  const row = { ...check(base), event: event(base, { payload }) };
  const result = checkSourceContracts([row]);
  expect(result.observations).toEqual([{
    ...reference(row), result: 'mapping_blocked', code: 'schema_mapping',
    origin: 'compiler_payload', compilerCode: 'SOURCE_SCHEMA', path,
  }]);
  expect(canonicalJson(result)).not.toContain('private-');
});

const envelopeFailures = [
  { field: '/resource', expected: invoice.resource, patch: { resource: 'private-actual-resource' } },
  { field: '/streamId', expected: invoice.streamId, patch: { streamId: 'other-stream' } },
  { field: '/kind', expected: 'invoice', patch: { kind: 'payment' } },
  { field: '/schemaVersion', expected: invoice.schemaVersion, patch: { schemaVersion: 'private-actual-schema' } },
] as const;

test.each(envelopeFailures)('guard_payload_drift reports expected envelope $field before payload validation', ({ field, expected, patch }) => {
  const row = { ...check(invoice), event: event(drift(invoice, false), patch) };
  expect(checkSourceContracts([row]).observations).toEqual([{
    ...reference(row), result: 'mapping_blocked', code: 'schema_mapping',
    origin: 'envelope', failures: [{ field, expected }],
  }]);
});

test('guard_payload_drift retains all envelope mismatches in the specified field order', () => {
  const patch = Object.assign({}, ...envelopeFailures.map(failure => failure.patch)) as Partial<RawSourceEvent>;
  const row = { ...check(invoice), event: event(drift(invoice, false), patch) };
  expect(checkSourceContracts([row]).observations).toEqual([{
    ...reference(row), result: 'mapping_blocked', code: 'schema_mapping', origin: 'envelope',
    failures: envelopeFailures.map(({ field, expected }) => ({ field, expected })),
  }]);
});

test('guard_positive_controls separates passing unknown, peer failures, and another contract on the same feed', () => {
  const validUnknown = check(unknownAccount(invoice), [consumerA, consumerB]);
  const original = { ...validUnknown, event: event(drift(validUnknown.event, true), { id: 'drift-next', sequence: 20 }) };
  const { amount, ...otherFields } = original.contract.fields;
  const alternate = withContract({ ...original, consumers: [consumerC] },
    SourceContractSchema.parse({ ...original.contract, fields: { ...otherFields, gross_amount: amount } }));
  const unrelated = check(payment, [consumerC]);
  const input = [alternate, unrelated, original, validUnknown];
  const result = checkSourceContracts(input);

  expect(result.sourceContractChecksComplete).toBe(true);
  expect(result.blockedConsumers).toEqual([consumerA, consumerB]);
  expect(result.observations).toHaveLength(4);
  expect(result.observations.slice(0, 2)).toEqual([
    { ...reference(validUnknown), result: 'passed' }, { ...reference(unrelated), result: 'passed' },
  ]);
  expect(result.observations.slice(2)).toEqual(expect.arrayContaining([
    { ...reference(alternate), result: 'passed' },
    { ...reference(original), result: 'mapping_blocked', code: 'schema_mapping',
      origin: 'compiler_payload', compilerCode: 'SOURCE_SCHEMA', path: '/payload' },
  ]));
  expect(checkSourceContracts([...input].reverse())).toEqual(result);
});

test('guard_positive_controls checks supplied paused, revoked, and acknowledged post-baseline rows', () => {
  // The guard consumes selected checks. The join that retains these rows is Task 3.
  const approvedBaseline = 10;
  const rows = [
    { status: 'paused', acknowledged: false, expected: 'passed' },
    { status: 'revoked', acknowledged: false, expected: 'passed' },
    { status: 'active', acknowledged: true, expected: 'mapping_blocked' },
  ].map(({ status, acknowledged, expected }, index) => {
    const base = acknowledged ? drift(invoice, false) : invoice;
    const delivery = event(base, { id: 'post-baseline-' + status, sequence: approvedBaseline + index + 1 });
    return { row: check(delivery, [consumer(status)]), expected };
  });
  const result = checkSourceContracts(rows.map(({ row }) => row));
  expect(result.sourceContractChecksComplete).toBe(true);
  expect(result.observations.map(({ event: observed, result: disposition }) => [observed.eventId, disposition]))
    .toEqual(rows.map(({ row, expected }) => [row.event.id, expected]));
  expect(result.blockedConsumers).toEqual([consumer('active')]);
});

test('guard_positive_controls merges duplicate check rows and validates each distinct applicable pair once', async () => {
  const validator = vi.fn<typeof import('@eapr/compiler/operations').validateSourcePayload>();
  vi.doMock('@eapr/compiler/operations', async importOriginal => {
    const actual = await importOriginal<typeof import('@eapr/compiler/operations')>();
    return { ...actual, validateSourcePayload: validator.mockImplementation(actual.validateSourcePayload) };
  });
  try {
    vi.resetModules();
    const { checkSourceContracts: countedCheck } = await import('../src/sync/selection.js');
    const row = check(invoice, [consumerB, consumerB]);
    const alternate = withContract({ ...row, consumers: [consumerC] }, SourceContractSchema.parse({
      ...row.contract, fields: { ...row.contract.fields, optional: { ...row.contract.fields.id, required: false } },
    }));
    const badEnvelope = { ...row, event: event(invoice, { id: 'wrong-kind', kind: 'payment' }) };
    const result = countedCheck([row, alternate, { ...row, consumers: [consumerB, consumerA] }, badEnvelope]);

    expect(validator).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledWith(row.contract, row.event);
    expect(validator).toHaveBeenCalledWith(alternate.contract, alternate.event);
    expect(result.observations).toHaveLength(3);
    expect(result.observations).toContainEqual({ ...reference(row, [consumerA, consumerB]), result: 'passed' });
    expect(result.observations).toContainEqual({ ...reference(alternate), result: 'passed' });
  } finally {
    vi.doUnmock('@eapr/compiler/operations');
    vi.resetModules();
  }
});

test.each([
  { code: 'MONEY_FORMAT', amount: 'private-invalid-money', dueDate: '2026-09-30', path: '/amount' },
  { code: 'MONEY_SCALE', amount: '12.345', dueDate: '2026-09-30', path: '/amount' },
  { code: 'MONEY_RANGE', amount: '50000.01', dueDate: '2026-09-30', path: '/amount' },
  { code: 'SOURCE_DATE', amount: '12.34', dueDate: 'private-invalid-date', path: '/due_date' },
])('guard_unexamined keeps $code before the later missing version', ({ code, amount, dueDate, path }) => {
  const first = check(invoice);
  const { version: _missing, ...rest } = invoice.payload;
  const broken = check(event(invoice, { id: 'bad-early-field', sequence: 2, payload: { ...rest, amount, due_date: dueDate } }),
    [consumerB]);
  const last = check(event(invoice, { id: 'later', sequence: 3 }));
  const result = checkSourceContracts([last, broken, first]);

  expect(result).toEqual({
    sourceContractChecksComplete: false, incompleteReason: 'source_contract_validation', blockedConsumers: [],
    observations: [
      { ...reference(first), result: 'passed' },
      { ...reference(broken), result: 'unexamined', compilerCode: code, path },
    ],
  });
  expect(canonicalJson(result)).not.toContain('private-');
});

test.each(['throwing', 'unavailable'] as const)('guard_unexamined redacts a %s validator seam', async mode => {
  vi.doMock('@eapr/compiler/operations', async importOriginal => {
    const actual = await importOriginal<typeof import('@eapr/compiler/operations')>();
    return {
      ...actual,
      validateSourcePayload: mode === 'throwing' ? () => { throw new Error('private-validator-message'); } : undefined,
    };
  });
  try {
    vi.resetModules();
    const { checkSourceContracts: mockedCheck } = await import('../src/sync/selection.js');
    const row = check(invoice);
    const result = mockedCheck([row]);
    expect(result).toEqual({
      sourceContractChecksComplete: false, incompleteReason: 'source_contract_validation', blockedConsumers: [],
      observations: [{ ...reference(row), result: 'unexamined', compilerCode: null, path: null }],
    });
    expect(canonicalJson(result)).not.toContain('private-validator-message');
  } finally {
    vi.doUnmock('@eapr/compiler/operations');
    vi.resetModules();
  }
});

function checksForCount(count: number, base = check(invoice)): ContractCheck[] {
  return Array.from({ length: count }, (_, index) => ({
    ...base, event: event(base.event, { id: 'bounded-delivery-' + index, sequence: index + 1 }),
  }));
}

test('guard_unexamined caps distinct observations at 8000 after deduplication', () => {
  const checks = checksForCount(8_001);
  const within = checks.slice(0, -1);
  const accepted = checkSourceContracts([...within, within[0]]);
  expect(accepted.sourceContractChecksComplete).toBe(true);
  expect(accepted.observations).toHaveLength(8_000);

  const overflow = checkSourceContracts(checks);
  expect(overflow.sourceContractChecksComplete).toBe(false);
  expect(overflow.incompleteReason).toBe('limit');
  expect(overflow.observations.length).toBeLessThanOrEqual(8_000);
  expect(checkSourceContracts([...checks].reverse())).toEqual(overflow);
});

test('guard_unexamined caps aggregate UTF-8 diagnostic bytes below the observation limit', () => {
  const row = check(invoice);
  const field = 'zz_' + 'é'.repeat(16_384);
  const longContract = SourceContractSchema.parse({
    ...row.contract, fields: { ...row.contract.fields, [field]: row.contract.fields.id },
  });
  const checks = checksForCount(520, withContract(row, longContract));
  const result = checkSourceContracts([...checks].reverse());
  const bytes = result.observations.reduce((total, observation) => total + Buffer.byteLength(canonicalJson(observation)), 0);

  expect(result.incompleteReason).toBe('limit');
  expect(result.sourceContractChecksComplete).toBe(false);
  expect(result.observations.length).toBeGreaterThan(0);
  expect(result.observations.length).toBeLessThan(checks.length);
  expect(result.observations.map(observation => observation.event.sequence))
    .toEqual(checks.slice(0, result.observations.length).map(candidate => candidate.event.sequence));
  const next = checks[result.observations.length];
  const nextBytes = Buffer.byteLength(canonicalJson({
    ...reference(next), result: 'mapping_blocked', code: 'schema_mapping', origin: 'compiler_payload',
    compilerCode: 'SOURCE_SCHEMA', path: '/' + field,
  }));
  expect(bytes).toBeLessThanOrEqual(16_777_216);
  expect(bytes + nextBytes).toBeGreaterThan(16_777_216);
});

test('guard_positive_controls leaves compiler outputs and guard inputs unchanged', () => {
  const inputs = [
    invoice, event(unknownAccount(invoice), { id: 'unknown-valid', sequence: 6 }),
    event(drift(invoice, false), { id: 'known-drift', sequence: 7 }),
    event(drift(unknownAccount(invoice), true), { id: 'unknown-drift', sequence: 8 }),
  ];
  const evaluate = () => canonicalJson({
    plan: planBatch(artifact, profileA, inputs, emptyTargetA),
    classification: classifyBatch(artifact, profileA, inputs, emptyTargetA),
  });
  const rows = Object.freeze(inputs.map(candidate => check(candidate, [consumerB, consumerA])).reverse());
  const before = evaluate();
  const beforeRows = canonicalJson(rows);
  expect(checkSourceContracts(rows).observations.map(observation => observation.result))
    .toEqual(['passed', 'passed', 'mapping_blocked', 'mapping_blocked']);
  expect(canonicalJson(rows)).toBe(beforeRows);
  expect(evaluate()).toBe(before);
});
