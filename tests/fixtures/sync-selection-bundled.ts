import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { compile } from '@eapr/compiler/compile';
import {
  BootstrapManifestSchema, ConnectorSpecSchema, CustomerProfileSchema, UploadMetadataSchema,
  canonicalJson, hashBytes, hashCanonical, hashManifest, hashProfile, targetRecordId,
  type CaptureResultV1, type ChangePage, type CustomerProfile, type Scope,
} from '@eapr/contracts';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { companyA, sourceFileId, streamContentHash } from '@eapr/sources';
import { withTransaction } from '@eapr/storage/transaction';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { decodeEvidenceProducer, type ProducerV1 } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth, type ProtectedFixtureSet } from '../../packages/evaluator/src/fixtures.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { captureEvidenceFixture } from './evidence-v2-capture.js';
import { createSelectionEnrollment, type SelectionSubject } from './sync-selection-enrollment.js';

const asOf = '2026-10-01T00:00:00.000Z';
const manifestId = 'manifest-sync-bundled-v1';
const fixtureSetId = 'truth-sync-bundled-v1';
const sidecarVersion = 'bootstrap-bundled-selected-v1';
const approvalKey = 'sync-bundle-approve-selected';
const source = { companyId: 'company-a', sellerEntityId: 'seller-a', sourceRef: 'legacy-a' } as const;
const accounts = [
  {
    sourceAccountId: 'sync-bundle-selected', accountId: 'company-a.seller-a.sync-bundle-selected',
    buyerId: 'sync-bundle-buyer-selected', legalName: 'Bundle Selected', contractId: 'sync-bundle-contract-selected',
    recordId: 'sync-bundle-invoice-selected', eventId: 'evt:sync-bundle-invoice-selected', sequence: 1,
    profileId: 'sync-bundle-profile-selected', termId: 'sync-bundle-term-selected',
    configurationId: 'configuration:sync-bundle-term-selected',
  },
  {
    sourceAccountId: 'sync-bundle-other', accountId: 'company-a.seller-a.sync-bundle-other',
    buyerId: 'sync-bundle-buyer-other', legalName: 'Bundle Other', contractId: 'sync-bundle-contract-other',
    recordId: 'sync-bundle-invoice-other', eventId: 'evt:sync-bundle-invoice-other', sequence: 2,
    profileId: 'sync-bundle-profile-other', termId: 'sync-bundle-term-other',
    configurationId: 'configuration:sync-bundle-term-other',
  },
] as const;
type Account = typeof accounts[number];
type Roots = { visibleRoot: string; truthRoot: string };
type Support = ProducerV1['contracts'][number]['support'][number];

const scopeFor = ({ accountId }: Account): Scope => ({ companyId: source.companyId, sellerEntityId: source.sellerEntityId, accountId });
const ordered = <T>(values: readonly T[], key: (item: T) => string) =>
  values.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const contractValues = ({ contractId }: Account) => ({
  contractId, validFrom: '2026-09-01', validToExclusive: null, fixedMonthlyFeeCents: 300000,
  currency: 'USD' as const, cadence: 'monthly' as const, anchorDay: 1,
});

