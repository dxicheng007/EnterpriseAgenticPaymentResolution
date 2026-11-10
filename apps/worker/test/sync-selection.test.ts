import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { classifyBatch, planBatch } from '@eapr/compiler/plan-batch';
import {
  SourceContractSchema, canonicalJson, hashBundleV2, hashCanonical, hashEvent, hashManifest, hashProfile, hashTargetSnapshot,
  type ConnectorSpec, type CurrentAuthorityV1, type CustomerProfile, type RawSourceEvent, type SourceContract,
} from '@eapr/contracts';
import { baselineEventsA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { parentStorageFixture } from '../../../tests/fixtures/parent-storage.js';
import { syncEventRef } from '@eapr/parent/sync-store';
import {
  checkSourceContracts, routeSelectionCut, type ContractCheck, type ContractConsumer,
  type SelectionCut, type SelectionLane, type SelectionSubject,
} from '../src/sync/selection.js';

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

const fixtureImport = parentStorageFixture();
const inspectionAsOf = '2026-11-10T00:00:00.000Z';

function routingProfile(name: string, rawAccount = 'cust-' + name): CustomerProfile {
  const scope = { ...profileA.scope, accountId: 'account-' + name };
  const next = {
    ...profileA, id: 'profile-' + name, scope, sourceAccountIds: [rawAccount],
    approvedLookups: profileA.approvedLookups.map(lookup => ({
      ...lookup, entries: lookup.entries.map(entry => ({ ...entry, source: rawAccount, target: scope.accountId })),
    })),
  };
  return { ...next, hash: hashProfile(next) };
}

const routeA = routingProfile('routing-a');
const routeB = routingProfile('routing-b');
const routeC = routingProfile('routing-c');
const unselected = routingProfile('unselected');

function storedTarget(records: typeof emptyTargetA) {
  return { records, snapshotHash: hashTargetSnapshot(records), digest: hashCanonical(records) };
}

// Detached test inputs for pure routing. This does not exercise import validation or approval.
function routingSubject(profile: CustomerProfile, options: {
  spec?: ConnectorSpec; extraProfiles?: CustomerProfile[]; laneName?: string; semanticBaseline?: string;
  status?: CurrentAuthorityV1['status'];
} = {}): SelectionSubject {
  const profiles = [profile, ...(options.extraProfiles ?? [])];
  const result = compile(options.spec ?? validSpecA, profiles);
  if (!result.ok) throw new Error('Routing test connector failed to compile: ' + canonicalJson(result.diagnostics));
  const { value: artifact } = result;
  const base = fixtureImport.bundle.manifest;
  const manifest = {
    ...base, id: options.laneName ?? 'routing-shared-lane',
    schemaVersions: Object.fromEntries(artifact.normalizedPlan.sourceContracts.map(({ resource, schemaVersion }) => [resource, schemaVersion])),
    streams: artifact.normalizedPlan.capture.map(({ streamId, transport }) => {
      const resumeAfter = transport === 'semantic' ? options.semanticBaseline ?? '0' : '0';
      return {
        streamId, snapshotId: 'snapshot-' + streamId, resumeAfter, eventIds: [],
        snapshotHash: hashCanonical({ sourceRef: base.sourceRef, streamId, resumeAfter, events: [] }),
      };
    }),
  };
  manifest.hash = hashManifest(manifest);
  const request = { ...fixtureImport.request, expectedArtifactHash: artifact.hash, expectedProfileHash: profile.hash };
  const bundle = { ...fixtureImport.bundle, request, artifact, profiles, manifest };
  bundle.hash = hashBundleV2(bundle);
  const activation = {
    ...fixtureImport.activation, id: 'activation-' + profile.id, scope: profile.scope, artifactHash: artifact.hash,
    profileHash: profile.hash, manifestHash: manifest.hash, allowedKinds: artifact.normalizedPlan.allowedKinds,
    baselineCursors: manifest.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter })),
  };
  const identity = { scope: profile.scope, activationId: activation.id, bundleHash: bundle.hash };
  const status = options.status ?? 'active';
  const authority: CurrentAuthorityV1 = {
    schemaVersion: '1', identity, sourceRef: artifact.sourceRef, artifactHash: artifact.hash, profileHash: profile.hash,
    manifestHash: manifest.hash, status, epoch: status === 'active' ? 1 : 2, changedAt: activation.approvedAt,
  };
  const target = storedTarget({ ...emptyTargetA, scope: profile.scope });
  const stored = {
    ...fixtureImport, request, bundle, activation, approvedTarget: target, requestHash: hashCanonical(request), bundleHash: bundle.hash,
  };
  return { identity, stored, authority, target, origins: [], outcomes: [], units: [], heads: [] };
}

