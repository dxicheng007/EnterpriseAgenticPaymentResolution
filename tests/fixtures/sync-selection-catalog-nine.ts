import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import {
  BootstrapManifestSchema, RawSourceEventSchema, UploadMetadataSchema, VerificationCheckIdSchema,
  canonicalJson, hashBytes, hashCanonical, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation,
  hashManifest, hashProfile, targetRecordId, type Scope, type TargetState,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { companyA, sourceFileId, streamContentHash } from '@eapr/sources';
import { withTransaction } from '@eapr/storage/transaction';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { decodeEvidenceProducer, type ProducerV1 } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth, type ProtectedFixtureSet } from '../../packages/evaluator/src/fixtures.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { captureEvidenceFixture } from './evidence-v2-capture.js';
import { createSelectionEnrollment, type SelectionProof, type SelectionSubject } from './sync-selection-enrollment.js';

const cutover = '2026-10-01T00:00:00.000Z';
const fixtureSetId = 'truth-sync-catalog-nine-v1';
const manifestId = 'manifest-sync-catalog-nine-v1';
const source = { companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a' } as const;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const accounts = ([
  ['01', 'Catalog One'], ['02', 'Catalog Two'], ['03', 'Catalog Three'],
  ['04', 'Catalog Four'], ['05', 'Catalog Five'], ['06', 'Catalog Six'],
  ['07', 'Catalog Seven'], ['08', 'Catalog Eight'], ['09', 'Catalog Nine'],
] as const).map(([suffix, legalName], index) => ({
  suffix, legalName, sequence: index + 1,
  sourceAccountId: 'sync-catalog-' + suffix, accountId: 'company-a.seller-a.sync-catalog-' + suffix,
  buyerId: 'sync-catalog-buyer-' + suffix, contractId: 'sync-catalog-contract-' + suffix,
  documentId: 'doc-sync-catalog-' + suffix, filename: 'contract-' + (index + 1) + '.pdf',
  invoiceId: 'sync-catalog-invoice-' + suffix, eventId: 'evt:sync-catalog-invoice-' + suffix,
  specId: 'sync-catalog-spec-' + suffix, profileId: 'sync-catalog-profile-' + suffix,
  approvalKey: 'sync-catalog-approve-' + suffix, jobId: 'sync-catalog-financial:' + suffix,
  bootstrapVersion: 'bootstrap-catalog-' + suffix + '-v1',
}));
type Account = typeof accounts[number];
type Roots = Awaited<ReturnType<typeof createSelectionEnrollment>>['roots'];
type Support = ProducerV1['identities'][number]['support'][number];
type NineSubjects = [
  SelectionSubject, SelectionSubject, SelectionSubject, SelectionSubject, SelectionSubject,
  SelectionSubject, SelectionSubject, SelectionSubject, SelectionSubject,
];

const scopeFor = ({ accountId }: Account): Scope => ({ companyId: 'company-a', sellerEntityId: 'seller-a', accountId });
const ordered = <T>(items: readonly T[], key: (item: T) => string) =>
  items.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

