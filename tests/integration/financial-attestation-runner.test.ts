import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import {
  BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, UploadMetadataSchema,
  canonicalJson, hashCanonical, hashEvent, hashFinancialReservation, hashProfile,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload } from '@eapr/sources';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { FinancialEvaluatorInputV1Schema } from '../../packages/evaluator/src/financial-attestation-protocol.js';
import { exchangeFinancialEvaluator } from '../../packages/evaluator/src/financial-attestation-runner.js';
import { validateFinancialCompletion } from '@eapr/evaluator/financial-attestation-verify';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createCandidateRegistry } from '../../packages/evaluator/src/registry.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const pinPath = (root: string, id: string, version: string) => join(root, hashCanonical([id, version]) + '.json');
const signProfile = (profile: Parameters<typeof hashProfile>[0]) =>
  CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });

test('fixed financial launcher binds and evaluates both registered metadata-bearing captures', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-financial-'));
  const namespace = testNamespace('financial');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const visibleRoot = join(directory, 'visible');
      const truthRoot = join(directory, 'protected');
      const storeRoot = join(directory, 'served-evidence');
      const registryRoot = join(directory, 'registry');
      const roots = {
        evidencePinRoot: join(directory, 'protected-evaluator'),
        servedRoots: [visibleRoot, storeRoot, registryRoot],
      };
      const store = await createEvidenceStore(storeRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      await generateFixtures({ seed: 'bootstrap-v1', asOf, visibleRoot, truthRoot });
      const service = createSourceService(dependencies, localSourceCatalog);
      const registry = createCandidateRegistry(db, registryRoot);
      for (const company of ['a', 'b'] as const) {
        const readVisible = (path: string) => readFile(join(visibleRoot, path));
        const json = async (path: string) => JSON.parse((await readVisible(path)).toString('utf8'));
        const manifest = BootstrapManifestSchema.parse(await json('manifest-' + company + '.json'));
        const source = localSourceCatalog.get(manifest.companyId)!;
        const uploads = await json('uploads-' + company + '.json') as { metadata: unknown; path: string }[];
        let contractFileId: string | null = null;
        for (const upload of uploads) {
          const metadata = UploadMetadataSchema.parse(upload.metadata);
          if (metadata.kind === 'contract_pdf' && contractFileId === null) contractFileId = sourceFileId(metadata);
          await storeSourceUpload(dependencies, metadata, await readVisible(upload.path));
        }
        const originals = await json('api-originals-' + company + '.json') as { eventId: string; path: string }[];
        const apiEvents = RawSourceEventSchema.array().parse(await json('api-' + company + '.json'));
        const prepared = await Promise.all(apiEvents.map(async event => prepareApiRecord(
          source, store, event, await readVisible(originals.find(item => item.eventId === event.id)!.path),
        )));
        await publishManifest(dependencies, localSourceCatalog, manifest, prepared);
        const captured = await service.captureSnapshot(manifest.id);
        if (!captured.ok || !captured.dossier.complete) throw new Error('Construction capture unavailable');
        const { snapshot } = captured;
        const capture = { companyId: manifest.companyId, manifestId: manifest.id, contractFileId };
        const events = await service.getSnapshotRecords(snapshot.id);
        const producerTruthJson = await readFile(join(truthRoot, 'expected-' + company + '.json'), 'utf8');
        const producerJson = await readFile(join(truthRoot, 'evidence-' + company + '.json'), 'utf8');
        const producer = decodeEvidenceProducer(producerJson);
        const evidence = await assembleEvidenceVerificationInput(
          db, store, { source, manifest, snapshot, events }, producerTruthJson, producerJson, producer,
        );
        await pinProtectedEvidenceFixture(evidence, new URL(roots.evidencePinRoot + '/', 'file:'));
        const existingPin = pinPath(roots.evidencePinRoot, producer.fixtureSetId, '2');
        const v2Bytes = await readFile(existingPin);
        const v2 = JSON.parse(v2Bytes.toString('utf8'));
        const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1)!;
        const candidate = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
        if (!('candidate' in candidate)) throw new Error('Designated candidate unavailable');
        const draft = candidate.candidate!.request;
        const originalProfile = draft.profiles[0]!;
        const profile = signProfile({
          ...originalProfile, version: originalProfile.version + 1,
          bootstrap: {
            customer: { id: originalProfile.parentCustomerId, displayName: /Legal name (.+?) Monthly fee/.exec(citation.text.value)![1]!, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: [{ termId: originalProfile.contractTerms[0]!.id, id: 'bootstrap-config-' + company }],
          },
        });
        const spec = { ...draft.spec, version: draft.spec.version + 1 };
        const compiled = compile(spec, [profile]);
        if (!compiled.ok) throw new Error('Construction subject failed to compile');
        const artifact = compiled.value;
        await registry.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
        const launcher = createProtectedFinancialLauncher({ registry, roots });
        const captureInput = { artifact, profiles: [profile], manifest, snapshot, events };
        const evaluatorBuildHash = await readFixedFinancialBuildHash();
        const jobId = 'financial-test:' + company;
        const probeInput = {
          protocolVersion: 'financial-attestation-probe-1', jobId, capture: captureInput, evaluatorBuildHash,
          selection: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
            snapshotHash: snapshot.contentHash },
        } as const;
        const probe = await launcher.probe(probeInput);
        expect(probe.evidencePin.bundleHash).toBe(v2.bundleHash);
        const requiredProfileHashes = [profile.hash];
        const reservationInput = {
          schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
          protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash,
          artifactHash: artifact.hash, requiredProfileHashes,
          capture: probe.capture, evidencePin: probe.evidencePin,
        } as const;
        const request = {
          protocolVersion: 'financial-attestation-1', jobId, capture: captureInput,
          reservation: { ...reservationInput, hash: hashFinancialReservation(reservationInput) },
        } as const;
        const completion = await launcher.launch(request);
        const { report } = validateFinancialCompletion(request, completion);
        expect(report.eligible).toBe(true);
        expect(report.checks).toHaveLength(13);
        expect(report.checks.every(check => check.status === 'passed' && check.cases > 0)).toBe(true);
        expect(report.unexplainedDifferenceCents).toBe(0);
        expect(await readFile(existingPin)).toEqual(v2Bytes);
        if (company === 'a') {
          const mismatch = 'FINANCIAL_ATTESTATION_MISMATCH';
          expect(() => validateFinancialCompletion(request, probe)).toThrow(mismatch);
          expect(() => validateFinancialCompletion(request, report)).toThrow(mismatch);
          for (const patch of [
            { jobId: 'wrong' }, { requestHash: hashCanonical('wrong') }, { reservationHash: hashCanonical('wrong') },
            { capture: { ...completion.capture, eventsHash: hashCanonical('wrong') } },
          ]) expect(() => validateFinancialCompletion(request, { ...completion, ...patch })).toThrow(mismatch);

          const extraEvent = { ...events[0]!, id: 'extra-event' };
          extraEvent.contentHash = hashEvent(extraEvent);
          for (const altered of [
            { ...captureInput, snapshot: { ...snapshot, capturedAt: asOf } },
            { ...captureInput, snapshot: { ...snapshot, contentHash: hashCanonical('wrong') } },
            { ...captureInput, events: events.slice(1) },
            { ...captureInput, events: [...events, events[0]!] },
            { ...captureInput, events: [...events, extraEvent] },
          ]) await expect(launcher.probe({ ...probeInput, capture: altered })).rejects.toThrow(mismatch);

          const staleBuild = { ...request.reservation, evaluatorBuildHash: hashCanonical('stale build') };
          await expect(launcher.launch({ ...request, reservation: { ...staleBuild, hash: hashFinancialReservation(staleBuild) } }))
            .rejects.toThrow(mismatch);
          const badSnapshot = { ...request.reservation, capture: { ...probe.capture, snapshotObjectHash: hashCanonical('wrong') } };
          await expect(launcher.launch({ ...request, reservation: { ...badSnapshot, hash: hashFinancialReservation(badSnapshot) } }))
            .rejects.toThrow(mismatch);

          const badPin = { ...request.reservation, evidencePin: { ...probe.evidencePin, bundleHash: hashCanonical('wrong') } };
          await expect(launcher.launch({
            ...request, reservation: { ...badPin, hash: hashFinancialReservation(badPin) },
          })).rejects.toThrow(mismatch);

          const malformedRoot = join(directory, 'malformed');
          await mkdir(malformedRoot, { mode: 0o700 });
          await writeFile(pinPath(malformedRoot, producer.fixtureSetId, '2'), 'malformed fixture', { mode: 0o400 });
          const malformedLauncher = createProtectedFinancialLauncher({
            registry, roots: { ...roots, evidencePinRoot: malformedRoot },
          });
          await expect(malformedLauncher.launch(request)).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');

          const servedLink = join(directory, 'served-link');
          await symlink(roots.evidencePinRoot, servedLink);
          const overlapping = createProtectedFinancialLauncher({ registry, roots: { ...roots, servedRoots: [servedLink] } });
          await expect(overlapping.probe(probeInput)).rejects.toThrow('FINANCIAL_ATTESTATION_UNAVAILABLE');

          const transport = (child: string, evidencePinRoot = roots.evidencePinRoot) => {
            const normalized = FinancialEvaluatorInputV1Schema.parse(request);
            return exchangeFinancialEvaluator(new URL(
              '../../packages/evaluator/test/children/financial-attestation-' + child + '.mjs', import.meta.url,
            ), normalized, Buffer.from(canonicalJson({
              protocolVersion: 'financial-attestation-context-1', requestHash: hashCanonical(normalized),
              roots: { ...roots, evidencePinRoot },
            }) + '\n'));
          };
          const aba = join(directory, 'aba');
          await mkdir(aba, { mode: 0o700 });
          const abaPin = pinPath(aba, producer.fixtureSetId, '2');
          await writeFile(abaPin, v2Bytes, { mode: 0o400 });
          const interposed = await transport('interposition', aba);
          expect(interposed.ok).toBe(true);
          if (!interposed.ok) throw new Error('Exact decoded bytes were unavailable');
          expect(validateFinancialCompletion(request, interposed.value).report.eligible).toBe(true);
          expect(await readFile(abaPin)).toEqual(v2Bytes);
          expect(await transport('execution-failure')).toEqual({ ok: false, code: 'EXIT_FAILED' });

          const buildMutationRoot = join(directory, 'build-mutation');
          await mkdir(buildMutationRoot, { mode: 0o700 });
          await writeFile(pinPath(buildMutationRoot, producer.fixtureSetId, '2'), v2Bytes, { mode: 0o400 });
          const mutatedBuild = await transport('interposition', buildMutationRoot);
          expect(await readFile(join(buildMutationRoot, 'plan-batch.ts'), 'utf8'))
            .toContain('Isolated build mutation during subject execution.');
          expect(mutatedBuild).toEqual({ ok: false, code: 'REQUEST_MISMATCH' });

          const alteredProfile = signProfile({
            ...profile, version: profile.version + 1,
            contractTerms: profile.contractTerms.map(term => ({ ...term, fixedMonthlyFeeCents: term.fixedMonthlyFeeCents + 1 })),
          });
          const alteredArtifact = compile(spec, [alteredProfile]);
          if (!alteredArtifact.ok) throw new Error('Altered profile should compile');
          const alteredCapture = { ...captureInput, artifact: alteredArtifact.value, profiles: [alteredProfile] };
          await registry.registerCandidate({ ...alteredCapture, spec });
          const alteredProbe = await launcher.probe({ ...probeInput, capture: alteredCapture });
          const alteredReservation = {
            ...reservationInput, artifactHash: alteredArtifact.value.hash, requiredProfileHashes: [alteredProfile.hash],
            capture: alteredProbe.capture, evidencePin: alteredProbe.evidencePin,
          };
          const actualNegative = await launcher.launch({
            ...request, capture: alteredCapture, reservation: { ...alteredReservation, hash: hashFinancialReservation(alteredReservation) },
          });
          expect(actualNegative.report.eligible).toBe(false);
          expect(actualNegative.report.checks.some(check => check.status === 'failed' || check.status === 'unavailable')).toBe(true);

          const negative = {
            ...completion, report: { ...report, eligible: false, checks: report.checks.map((check, index) => index === 0
              ? { ...check, status: 'failed', diagnosticCodes: ['PRIVATE_SENTINEL'] } : check) },
          };
          const sanitized = validateFinancialCompletion(request, negative);
          expect(sanitized.report.eligible).toBe(false);
          expect(sanitized.report.checks[0]!.diagnosticCodes).toEqual(['CHECK_FAILED']);
          expect(sanitized.completion.report).toEqual(sanitized.report);
        }
      }
    } finally {
      await db.end();
    }
  } finally {
    await dropTest(namespace);
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