function routingDelivery(base: RawSourceEvent, id: string, sequence: number, account: string) {
  return event(base, {
    id, sequence, recordId: 'record-' + id, rawIdentity: { ...base.rawIdentity, sourceAccountId: account },
    payload: { ...base.payload, id: 'record-' + id, account },
  });
}

function semanticDelivery(id: string, sequence: number, profile: CustomerProfile, semanticVersion: string) {
  return event(routingDelivery(invoice, id, sequence, profile.sourceAccountIds[0]!), {
    streamId: 'a-semantics', resource: 'a-semantics', kind: 'semantic_change', semanticVersion,
    payload: { id: 'record-' + id, version: 1, account: profile.sourceAccountIds[0]!, effective_date: '2026-09-01', revision: semanticVersion },
  });
}

function routingLane(subject: SelectionSubject, events: RawSourceEvent[]): SelectionLane {
  const { activation, bundle: { manifest, artifact } } = subject.stored;
  const { sourceRef, hash: manifestHash } = manifest;
  const capture = artifact.normalizedPlan.capture;
  const lane = { schemaVersion: '1' as const, sourceRef, manifestHash };
  const binding = {
    manifest, capture, manifestDigest: hashCanonical(manifest), captureDigest: hashCanonical(capture),
    initialActivationId: activation.id, initializedAt: activation.approvedAt,
  };
  const pageRows = capture.map(({ streamId, transport, resources }) => {
    if (transport === 'csv') throw new Error('Routing tests require an API-only cut');
    const baselineCursor = activation.baselineCursors.find(row => row.streamId === streamId)!.resumeAfter;
    const members = events.filter(row => row.sourceRef === sourceRef && row.rawIdentity.companyId === manifest.companyId &&
      row.streamId === streamId && resources.includes(row.resource) && row.sequence > Number(baselineCursor))
      .sort((left, right) => left.sequence - right.sequence);
    const captureCursor = members.length ? String(members.at(-1)!.sequence) : baselineCursor;
    const page = { sourceRef, streamId, after: baselineCursor, next: captureCursor, complete: true, events: members };
    const checkpoint = {
      streamId, transport, baselineCursor, captureCursor, capturedPages: members.length ? '1' : '0',
      lastCapturedAt: members.length ? inspectionAsOf : null,
    };
    return { page, checkpoint };
  });
  const pages = pageRows.filter(({ page }) => page.events.length).map(({ page }) => ({
    page, digest: hashCanonical(page), capturedAt: inspectionAsOf,
  }));
  const inbox = pages.flatMap(({ page }) => page.events.map(({ id: eventId, streamId, sequence }) => ({
    sourceRef, manifestHash, streamId, sequence, eventId, afterCursor: page.after,
  })));
  const positions = inbox.map(({ sourceRef, streamId, sequence, eventId }) => ({ sourceRef, streamId, sequence, eventId }));
  return { lane, binding, pages, inbox, positions, incidents: [], checkpoints: pageRows.map(({ checkpoint }) => checkpoint) };
}

