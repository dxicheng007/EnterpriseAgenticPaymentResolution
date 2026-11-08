import { expect, test } from 'vitest';
import {
  BootstrapManifestSchema, CompiledArtifactSchema, ConnectorSpecSchema, CustomerProfileSchema, Decimal2Schema,
  FieldContractSchema, IsoDateSchema, IsoInstantSchema, JsonObjectSchema, MappingOpSchema, MoneyCentsSchema,
  MutationOperationSchema, RawSourceEventSchema, ReceiptResponseSchema, ResolvedSourceEventSchema,
  SemanticPreflightSchema, TargetStateSchema, TransactionCentsSchema, ValidatorIdSchema,
  canonicalJson, decodeUiCursor, encodeUiCursor, hashArtifact, hashBytes, hashCanonical, hashEvent,
  hashManifest, hashProfile, hashSpec, type CompiledArtifact,
} from '../src/index.js';
import {
  afterLatePaymentA, ambiguousRemittanceB, baselineA, baselineCsvB, baselineEventsA, baselineEventsB,
  baselineManifestA, baselineManifestB, conflictingReceiptKey, emailFixturesA, emailFixturesB, emptyTargetA,
  fixtureMetadata, invoiceBeforePaymentVariant, latePaymentA, originalReceiptResponse, profileA, profileB,
  renamedSchemaA, retryReceiptResponse, validSpecA, validSpecB, variantDiagnostics,
} from '../../../tests/fixtures/index.js';

test('validates UTC timestamps and rejects rolled-over source dates', () => {
  expect(IsoDateSchema.safeParse('2026-02-30').success).toBe(false);
  expect(IsoDateSchema.parse('2024-02-29')).toBe('2024-02-29');
  expect(IsoInstantSchema.parse('2026-01-01T12:34:56Z')).toBe('2026-01-01T12:34:56.000Z');
  for (const invalid of ['2026-02-29T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+00:00']) {
    expect(IsoInstantSchema.safeParse(invalid).success).toBe(false);
  }
});

test('parses exact public development fixtures for both source shapes', () => {
  expect(fixtureMetadata.classification).toBe('development-only');
  for (const spec of [validSpecA, validSpecB]) expect(ConnectorSpecSchema.parse(spec)).toEqual(spec);
  for (const profile of [profileA, profileB]) {
    expect(CustomerProfileSchema.parse(profile)).toEqual(profile);
    expect(hashProfile(profile)).toBe(profile.hash);
  }
  expect(profileA.parentCustomerId).toBe(profileB.parentCustomerId);
  expect(profileA.scope).not.toEqual(profileB.scope);
  for (const manifest of [baselineManifestA, baselineManifestB]) {
    expect(BootstrapManifestSchema.parse(manifest)).toEqual(manifest);
    expect(hashManifest(manifest)).toBe(manifest.hash);
  }
  expect(baselineEventsA.map(event => event.id)).toEqual([
    'evt-a-inv-1', 'evt-a-pay-1', 'evt-a-credit-1', 'evt-a-alloc-pay-1', 'evt-a-alloc-credit-1',
  ]);
  for (const event of [
    ...baselineEventsA, ...baselineEventsB, ...latePaymentA, ...invoiceBeforePaymentVariant().events,
    renamedSchemaA, ambiguousRemittanceB,
  ]) {
    expect(RawSourceEventSchema.parse(event)).toEqual(event);
    expect(hashEvent(event)).toBe(event.contentHash);
  }
  expect(invoiceBeforePaymentVariant()).toMatchObject({
    expectedHoldIds: ['evt-a-dep-pay', 'evt-a-dep-alloc'],
    expectedReleaseIds: ['evt-a-dep-pay', 'evt-a-dep-alloc', 'evt-a-dep-inv'],
  });
  expect(renamedSchemaA.payload).not.toHaveProperty('amount');
  expect(renamedSchemaA.payload.gross_amount).toBe('3000.00');
  expect(variantDiagnostics.renamedSchemaA).toBe('SOURCE_SCHEMA');
  for (const state of [emptyTargetA, baselineA, afterLatePaymentA]) expect(TargetStateSchema.parse(state)).toEqual(state);
  expect(baselineA).toMatchObject({ version: 1, invoices: [{ amountCents: 300000 }] });
  expect(afterLatePaymentA.allocations.at(-1)).toMatchObject({ amountCents: 30000, invoiceRecordId: 'inv-a-1' });
});

