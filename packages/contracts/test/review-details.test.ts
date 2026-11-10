import { expect, test } from 'vitest';
import { ReviewDetailsV1Schema } from '../src/review-details.js';
import { ValidatorIdSchema } from '../src/connector.js';

const hash = 'a'.repeat(64);
const scope = { accountId: 'account', companyId: 'company', sellerEntityId: 'seller' };
const asOf = '2026-10-01T00:00:00.000Z';

function fixture() {
  return {
    schemaVersion: '1', sourceRef: 'source', parentWrites: 0,
    reviewPackage: { id: 'package', revision: 1, hash, scope, artifactHash: hash, profileHash: hash, manifestHash: hash,
      verificationReportId: 'report', previewPlanHash: hash, expectedTargetVersion: 0, diagnostics: [], ready: true },
    capture: { manifestId: 'manifest', manifestHash: hash, snapshotId: 'snapshot:manifest', snapshotHash: hash },
    artifact: { id: 'artifact', hash, specHash: hash, compilerVersion: '1', runtimeVersion: '1', targetSchemaVersion: '1' },
    profile: { id: 'profile', version: 1, hash, sourceRef: 'source', scope, parentCustomerId: 'buyer',
      sourceAccountIds: ['source-account'], approvedLookups: [], contractTerms: [], semanticVersion: '1',
      bootstrap: { customer: { id: 'buyer', displayName: 'Buyer', evidenceRefs: ['cite'] }, billingConfigurationIds: [] } },
    baseline: { scope, version: 0, asOf, snapshotHash: hash, balanceCents: 0, legacyReferences: [],
      records: { scope, version: 0, asOf: '2026-09-30T00:00:00.000Z',
        customers: [], accounts: [], billingConfigurations: [], invoices: [], payments: [], credits: [], allocations: [], reversals: [] } },
    proposedImport: { hash, scope, artifactHash: hash, profileHash: hash, expectedTargetVersion: 0, eventIds: [] as string[],
      operations: [], expectedBalanceCents: 0, asOf, lineage: [] },
    futureScope: { allowedKinds: ['invoice'], limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 },
      validators: [...ValidatorIdSchema.options].sort(), runtimeModelCalls: 'forbidden', safetyRulesVersion: 'frozen-v1',
      safetyRules: ['identity-bound-scope', 'source-contract-bound', 'reviewed-semantic-version',
        'explicit-supported-finance', 'target-version-bound', 'bounded-cycle'] },
    evidence: { snapshotId: 'snapshot:manifest', referencedEvidenceIds: ['cite'] },
  };
}

test('accepts a closed exact projection and preserves the recorded baseline time', () => {
  expect(ReviewDetailsV1Schema.parse(fixture())).toEqual(fixture());
});

test.each([
  ['protected nested key', () => ({ artifact: { ...fixture().artifact, policyId: 'private' } })],
  ['unsafe cents', () => ({ baseline: { ...fixture().baseline, balanceCents: Number.MAX_SAFE_INTEGER + 1 } })],
  ['duplicate evidence', () => ({ evidence: { ...fixture().evidence, referencedEvidenceIds: ['cite', 'cite'] } })],
  ['duplicate kind', () => ({ futureScope: { ...fixture().futureScope, allowedKinds: ['invoice', 'invoice'] } })],
  ['duplicate validator', () => ({ futureScope: { ...fixture().futureScope, validators: ['identity_scope', 'identity_scope'] } })],
  ['missing validator', () => ({ futureScope: { ...fixture().futureScope, validators: ['identity_scope'] } })],
  ['rule tuple', () => ({ futureScope: { ...fixture().futureScope, safetyRules: ['identity-bound-scope'] } })],
  ['runtime version', () => ({ artifact: { ...fixture().artifact, runtimeVersion: '2' } })],
  ['scope mismatch', () => ({ profile: { ...fixture().profile, scope: { ...scope, accountId: 'other' } } })],
  ['hash mismatch', () => ({ proposedImport: { ...fixture().proposedImport, profileHash: 'b'.repeat(64) } })],
  ['time mismatch', () => ({ proposedImport: { ...fixture().proposedImport, asOf: '2026-10-02T00:00:00.000Z' } })],
  ['missing bootstrap', () => ({ profile: { ...fixture().profile, bootstrap: undefined } })],
  ['different bootstrap customer', () => ({ profile: { ...fixture().profile, parentCustomerId: 'other' } })],
  ['missing evidence', () => ({ evidence: { ...fixture().evidence, referencedEvidenceIds: [] } })],
] as const)('rejects %s', (_name, change) => {
  expect(ReviewDetailsV1Schema.safeParse({ ...fixture(), ...change() }).success).toBe(false);
});

test('orders declared sets without reordering the saved plan arrays', () => {
  const details = fixture();
  details.profile.sourceAccountIds = ['z-account', 'a-account'];
  details.futureScope.allowedKinds = ['payment', 'credit'];
  details.futureScope.validators.reverse();
  details.proposedImport.eventIds = ['z-event', 'a-event'];
  const parsed = ReviewDetailsV1Schema.parse(details);
  expect(parsed.profile.sourceAccountIds).toEqual(['a-account', 'z-account']);
  expect(parsed.futureScope.allowedKinds).toEqual(['credit', 'payment']);
  expect(parsed.futureScope.validators).toEqual([...ValidatorIdSchema.options].sort());
  expect(parsed.proposedImport.eventIds).toEqual(['z-event', 'a-event']);
});

test('the direct leaf builds for browsers without server modules', async () => {
  const { build } = await import('vite');
  const { isBuiltin } = await import('node:module');
  const { fileURLToPath } = await import('node:url');
  const entry = fileURLToPath(new URL('../src/review-details.ts', import.meta.url));
  const modules = new Set<string>();
  await build({
    configFile: false, logLevel: 'silent',
    build: { lib: { entry, formats: ['es'] }, write: false },
    plugins: [{
      name: 'assert-review-details-browser-imports',
      enforce: 'pre',
      resolveId(source) {
        if (isBuiltin(source) || source.startsWith('@eapr/')) this.error('Non-browser dependency: ' + source);
      },
      moduleParsed(module) { modules.add(module.id); },
    }],
  });
  expect(modules.has(entry)).toBe(true);
  expect([...modules].filter(id => id.includes('/packages/') && !id.includes('/node_modules/'))).toEqual(
    expect.arrayContaining([entry]),
  );
  expect([...modules].filter(id => id.includes('/packages/') && !id.includes('/node_modules/'))
    .every(id => /\/packages\/contracts\/src\/(common|connector|evidence|model|review-details|review|runtime|source)\.ts$/.test(id)))
    .toBe(true);
});