function routingCut(subjects: SelectionSubject[], events: RawSourceEvent[]): SelectionCut {
  const lanes = new Map<string, SelectionLane>();
  for (const subject of subjects) {
    const lane = routingLane(subject, events);
    lanes.set(lane.lane.manifestHash, lane);
  }
  return {
    input: { sourceRef: profileA.sourceRef, asOf: inspectionAsOf }, subjects, lanes: [...lanes.values()],
    deliveries: events.map(value => ({ event: value, digest: hashCanonical(value) })), globalClaims: [], evidence: [],
  };
}

function fullFor(result: ReturnType<typeof routeSelectionCut>, subject: SelectionSubject) {
  return result.classifications.find(row => row.identity.activationId === subject.identity.activationId)?.full;
}

test('routing_exact_catalog routes only separately selected committed profiles and retains full delivery applicability', () => {
  const a = routingSubject(routeA, { extraProfiles: [unselected] });
  const b = routingSubject(routeB, { laneName: 'routing-peer-lane' });
  const forA = routingDelivery(invoice, 'route-a', 1, routeA.sourceAccountIds[0]!);
  const forB = routingDelivery(invoice, 'route-b', 2, routeB.sourceAccountIds[0]!);
  const bundled = routingDelivery(invoice, 'route-bundled', 3, unselected.sourceAccountIds[0]!);
  const unknown = routingDelivery(invoice, 'route-unknown', 4, 'raw-new');
  const repeatEconomics = event(forB, { id: 'route-b-other-delivery', sequence: 5 });
  const events = [forA, forB, bundled, unknown, repeatEconomics];
  const cut = routingCut([b, a], events.toReversed());
  const result = routeSelectionCut(cut);
  expect(result.incompleteReason).toBeNull();
  expect(result.routes.map(({ event, rawIdentity, disposition, identities }) => ({ event, rawIdentity, disposition, identities })))
    .toEqual(events.map((value, index) => ({
      event: syncEventRef(value), rawIdentity: value.rawIdentity,
      disposition: index === 2 || index === 3 ? 'unknown_account' : 'known',
      identities: index === 0 ? [a.identity] : index === 1 || index === 4 ? [b.identity] : [],
    })));
  expect(result.routes[1]!.applicability).toEqual([a, b].map(subject => ({
    identity: subject.identity, lane: cut.lanes.find(row => row.lane.manifestHash === subject.authority.manifestHash)!.lane,
    baselineCursor: '0', captureCursor: '5', applicable: true,
  })));
  expect(result.blockers).toEqual([bundled, unknown].map(value => ({
    level: 'raw_identity', code: 'unknown_account', identities: [], rawIdentity: value.rawIdentity,
    events: [syncEventRef(value)], incidentRefs: [], bindings: [], missing: [], compilerHolds: [], classifierStopReason: null,
  })));
  expect(fullFor(result, a)?.outcome.holds).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_ACCOUNT', eventIds: [forB.id] }));
  expect(fullFor(result, b)?.details).toMatchObject({ kind: 'classified', binding: { asOf: inspectionAsOf } });
  expect(routeSelectionCut(routingCut([a, b], events))).toEqual(result);
});

test.each(['companyId', 'sellerEntityId'] as const)('routing_exact_catalog rejects an unrecognized %s without assigning scope', field => {
  const a = routingSubject(routeA);
  const input = event(invoice, { rawIdentity: { ...invoice.rawIdentity, [field]: 'foreign-' + field } });
  const result = routeSelectionCut(routingCut([a], [input]));
  expect(result.incompleteReason).toBe('unknown_source_binding');
  expect(result.routes).toMatchObject([{
    event: syncEventRef(input), rawIdentity: input.rawIdentity, identities: [], disposition: 'unknown_source_binding',
  }]);
});