test('pins manifest watermarks, stream members, and original email and CSV bytes', () => {
  expect(emailFixturesA[0].bytes.toString('utf8')).toBe(
    '{"body":"Account cust-a-1; seller seller-a; currency USD.","messageId":"msg-a-identity"}',
  );
  expect(emailFixturesA[1].bytes.toString('utf8')).toBe(
    '{"body":"Fixed monthly fee USD 3000.00 effective 2026-07-01.","messageId":"msg-a-contract"}',
  );
  for (const [manifest, documents, events] of [
    [baselineManifestA, emailFixturesA, baselineEventsA],
    [baselineManifestB, emailFixturesB, baselineEventsB],
  ] as const) {
    for (const { file, refs, bytes } of documents) {
      expect(manifest.files).toContainEqual(file);
      expect(hashBytes(bytes)).toBe(file.sha256);
      expect(refs.every(ref => ref.sourceId === file.fileId && ref.sha256 === file.sha256)).toBe(true);
    }
    for (const stream of manifest.streams) {
      const members = events.filter(event => event.streamId === stream.streamId)
        .sort((a, b) => a.sequence - b.sequence).map(({ id, contentHash }) => ({ id, contentHash }));
      expect(stream.resumeAfter).toBe(String(members.length));
      expect(stream.eventIds).toEqual(members.map(member => member.id));
      expect(stream.snapshotHash).toBe(hashCanonical({
        sourceRef: manifest.sourceRef, streamId: stream.streamId, resumeAfter: stream.resumeAfter, events: members,
      }));
    }
  }
  expect(baselineManifestB.files.find(file => file.kind === 'event_csv')).toMatchObject({
    batchId: 'batch-b-1', sequence: 1, streamId: 'b-files', sha256: hashBytes(baselineCsvB),
  });
  expect(baselineCsvB.toString('utf8').split('\n')).toHaveLength(6);
  expect(baselineCsvB.toString('utf8')).toContain('""amount_minor"":300000');
});

test('raw unknown identity is capturable without an approved scope', () => {
  expect(ambiguousRemittanceB).toMatchObject({
    rawIdentity: { companyId: 'company-b', sellerEntityId: 'seller-b', sourceAccountId: 'cust-b-unknown' },
    payload: { client_code: 'cust-b-unknown', amount_minor: 30000 },
  });
  expect(variantDiagnostics.ambiguousRemittanceB).toBe('UNKNOWN_ACCOUNT');
  expect(ResolvedSourceEventSchema.safeParse(ambiguousRemittanceB).success).toBe(false);
  expect(RawSourceEventSchema.safeParse({ ...ambiguousRemittanceB, scope: profileB.scope }).success).toBe(false);
  expect(RawSourceEventSchema.safeParse({
    ...ambiguousRemittanceB, rawIdentity: { companyId: 'company-b' },
  }).success).toBe(true);
});

test('manifest and preflight enforce identical semantic map keys', () => {
  for (const key of ['seller-a/cust-a-1', '*', 'seller.x/account:y', 'cust-a-1', '/cust-a-1', 'seller-a/',
    'seller-a/cust-a-1/other', 'seller-a%2Fcust-a-1', 'seller-a/*', '__proto__/cust-a-1',
    'constructor/cust-a-1', 'seller-a/prototype', '__proto__']) {
    const valid = ['seller-a/cust-a-1', '*', 'seller.x/account:y'].includes(key);
    const versions = { [key]: 'sem-a-1' };
    expect(BootstrapManifestSchema.safeParse({ ...baselineManifestA, semanticVersions: versions }).success, key).toBe(valid);
    expect(SemanticPreflightSchema.safeParse({
      sourceRef: 'legacy-a', checkedAt: baselineManifestA.asOf, versions,
    }).success, key).toBe(valid);
  }
});

test('money schemas reject unsafe cents and decimal2 values requiring rounding', () => {
  for (const valid of [0, 300000, Number.MAX_SAFE_INTEGER]) expect(MoneyCentsSchema.safeParse(valid).success).toBe(true);
  for (const invalid of [-1, -0, 1.005, Infinity, Number.MAX_SAFE_INTEGER + 1, '300000']) {
    expect(MoneyCentsSchema.safeParse(invalid).success).toBe(false);
  }
  expect(TransactionCentsSchema.safeParse(0).success).toBe(false);
  expect(TransactionCentsSchema.safeParse(5_000_001).success).toBe(false);
  expect(FieldContractSchema.parse(validSpecA.sourceContracts[0].fields.amount)).toMatchObject({ format: 'decimal2' });
  for (const invalid of ['1.005', '1e3', ' 1.00', '+1', '-1', '00.01', '1,000']) {
    expect(Decimal2Schema.safeParse(invalid).success).toBe(false);
  }
  for (const valid of ['0', '0.0', '1.05', '3000.00']) expect(Decimal2Schema.safeParse(valid).success).toBe(true);
});

test('rejects unknown executable operations, paths and prototype properties', () => {
  expect(MappingOpSchema.safeParse({ op: 'eval', value: 'arbitrary code' }).success).toBe(false);
  expect(MutationOperationSchema.safeParse({ op: 'issue_invoice', record: baselineA.invoices[0] }).success).toBe(false);
  expect(MappingOpSchema.safeParse({ op: 'field', path: '/amount', dependsOn: 'another-output' }).success).toBe(false);
  for (const invalid of ['/', '/nested/amount', '/constructor', '/prototype', '/__proto__', '/bad~2key']) {
    expect(MappingOpSchema.safeParse({ op: 'field', path: invalid }).success, invalid).toBe(false);
  }
  expect(MappingOpSchema.safeParse({ op: 'field', path: '/amount~1value' }).success).toBe(true);
  expect(JsonObjectSchema.safeParse(JSON.parse('{"nested":[{"__proto__":1}]}')).success).toBe(false);
  expect(MappingOpSchema.safeParse(JSON.parse('{"op":"field","path":"/amount","__proto__":null}')).success).toBe(false);
  expect(MappingOpSchema.safeParse({ op: 'enum_lookup', path: '/kind', values: { constructor: 'bad' } }).success).toBe(false);
  expect(ConnectorSpecSchema.safeParse({ ...validSpecA, sourceContracts: [...validSpecA.sourceContracts, validSpecA.sourceContracts[0]] }).success)
    .toBe(false);
});