async function authorOriginals({ visibleRoot, truthRoot }: Roots) {
  const commonCurrency = 'Currency USD applies to both agreements below.';
  const agreements = accounts.map(({ contractId, buyerId, sourceAccountId, legalName }) => ({
    title: 'Fixed monthly agreement ' + contractId,
    parties: 'Seller seller-a; buyer ' + buyerId + '; account ' + sourceAccountId,
    name: 'Legal name ' + legalName,
    fee: 'Monthly fee USD 3000.00 for ' + sourceAccountId,
    effective: 'Effective 2026-09-01; monthly invoice anchor day 1.',
  }));
  const lines = [commonCurrency, ...agreements.flatMap(({ title, parties, name, fee, effective }) =>
    [title, parties, name, fee, effective])];
  const text = lines.join(' ');
  const bytes = await textPdf(lines, asOf, lines[0]!);
  const metadata = UploadMetadataSchema.parse({
    companyId: source.companyId, sourceRef: source.sourceRef, documentId: 'doc-sync-bundle-agreements',
    documentVersion: 1, kind: 'contract_pdf', originalName: 'contract-1.pdf',
  });
  const fileId = sourceFileId(metadata);
  const sha256 = hashBytes(bytes);
  const file = { fileId, documentId: metadata.documentId, documentVersion: 1, kind: metadata.kind, sha256 };
  const originals = accounts.map(({ sourceAccountId, recordId, sequence }) => {
    const raw = {
      account: sourceAccountId, amount: '3000.00', due_date: '2026-09-30',
      effective_date: '2026-09-01', id: recordId, version: 1,
    };
    const event = eventA({ kind: 'invoice', sourceAccountId, recordId, effectiveDate: raw.effective_date, fields: raw }, sequence, asOf);
    return { event, path: 'api-a/' + hashCanonical(event.id) + '.json', bytes: canonicalJson(raw) };
  });
  const events = originals.map(({ event }) => event);
  const manifestFields = {
    companyId: source.companyId, sourceRef: source.sourceRef, id: manifestId, epoch: 1, asOf,
    schemaVersions: Object.fromEntries(companyA.contracts.map(({ resource, schemaVersion }) => [resource, schemaVersion])),
    semanticVersions: Object.fromEntries(accounts.map(({ sourceAccountId }) => ['seller-a/' + sourceAccountId, 'sem-a-1'])),
    files: [file],
    streams: companyA.streams.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {
        streamId, resumeAfter, snapshotId: 'member:' + manifestId + ':' + streamId,
        eventIds: members.map(event => event.id), snapshotHash: streamContentHash(source.sourceRef, streamId, resumeAfter, members),
      };
    }),
  };
  const manifest = BootstrapManifestSchema.parse({ ...manifestFields, hash: hashManifest(manifestFields) });
  const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
  const generatorPaths = [
    'package-lock.json', 'packages/sources/src/canonical-fixtures.ts', 'packages/sources/src/company-a.ts',
    'tests/fixtures/sync-selection-bundled.ts', 'tests/fixtures/sync-selection-enrollment.ts',
    'tests/fixtures/sync-selection-reviewer.ts',
  ].toSorted();
  const buildHash = hashCanonical(await Promise.all(generatorPaths.map(async path => ({
    path, sha256: hashBytes(await readFile(join(repositoryRoot, path))),
  }))));
  const binding = {
    ...source, fixtureSetId, manifestId, manifestHash: manifest.hash, generator: { seed: 'sync-bundled-v1', buildHash },
  };
  const truth: Omit<ProtectedFixtureSet, 'hash'> = {
    ...binding, schemaVersion: 1, fixtureSetVersion: '1', purpose: 'construction', asOf,
    inputEvents: ordered(events.map(({ id, contentHash }) => ({ id, contentHash })), event => event.id),
    accounts: ordered(accounts.map(({ sourceAccountId, recordId, eventId }) => ({
      sourceAccountId, balanceAnchorCents: 300000,
      records: [{
        kind: 'invoice' as const, recordId, sourceEventId: eventId, sourceRecordVersion: 1,
        amountCents: 300000, currency: 'USD' as const, effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
      }],
    })), account => account.sourceAccountId),
    evidence: [{ fileId, originalSha256: sha256, text }],
  };
  const truthJson = canonicalJson({ ...truth, hash: hashCanonical(truth) });
  const support = (expectedLiteral: string, ...fields: Support['field'][]): Support[] =>
    fields.map(field => ({ field, fileId, expectedLiteral }));
  const sortSupport = (items: Support[]) => ordered(items,
    ({ field, fileId, expectedLiteral }) => canonicalJson([field, fileId, expectedLiteral]));
  const producer: Omit<ProducerV1, 'hash'> = {
    ...binding, schemaVersion: 1, kind: 'evidence-facts', producerFixtureSetVersion: '1',
    producerTruthHash: decodeTruth(truthJson).hash,
    identities: ordered(accounts.map(({ sourceAccountId, buyerId, legalName }, index) => ({
      id: 'identity:' + hashCanonical({ ...source, sourceAccountId }), sourceAccountId, sellerEntityId: source.sellerEntityId,
      buyerId, legalName, support: sortSupport([
        ...support(agreements[index]!.parties, 'sourceAccountId', 'sellerEntityId', 'buyerId'),
        ...support(agreements[index]!.name, 'legalName'),
      ]),
    })), identity => identity.id),
    contracts: ordered(accounts.map((account, index) => {
      const { sourceAccountId, contractId } = account;
      const { parties, title, fee, effective } = agreements[index]!;
      return {
        id: 'term:' + hashCanonical({ ...source, sourceAccountId, contractId, validFrom: '2026-09-01' }),
        sourceAccountId, sellerEntityId: source.sellerEntityId, ...contractValues(account),
        support: sortSupport([
          ...support(parties, 'sourceAccountId', 'sellerEntityId'), ...support(title, 'contractId'),
          ...support(fee, 'fixedMonthlyFeeCents'), ...support(commonCurrency, 'currency'),
          ...support(effective, 'validFrom', 'cadence', 'anchorDay'),
        ]),
      };
    }), contract => contract.id),
  };
  const producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
  decodeEvidenceProducer(producerJson);
  const files: [string, Uint8Array | string][] = [
    [join(visibleRoot, 'contract-1.pdf'), bytes],
    ...originals.map(({ path, bytes }): [string, string] => [join(visibleRoot, path), bytes]),
    [join(visibleRoot, 'api-a.json'), canonicalJson(events)],
    [join(visibleRoot, 'api-originals-a.json'), canonicalJson(originals.map(({ event, path }) => ({ eventId: event.id, path })))],
    [join(visibleRoot, 'manifest-a.json'), canonicalJson(manifest)],
    [join(visibleRoot, 'uploads-a.json'), canonicalJson([{ metadata, path: 'contract-1.pdf' }])],
    [join(truthRoot, 'expected-a.json'), truthJson],
    [join(truthRoot, 'evidence-a.json'), producerJson],
  ];
  await mkdir(join(visibleRoot, 'api-a'), { recursive: true, mode: 0o700 });
  await mkdir(truthRoot, { mode: 0o700 });
  const digests = new Map<string, { hash: string; length: number }>();
  for (const [path, content] of files) {
    const input = typeof content === 'string' ? Buffer.from(content) : content;
    await writeFile(path, input, { flag: 'wx', mode: 0o600 });
    digests.set(path, { hash: hashBytes(input), length: input.length });
  }
  return {
    text, sha256, pdfBytes: bytes.length, producer,
    async assertInputsUnchanged() {
      for (const [path, digest] of digests) {
        const input = await readFile(path);
        assert.deepEqual({ hash: hashBytes(input), length: input.length }, digest, 'Authored input changed after publication');
      }
    },
  };
}