test('routing_exact_catalog exposes source-wide ambiguity for conflicting committed matches', () => {
  const a = routingSubject(routeA);
  const b = routingSubject(routingProfile('routing-b', routeA.sourceAccountIds[0]));
  const input = routingDelivery(invoice, 'ambiguous', 1, routeA.sourceAccountIds[0]!);
  const result = routeSelectionCut(routingCut([b, a], [input]));
  expect(result.routes).toMatchObject([{
    disposition: 'ambiguous_mapping', identities: [a.identity, b.identity], event: syncEventRef(input),
  }]);
  expect(result.blockers).toContainEqual(expect.objectContaining({
    level: 'source', code: 'ambiguous_mapping', identities: [a.identity, b.identity], events: [syncEventRef(input)],
  }));
});

test('routing_exact_catalog returns empty incomplete coverage when nobody is enrolled', () => {
  const result = routeSelectionCut(routingCut([], [invoice]));
  expect(result).toEqual({
    routes: [], guard: checkSourceContracts([]), blockers: [], classifications: [], incompleteReason: 'no_committed_subjects',
  });
});

test.each(['paused', 'revoked'] as const)('routing_exact_catalog keeps %s authority known with a subject blocker', status => {
  const a = routingSubject(routeA, { status });
  const input = routingDelivery(invoice, 'inactive', 1, routeA.sourceAccountIds[0]!);
  const result = routeSelectionCut(routingCut([a], [input]));
  expect(result.routes).toMatchObject([{ disposition: 'known', identities: [a.identity], event: syncEventRef(input) }]);
  expect(result.blockers).toContainEqual(expect.objectContaining({
    level: 'subject', code: 'inactive_authority', identities: [a.identity], events: [syncEventRef(input)],
  }));
  expect(result.guard.observations).toMatchObject([{ result: 'passed', consumers: [{ identity: a.identity }] }]);
});

test.each([false, true])('routing_guards_before_filtering checks unknown input across both consumers (drift %s)', hasDrift => {
  const a = routingSubject(routeA);
  const b = routingSubject(routeB, { laneName: 'routing-peer-lane' });
  const unknown = routingDelivery(invoice, 'unknown', 1, 'raw-new');
  const input = hasDrift ? drift(unknown, true) : unknown;
  const forB = routingDelivery(payment, 'peer-payment', 2, routeB.sourceAccountIds[0]!);
  const result = routeSelectionCut(routingCut([b, a], [forB, input]));
  expect(result.incompleteReason).toBeNull();
  expect(result.routes).toMatchObject([{ disposition: 'unknown_account', identities: [] }, { disposition: 'known', identities: [b.identity] }]);
  const binding = check(input).binding;
  expect(result.guard.observations[0]).toMatchObject({
    event: syncEventRef(input), binding,
    consumers: [a, b].map(subject => ({ identity: subject.identity, artifactHash: subject.authority.artifactHash })),
    ...(hasDrift ? { result: 'mapping_blocked', compilerCode: 'SOURCE_SCHEMA', path: '/payload' } : { result: 'passed' }),
  });
  expect(result.blockers.filter(row => row.level === 'mapping')).toMatchObject(hasDrift ? [{
    code: 'schema_mapping', identities: [a.identity, b.identity], events: [syncEventRef(input)], bindings: [binding],
  }] : []);
  expect(fullFor(result, b)?.details).toMatchObject({
    kind: 'classified', items: [{ disposition: 'held' }, { disposition: 'financial_new', event: syncEventRef(forB) }],
  });
});

