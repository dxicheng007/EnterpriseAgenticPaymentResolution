import { mkdtemp, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, hashBundleV2, hashCanonical, hashFinancialReservation, ReviewPackageSchema, LocalSessionResponseSchema } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { type BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeEvidenceProducer, type EvidenceFixtureInput } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { captureEvidenceFixture } from '../fixtures/evidence-v2-capture.js';
import { testNamespace } from '../fixtures/harness.js';
import { createWorkerClient, launchControl } from '../../apps/control/src/server.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository, headToken } from '../../apps/control/src/review-repository.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { readActivationBundle } from '@eapr/storage/activation-registry';

const asOf = '2026-10-01T00:00:00.000Z';

test('composed reviewer prepares both real subjects and recovers one exact published approval after restart', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-activation-setup-'));
  const namespace = testNamespace('a4compose');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const runtimeState = async () => {
        const { rows } = await runtime.query<{ name: string }>(
          "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        );
        return Promise.all(rows.map(async ({ name }) => (await runtime.query(
          'SELECT to_jsonb(t) FROM public.' + name + ' t ORDER BY to_jsonb(t)',
        )).rows));
      };
      const before = await runtimeState();
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
        return { ...first, accountId: profile.scope.accountId, sourceRef: manifest.sourceRef, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId } };
      }

      const a = await issue('a');
      const b = await issue('b');

      const selection = { policyId: 'review-policy', entries: [a.selection, b.selection] };
      await prepareAndPublishActivationPolicy({
        candidates, captureReader, financialRegistry, bootstrapRoots,
        readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
      }, selection, { policyRoot, install: true });
      const selectionPath = join(root, 'selection.json');
      await writeFile(selectionPath, canonicalJson(selection), { mode: 0o600 });
      const workerPort = localPort('EAPR_WORKER_PORT', 3002);
      const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
      const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
      const workerOrigin = 'http://127.0.0.1:' + workerPort;
      const controlOrigin = 'http://127.0.0.1:' + controlPort;
      const serviceToken = 'integration-service-token';
      const sourceReadToken = 'integration-source-read-token';
      const clock = () => new Date();
      const migrations = readMigrationCatalog();
      const worker = await launchWorker({
        db: runtime, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
        featurePlugins: [composeWorkerParentReads(registryRoot)],
      }, workerPort);
      async function startControl() {
        const local = await createLocalComposition({ ...dependencies, clock }, {
          captures: [a.capture, b.capture], webOrigin, registry: candidates, sourceReadToken,
          parentReads: createParentReadClient(workerOrigin, serviceToken, registryRoot),
          activationReview: { registryRoot, policyPath, selectionPath, bootstrapRoots },
        });
        return launchControl({
          db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
          expectedMigrations: migrationIdentities(migrations.control), featurePlugins: local.featurePlugins,
        }, controlPort);
      }
      let control;
      try {
        control = await startControl();
        const request = (path: string, init?: RequestInit) => fetch(controlOrigin + path, init);
        async function reviewer() {
          const session = await request('/api/local-session', {
            method: 'POST', headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, body: '{}',
          });
          expect(session.status).toBe(200);
          const cookie = session.headers.getSetCookie()[0]!.split(';', 1)[0]!;
          const context = LocalSessionResponseSchema.parse(await session.json());
          return { cookie, origin: webOrigin, 'x-eapr-csrf': context.csrfToken, 'content-type': 'application/json' };
        }
        const headers = await reviewer();
        const route = '/api/review/' + a.accountId;
        const semantics = '/internal/sources/' + a.sourceRef + '/semantics';
        const post = (path: string, body: object, requestHeaders = headers) =>
          request(path, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
        expect((await request(semantics, { headers: { authorization: 'Bearer ' + serviceToken } })).status).toBe(403);
        expect((await request(semantics, { headers: { authorization: 'Bearer ' + sourceReadToken } })).status).toBe(200);
        expect((await request('/internal/sources/foreign/semantics', {
          headers: { authorization: 'Bearer ' + sourceReadToken },
        })).status).toBe(403);
        expect((await request(route)).status).toBe(401);
        for (const id of ['x'.repeat(161), '%C0%AF', 'bad%2Fid']) {
          for (const [suffix, method] of [['', 'GET'], ['/prepare', 'POST'], ['/activate', 'POST']] as const) {
            const invalid = await request('/api/review/' + id + suffix, {
              method, headers, ...(method === 'POST' ? { body: '{}' } : {}),
            });
            expect(invalid.status, id + suffix).toBe(400);
            expect(invalid.headers.get('cache-control')).toBe('no-store');
          }
        }
        expect((await request(route, { headers })).status).toBe(404);
        expect((await request(route, { headers: { ...headers, authorization: 'Bearer ' + serviceToken } })).status).toBe(403);
        expect((await request(route, { headers: { ...headers, 'x-eapr-task-token': 'task' } })).status).toBe(403);
        expect((await request('/api/review/foreign', { headers })).status).toBe(403);
        expect((await db.query('SELECT * FROM review_heads')).rowCount).toBe(0);
        expect((await post(route + '/prepare', { reviewerId: 'other' })).status).toBe(400);
        expect((await post(route + '/prepare', {}, { ...headers, 'x-eapr-csrf': 'bad' })).status).toBe(403);

        async function prepare(accountId: string) {
          const response = await post('/api/review/' + accountId + '/prepare', {});
          const result: unknown = await response.json();
          expect(response.status, JSON.stringify(result)).toBe(200);
          return ReviewPackageSchema.parse(result);
        }
        const prepared = await prepare(a.accountId);
        expect(prepared.ready).toBe(true);
        expect(await prepare(a.accountId)).toEqual(prepared);
        expect((await prepare(b.accountId)).ready).toBe(true);
        expect((await db.query('SELECT * FROM review_bootstrap_selections')).rowCount).toBe(2);
        expect(await (await request(route, { headers })).json()).toEqual(prepared);
        const operatorToken = 'integration-operator-token';
        const operator = createScenarioAdmin({ ...dependencies, clock }, {
          DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
        });
        const scenario = { effectiveDate: '2026-10-01', observedAt: '2026-11-08T00:00:00.000Z' };
        await operator.semanticChangeA(operatorToken, {
          ...scenario, id: 'review-unrelated', accountId: 'unrelated-account', revision: 'unrelated-v2',
        });

        const approval = {
          reviewPackageId: prepared.id, expectedPackageHash: prepared.hash,
          expectedArtifactHash: prepared.artifactHash, expectedProfileHash: prepared.profileHash,
          expectedTargetVersion: prepared.expectedTargetVersion, idempotencyKey: 'approve-a',
        };
        const repository = createReviewRepository(db, clock);
        expect(await repository.readIntentByKey(approval.idempotencyKey)).toBeNull();
        expect((await post(route + '/activate', { ...approval, reviewerId: 'other' })).status).toBe(400);
        const bundleDirectory = join(registryRoot, 'activation-bundles');
        await writeFile(bundleDirectory, 'publication deliberately obstructed');
        const [grant, simultaneous] = await Promise.all([
          post(route + '/activate', approval),
          post(route + '/activate', approval, await reviewer()),
        ]);
        const pending = await grant.json();
        expect(grant.status, JSON.stringify(pending)).toBe(202);
        expect(simultaneous.status).toBe(202);
        expect(await simultaneous.json()).toEqual(pending);
        expect(pending).toEqual({ state: 'pending', reviewPackageId: prepared.id, idempotencyKey: 'approve-a' });
        const committed = await repository.readIntentByKey(approval.idempotencyKey);
        expect(committed).not.toBeNull();
        expect((await db.query('SELECT * FROM activation_intents')).rowCount).toBe(1);
        await expect(readActivationBundle({ registryRoot }, committed!.bundleHash)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
        await unlink(bundleDirectory);
        const member = (await scopeReader.readSnapshot()).resolveRegisteredScope(a.accountId)!;
        await operator.semanticChangeA(operatorToken, {
          ...scenario, id: 'review-selected', accountId: member.profile.sourceAccountIds[0]!, revision: 'selected-v2',
        });
        const blocked = await post(route + '/activate', { ...approval, idempotencyKey: 'changed-semantics' });
        expect(blocked.status).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: 'SOURCE_SEMANTICS_MISMATCH' });
        expect((await post(route + '/prepare', {})).status).toBe(409);

        const saved = (await repository.readHead(a.accountId))!;
        const malformedDraft = { ...committed!.bundle, request: { ...approval, idempotencyKey: 'rollback-grant' } };
        await expect(repository.commitIntent(headToken(saved.review), malformedDraft)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
        expect(await repository.readIntentByKey('rollback-grant')).toBeNull();

        const { id: _id, hash: _hash, revision: _revision, ...fields } = saved.review;
        const corrected = await repository.savePreparation(headToken(saved.review), {
          fields, sourceRef: saved.sourceRef, fingerprint: hashCanonical('corrected'), companion: saved.companion,
        });
        expect(corrected.revision).toBe(prepared.revision + 1);
        const staleDraft = { ...committed!.bundle, request: { ...approval, idempotencyKey: 'stale-grant' } };
        await expect(repository.commitIntent(headToken(saved.review), { ...staleDraft, hash: hashBundleV2(staleDraft) }))
          .rejects.toThrow('STALE_REVIEW');
        expect(await repository.readIntentByKey('stale-grant')).toBeNull();
        expect((await post(route + '/activate', { ...approval, expectedTargetVersion: 1 })).status).toBe(409);

        await control.close();
        await unlink(policyPath);
        control = await startControl();
        const retry = await post(route + '/activate', approval, await reviewer());
        expect(retry.status).toBe(202);
        expect(await retry.json()).toEqual(pending);
        expect(await readActivationBundle({ registryRoot }, committed!.bundleHash)).toEqual(committed!.bundle);
        expect(await repository.readIntentByKey(approval.idempotencyKey)).toEqual(committed);
        expect((await post(route + '/prepare', {}, await reviewer())).status).toBe(503);
        expect((await db.query('SELECT * FROM activation_receipt_observations')).rowCount).toBe(0);
        // Synthetic worker-shaped data exercises the private mirror only. No worker grant was delivered.
        const { previewPlan } = committed!.bundle;
        const receipt = {
          id: 'synthetic-observation', activationId: 'synthetic-activation', epoch: 1, scope: previewPlan.scope,
          artifactHash: previewPlan.artifactHash, planHash: previewPlan.hash, eventIds: previewPlan.eventIds,
          targetRecordIds: previewPlan.operations.filter(operation => !operation.op.startsWith('ensure_')).map(operation => operation.record.id),
          beforeBalanceCents: 0, afterBalanceCents: previewPlan.expectedBalanceCents,
          committedAt: committed!.committedAt, status: 'applied' as const,
        };
        const observation = {
          intentId: committed!.intentId, expectedRequestHash: committed!.requestHash,
          expectedBundleHash: committed!.bundleHash, receipt,
        };
        for (const invalid of [
          { ...observation, intentId: 'missing' },
          { ...observation, expectedRequestHash: 'a'.repeat(64) },
          { ...observation, expectedBundleHash: 'a'.repeat(64) },
          ...[
            { scope: { ...receipt.scope, accountId: b.accountId } },
            { artifactHash: 'a'.repeat(64) }, { planHash: 'a'.repeat(64) }, { eventIds: [] },
            { targetRecordIds: [] }, { afterBalanceCents: receipt.afterBalanceCents + 1 },
          ].map(diff => ({ ...observation, receipt: { ...receipt, ...diff } })),
        ]) await expect(repository.recordWorkerReceiptObservation(invalid)).rejects.toThrow('ACTIVATION_RECEIPT_MISMATCH');

        const observations = await Promise.all([
          repository.recordWorkerReceiptObservation(observation),
          createReviewRepository(db, () => new Date('2030-01-01T00:00:00Z')).recordWorkerReceiptObservation(observation),
        ]);
        expect(observations[0]).toEqual(observations[1]);
        expect(await createReviewRepository(db, clock).readWorkerReceiptObservation(committed!.intentId)).toEqual(observations[0]);
        await expect(repository.recordWorkerReceiptObservation({
          ...observation, receipt: { ...receipt, activationId: 'different-activation' },
        })).rejects.toThrow('ACTIVATION_RECEIPT_CONFLICT');
        const secondRequest = {
          ...approval, idempotencyKey: 'synthetic-other-intent', reviewPackageId: corrected.id, expectedPackageHash: corrected.hash,
        };
        const secondDraft = { ...committed!.bundle, request: secondRequest, reviewPackage: corrected };
        const secondIntent = await repository.commitIntent(headToken(corrected), { ...secondDraft, hash: hashBundleV2(secondDraft) });
        await expect(repository.recordWorkerReceiptObservation({
          ...observation, intentId: secondIntent.intentId,
          expectedRequestHash: secondIntent.requestHash, expectedBundleHash: secondIntent.bundleHash,
        })).rejects.toThrow('ACTIVATION_RECEIPT_CONFLICT');
        expect(await repository.readWorkerReceiptObservation(secondIntent.intentId)).toBeNull();
        await expect(db.query('UPDATE activation_receipt_observations SET observed_at = CURRENT_TIMESTAMP')).rejects.toThrow(/permission denied/);
        await expect(db.query('DELETE FROM activation_receipt_observations')).rejects.toThrow(/permission denied/);

        expect(await runtimeState()).toEqual(before);
      } finally {
        await control?.close();
        await worker.close();
      }
    } finally {
      await Promise.all([db.end(), runtime.end()]);
    }
  } finally {
    await dropTest(namespace);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