async function authorOriginals({ visibleRoot, truthRoot }: Roots) {
  const documents = await Promise.all(accounts.map(async account => {
    const { sourceAccountId, buyerId, legalName, contractId, documentId, filename } = account;
    const title = 'Fixed monthly agreement ' + contractId;
    const party = 'Seller seller-a; buyer ' + buyerId + '; account ' + sourceAccountId;
    const name = 'Legal name ' + legalName;
    const fee = 'Monthly fee USD 3000.00';
    const effective = 'Effective 2026-09-01; monthly invoice anchor day 1.';
    const lines = [title, party, name, fee, effective];
    const bytes = await textPdf(lines, cutover, title);
    const metadata = UploadMetadataSchema.parse({
      companyId: source.companyId, sourceRef: source.sourceRef, documentId,
      documentVersion: 1, kind: 'contract_pdf', originalName: filename,
    });
    const fileId = sourceFileId(metadata);
    const sha256 = hashBytes(bytes);
    const support = (expectedLiteral: string, ...fields: Support['field'][]): Support[] =>
      fields.map(field => ({ field, fileId, expectedLiteral }));
    const sortedSupport = (items: Support[]) => ordered(items, item =>
      canonicalJson([item.field, item.fileId, item.expectedLiteral]));
    const identity: ProducerV1['identities'][number] = {
      id: 'identity:' + hashCanonical({ ...source, sourceAccountId }),
      sourceAccountId, sellerEntityId: 'seller-a', buyerId, legalName,
      support: sortedSupport([...support(party, 'sourceAccountId', 'sellerEntityId', 'buyerId'), ...support(name, 'legalName')]),
    };
    const term: ProducerV1['contracts'][number] = {
      id: 'term:' + hashCanonical({ ...source, sourceAccountId, contractId, validFrom: '2026-09-01' }),
      sourceAccountId, sellerEntityId: 'seller-a', contractId, validFrom: '2026-09-01', validToExclusive: null,
      fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1,
      support: sortedSupport([
        ...support(party, 'sourceAccountId', 'sellerEntityId'), ...support(title, 'contractId'),
        ...support(fee, 'fixedMonthlyFeeCents', 'currency'), ...support(effective, 'validFrom', 'cadence', 'anchorDay'),
      ]),
    };
    return {
      account, bytes, upload: { metadata, path: filename }, identity, term,
      file: { fileId, documentId, documentVersion: 1, kind: 'contract_pdf' as const, sha256 },
      evidence: { fileId, originalSha256: sha256, text: lines.join(' ') },
    };
  }));
  const originals = accounts.map(({ sourceAccountId, invoiceId, sequence }) => {
    const raw = {
      account: sourceAccountId, amount: '3000.00', due_date: '2026-09-30', effective_date: '2026-09-01', id: invoiceId, version: 1,
    };
    const event = eventA({
      kind: 'invoice', sourceAccountId, recordId: invoiceId, effectiveDate: '2026-09-01', fields: raw,
    }, sequence, cutover);
    return { raw, event, path: 'api-a/' + hashCanonical(event.id) + '.json' };
  });
  const events = RawSourceEventSchema.array().parse(originals.map(({ event }) => event));
  const fields = {
    companyId: source.companyId, sourceRef: source.sourceRef, id: manifestId, epoch: 1, asOf: cutover,
    schemaVersions: Object.fromEntries(companyA.contracts.map(contract => [contract.resource, contract.schemaVersion])),
    semanticVersions: Object.fromEntries(accounts.map(account => ['seller-a/' + account.sourceAccountId, 'sem-a-1'])),
    files: documents.map(document => document.file),
    streams: companyA.streams.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId);
      const resumeAfter = streamId === 'a-finance' ? '9' : '0';
      return {
        streamId, resumeAfter, snapshotId: 'member:' + manifestId + ':' + streamId,
        eventIds: members.map(event => event.id), snapshotHash: streamContentHash(source.sourceRef, streamId, resumeAfter, members),
      };
    }),
  };
  const manifest = BootstrapManifestSchema.parse({ ...fields, hash: hashManifest(fields) });
  const generatorPaths = [
    'package-lock.json', 'packages/sources/src/canonical-fixtures.ts', 'packages/sources/src/company-a.ts',
    'tests/fixtures/evidence-v2-capture.ts', 'tests/fixtures/sync-selection-catalog-nine.ts',
    'tests/fixtures/sync-selection-enrollment.ts', 'tests/fixtures/sync-selection-reviewer.ts',
  ].sort();
  const buildHash = hashCanonical(await Promise.all(generatorPaths.map(async path =>
    ({ path, sha256: hashBytes(await readFile(join(repository, path))) }))));
  const binding = { ...source, fixtureSetId, manifestId, manifestHash: manifest.hash, generator: { seed: 'sync-catalog-nine-v1', buildHash } };
  const truth: Omit<ProtectedFixtureSet, 'hash'> = {
    ...binding, schemaVersion: 1, fixtureSetVersion: '1', purpose: 'construction', asOf: cutover,
    inputEvents: ordered(events.map(({ id, contentHash }) => ({ id, contentHash })), event => event.id),
    accounts: accounts.map(({ sourceAccountId, invoiceId, eventId }) => ({
      sourceAccountId, balanceAnchorCents: 300000,
      records: [{
        kind: 'invoice', recordId: invoiceId, sourceEventId: eventId, sourceRecordVersion: 1,
        amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
      }],
    })),
    evidence: ordered(documents.map(document => document.evidence), item => item.fileId),
  };
  const truthJson = canonicalJson({ ...truth, hash: hashCanonical(truth) });
  const producer: Omit<ProducerV1, 'hash'> = {
    ...binding, schemaVersion: 1, kind: 'evidence-facts', producerFixtureSetVersion: '1',
    producerTruthHash: decodeTruth(truthJson).hash,
    identities: ordered(documents.map(document => document.identity), item => item.id),
    contracts: ordered(documents.map(document => document.term), item => item.id),
  };
  const producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
  decodeEvidenceProducer(producerJson);

  const files: [string, Uint8Array | string][] = [
    ...documents.map(({ upload, bytes }): [string, Uint8Array] => [join(visibleRoot, upload.path), bytes]),
    ...originals.map(({ path, raw }): [string, string] => [join(visibleRoot, path), canonicalJson(raw)]),
    [join(visibleRoot, 'api-a.json'), canonicalJson(events)],
    [join(visibleRoot, 'api-originals-a.json'), canonicalJson(originals.map(({ event, path }) => ({ eventId: event.id, path })))],
    [join(visibleRoot, 'manifest-a.json'), canonicalJson(manifest)],
    [join(visibleRoot, 'uploads-a.json'), canonicalJson(documents.map(document => document.upload))],
    [join(truthRoot, 'expected-a.json'), truthJson], [join(truthRoot, 'evidence-a.json'), producerJson],
  ];
  for (const directory of new Set(files.map(([path]) => dirname(path)))) await mkdir(directory, { recursive: true, mode: 0o700 });
  const originalDigests = new Map<string, string>();
  for (const [path, content] of files) {
    await writeFile(path, content, { flag: 'wx', mode: 0o600 });
    originalDigests.set(path, hashBytes(await readFile(path)));
  }
  return { documents, manifest, originalDigests };
}

