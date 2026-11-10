import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import {
  BootstrapManifestSchema, IdSchema, LocalSessionResponseSchema, RawSourceEventSchema,
  ReviewPackageSchema, UploadMetadataSchema, VerificationCheckIdSchema, bootstrapRequiredAssertions,
  bootstrapRequiredCases, canonicalJson, hashBytes, hashCanonical, hashFinancialReservation, hashManifest,
  hashProfile, strict, targetRecordId, type CaptureResultV1, type ChangePage,
  type CommittedAuthorityIdentityV1, type Scope,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { createEvidenceStore } from '@eapr/evidence';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { companyA, createSourceService, sourceFileId, streamContentHash } from '@eapr/sources';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader, readActivationBundle } from '@eapr/storage/activation-registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { withTransaction } from '@eapr/storage/transaction';
import { z } from 'zod';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { buildControl, createWorkerClient } from '../../apps/control/src/server.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { decodeEvidenceProducer, type ProducerV1 } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth, type ProtectedFixtureSet } from '../../packages/evaluator/src/fixtures.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest } from '../../scripts/native-db.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { captureEvidenceFixture } from './evidence-v2-capture.js';
import { testNamespace } from './harness.js';

const cutover = '2026-10-01T00:00:00.000Z';
const clock = () => new Date('2026-11-09T08:00:00.000Z');
const fixtureSetId = 'truth-sync-selection-peers-v1';
const manifestId = 'manifest-sync-selection-peers-v1';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = { companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a' } as const;
const peers = [
  {
    label: 'one', sourceAccountId: 'sync-selection-one', accountId: 'company-a.seller-a.sync-selection-one',
    buyerId: 'sync-selection-buyer-one', legalName: 'Selection One', contractId: 'sync-selection-contract-one',
    documentId: 'doc-sync-selection-one', filename: 'contract-1.pdf', recordId: 'sync-selection-invoice-one',
    eventId: 'evt:sync-selection-invoice-one', sequence: 1, specId: 'sync-selection-spec-one',
    profileId: 'sync-selection-profile-one', approvalKey: 'sync-selection-approve-one',
    bootstrapVersion: 'bootstrap-peer-one-v1',
  },
  {
    label: 'two', sourceAccountId: 'sync-selection-two', accountId: 'company-a.seller-a.sync-selection-two',
    buyerId: 'sync-selection-buyer-two', legalName: 'Selection Two', contractId: 'sync-selection-contract-two',
    documentId: 'doc-sync-selection-two', filename: 'contract-2.pdf', recordId: 'sync-selection-invoice-two',
    eventId: 'evt:sync-selection-invoice-two', sequence: 2, specId: 'sync-selection-spec-two',
    profileId: 'sync-selection-profile-two', approvalKey: 'sync-selection-approve-two',
    bootstrapVersion: 'bootstrap-peer-two-v1',
  },
] as const;
type Peer = typeof peers[number];
type Roots = { visibleRoot: string; truthRoot: string };
type Subject = { identity: CommittedAuthorityIdentityV1; stored: StoredActivation };
type Support = ProducerV1['identities'][number]['support'][number];

const scopeFor = ({ accountId }: Peer): Scope => ({ companyId: source.companyId, sellerEntityId: source.sellerEntityId, accountId });
const ordered = <T>(values: readonly T[], key: (item: T) => string) =>
  values.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const writeOptions = { flag: 'wx', mode: 0o600 } as const;

async function authorOriginals({ visibleRoot, truthRoot }: Roots) {
  const documents = await Promise.all(peers.map(async peer => {
    const { sourceAccountId, buyerId, legalName, contractId, documentId, filename } = peer;
    const title = 'Fixed monthly agreement ' + contractId;
    const parties = 'Seller seller-a; buyer ' + buyerId + '; account ' + sourceAccountId;
    const name = 'Legal name ' + legalName;
    const fee = 'Monthly fee USD 3000.00';
    const effective = 'Effective 2026-09-01; monthly invoice anchor day 1.';
    const lines = [title, parties, name, fee, effective];
    const bytes = await textPdf(lines, cutover, title);
    const metadata = UploadMetadataSchema.parse({
      companyId: source.companyId, sourceRef: source.sourceRef, documentId,
      documentVersion: 1, kind: 'contract_pdf', originalName: filename,
    });
    const fileId = sourceFileId(metadata);
    const sha256 = hashBytes(bytes);
    const support = (expectedLiteral: string, ...fields: Support['field'][]): Support[] =>
      fields.map(field => ({ field, fileId, expectedLiteral }));
    const sortSupport = (items: Support[]) => ordered(items,
      ({ field, fileId, expectedLiteral }) => canonicalJson([field, fileId, expectedLiteral]));
    const identity: ProducerV1['identities'][number] = {
      id: 'identity:' + hashCanonical({ ...source, sourceAccountId }),
      sourceAccountId, sellerEntityId: source.sellerEntityId, buyerId, legalName,
      support: sortSupport([...support(parties, 'sourceAccountId', 'sellerEntityId', 'buyerId'), ...support(name, 'legalName')]),
    };
    const term: ProducerV1['contracts'][number] = {
      id: 'term:' + hashCanonical({ ...source, sourceAccountId, contractId, validFrom: '2026-09-01' }),
      sourceAccountId, sellerEntityId: source.sellerEntityId, contractId,
      validFrom: '2026-09-01', validToExclusive: null, fixedMonthlyFeeCents: 300000,
      currency: 'USD', cadence: 'monthly', anchorDay: 1,
      support: sortSupport([
        ...support(parties, 'sourceAccountId', 'sellerEntityId'), ...support(title, 'contractId'),
        ...support(fee, 'fixedMonthlyFeeCents', 'currency'), ...support(effective, 'validFrom', 'cadence', 'anchorDay'),
      ]),
    };
    return {
      file: { fileId, documentId, documentVersion: 1, kind: 'contract_pdf' as const, sha256 },
      upload: { metadata, path: filename }, bytes, identity, term,
      evidence: { fileId, originalSha256: sha256, text: lines.join(' ') },
    };
  }));

  const originals = peers.map(({ sourceAccountId, recordId, sequence }) => {
    const raw = {
      account: sourceAccountId, amount: '3000.00', due_date: '2026-09-30',
      effective_date: '2026-09-01', id: recordId, version: 1,
    };
    const event = eventA({
      kind: 'invoice', sourceAccountId, recordId, effectiveDate: raw.effective_date, fields: raw,
    }, sequence, cutover);
    return { event, path: 'api-a/' + hashCanonical(event.id) + '.json', raw };
  });
  const events = RawSourceEventSchema.array().parse(originals.map(({ event }) => event));
  const manifestFields = {
    companyId: source.companyId, sourceRef: source.sourceRef, id: manifestId, epoch: 1, asOf: cutover,
    schemaVersions: Object.fromEntries(companyA.contracts.map(({ resource, schemaVersion }) => [resource, schemaVersion])),
    semanticVersions: Object.fromEntries(peers.map(({ sourceAccountId }) => ['seller-a/' + sourceAccountId, 'sem-a-1'])),
    files: documents.map(({ file }) => file),
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
  const generatorPaths = [
    'package-lock.json', 'packages/sources/src/canonical-fixtures.ts',
    'packages/sources/src/company-a.ts', 'tests/fixtures/sync-selection.ts',
  ].toSorted();
  const buildHash = hashCanonical(await Promise.all(generatorPaths.map(async path => ({
    path, sha256: hashBytes(await readFile(join(repositoryRoot, path))),
  }))));
  const binding = {
    ...source, fixtureSetId, manifestId, manifestHash: manifest.hash, generator: { seed: 'sync-selection-peers-v1', buildHash },
  };
  const truth: Omit<ProtectedFixtureSet, 'hash'> = {
    ...binding, schemaVersion: 1, fixtureSetVersion: '1', purpose: 'construction', asOf: cutover,
    inputEvents: ordered(events.map(({ id, contentHash }) => ({ id, contentHash })), event => event.id),
    accounts: ordered(peers.map(({ sourceAccountId, recordId, eventId }) => ({
      sourceAccountId, balanceAnchorCents: 300000,
      records: [{
        kind: 'invoice' as const, recordId, sourceEventId: eventId, sourceRecordVersion: 1,
        amountCents: 300000, currency: 'USD' as const, effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
      }],
    })), account => account.sourceAccountId),
    evidence: ordered(documents.map(({ evidence }) => evidence), evidence => evidence.fileId),
  };
  const truthJson = canonicalJson({ ...truth, hash: hashCanonical(truth) });
  const producer: Omit<ProducerV1, 'hash'> = {
    ...binding, schemaVersion: 1, kind: 'evidence-facts', producerFixtureSetVersion: '1',
    producerTruthHash: decodeTruth(truthJson).hash,
    identities: ordered(documents.map(({ identity }) => identity), identity => identity.id),
    contracts: ordered(documents.map(({ term }) => term), term => term.id),
  };
  const producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
  decodeEvidenceProducer(producerJson);
  const uploads = strict({ metadata: UploadMetadataSchema, path: z.string() }).array()
    .parse(documents.map(({ upload }) => upload));
  const originalsIndex = strict({ eventId: IdSchema, path: z.string() }).array()
    .parse(originals.map(({ event, path }) => ({ eventId: event.id, path })));
  const inputFiles = new Map<string, Uint8Array | string>([
    ...documents.map(({ upload, bytes }): [string, Uint8Array] => [join(visibleRoot, upload.path), bytes]),
    ...originals.map(({ path, raw }): [string, string] => [join(visibleRoot, path), canonicalJson(raw)]),
    [join(visibleRoot, 'api-a.json'), canonicalJson(events)],
    [join(visibleRoot, 'api-originals-a.json'), canonicalJson(originalsIndex)],
    [join(visibleRoot, 'manifest-a.json'), canonicalJson(manifest)],
    [join(visibleRoot, 'uploads-a.json'), canonicalJson(uploads)],
    [join(truthRoot, 'expected-a.json'), truthJson],
    [join(truthRoot, 'evidence-a.json'), producerJson],
  ]);
  for (const directory of new Set([...inputFiles.keys()].map(dirname))) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const digests = new Map<string, string>();
  for (const [path, content] of inputFiles) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;
    await writeFile(path, bytes, writeOptions);
    digests.set(path, hashBytes(await readFile(path)));
  }
  return async () => {
    for (const [path, digest] of digests) {
      assert.equal(hashBytes(await readFile(path)), digest, 'Original or private expectation changed after publication');
    }
  };
}

function requireStatus(response: { statusCode: number; json(): unknown }, status: number, stage: string) {
  if (response.statusCode === status) return;
  const error = response.json() as { code?: unknown };
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'UNKNOWN';
  throw new Error(stage + ' returned HTTP ' + response.statusCode + ' (' + code + ')');
}

export async function createSyncSelectionFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
  ];
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}> {
  const cleanup: (() => Promise<unknown>)[] = [];
  let closed: Promise<void> | undefined;
  function close() {
    return closed ??= (async () => {
      const failures: unknown[] = [];
      for (const action of cleanup.toReversed()) {
        try { await action(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Same-feed fixture cleanup failed');
    })();
  }
  function ownListener(app: { close(): Promise<void> }) {
    let closing: Promise<void> | undefined;
    const stop = () => closing ??= app.close();
    cleanup.push(stop);
    return stop;
  }

  try {
    const namespace = testNamespace('selpeers');
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-sync-selection-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const pair = await provisionTest(namespace);
    cleanup.push(() => dropTest(namespace));
    const controlDb = createControlDb({ connectionString: pair.control.appUrl });
    cleanup.push(() => controlDb.end());
    const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    cleanup.push(() => db.end());
    const migrations = readMigrationCatalog();
    await migrate(pair, migrationStreams, migrations);
    const roots = { visibleRoot: join(root, 'visible'), truthRoot: join(root, 'truth') };
    const registryRoot = join(root, 'registry');
    const storeRoot = join(root, 'originals');
    const bootstrapRoots = {
      sidecarRoot: join(root, 'bootstrap'), evidencePinRoot: join(root, 'evaluator'),
      servedRoots: [roots.visibleRoot, storeRoot, registryRoot],
    };
    const dependencies = { db: controlDb, clock, store: await createEvidenceStore(storeRoot) };
    const assertInputsUnchanged = await authorOriginals(roots);
    const captured = await captureEvidenceFixture(dependencies, roots, 'a');
    const { input, source: definition } = captured;
    const service = createSourceService(dependencies, localSourceCatalog);
    const { manifest, snapshot, events } = input;
    const producer = decodeEvidenceProducer(input.producerJson);
    const candidates = createCandidateRegistry(controlDb, registryRoot);

    async function register(peer: Peer) {
      const member = manifest.files.find(file => file.documentId === peer.documentId);
      const citation = input.citations.find(({ evidence }) => evidence.sourceId === member?.fileId &&
        evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
      assert(member && citation, 'Missing captured page-one agreement for ' + peer.label);
      const built = buildDemoCandidate({
        source: definition, capture: { companyId: definition.companyId, manifestId, contractFileId: member.fileId },
        manifest, snapshot, events, citation,
      });
      assert('candidate' in built, 'Candidate construction failed for ' + peer.label);
      const draft = built.candidate.request;
      const spec = { ...draft.spec, id: peer.specId };
      const profileInput = { ...draft.profiles[0]!, id: peer.profileId };
      const profile = { ...profileInput, hash: hashProfile(profileInput) };
      const compiled = compile(spec, [profile]);
      assert(compiled.ok && profile.bootstrap, 'Compilation failed for ' + peer.label);
      assert.deepEqual(profile.scope, scopeFor(peer));
      const artifact = compiled.value;
      await candidates.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
      const selection = { artifactHash: artifact.hash, manifestId, selectedProfileHash: profile.hash };
      return { peer, selection, profile, artifact, citation: citation.evidence.id };
    }
    const registered = [await register(peers[0]), await register(peers[1])] as const;

    await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
    const sourceDependencies = { dependencies, catalog: localSourceCatalog, service };
    const captureReader = createFinancialCaptureReader({ ...sourceDependencies, registry: candidates });
    const financialRegistry = createFinancialAttestationRegistry(controlDb, candidates);
    const launcher = createProtectedFinancialLauncher({
      registry: candidates, roots: { evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots },
    });
    const evaluatorBuildHash = await readFixedFinancialBuildHash();
    const mandatoryChecks = [...VerificationCheckIdSchema.options].sort();
    async function prove({ peer, selection, profile, artifact, citation }: typeof registered[number]) {
      const capture = await captureReader.readCapture(selection);
      const jobId = 'sync-selection-financial:' + peer.label;
      const probe = await launcher.probe({
        protocolVersion: 'financial-attestation-probe-1', jobId, capture, evaluatorBuildHash,
        selection: { fixtureSetId, fixtureSetVersion: '2', purpose: 'construction', snapshotHash: snapshot.contentHash },
      });
      const identity = producer.identities.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      const term = producer.contracts.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      assert(identity && term && profile.bootstrap, 'Missing captured reviewed facts for ' + peer.label);
      const pin = await prepareBootstrapVerification(candidates, service, {
        ...selection, review: {
          fixtureSetId, fixtureSetVersion: peer.bootstrapVersion, evidencePin: probe.evidencePin,
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citation],
            terms: profile.bootstrap.billingConfigurationIds.map(({ termId, id }) => ({
              factId: term.id, termId, configurationId: id, evidenceRefs: [citation],
            })),
          }],
        },
      }, bootstrapRoots);
      const reservation = {
        schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
        protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash,
        artifactHash: artifact.hash, requiredProfileHashes: artifact.requiredProfileHashes,
        capture: probe.capture, evidencePin: probe.evidencePin,
      } as const;
      await financialRegistry.reserve({
        protocolVersion: 'financial-attestation-1', jobId, capture,
        reservation: { ...reservation, hash: hashFinancialReservation(reservation) },
      });
      const request = await financialRegistry.start(jobId);
      const { report, attestation } = await financialRegistry.complete(jobId, await launcher.launch(request));
      const gaps = report.checks.filter(check => check.status !== 'passed' || check.cases === 0)
        .map(({ id, status, cases }) => id + '=' + status + '(' + cases + ')');
      assert(report.eligible && report.unexplainedDifferenceCents === 0 && gaps.length === 0,
        'Financial proof failed for ' + peer.label + ' (' + report.id + '): ' + gaps.join(', '));
      assert.deepEqual(report.coverage.required.toSorted(), mandatoryChecks);
      assert.deepEqual(report.coverage.executed.toSorted(), mandatoryChecks);
      return {
        peer, citation, report, attestation, entry: {
          ...selection, financialReportId: report.id,
          bootstrapFixture: { fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash },
        },
      };
    }
    const proofs = [await prove(registered[0]), await prove(registered[1])] as const;

    await createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes(registered.map(item => item.selection));
    const selection = { policyId: 'sync-selection-peer-policy-v1', entries: proofs.map(proof => proof.entry) };
    const policyRoot = join(root, 'policy');
    await prepareAndPublishActivationPolicy({
      candidates, captureReader, financialRegistry, bootstrapRoots,
      readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
    }, selection, { policyRoot, install: true });
    const policyPath = join(policyRoot, 'current.json');
    const selectionPath = join(root, 'selection.json');
    await writeFile(selectionPath, canonicalJson(selection), writeOptions);

    const serviceToken = randomBytes(32).toString('hex');
    const worker = await launchWorker({
      db, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
      featurePlugins: [composeWorkerParentReads(registryRoot)],
    }, 0);
    const stopWorker = ownListener(worker);
    const address = worker.server.address();
    assert(address && typeof address !== 'string', 'Worker listener has no loopback address');
    const origin = 'http://127.0.0.1:' + address.port;
    const webOrigin = 'http://127.0.0.1:5182';
    const reviewer = createLocalSessionService({
      webOrigin, reviewerId: 'sync-selection-reviewer', allowedSourceRefs: [source.sourceRef],
      allowedAccountIds: peers.map(peer => peer.accountId),
    });
    const review = await composeActivationReview(sourceDependencies, {
      registryRoot, policyPath, selectionPath, bootstrapRoots, candidates, observe: service.readCurrentSemantics,
      parent: createParentReadClient(origin, serviceToken, registryRoot), authorize: reviewer.authorizeReviewer,
    });
    const app = buildControl({
      db: controlDb, clock, expectedMigrations: migrationIdentities(migrations.control),
      workerClient: createWorkerClient(origin, serviceToken), featurePlugins: [reviewer.plugin, ...review],
    });
    const stopControl = ownListener(app);
    const session = await app.inject({
      method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
    });
    requireStatus(session, 200, 'Reviewer session');
    const [cookie] = session.cookies;
    assert(cookie, 'Missing reviewer session cookie');
    const headers = {
      origin: webOrigin, cookie: cookie.name + '=' + cookie.value,
      'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken,
    };
    const repository = createReviewRepository(controlDb, clock);
    const activation = createWorkerActivation({
      db, clock, policy: await loadActivationPolicy({ policyPath }),
      registered: createRegisteredScopeReader({ registryRoot }),
      readBundle: hash => readActivationBundle({ registryRoot }, hash), observe: service.readCurrentSemantics,
    });

    async function approve({ peer, citation, report, attestation, entry }: typeof proofs[number]): Promise<Subject> {
      const url = '/api/review/' + peer.accountId;
      const prepared = await app.inject({ method: 'POST', url: url + '/prepare', headers, payload: {} });
      requireStatus(prepared, 200, 'Reviewer preparation for ' + peer.label);
      const reviewPackage = ReviewPackageSchema.parse(prepared.json());
      assert(reviewPackage.ready, 'Review package is not ready for ' + peer.label);
      const approved = await app.inject({
        method: 'POST', url: url + '/activate', headers, payload: {
          reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash,
          expectedArtifactHash: reviewPackage.artifactHash, expectedProfileHash: reviewPackage.profileHash,
          expectedTargetVersion: reviewPackage.expectedTargetVersion, idempotencyKey: peer.approvalKey,
        },
      });
      requireStatus(approved, 202, 'Reviewer activation for ' + peer.label);
      const intent = await repository.readIntentByKey(peer.approvalKey);
      assert(intent, 'Missing committed reviewer intent for ' + peer.label);
      const { receipt, replayed } = await activation.activate({
        idempotencyKey: intent.request.idempotencyKey, bundleHash: intent.bundleHash,
      });
      assert.equal(replayed, false);
      const scope = scopeFor(peer);
      const stored = await withTransaction(db, async client => {
        const committed = await readStoredActivation(client, scope);
        const target = await readStoredTarget(client, scope);
        assert(committed && target, 'Missing A5 readback for ' + peer.label);
        assert.deepEqual(committed.receipt, receipt);
        assert.deepEqual(target, committed.approvedTarget);
        assert.deepEqual(committed.bundle.verificationReport, report);
        assert.deepEqual(committed.bundle.financialAttestation, attestation);
        const identity = {
          sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: peer.recordId,
        };
        const recordId = targetRecordId(identity);
        const evidenceRefs = [citation];
        assert.deepEqual(target.records, {
          scope, version: 1, asOf: cutover,
          invoices: [{
            id: recordId, identity, scope, kind: 'invoice', sourceEventId: peer.eventId, sourceRecordVersion: 1,
            amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
          }],
          payments: [], credits: [], allocations: [], reversals: [],
          customers: [{ id: peer.buyerId, displayName: peer.legalName, evidenceRefs }],
          accounts: [{
            id: peer.accountId, scope, parentCustomerId: peer.buyerId, sourceRef: 'legacy-a',
            sourceAccountIds: [peer.sourceAccountId],
          }],
          billingConfigurations: [{
            id: 'configuration:demo-term-a', scope, contractTerm: {
              id: 'demo-term-a', contractId: peer.contractId, validFrom: '2026-09-01', validToExclusive: null,
              fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
            },
          }],
        });
        assert.deepEqual(receipt.eventIds, [peer.eventId]);
        assert.deepEqual(receipt.targetRecordIds, [recordId]);
        assert.equal(receipt.beforeBalanceCents, 0);
        assert.equal(receipt.afterBalanceCents, 300000);
        assert.deepEqual(await readFinancialOrigins(client, scope, target.records.invoices), [{
          kind: 'initial', recordId, importKey: peer.approvalKey, receipt,
        }]);
        return committed;
      });
      const bootstrap = stored.bundle.bootstrapVerification;
      assert(bootstrap.passed, 'Bootstrap proof failed for ' + peer.label);
      assert.deepEqual(bootstrap.cases.map(item => item.id), [...bootstrapRequiredCases]);
      assert.deepEqual(bootstrap.assertions.map(item => item.id), [...bootstrapRequiredAssertions]);
      assert(bootstrap.cases.every(item => item.status === 'passed') &&
        bootstrap.assertions.every(item => item.status === 'passed'));
      assert.equal(bootstrap.binding.profileHash, entry.selectedProfileHash);
      assert.equal(bootstrap.pin.fixtureSetId, entry.bootstrapFixture.fixtureSetId);
      assert.equal(bootstrap.pin.fixtureSetVersion, entry.bootstrapFixture.fixtureSetVersion);
      assert.equal(bootstrap.pin.fixtureHash, entry.bootstrapFixture.fixtureHash);
      assert.equal(bootstrap.planHash, stored.plan.hash);
      return { identity: { scope, activationId: receipt.activationId, bundleHash: intent.bundleHash }, stored };
    }

    const one = await approve(proofs[0]);
    await withTransaction(db, async client => {
      const scope = scopeFor(peers[1]);
      assert.equal(await readStoredActivation(client, scope), null, 'First approval also enrolled second subject');
      assert.equal(await readStoredTarget(client, scope), null, 'First approval also imported second subject');
    });
    const two = await approve(proofs[1]);
    await stopControl();
    await stopWorker();

    const runtimeCapture = createRuntimeCapture({ db, clock });
    for (const subject of [one, two]) {
      const bound = await runtimeCapture.openCommitted(subject.identity);
      assert.deepEqual(bound.lane, { schemaVersion: '1', sourceRef: source.sourceRef, manifestHash: manifest.hash });
      const progress = await bound.readProgress();
      assert.deepEqual(progress.streams.map(({ streamId, baselineCursor, captureCursor, capturedRecords, capturedPages }) =>
        ({ streamId, baselineCursor, captureCursor, capturedRecords, capturedPages })), [
        { streamId: 'a-finance', baselineCursor: '2', captureCursor: '2', capturedRecords: 0, capturedPages: 0 },
        { streamId: 'a-semantics', baselineCursor: '0', captureCursor: '0', capturedRecords: 0, capturedPages: 0 },
      ]);
    }
    const { rows } = await db.query('SELECT initial_activation_id FROM runtime_capture_lanes');
    assert.deepEqual(rows, [{ initial_activation_id: one.identity.activationId }]);
    await assertInputsUnchanged();
    return {
      db, close, subjects: [one, two],
      async capture(identity, page) {
        const bound = await runtimeCapture.openCommitted(identity);
        return bound.capturePage(page);
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      if (error instanceof Error && Object.isExtensible(error)) {
        Object.defineProperty(error, 'cleanupError', { value: cleanupError });
      } else {
        console.error('Same-feed fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