test('canonical JSON sorts object keys recursively and preserves ordered arrays', () => {
  expect(canonicalJson({ 2: 'b', 10: 'a', z: [{ c: 1, a: 2 }, 0] })).toBe(
    '{"10":"a","2":"b","z":[{"a":2,"c":1},0]}',
  );
  expect(hashCanonical({ z: [{ c: 1, a: 2 }, 0], b: 1 })).toBe(hashCanonical({ b: 1, z: [{ a: 2, c: 1 }, 0] }));
  expect(hashCanonical([1, 2])).not.toBe(hashCanonical([2, 1]));
  for (const invalid of [undefined, -0, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, JSON.parse('{"prototype":1}')]) {
    expect(() => canonicalJson(invalid)).toThrow();
  }
});

test('artifact and profile hashes sort sets and cover executable semantics', () => {
  const { sourceRef, sourceContracts, capture, mappings, allowedKinds, runtimeModelCalls } = validSpecA;
  const artifact: Omit<CompiledArtifact, 'hash'> = {
    id: 'artifact-fixture-a', sourceRef, specHash: hashSpec(validSpecA), compilerVersion: '1',
    runtimeVersion: '1', targetSchemaVersion: '1',
    normalizedPlan: {
      sourceRef, sourceContracts, capture, mappings, allowedKinds, runtimeModelCalls,
      validators: ValidatorIdSchema.options,
      limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
    },
    sourceContractHashes: sourceContracts.map(contract => ({ resource: contract.resource, hash: hashCanonical(contract) })),
    requiredProfileHashes: [profileA.hash, profileB.hash],
  };
  const hash = hashArtifact(artifact);
  expect(CompiledArtifactSchema.parse({ ...artifact, hash }).hash).toBe(hash);
  expect(hashArtifact({
    ...artifact, id: 'other-id', requiredProfileHashes: [...artifact.requiredProfileHashes].reverse(),
    sourceContractHashes: [...artifact.sourceContractHashes].reverse(),
    normalizedPlan: { ...artifact.normalizedPlan, mappings: [...mappings].reverse() },
  })).toBe(hash);
  expect(hashArtifact({ ...artifact, normalizedPlan: { ...artifact.normalizedPlan, validators: [] } })).not.toBe(hash);
  expect(hashSpec({ ...validSpecA, version: 2 })).not.toBe(artifact.specHash);
  const accounts = { ...profileA, sourceAccountIds: ['second', 'cust-a-1'] };
  expect(hashProfile(accounts)).toBe(hashProfile({ ...accounts, sourceAccountIds: [...accounts.sourceAccountIds].reverse() }));
  expect(hashProfile({ ...profileA, semanticVersion: 'sem-a-2' })).not.toBe(profileA.hash);
  expect(() => hashProfile({ ...profileA, sourceAccountIds: ['cust-a-1', 'cust-a-1'] })).toThrow('Duplicate');
});

test('receipt replay carries the identical stored receipt and conflict has no receipt', () => {
  expect(ReceiptResponseSchema.parse(originalReceiptResponse).replayed).toBe(false);
  expect(ReceiptResponseSchema.parse(retryReceiptResponse).replayed).toBe(true);
  expect(canonicalJson(originalReceiptResponse.receipt)).toBe(canonicalJson(retryReceiptResponse.receipt));
  expect(conflictingReceiptKey).toEqual({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
  expect(ReceiptResponseSchema.safeParse(conflictingReceiptKey).success).toBe(false);
  expect(ReceiptResponseSchema.safeParse({
    ...retryReceiptResponse, receipt: { ...retryReceiptResponse.receipt, replayed: true },
  }).success).toBe(false);
});

test('activity cursor rejects invalid encodings, unexpected keys, and future offsets', () => {
  const highWater = { v: 1 as const, controlCursor: 2, runtimeCursor: 3 };
  const wire = encodeUiCursor({ v: 1, controlCursor: 2, runtimeCursor: 1 });
  expect(decodeUiCursor(wire, highWater)).toEqual({ v: 1, controlCursor: 2, runtimeCursor: 1 });
  for (const invalid of ['', wire + '=', 'a'.repeat(1025), encodeUiCursor({ ...highWater, runtimeCursor: 4 }),
    Buffer.from('{"controlCursor":1,"runtimeCursor":1,"v":1,"other":1}').toString('base64url')]) {
    expect(() => decodeUiCursor(invalid, highWater)).toThrow('Invalid activity cursor');
  }
});