test('routing_guards_before_filtering keeps approval baselines and changed-then-return governing history', () => {
  const a = routingSubject(routeA, { semanticBaseline: '1', laneName: 'routing-later-approval' });
  const b = routingSubject(routeB);
  const prior = semanticDelivery('prior', 1, routeA, 'old-approval-version');
  const same = semanticDelivery('same', 2, routeA, routeA.semanticVersion);
  const changed = semanticDelivery('changed', 3, routeA, 'new-version');
  const returned = semanticDelivery('returned', 4, routeA, routeA.semanticVersion);
  const before = routeSelectionCut(routingCut([a, b], [prior, same]));
  expect(before.routes[0]?.applicability).toMatchObject([
    { identity: a.identity, baselineCursor: '1', captureCursor: '2', applicable: false },
    { identity: b.identity, baselineCursor: '0', captureCursor: '2', applicable: true },
  ]);
  expect(fullFor(before, a)?.details).toMatchObject({
    kind: 'classified', items: [{ disposition: 'semantic_observed', event: syncEventRef(same) }], groups: [],
  });
  expect(fullFor(before, a)?.outcome.plans).toEqual([]);
  expect(before.blockers).toEqual([]);
  expect(before.guard.observations[0]?.consumers.map(row => row.identity)).toEqual([b.identity]);
  const after = routeSelectionCut(routingCut([b, a], [returned, changed, same, prior]));
  expect(after.blockers).toContainEqual(expect.objectContaining({
    level: 'subject', code: 'source_semantics', identities: [a.identity], events: expect.arrayContaining([syncEventRef(changed), syncEventRef(returned)]),
    compilerHolds: expect.arrayContaining([expect.objectContaining({ code: 'SEMANTIC_VERSION', eventIds: [changed.id] })]),
  }));
  expect(after.blockers.every(row => row.level === 'subject' && row.identities.every(identity => identity === a.identity))).toBe(true);
});

test.each(['seller', 'semantic'] as const)('routing_guards_before_filtering honors the actual source-wide %s guard', issue => {
  const semanticSpec = {
    ...validSpecA, sourceContracts: validSpecA.sourceContracts.map(contract => contract.kind === 'semantic_change'
      ? { ...contract, accountIdField: null } : contract),
  };
  const a = routingSubject(routeA, { spec: semanticSpec });
  const b = routingSubject(routeB, { spec: semanticSpec });
  const financial = routingDelivery(invoice, 'no-seller', 1, routeA.sourceAccountIds[0]!);
  const semantics = semanticDelivery('no-account', 1, routeA, routeA.semanticVersion);
  const input = issue === 'seller'
    ? event(financial, { rawIdentity: { companyId: financial.rawIdentity.companyId, sourceAccountId: routeA.sourceAccountIds[0]! } })
    : event(semantics, { rawIdentity: { companyId: semantics.rawIdentity.companyId, sellerEntityId: routeA.scope.sellerEntityId } });
  const forB = routingDelivery(payment, 'peer-payment', issue === 'seller' ? 2 : 1, routeB.sourceAccountIds[0]!);
  const result = routeSelectionCut(routingCut([b, a], [input, forB]));
  const code = issue === 'seller' ? 'IDENTITY_SCOPE' : 'SEMANTIC_VERSION';
  expect(result.routes.find(row => row.event.eventId === forB.id)).toMatchObject({ disposition: 'known', identities: [b.identity] });
  expect(result.guard.observations.every(row => row.result === 'passed')).toBe(true);
  expect(fullFor(result, a)?.details).toMatchObject({ kind: 'not_classified', reason: 'source_guard', sourceBlockers: [{ code }] });
  expect(result.blockers).toContainEqual(expect.objectContaining({
    level: 'source', code: issue === 'seller' ? 'source_identity' : 'source_semantics',
    identities: [a.identity, b.identity], events: [syncEventRef(input)], classifierStopReason: 'source_guard',
    compilerHolds: expect.arrayContaining([expect.objectContaining({ code })]),
  }));
});

test('routing_guards_before_filtering marks early validation errors incomplete and preserves their diagnostic', () => {
  const a = routingSubject(routeA);
  const invalid = routingDelivery(invoice, 'invalid-format', 1, 'raw-new');
  const input = event(invalid, { payload: { ...invalid.payload, amount: '1.234', due_date: 3 } });
  const result = routeSelectionCut(routingCut([a], [input]));
  expect(result.incompleteReason).toBe('source_contract_validation');
  expect(result.guard).toMatchObject({
    sourceContractChecksComplete: false, blockedConsumers: [],
    observations: [{ result: 'unexamined', compilerCode: 'MONEY_SCALE', path: '/amount' }],
  });
  expect(result.routes).toMatchObject([{ disposition: 'unknown_account', identities: [] }]);
});