function profileFor(account: Account, citation: string) {
  const { profileId, buyerId, sourceAccountId, termId, legalName, configurationId } = account;
  const evidenceRefs = [citation];
  const profile = {
    id: profileId, version: 2, sourceRef: source.sourceRef, scope: scopeFor(account), parentCustomerId: buyerId,
    sourceAccountIds: [sourceAccountId], semanticVersion: 'sem-a-1',
    approvedLookups: [{ id: 'account-map', valueType: 'parent-account' as const, entries: [{
      source: sourceAccountId, target: account.accountId, evidenceRefs,
    }] }],
    contractTerms: [{ id: termId, ...contractValues(account), evidenceRefs }], findings: [],
    bootstrap: { customer: { id: buyerId, displayName: legalName, evidenceRefs },
      billingConfigurationIds: [{ termId, id: configurationId }] },
  };
  return CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });
}

function specFor(evidenceRef: string) {
  const common = {
    currency: { op: 'constant', value: 'USD', evidenceRef },
    effectiveAt: { op: 'date_parse', path: '/effective_date', format: 'YYYY-MM-DD', timezone: 'UTC' },
  };
  const money = { ...common, amountCents: { op: 'decimal_to_minor', path: '/amount', scale: 2 } };
  const kinds = { payment: 'payment', credit: 'credit' };
  return ConnectorSpecSchema.parse({
    id: 'sync-bundle-spec', version: 1, sourceRef: source.sourceRef, targetSchemaVersion: '1',
    sourceContracts: companyA.contracts, capture: companyA.streams, runtimeModelCalls: 'forbidden',
    requiredValidators: [], maxTransactionCents: 5000000, maxRecordsPerCycle: 1000, evidenceRefs: [evidenceRef],
    allowedKinds: ['invoice', 'payment', 'credit', 'allocation', 'reversal'],
    mappings: [
      { resource: 'a-invoices', kind: 'invoice', fields: { ...money, dueDate: { op: 'field', path: '/due_date' } } },
      { resource: 'a-payments', kind: 'payment', fields: money },
      { resource: 'a-credits', kind: 'credit', fields: money },
      { resource: 'a-allocations', kind: 'allocation', fields: {
        ...money, fundingKind: { op: 'enum_lookup', path: '/funding_kind', values: kinds },
        fundingRecordId: { op: 'field', path: '/funding_id' },
        invoiceRecordId: { op: 'existing_invoice_lookup', path: '/invoice_id' },
      } },
      { resource: 'a-reversals', kind: 'reversal', fields: {
        ...common, reversedKind: { op: 'enum_lookup', path: '/reversed_kind', values: kinds },
        reversedRecordId: { op: 'field', path: '/reversed_id' },
      } },
    ],
  });
}