async function assertLiteralImport(db: Pool, account: Account, citation: string, { stored, identity: committed }: SelectionSubject) {
  const scope = scopeFor(account);
  const identity = { sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: account.invoiceId };
  const id = targetRecordId(identity);
  const evidenceRefs = [citation];
  const expected: TargetState = {
    scope, version: 1, asOf: cutover,
    invoices: [{
      id, identity, scope, kind: 'invoice', sourceEventId: account.eventId, sourceRecordVersion: 1,
      amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
    }],
    payments: [], credits: [], allocations: [], reversals: [],
    customers: [{ id: account.buyerId, displayName: account.legalName, evidenceRefs }],
    accounts: [{ id: scope.accountId, scope, parentCustomerId: account.buyerId, sourceRef: 'legacy-a', sourceAccountIds: [account.sourceAccountId] }],
    billingConfigurations: [{
      id: 'configuration:demo-term-a', scope, contractTerm: {
        id: 'demo-term-a', contractId: account.contractId, validFrom: '2026-09-01', validToExclusive: null,
        fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
      },
    }],
  };
  assert(equal(stored.approvedTarget.records, expected), 'Unexpected approved target for ' + scope.accountId);
  const { receipt, activation, plan, request } = stored;
  assert(equal(committed, { scope, activationId: activation.id, bundleHash: stored.bundleHash }) &&
    request.idempotencyKey === account.approvalKey &&
    equal(receipt, {
      id: receipt.id, scope, activationId: activation.id, epoch: 1, artifactHash: activation.artifactHash, planHash: plan.hash,
      eventIds: [account.eventId], targetRecordIds: [id], beforeBalanceCents: 0, afterBalanceCents: 300000,
      status: 'applied', committedAt: '2026-11-09T08:00:00.000Z',
    }), 'Unexpected first receipt for ' + scope.accountId);
  await withTransaction(db, async client => {
    assert(equal(await readStoredTarget(client, scope), stored.approvedTarget), 'Current target differs for ' + scope.accountId);
    const origins = await readFinancialOrigins(client, scope, expected.invoices);
    assert(equal(origins, [{ kind: 'initial', recordId: id, importKey: account.approvalKey, receipt }]),
      'Unexpected financial origin for ' + scope.accountId);
  });
}

