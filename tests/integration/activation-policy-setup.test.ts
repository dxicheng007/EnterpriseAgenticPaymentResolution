import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, hashCanonical, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, type VerificationReport } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { type BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeEvidenceProducer, type EvidenceFixtureInput } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { captureEvidenceFixture } from '../fixtures/evidence-v2-capture.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';

function alternateFixture(input: EvidenceFixtureInput): EvidenceFixtureInput {
  const { hash: _truthHash, ...originalTruth } = decodeTruth(input.producerTruthJson);
  const { hash: _producerHash, ...originalProducer } = decodeEvidenceProducer(input.producerJson);
  const fixtureSetId = originalTruth.fixtureSetId + '-alternate';
  const truth = { ...originalTruth, fixtureSetId };
  const producer = { ...originalProducer, fixtureSetId, producerTruthHash: hashCanonical(truth) };
  return {
    ...input, producerTruthJson: canonicalJson({ ...truth, hash: hashCanonical(truth) }),
    producerJson: canonicalJson({ ...producer, hash: hashCanonical(producer) }),
  };
}

test('prepares and explicitly installs policies from exact fixed-child A/B attestations and reviewed descriptors', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-activation-setup-'));
  const namespace = testNamespace('actpolicy');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const runtimeCounts = () => runtime.query(`
        SELECT (SELECT count(*) FROM parent_scopes) AS scopes,
               (SELECT count(*) FROM parent_snapshots) AS snapshots,
               (SELECT count(*) FROM parent_metadata) AS metadata,
               (SELECT count(*) FROM parent_financial_records) AS financial,
               (SELECT count(*) FROM runtime_activation_imports) AS activations,
               (SELECT count(*) FROM runtime_deliveries) AS deliveries,
               (SELECT count(*) FROM activity_events) AS activity
      `);
      const before = await runtimeCounts();
      const visibleRoot = join(root, 'visible');
      const truthRoot = join(root, 'truth');
      const storeRoot = join(root, 'originals');
      const registryRoot = join(root, 'registry');
      const policyRoot = join(root, 'policy');
      const policyPath = join(policyRoot, 'current.json');
      const bootstrapRoots = {
        sidecarRoot: join(root, 'bootstrap'), evidencePinRoot: join(root, 'evaluator'),
        servedRoots: [visibleRoot, storeRoot, registryRoot],
      };
      const store = await createEvidenceStore(storeRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      const service = createSourceService(dependencies, localSourceCatalog);
      const candidates = createCandidateRegistry(db, registryRoot);
      const financialRegistry = createFinancialAttestationRegistry(db, candidates);
      const captureReader = createFinancialCaptureReader({ dependencies, service, catalog: localSourceCatalog, registry: candidates });
      const launcher = createProtectedFinancialLauncher({ registry: candidates, roots: {
        evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots,
      } });
      const publishScopes = createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes;
      const scopeReader = createRegisteredScopeReader({ registryRoot });
      await expect(scopeReader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
      await generateFixtures({ seed: 'activation-policy', asOf, visibleRoot, truthRoot });
      const evaluatorBuildHash = await readFixedFinancialBuildHash();

      async function issue(company: 'a' | 'b') {
        const { input, source, contractFileId } = await captureEvidenceFixture(dependencies, { visibleRoot, truthRoot }, company);
        const { manifest, snapshot, events } = input;
        const citation = input.citations.find(item => item.evidence.sourceId === contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
        const built = buildDemoCandidate({
          source, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
          manifest, snapshot, events, citation,
        });
        if (!('candidate' in built) || !citation) throw new Error('Expected captured agreement and candidate');
        const { spec, profiles } = built.candidate.request;
        const [profile] = profiles;
        const compiled = compile(spec, profiles);
        if (!compiled.ok || !profile?.bootstrap) throw new Error('Expected a metadata-bearing compiled candidate');
        const artifact = compiled.value;
        await candidates.registerCandidate({ spec, profiles, artifact, manifest, snapshot });
        const selection = { artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: profile.hash };
        await publishScopes([selection]);
        const scopes = await scopeReader.readSnapshot();
        expect(scopes.resolveRegisteredScope(profile.scope.accountId)?.profile).toEqual(profile);
        expect(scopes.resolveRegisteredScope('unknown')).toBeNull();

        async function issueProof(fixture: EvidenceFixtureInput, suffix: string) {
          const producer = decodeEvidenceProducer(fixture.producerJson);
          const identity = producer.identities.find(item => item.sourceAccountId === profile!.sourceAccountIds[0])!;
          const term = producer.contracts.find(item => item.sourceAccountId === identity.sourceAccountId)!;
          await pinProtectedEvidenceFixture(fixture, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
          const capture = await captureReader.readCapture(selection);
          const jobId = 'activation-policy:' + company + ':' + suffix;
          const probe = await launcher.probe({
            protocolVersion: 'financial-attestation-probe-1', jobId, capture, evaluatorBuildHash,
            selection: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
              snapshotHash: snapshot.contentHash },
          });
          const review: BootstrapExpectationReview = {
            fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-v1', evidencePin: probe.evidencePin,
            subjects: [{
              profileHash: profile!.hash, profileId: profile!.id, scope: profile!.scope, identityFactId: identity.id,
              customerId: identity.buyerId, customerEvidenceRefs: [citation!.evidence.id],
              terms: profile!.bootstrap!.billingConfigurationIds.map(({ termId, id }) => ({
                factId: term.id, termId, configurationId: id, evidenceRefs: [citation!.evidence.id],
              })),
            }],
          };
          const pin = await prepareBootstrapVerification(candidates, service, { ...selection, review }, bootstrapRoots);
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
          const { report } = await financialRegistry.complete(jobId, await launcher.launch(request));
          expect(report.eligible).toBe(true);
          return {
            selection: { ...selection, financialReportId: report.id, bootstrapFixture: {
              fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash,
            } },
            report, request, evidencePin: probe.evidencePin,
          };
        }

        const first = await issueProof(input, 'first');
        return { first, issueAlternate: () => issueProof(alternateFixture(input), 'alternate') };
      }

      const a = await issue('a');
      const b = await issue('b');
      const alternate = await a.issueAlternate();
      const deps = {
        candidates, captureReader, financialRegistry, bootstrapRoots,
        readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
      };
      const selection = { policyId: 'operator-policy', entries: [a.first.selection, b.first.selection] };
      const prepared = await prepareAndPublishActivationPolicy(deps, selection, { policyRoot });
      await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_UNAVAILABLE');
      const forA = prepared.entries.find(entry => entry.artifactHash === a.first.selection.artifactHash)!;
      expect(forA.financial.evidencePin).toEqual(a.first.evidencePin);
      expect(forA.bootstrapPin.fixtureHash).toBe(a.first.selection.bootstrapFixture.fixtureHash);
      expect(forA.bootstrapPin.fixtureHash).not.toBe(forA.financial.evidencePin.bundleHash);

      // An aggregate policy could let the first report match the first entry on both reads.
      expect(alternate.evidencePin).not.toEqual(a.first.evidencePin);
      await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [
        a.first.selection, { ...alternate.selection, financialReportId: a.first.report.id },
      ] }, { policyRoot, install: true })).rejects.toThrow('FINANCIAL_ATTESTATION_MISMATCH');
      await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [
        a.first.selection, alternate.selection,
      ] }, { policyRoot })).resolves.toMatchObject({ entries: expect.arrayContaining([
        expect.objectContaining({ financial: expect.objectContaining({ evidencePin: alternate.evidencePin }) }),
      ]) });

      const first = a.first.selection;
      const badEntries = [
        [{ ...first, selectedProfileHash: b.first.selection.selectedProfileHash }, 'ACTIVATION_POLICY_MISMATCH'],
        [{ ...first, bootstrapFixture: b.first.selection.bootstrapFixture }, 'BOOTSTRAP_FIXTURE_SETUP_REQUIRED'],
        [{ ...first, bootstrapFixture: { ...first.bootstrapFixture, fixtureHash: a.first.evidencePin.bundleHash } }, 'BOOTSTRAP_FIXTURE_SETUP_REQUIRED'],
        [{ ...first, financialReportId: b.first.report.id }, 'FINANCIAL_ATTESTATION_MISMATCH'],
        [{ ...first, financialReportId: 'report:missing' }, 'FINANCIAL_ATTESTATION_UNAVAILABLE'],
      ] as const;
      for (const [entry, code] of badEntries) {
        await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [entry] }, { policyRoot, install: true }))
          .rejects.toThrow(code);
      }
      await expect(prepareAndPublishActivationPolicy({ ...deps, readFinancialBuildHash: async () => hashCanonical('stale') },
        selection, { policyRoot, install: true })).rejects.toThrow('FINANCIAL_ATTESTATION_MISMATCH');

      const failedJobId = 'activation-policy-failed';
      const request = a.first.request;
      const failed = { ...request.reservation, jobId: failedJobId };
      await financialRegistry.reserve({
        ...request, jobId: failedJobId, reservation: { ...failed, hash: hashFinancialReservation(failed) },
      });
      await financialRegistry.fail(failedJobId);
      await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [
        { ...first, financialReportId: 'report:' + failedJobId },
      ] }, { policyRoot, install: true })).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');

      const legacyJobId = 'legacy-unattested';
      const legacy: VerificationReport = { ...a.first.report, id: 'report:' + legacyJobId };
      await db.query(
        `INSERT INTO verification_jobs (id, state, source_refs, account_ids, artifact_hash, manifest_id, summary)
         SELECT $1, state, source_refs, account_ids, artifact_hash, manifest_id, summary
         FROM verification_jobs WHERE id = $2`, [legacyJobId, request.jobId],
      );
      await db.query('INSERT INTO verification_reports VALUES ($1, $2, $3)', [legacy.id, legacyJobId, canonicalJson(legacy)]);
      await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [
        { ...first, financialReportId: legacy.id },
      ] }, { policyRoot, install: true })).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');

      const forgedJobId = 'self-hashed-forgery';
      const body = { ...request.reservation, jobId: forgedJobId };
      const forgedRequest = { ...request, jobId: forgedJobId, reservation: { ...body, hash: hashFinancialReservation(body) } };
      await financialRegistry.reserve(forgedRequest);
      await financialRegistry.start(forgedJobId);
      const forgedReport = { ...a.first.report, id: 'report:' + forgedJobId };
      const attestation = {
        schemaVersion: '1' as const, reservation: forgedRequest.reservation,
        reportId: forgedReport.id, reportHash: hashFinancialReport(forgedReport),
      };
      const forgedBytes = Buffer.from(canonicalJson(forgedReport));
      const attestationHash = hashFinancialAttestation(attestation);
      await db.query('INSERT INTO verification_reports VALUES ($1, $2, $3)', [forgedReport.id, forgedJobId, canonicalJson(forgedReport)]);
      await db.query(`INSERT INTO financial_verification_attestations
        (report_id, job_id, request_hash, completion_bytes, report_bytes, report_hash, attestation_bytes, attestation_hash)
        SELECT $1, $2, request_hash, $3, $3, $4, $5, $6 FROM financial_verification_reservations WHERE job_id = $2`,
      [forgedReport.id, forgedJobId, forgedBytes, attestation.reportHash,
        Buffer.from(canonicalJson({ ...attestation, hash: attestationHash })), attestationHash]);
      await db.query(`UPDATE verification_jobs SET state = 'completed',
        summary = (SELECT jsonb_set(summary, '{reportId}', to_jsonb($3::text)) FROM verification_jobs WHERE id = $2)
        WHERE id = $1`, [forgedJobId, request.jobId, forgedReport.id]);
      await expect(prepareAndPublishActivationPolicy(deps, { ...selection, entries: [
        { ...first, financialReportId: forgedReport.id },
      ] }, { policyRoot, install: true })).rejects.toThrow('FINANCIAL_ATTESTATION_MISMATCH');

      await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_UNAVAILABLE');
      const installed = await prepareAndPublishActivationPolicy(deps, selection, { policyRoot, install: true });
      expect(installed).toEqual(prepared);
      const [control, worker] = await Promise.all([loadActivationPolicy({ policyPath }), loadActivationPolicy({ policyPath })]);
      expect(control).toEqual(worker);
      expect(control).not.toBe(worker);
      expect((await scopeReader.readSnapshot()).index.entries).toHaveLength(2);
      expect(await readFile(policyPath, 'utf8')).toBe(canonicalJson(installed));
      expect((await runtimeCounts()).rows)
        .toEqual(before.rows);
    } finally {
      await Promise.all([db.end(), runtime.end()]);
    }
  } finally {
    await dropTest(namespace);
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