async function assertSelectedImport(db: Pool, citation: string, selected: SelectionSubject) {
  const account = accounts[0];
  const scope = scopeFor(account);
  const { stored } = selected;
  const identity = { sourceRef: source.sourceRef, sellerEntityId: source.sellerEntityId, kind: 'invoice' as const, recordId: account.recordId };
  const id = targetRecordId(identity);
  const evidenceRefs = [citation];
  const { approvedTarget: { records }, receipt } = stored;
  assert.deepEqual(records, {
    scope, version: 1, asOf, invoices: [{
      id, identity, scope, kind: 'invoice', sourceEventId: account.eventId, sourceRecordVersion: 1,
      amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
    }], payments: [], credits: [], allocations: [], reversals: [],
    customers: [{ id: account.buyerId, displayName: account.legalName, evidenceRefs }],
    accounts: [{ id: account.accountId, scope, parentCustomerId: account.buyerId,
      sourceRef: source.sourceRef, sourceAccountIds: [account.sourceAccountId] }],
    billingConfigurations: [{ id: account.configurationId, scope,
      contractTerm: { id: account.termId, ...contractValues(account), evidenceRefs } }],
  });
  assert.deepEqual(receipt.eventIds, [account.eventId]);
  assert.deepEqual(receipt.targetRecordIds, [id]);
  assert.equal(receipt.beforeBalanceCents, 0);
  assert.equal(receipt.afterBalanceCents, 300000);
  await withTransaction(db, async client => {
    assert.deepEqual(await readFinancialOrigins(client, scope, records.invoices), [
      { kind: 'initial', recordId: id, importKey: approvalKey, receipt },
    ]);
    const other = scopeFor(accounts[1]);
    assert.equal(await readStoredActivation(client, other), null);
    assert.equal(await readStoredTarget(client, other), null);
    for (const table of ['parent_scopes', 'parent_targets', 'parent_metadata', 'parent_financial_records',
      'runtime_activation_imports', 'runtime_financial_origins']) {
      const { rows } = await client.query('SELECT DISTINCT account_id FROM ' + table);
      assert.deepEqual(rows, [{ account_id: scope.accountId }], 'Unexpected selecting account in ' + table);
    }
    for (const table of ['runtime_authority_heads', 'runtime_authority_commands']) {
      assert.equal((await client.query('SELECT 1 FROM ' + table)).rowCount, 0);
    }
  });
}