export async function createSyncSelectionCatalogNineFixture(): Promise<{ db: Pool; subjects: NineSubjects; close(): Promise<void> }> {
  const context = await createSelectionEnrollment();
  const { db, roots, dependencies, candidates, bootstrapRoots, close, prove, openReviewer } = context;
  try {
    const authored = await authorOriginals(roots);
    const captured = await captureEvidenceFixture(dependencies, roots, 'a');
    const { input, source: definition } = captured;
    const { manifest, snapshot, events } = input;
    assert(equal(manifest, authored.manifest), 'Captured catalog manifest differs from authored manifest');
    await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));

    const registered = [];
    for (const { account, file, identity, term } of authored.documents) {
      const member = manifest.files.find(item => item.documentId === account.documentId);
      assert(equal(member, file), 'Captured agreement differs for ' + account.accountId);
      const matches = input.citations.filter(({ evidence }) =>
        evidence.sourceId === file.fileId && evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
      const citation = matches[0];
      assert(matches.length === 1 && citation && citation.original.sha256 === file.sha256 &&
        citation.evidence.sha256 === file.sha256 && citation.evidence.snapshotId === snapshot.id &&
        snapshot.evidenceIds.includes(citation.evidence.id), 'Missing exact page-one citation for ' + account.accountId);
      const built = buildDemoCandidate({
        source: definition, capture: { companyId: 'company-a', manifestId, contractFileId: file.fileId },
        manifest, snapshot, events, citation,
      });
      assert('candidate' in built, 'Candidate construction failed for ' + account.accountId);
      const draft = built.candidate.request;
      const spec = { ...draft.spec, id: account.specId };
      const profileInput = { ...draft.profiles[0]!, id: account.profileId };
      const profile = { ...profileInput, hash: hashProfile(profileInput) };
      const compiled = compile(spec, [profile]);
      assert(compiled.ok && equal(profile.scope, scopeFor(account)) && equal(compiled.value.requiredProfileHashes, [profile.hash]),
        'Unexpected candidate scope for ' + account.accountId);
      await candidates.registerCandidate({ spec, profiles: [profile], artifact: compiled.value, manifest, snapshot });
      registered.push({ account, identity, term, profile, citationId: citation.evidence.id, selection: {
        artifactHash: compiled.value.hash, manifestId, selectedProfileHash: profile.hash,
      } });
    }
    for (const key of ['artifactHash', 'selectedProfileHash'] as const) {
      assert(new Set(registered.map(item => item.selection[key])).size === 9, 'Duplicate catalog selection ' + key);
    }

    const mandatory = [...VerificationCheckIdSchema.options].sort();
    const buildHash = await readFixedFinancialBuildHash();
    const captureBinding = {
      companyId: source.companyId, sourceRef: source.sourceRef, manifestId, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
      snapshotObjectHash: hashCanonical(snapshot), eventsHash: hashCanonical(ordered(events, event => event.id)),
    };
    const proofs: SelectionProof[] = [];
    for (const { account, identity, term, profile, citationId, selection } of registered) {
      const proof = await prove({ selection, jobId: account.jobId, review: {
        fixtureSetId, fixtureSetVersion: account.bootstrapVersion,
        subjects: [{
          profileHash: profile.hash, profileId: account.profileId, scope: scopeFor(account), identityFactId: identity.id,
          customerId: account.buyerId, customerEvidenceRefs: [citationId],
          terms: [{ factId: term.id, termId: 'demo-term-a', configurationId: 'configuration:demo-term-a', evidenceRefs: [citationId] }],
        }],
      } });
      const { report, attestation, entry } = proof;
      const { reservation } = attestation;
      const pin = reservation.evidencePin;
      assert(report.eligible && report.unexplainedDifferenceCents === 0 &&
        equal(report.checks.map(check => check.id).sort(), mandatory) &&
        report.checks.every(check => check.status === 'passed' && check.cases > 0) &&
        equal(report.coverage.required.toSorted(), mandatory) && equal(report.coverage.executed.toSorted(), mandatory) &&
        equal(report.coverage.profileHashes, [profile.hash]) && equal(report.coverage.sourceRefs, ['legacy-a']) &&
        equal(report.coverage.eventKinds.toSorted(), ['allocation', 'credit', 'invoice', 'payment', 'reversal']),
      'Incomplete financial coverage for ' + account.jobId);
      assert(report.id === 'report:' + account.jobId && report.artifactHash === selection.artifactHash &&
        equal(report.profileHashes, [profile.hash]) && report.manifestHash === manifest.hash &&
        report.evaluatorBuildHash === buildHash && report.fixtureSetId === fixtureSetId && report.fixtureSetVersion === '2' &&
        reservation.jobId === account.jobId && reservation.artifactHash === selection.artifactHash &&
        equal(reservation.requiredProfileHashes, [profile.hash]) && reservation.evaluatorBuildHash === buildHash &&
        equal(reservation.capture, captureBinding) &&
        pin.fixtureSetId === fixtureSetId && pin.fixtureSetVersion === '2' &&
        (!proofs.length || equal(proofs[0]!.attestation.reservation.evidencePin, pin)) &&
        attestation.reportId === report.id && attestation.reportHash === hashFinancialReport(report) &&
        attestation.hash === hashFinancialAttestation(attestation) && reservation.hash === hashFinancialReservation(reservation) &&
        entry.financialReportId === report.id && entry.bootstrapFixture.fixtureSetId === fixtureSetId &&
        entry.bootstrapFixture.fixtureSetVersion === account.bootstrapVersion,
      'Financial proof binding differs for ' + account.jobId);
      proofs.push(proof);
    }

    const reviewer = await openReviewer({ policyId: 'sync-catalog-nine-policy-v1', proofs });
    const subjects: SelectionSubject[] = [];
    for (const [index, { account, citationId }] of registered.entries()) {
      const scope = scopeFor(account);
      await withTransaction(db, async client => {
        const origins = await client.query(
          'SELECT 1 FROM runtime_financial_origins WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3',
          [scope.accountId, scope.companyId, scope.sellerEntityId],
        );
        assert(!origins.rowCount && await readStoredActivation(client, scope) === null &&
          await readStoredTarget(client, scope) === null, 'Subject enrolled before its approval ' + scope.accountId);
      });
      const subject = await reviewer.approve(proofs[index]!, account.approvalKey);
      await assertLiteralImport(db, account, citationId, subject);
      subjects.push(subject);
    }
    await reviewer.stop();
    const { rows: [counts] } = await db.query(
      'SELECT (SELECT count(*)::int FROM runtime_activation_imports) AS imports, ' +
      '(SELECT count(*)::int FROM runtime_activation_imports WHERE capture_source_ref = $1) AS source_imports, ' +
      '(SELECT count(*)::int FROM runtime_capture_lanes) AS lanes, ' +
      '(SELECT count(*)::int FROM runtime_capture_checkpoints) AS checkpoints, ' +
      '(SELECT count(*)::int FROM runtime_source_positions) AS positions, ' +
      '(SELECT count(*)::int FROM runtime_capture_pages) AS pages, ' +
      '(SELECT count(*)::int FROM runtime_inbox) AS inbox, ' +
      '(SELECT count(*)::int FROM runtime_sync_units) AS units', ['legacy-a'],
    );
    assert(equal(counts, { imports: 9, source_imports: 9, lanes: 0, checkpoints: 0, positions: 0, pages: 0, inbox: 0, units: 0 }),
      'Unexpected catalog enrollment totals');
    for (const [path, digest] of authored.originalDigests) {
      assert(hashBytes(await readFile(path)) === digest, 'Catalog input changed after publication');
    }
    assert(subjects.length === 9, 'Incomplete catalog subject tuple');
    return { db, subjects: subjects as NineSubjects, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      try {
        if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
          console.error('Catalog fixture cleanup failed while preserving construction error');
        }
      } catch {
        console.error('Catalog fixture cleanup failed while preserving construction error');
      }
    }
    throw error;
  }
}
