import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBootstrapVerificationResult, hashBytes, hashCanonical, hashEvent, hashManifest, hashPlan, hashProfile, hashTargetSnapshot, type TargetState } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createProtectedBootstrapLauncher, readFixedBootstrapBuildPins } from '../../packages/evaluator/src/bootstrap-launcher.js';
import {
  type BootstrapExpectationReview,
} from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { exchangeBootstrapEvaluator, runBootstrapEvaluator } from '../../packages/evaluator/src/bootstrap-runner.js';
import { matchesBootstrapCase } from '../../packages/evaluator/src/bootstrap-comparison.js';
import { buildBootstrapCases } from '../../packages/evaluator/src/bootstrap-cases.js';
import { validateBootstrapCompletion } from '../../packages/evaluator/src/bootstrap-verify.js';
import { readBootstrapExpectation } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createCandidateRegistry } from '../../packages/evaluator/src/registry.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const pinPath = (root: string, id: string, version: string) => join(root, hashCanonical([id, version]) + '.json');
const signProfile = (profile: Parameters<typeof hashProfile>[0]) =>
  CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });
test('registered A/B captures pass the fixed protected subprocess pipeline', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-bootstrap-'));
  const namespace = testNamespace('bootstrap');
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
        sidecarRoot: join(directory, 'protected-bootstrap'), evidencePinRoot: join(directory, 'protected-evaluator'),
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
        const result = await service.captureSnapshot(manifest.id);
        if (!result.ok || !result.dossier.complete) throw new Error('Construction capture unavailable');
        const { snapshot } = result;
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
        const original = draft.profiles[0]!;
        const identity = producer.identities.find(item => item.sourceAccountId === original.sourceAccountIds[0])!;
        const term = producer.contracts.find(item => item.sourceAccountId === identity.sourceAccountId)!;
        const profile = signProfile({
          ...original, version: original.version + 1,
          bootstrap: {
            customer: { id: original.parentCustomerId, displayName: /Legal name (.+?) Monthly fee/.exec(citation.text.value)![1]!, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: [{ termId: original.contractTerms[0]!.id, id: 'bootstrap-config-' + company }],
          },
        });
        const spec = { ...draft.spec, version: draft.spec.version + 1 };
        const compiled = compile(spec, [profile]);
        if (!compiled.ok) throw new Error('Construction subject failed to compile');
        const artifact = compiled.value;
        await registry.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
        const review: BootstrapExpectationReview = {
          fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-v1',
          evidencePin: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', bundleHash: v2.bundleHash },
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citation.evidence.id],
            terms: [{ factId: term.id, termId: profile.contractTerms[0]!.id, configurationId: 'bootstrap-config-' + company,
              evidenceRefs: [citation.evidence.id] }],
          }],
        };
        const prepare = () => prepareBootstrapVerification(registry, service, { artifactHash: artifact.hash, manifestId: manifest.id, review }, roots);
        const pin = await prepare();
        expect(await prepare()).toEqual(pin);
        const target: TargetState = {
          scope: profile.scope, asOf, version: 0, customers: [], accounts: [], billingConfigurations: [],
          invoices: [], credits: [], payments: [], allocations: [], reversals: [],
        };
        const builds = await readFixedBootstrapBuildPins();
        const runnerPin = { runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...builds,
          fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash } as const;
        const launch = createProtectedBootstrapLauncher({ registry, roots, pin: runnerPin });
        const request = {
          protocolVersion: 'bootstrap-1' as const, jobId: 'bootstrap-runner-' + company, pin: runnerPin,
          artifact, profiles: [profile], selectedProfileHash: profile.hash, manifest, snapshot, events, target,
        };
        const completed = await launch.launch(request);
        expect(JSON.stringify(completed).includes(directory)).toBe(false);
        expect(completed.result.passed).toBe(true);
        expect(completed.result.cases.filter(item => item.status === 'passed')).toHaveLength(10);
        expect(completed.result.assertions.filter(item => item.status === 'passed')).toHaveLength(9);
        expect(completed.requestHash).toBe(hashCanonical(request));
        expect(completed.result.pin).toEqual(runnerPin);
        expect(completed.result.binding.snapshotHash).toBe(snapshot.contentHash);
        expect(completed.result.binding.targetSnapshotHash).toBe(hashTargetSnapshot(target));
        const plan = completed.observedBaselinePlan!;
        expect(plan.hash).toBe(hashPlan(plan));
        expect(completed.result.planHash).toBe(plan.hash);
        expect(completed.observedBaselinePlanBytesHash).toBe(hashCanonical(plan));
        expect(plan.operations.some(operation => !operation.op.startsWith('ensure_'))).toBe(true);
        if (company === 'b') expect(plan.expectedBalanceCents).toBe(0);
        await expect(launch.launch({ ...request, snapshot: { ...snapshot, eventIds: [...snapshot.eventIds].reverse() } }))
          .rejects.toThrow('REQUEST_MISMATCH');
        const context = {
          protocolVersion: 'bootstrap-launch-context-1' as const, requestHash: completed.requestHash, roots,
          registration: { artifactHash: artifact.hash, manifestHash: manifest.hash, snapshotId: snapshot.id,
            snapshotObjectHash: hashCanonical(snapshot) },
        };
        if (company === 'a') {
          const stale = (name: string) => hashCanonical('stale-' + name);
          const rejected = async (value: Parameters<typeof launch.launch>[0], code: string) =>
            expect(launch.launch(value)).rejects.toThrow(code);
          await rejected({ ...request, pin: { ...runnerPin, subjectBuildHash: stale('subject') } }, 'REQUEST_MISMATCH');
          await rejected({ ...request, pin: { ...runnerPin, fixtureHash: stale('fixture') } }, 'REQUEST_MISMATCH');
          await rejected({ ...request, artifact: { ...artifact, hash: stale('artifact') } }, 'REQUEST_MISMATCH');
          await rejected({ ...request, selectedProfileHash: stale('profile') }, 'REQUEST_MISMATCH');
          await rejected({ ...request, target: { ...target, asOf: '2026-10-02T00:00:00.000Z' } }, 'REQUEST_MISMATCH');
          await rejected({ ...request, target: { ...target, protectedRoot: roots.sidecarRoot } } as typeof request, 'INPUT_INVALID');
          const changedEvent = { ...events[0]!, sequence: events[0]!.sequence + 1000 };
          await rejected({ ...request, events: [{ ...changedEvent, contentHash: hashEvent(changedEvent) }, ...events.slice(1)] }, 'EXIT_FAILED');

          const child = new URL('../../packages/evaluator/src/bootstrap-evaluator-runner.ts', import.meta.url);
          const run = (bytes?: Buffer) => exchangeBootstrapEvaluator(child, request, bytes, {
            maxBytes: 10 * 1024 * 1024, timeoutMs: 5_000,
          });
          for (const bytes of [undefined, Buffer.from('{} trailing'), Buffer.from(canonicalJson(context) + '{}')]) {
            await expect(run(bytes)).resolves.toEqual({ ok: false, code: 'EXIT_FAILED' });
          }
          await expect(runBootstrapEvaluator({ ...request, jobId: 'different-request' }, context))
            .resolves.toEqual({ ok: false, code: 'EXIT_FAILED' });
          await expect(runBootstrapEvaluator(request, {
            ...context, registration: { ...context.registration, snapshotObjectHash: snapshot.contentHash },
          })).resolves.toEqual({ ok: false, code: 'EXIT_FAILED' });

          const result = completed.result;
          const planWithHash = (patch: Partial<typeof plan>) => {
            const changed = { ...plan, ...patch };
            return { ...changed, hash: hashPlan(changed) };
          };
          const changedPlan = planWithHash({ expectedBalanceCents: plan.expectedBalanceCents + 1 });
          const binding = result.binding;
          const seal = (patch: Partial<typeof result>) => {
            const changed = { ...result, ...patch };
            return { ...changed, hash: hashBootstrapVerificationResult(changed) };
          };
          const staleBindings = [
            { ...binding, manifestHash: stale('manifest') }, { ...binding, snapshotHash: hashCanonical(snapshot) },
            { ...binding, eventsHash: stale('events') }, { ...binding, targetSnapshotHash: stale('target') },
            { ...binding, asOf: '2026-10-02T00:00:00.000Z' },
            { ...binding, profileHash: stale('profile'), requiredProfileHashes: [stale('profile')] },
          ];
          const completions = [
            result, { ...completed, protocolVersion: 'bootstrap-1' }, { ...completed, jobId: 'other-job' },
            { ...completed, requestHash: stale('request') }, { ...completed, observedBaselinePlan: null },
            { ...completed, observedBaselinePlanBytesHash: null },
            { ...completed, observedBaselinePlan: changedPlan },
            { ...completed, observedBaselinePlan: changedPlan, observedBaselinePlanBytesHash: hashCanonical(changedPlan) },
            { ...completed, observedBaselinePlan: { ...plan, asOf: asOf.replace('.000', '') } },
            { ...completed, observedBaselinePlanBytesHash: stale('bytes') },
            { ...completed, result: { ...result, hash: stale('result') } },
            { ...completed, result: { ...result, passed: false } },
            { ...completed, result: { ...result, assertions: result.assertions.slice(1) } },
            { ...completed, result: { ...result, assertions: [...result.assertions.slice(1), result.assertions[1]] } },
            { ...completed, result: { ...result, cases: [...result.cases].reverse() } },
            { ...completed, result: { ...result, cases: [...result.cases.slice(1), result.cases[1]] } },
            { ...completed, result: seal({ planHash: stale('plan') }) },
            { ...completed, result: seal({ pin: { ...runnerPin, evaluatorBuildHash: stale('build') } }) },
            ...staleBindings.map(staleBinding => ({ ...completed, result: seal({ binding: staleBinding }) })),
          ];
          for (const mutant of completions) {
            expect(() => validateBootstrapCompletion(request, mutant)).toThrow('REQUEST_MISMATCH');
          }

          const oracle = await readBootstrapExpectation(pin, {
            artifact, profiles: [profile], manifest, snapshot, events, registration: context.registration,
          }, roots);
          const probe = buildBootstrapCases(oracle, profile.hash, target)![0]!;
          const holds = probe.expectedHolds.map(hold => ({ ...hold, dependencies: [], diagnostics: [] }));
          expect(matchesBootstrapCase(probe, { plans: [plan], holds })).toBe(true);
          const [first, second, ...remaining] = plan.lineage;
          const lineageMutations = [
            plan.lineage.slice(1), [first!, ...plan.lineage],
            [{ ...first!, targetField: '/unexpected' }, ...plan.lineage.slice(1)],
            [{ ...first!, targetField: '' }, ...plan.lineage.slice(1)],
            [{ ...first!, derivationInputs: ['wrong-input'] }, ...plan.lineage.slice(1)],
            [{ ...first!, evidenceRefs: ['wrong-evidence'] }, ...plan.lineage.slice(1)],
            [{ ...first!, sourceEventIds: ['wrong-event'] }, ...plan.lineage.slice(1)],
            [{ ...first!, mapping: { op: 'field' as const, path: '/wrong' } }, ...plan.lineage.slice(1)],
            [second!, first!, ...remaining],
            plan.lineage.map(row => row.operationIndex >= 3 ? { ...row, operationIndex: row.operationIndex - 3 } : row),
            plan.lineage.map(row => row.operationIndex >= 3 ? { ...row, operationIndex: row.operationIndex + 3 } : row),
          ];
          const mutants = [
            { ...plan, hash: stale('plan') },
            planWithHash({ operations: [plan.operations[1]!, plan.operations[0]!, ...plan.operations.slice(2)] }),
            planWithHash({ operations: [...plan.operations.slice(0, 3), ...plan.operations.slice(3).reverse()] }),
            ...lineageMutations.map(lineage => planWithHash({ lineage })),
          ];
          for (const mutant of mutants) expect(matchesBootstrapCase(probe, { plans: [mutant], holds })).toBe(false);

          const missing = compile({ ...spec, version: spec.version + 1 }, [profile]);
          if (!missing.ok) throw new Error('Unregistered test subject unavailable');
          await rejected({ ...request, artifact: missing.value }, 'REQUEST_MISMATCH');
          const foreign = { ...manifest, id: 'foreign-manifest' };
          await rejected({
            ...request, manifest: { ...foreign, hash: hashManifest(foreign) },
            snapshot: { ...snapshot, manifestId: foreign.id, id: 'snapshot:' + foreign.id },
          }, 'REQUEST_MISMATCH');
          const sidecarBytes = await readFile(pinPath(roots.sidecarRoot, pin.fixtureSetId, pin.fixtureSetVersion));
          const { hash: _hash, ...descriptor } = oracle.descriptor;
          for (const [index, change] of [
            { bootstrap: { ...profile.bootstrap!, customer: { ...profile.bootstrap!.customer, displayName: 'Wrong name' } } },
            { contractTerms: [{ ...profile.contractTerms[0]!, fixedMonthlyFeeCents: profile.contractTerms[0]!.fixedMonthlyFeeCents + 1 }] },
          ].entries()) {
            const changed = signProfile({ ...profile, version: profile.version + index + 1, ...change });
            const rebuilt = compile(spec, [changed]);
            if (!rebuilt.ok) throw new Error('Rehashed mutation failed to compile');
            await registry.registerCandidate({ spec, profiles: [changed], artifact: rebuilt.value, manifest, snapshot });
            const mutant = { ...request, artifact: rebuilt.value, profiles: [changed], selectedProfileHash: changed.hash };
            await rejected(mutant, 'EXIT_FAILED');
            // Even if the pinned sidecar references the re-registered profile, the
            // original protected facts do not support the substituted name or term.
            const replacement = { ...descriptor, fixtureSetVersion: 'mutation-' + changed.hash,
              subjects: descriptor.subjects.map(subject => ({ ...subject, profileHash: changed.hash })) };
            const mutantPin = { ...runnerPin, fixtureSetVersion: replacement.fixtureSetVersion, fixtureHash: hashCanonical(replacement) };
            await writeFile(pinPath(roots.sidecarRoot, mutantPin.fixtureSetId, mutantPin.fixtureSetVersion),
              canonicalJson({ ...replacement, hash: mutantPin.fixtureHash }), { mode: 0o400, flag: 'wx' });
            const mutationLauncher = createProtectedBootstrapLauncher({ registry, roots, pin: mutantPin });
            await expect(mutationLauncher.launch({ ...mutant, pin: mutantPin })).rejects.toThrow('EXIT_FAILED');
          }
          expect(await readFile(pinPath(roots.sidecarRoot, pin.fixtureSetId, pin.fixtureSetVersion)).then(hashBytes))
            .toBe(hashBytes(sidecarBytes));
        }
        expect(await readFile(existingPin).then(hashBytes)).toBe(hashBytes(v2Bytes));
      }
    } finally {
      await db.end();
      await dropTest(namespace);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 240_000);