export async function createSyncSelectionBundledFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  selected: SelectionSubject;
  unselected: CustomerProfile;
  capture(page: ChangePage): Promise<CaptureResultV1>;
}> {
  const { db, roots, dependencies, candidates, bootstrapRoots, prove, openReviewer, close } = await createSelectionEnrollment();
  try {
    const original = await authorOriginals(roots);
    const { input, contractFileId } = await captureEvidenceFixture(dependencies, roots, 'a');
    const { manifest, snapshot } = input;
    assert.equal(manifest.id, manifestId);
    const citations = input.citations.filter(({ evidence }) => evidence.sourceId === contractFileId);
    const [citation] = citations;
    assert(citations.length === 1 && citation, 'Expected one real page citation');
    const { evidence, text } = citation;
    assert.deepEqual(evidence.locator, { kind: 'pdf', page: 1, start: 0, end: original.text.length });
    assert(text.value === original.text && evidence.excerpt === original.text, 'Shared PDF text did not match author input');
    assert.equal(text.startInclusive, 0);
    assert.equal(text.endExclusive, original.text.length);
    assert.equal(citation.original.byteLength, original.pdfBytes);
    assert.equal(citation.original.sha256, original.sha256);
    assert.equal(evidence.sha256, original.sha256);
    assert.equal(text.sha256, hashBytes(Buffer.from(original.text)));
    assert.equal(evidence.snapshotId, snapshot.id);
    const currencyRows = input.resolvedSupport.filter(row => row.field === 'currency');
    assert.equal(currencyRows.length, 2);
    for (const contract of original.producer.contracts) {
      assert(currencyRows.some(row => row.factId === contract.id && row.evidenceId === evidence.id &&
        row.fileId === contractFileId && row.expectedLiteral === 'Currency USD applies to both agreements below.'),
      'Shared citation did not support a distinct contract currency');
    }
    const selectedProfile = profileFor(accounts[0], evidence.id);
    const otherProfile = profileFor(accounts[1], evidence.id);
    const profiles = [selectedProfile, otherProfile];
    const spec = specFor(evidence.id);
    const compiled = compile(spec, profiles);
    assert(compiled.ok, 'Bundled connector compilation failed');
    const artifact = compiled.value;
    const hashes = profiles.map(profile => profile.hash).toSorted();
    assert.deepEqual(artifact.requiredProfileHashes, hashes);
    await candidates.registerCandidate({ spec, profiles, artifact, manifest, snapshot });
    await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
    const account = accounts[0];
    const identity = original.producer.identities.find(fact => fact.sourceAccountId === account.sourceAccountId);
    const contract = original.producer.contracts.find(fact => fact.sourceAccountId === account.sourceAccountId);
    assert(identity && contract, 'Missing selected reviewed facts');
    const proof = await prove({
      selection: { artifactHash: artifact.hash, manifestId, selectedProfileHash: selectedProfile.hash },
      jobId: 'sync-bundled-financial:' + randomUUID(),
      review: {
        fixtureSetId, fixtureSetVersion: sidecarVersion, subjects: [{
          profileId: account.profileId, profileHash: selectedProfile.hash, scope: selectedProfile.scope,
          identityFactId: identity.id, customerId: account.buyerId, customerEvidenceRefs: [evidence.id],
          terms: [{ factId: contract.id, termId: account.termId, configurationId: account.configurationId, evidenceRefs: [evidence.id] }],
        }],
      },
    });
    assert.deepEqual(proof.report.profileHashes, hashes);
    assert.deepEqual(proof.report.coverage.profileHashes, hashes);
    assert.deepEqual(proof.attestation.reservation.requiredProfileHashes, hashes);
    const reviewer = await openReviewer({ policyId: 'sync-bundled-policy-v1', proofs: [proof] });
    const selected = await reviewer.approve(proof, approvalKey);
    await reviewer.stop();
    const { bundle, request } = selected.stored;
    assert.deepEqual(bundle.profiles.map(profile => profile.hash).toSorted(), hashes);
    assert.equal(request.expectedProfileHash, selectedProfile.hash);
    assert.equal(bundle.bootstrapVerification.binding.profileHash, selectedProfile.hash);
    assert.deepEqual(bundle.bootstrapVerification.binding.requiredProfileHashes, hashes);
    await assertSelectedImport(db, evidence.id, selected);
    for (const table of ['review_heads', 'prepared_reviews', 'activation_intents']) {
      const { rows } = await dependencies.db.query('SELECT account_id FROM ' + table);
      assert.deepEqual(rows, [{ account_id: account.accountId }]);
    }

    const bound = await createRuntimeCapture({ db, clock: dependencies.clock }).openCommitted(selected.identity);
    const { streams } = await bound.readProgress();
    assert.deepEqual(streams.map(({ streamId, baselineCursor, captureCursor, capturedRecords, capturedPages }) =>
      [streamId, baselineCursor, captureCursor, capturedRecords, capturedPages]), [
      ['a-finance', '2', '2', 0, 0], ['a-semantics', '0', '0', 0, 0],
    ]);
    assert.deepEqual((await db.query('SELECT manifest_hash, initial_activation_id FROM runtime_capture_lanes')).rows,
      [{ manifest_hash: manifest.hash, initial_activation_id: selected.identity.activationId }]);
    const { rows: [counts] } = await db.query(`SELECT
      (SELECT count(*)::int FROM runtime_deliveries) AS deliveries,
      (SELECT count(*)::int FROM runtime_source_positions) AS positions,
      (SELECT count(*)::int FROM runtime_capture_pages) AS pages,
      (SELECT count(*)::int FROM runtime_inbox) AS inbox`);
    assert.deepEqual(counts, { deliveries: 2, positions: 2, pages: 0, inbox: 0 });
    await original.assertInputsUnchanged();
    return { db, close, selected, unselected: otherProfile, capture: bound.capturePage };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
        console.error('Bundled fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