test('routing_guards_before_filtering validates distinct approved hashes for the same feed and resource', () => {
  const spec = {
    ...validSpecA,
    sourceContracts: validSpecA.sourceContracts.map(contract => contract.resource === invoice.resource ? {
      ...contract, fields: { ...contract.fields, note: { required: false, nullable: false, type: 'string', format: 'text' } as const },
    } : contract),
  };
  const a = routingSubject(routeA);
  const b = routingSubject(routeB, { spec, laneName: 'routing-distinct-contract' });
  const unknown = routingDelivery(invoice, 'unknown-distinct-contract', 1, 'raw-new');
  const input = event(unknown, { payload: { ...unknown.payload, note: 'declared by B only' } });
  const result = routeSelectionCut(routingCut([b, a], [input]));
  expect(result.incompleteReason).toBeNull();
  expect(result.guard.observations).toHaveLength(2);
  expect(result.guard.observations).toEqual(expect.arrayContaining([
    expect.objectContaining({
      result: 'mapping_blocked', path: '/payload', event: syncEventRef(input),
      binding: check(input).binding, consumers: [{ identity: a.identity, artifactHash: a.authority.artifactHash }],
    }),
    expect.objectContaining({
      result: 'passed', event: syncEventRef(input),
      binding: expect.objectContaining({ sourceContractHash: hashCanonical(spec.sourceContracts.find(row => row.resource === input.resource)) }),
      consumers: [{ identity: b.identity, artifactHash: b.authority.artifactHash }],
    }),
  ]));
  expect(result.guard.blockedConsumers).toEqual([{ identity: a.identity, artifactHash: a.authority.artifactHash }]);
});

test.each([false, true])('routing_guards_before_filtering distinguishes an independent binding from a source-wide stop (%s)', sourceStop => {
  const a = routingSubject(routeA);
  const b = routingSubject(routeB);
  const credit = baselineEventsA[2]!;
  const otherStream = 'a-other-finance';
  const spec: ConnectorSpec = {
    ...validSpecA, allowedKinds: ['credit'],
    sourceContracts: validSpecA.sourceContracts.filter(row => row.resource === credit.resource),
    mappings: validSpecA.mappings.filter(row => row.resource === credit.resource),
    capture: [{ ...validSpecA.capture.find(row => row.transport === 'api')!, streamId: otherStream, resources: [credit.resource] }],
  };
  const c = routingSubject(routeC, { spec, laneName: 'routing-independent-lane' });
  const independent = event(routingDelivery(credit, 'peer-credit', 1, routeC.sourceAccountIds[0]!), { streamId: otherStream });
  const unknownDrift = drift(routingDelivery(invoice, 'unknown-drift', 1, 'raw-new'), true);
  const sourceInput = routingDelivery(invoice, 'unscoped', 2, routeB.sourceAccountIds[0]!);
  const missingSeller = event(sourceInput, {
    rawIdentity: { companyId: sourceInput.rawIdentity.companyId, sourceAccountId: sourceInput.rawIdentity.sourceAccountId! },
  });
  const events = sourceStop ? [unknownDrift, independent, missingSeller] : [unknownDrift, independent];
  const result = routeSelectionCut(routingCut([c, a, b], events));

  expect(result.incompleteReason).toBeNull();
  expect(fullFor(result, c)?.details).toMatchObject({
    kind: 'classified', items: [{ disposition: 'financial_new', event: syncEventRef(independent) }],
  });
  expect(result.blockers.filter(row => row.level === 'mapping')).toMatchObject([{ identities: [a.identity, b.identity] }]);
  expect(result.blockers.filter(row => row.level === 'source')).toMatchObject(sourceStop ? [{
    code: 'source_identity', identities: [a.identity, b.identity, c.identity], events: [syncEventRef(missingSeller)],
    compilerHolds: [{ code: 'IDENTITY_SCOPE' }],
  }] : []);
});
