import { mkdtemp, readFile, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '@eapr/storage/transaction';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, ActivationTrustPolicyV1Schema, hashActivationTrustPolicy, hashBundleV2, hashBytes, hashCanonical, hashEvent, hashManifest, hashProfile, hashTargetSnapshot, targetRecordId, MutationPlanSchema, TargetStateSchema, BootstrapManifestSchema, RawSourceEventSchema, hashFinancialReservation, ReviewPackageSchema, LocalSessionResponseSchema } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { companyA, createSourceService, streamContentHash, type SourceDefinition } from '@eapr/sources';
import { eventA } from '../../packages/sources/src/company-a.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { loadActivationPolicy } from '@eapr/storage/activation-policy';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createActivationPublication, createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { createLocalComposition, localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { type BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
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
import { createActivationReview } from '../../apps/control/src/activation-review.js';
import { createReviewPreparation } from '../../apps/control/src/review-preparation.js';
import { createReviewProofSelection } from '../../apps/control/src/review-proof-selection.js';
import { createReviewRepository, headToken } from '../../apps/control/src/review-repository.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { readActivationBundle } from '@eapr/storage/activation-registry';

function barrier() {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    entered: entered.promise,
    release: release.resolve,
    async hold() {
      entered.resolve();
      await release.promise;
    },
  };
}

function gatedTransactions(db: Pool, afterHeadLock: () => Promise<void>, beforeHeadLock?: () => void): Pool {
  return new Proxy(db, {
    get(pool, property) {
      if (property === 'connect') return async () => {
        const client = await pool.connect();
        return new Proxy(client, {
          get(connection, member) {
            if (member === 'query') return async (sql: string, values?: unknown[]) => {
              const isHeadLock = sql.includes('FROM review_heads') && sql.endsWith('FOR UPDATE');
              const pending = connection.query(sql, values);
              if (isHeadLock) beforeHeadLock?.();
              const result = await pending;
              if (isHeadLock) await afterHeadLock();
              return result;
            };
            const value: unknown = Reflect.get(connection, member);
            return typeof value === 'function' ? value.bind(connection) : value;
          },
        }) satisfies PoolClient;
      };
      const value: unknown = Reflect.get(pool, property);
      return typeof value === 'function' ? value.bind(pool) : value;
    },
  });
}

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
      let before = await runtimeState();
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
      const publishScopes = createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes;
      const scopeReader = createRegisteredScopeReader({ registryRoot });
      await expect(scopeReader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
      await generateFixtures({ seed: 'activation-policy', asOf, visibleRoot, truthRoot });
      const evaluatorBuildHash = await readFixedFinancialBuildHash();

      async function issue(company: 'a' | 'b', variant?: { source: SourceDefinition; proofRoots: typeof bootstrapRoots }) {
        const { input, source, contractFileId } = await captureEvidenceFixture(dependencies, { visibleRoot, truthRoot }, company, variant?.source);
        const proofRoots = variant?.proofRoots ?? bootstrapRoots;
        const selectedCatalog = variant ? new Map([[source.companyId, source]]) : localSourceCatalog;
        const selectedService = variant ? createSourceService(dependencies, selectedCatalog) : service;
        const selectedCaptureReader = variant
          ? createFinancialCaptureReader({ dependencies, service: selectedService, catalog: selectedCatalog, registry: candidates })
          : captureReader;
        const launcher = createProtectedFinancialLauncher({ registry: candidates, roots: {
          evidencePinRoot: proofRoots.evidencePinRoot, servedRoots: proofRoots.servedRoots,
        } });
        const { manifest, snapshot, events } = input;
        const citation = input.citations.find(item => item.evidence.sourceId === contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
        const built = buildDemoCandidate({
          source: variant ? companyA : source, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
          manifest, snapshot, events, citation,
        });
        if (!('candidate' in built) || !citation) throw new Error('Expected captured agreement and candidate');
        const original = built.candidate.request;
        const spec = variant ? { ...original.spec, version: original.spec.version + 1 } : original.spec;
        const profiles = variant ? original.profiles.map(profile => {
          const draft = { ...profile, version: profile.version + 1 };
          return { ...draft, hash: hashProfile(draft) };
        }) : original.profiles;
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
          await pinProtectedEvidenceFixture(fixture, pathToFileURL(proofRoots.evidencePinRoot + '/'));
          const capture = await selectedCaptureReader.readCapture(selection);
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
          const pin = await prepareBootstrapVerification(candidates, selectedService, { ...selection, review }, proofRoots);
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

        const first = await issueProof(input, variant ? 'source-wide' : 'first');
        return { ...first, accountId: profile.scope.accountId, sourceRef: manifest.sourceRef, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId } };
      }

      const a = await issue('a');
      const b = await issue('b');

      const selection = { policyId: 'review-policy', entries: [a.selection, b.selection] };
      await prepareAndPublishActivationPolicy({
        candidates, captureReader, financialRegistry, bootstrapRoots,
        readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
      }, selection, { policyRoot, install: true });
      const policyBytes = await readFile(policyPath);
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
      const parent = createParentReadClient(workerOrigin, serviceToken, registryRoot);
      let parentBarrier: ReturnType<typeof barrier> | undefined;
      async function startControl() {
        const local = await createLocalComposition({ ...dependencies, clock }, {
          captures: [a.capture, b.capture], webOrigin, registry: candidates, sourceReadToken,
          parentReads: {
            ...parent,
            async readParent(...args) {
              const view = await parent.readParent(...args);
              const gate = parentBarrier;
              parentBarrier = undefined;
              if (gate) await gate.hold();
              return view;
            },
          },
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
        const heldAbsent = parentBarrier = barrier();
        const obsoleteFirst = post('/api/review/' + b.accountId + '/prepare', {});
        await heldAbsent.entered;
        let preparedB;
        try {
          preparedB = await prepare(b.accountId);
        } finally {
          heldAbsent.release();
        }
        const obsoleteFirstResponse = await obsoleteFirst;
        expect(obsoleteFirstResponse.status).toBe(409);
        expect(await obsoleteFirstResponse.json()).toMatchObject({ code: 'STALE_REVIEW' });
        expect(preparedB.ready).toBe(true);
        expect((await db.query('SELECT * FROM review_bootstrap_selections')).rowCount).toBe(2);
        expect(await (await request(route, { headers })).json()).toEqual(prepared);
        const repository = createReviewRepository(db, clock);
        function replacement(saved: NonNullable<Awaited<ReturnType<typeof repository.readHead>>>, label: string) {
          const { id: _id, hash: _hash, revision: _revision, ...fields } = saved.review;
          return { fields, sourceRef: saved.sourceRef, fingerprint: hashCanonical(label), companion: saved.companion };
        }

        // Block a real preparation after it has captured a present token and read the real worker.
        const bHead = (await repository.readHead(b.accountId))!;
        const heldPrepare = parentBarrier = barrier();
        const stalePrepare = post('/api/review/' + b.accountId + '/prepare', {});
        await heldPrepare.entered;
        try {
          await repository.savePreparation(headToken(bHead.review), replacement(bHead, 'held-preparation-correction'));
        } finally {
          heldPrepare.release();
        }
        const stalePrepareResponse = await stalePrepare;
        expect(stalePrepareResponse.status).toBe(409);
        expect(await stalePrepareResponse.json()).toMatchObject({ code: 'STALE_REVIEW' });

        const admin = createControlDb({ connectionString: pair.control.migrationUrl });
        try {
          const { rows: [proofA] } = await db.query<{ selection_hash: string; result_id: string; job_id: string; result_bytes: Buffer; observed_plan_bytes: Buffer; observed_plan_bytes_hash: string }>(
            `SELECT s.*, r.job_id, r.result_bytes, r.observed_plan_bytes, r.observed_plan_bytes_hash FROM review_bootstrap_selections s
               JOIN bootstrap_verification_results r ON s.result_id = r.id
               JOIN bootstrap_verification_jobs j ON r.job_id = j.id WHERE j.account_id = $1`, [a.accountId],
          );
          const { rows: [proofB] } = await db.query<{ result_id: string }>(
            `SELECT s.result_id FROM review_bootstrap_selections s
               JOIN bootstrap_verification_results r ON s.result_id = r.id
               JOIN bootstrap_verification_jobs j ON r.job_id = j.id WHERE j.account_id = $1`, [b.accountId],
          );
          // The real registered proof includes the protected source-wide planner challenge.
          expect(JSON.parse(proofA!.result_bytes.toString('utf8'))).toMatchObject({
            cases: expect.arrayContaining([expect.objectContaining({ id: 'source_wide_blocker', status: 'passed' })]),
          });
          const plan = MutationPlanSchema.parse(JSON.parse(proofA!.observed_plan_bytes.toString('utf8')));
          expect(plan.operations.length).toBeGreaterThan(1);
          const alteredPlan = Buffer.from(canonicalJson({ ...plan, operations: [...plan.operations].reverse() }));
          try {
            await admin.query('UPDATE bootstrap_verification_results SET observed_plan_bytes = $1, observed_plan_bytes_hash = $2 WHERE id = $3',
              [alteredPlan, hashBytes(alteredPlan), proofA!.result_id]);
            const forged = await post(route + '/prepare', {});
            expect(forged.status).toBe(409);
            expect(await forged.json()).toMatchObject({ code: 'BOOTSTRAP_VERIFICATION_MISMATCH' });
          } finally {
            await admin.query('UPDATE bootstrap_verification_results SET observed_plan_bytes = $1, observed_plan_bytes_hash = $2 WHERE id = $3',
              [proofA!.observed_plan_bytes, proofA!.observed_plan_bytes_hash, proofA!.result_id]);
          }

          try {
            await admin.query("UPDATE bootstrap_verification_jobs SET state = 'failed' WHERE id = $1", [proofA!.job_id]);
            const failed = await post(route + '/prepare', {});
            expect(failed.status).toBe(503);
            expect(await failed.json()).toMatchObject({ code: 'BOOTSTRAP_VERIFICATION_UNAVAILABLE' });
          } finally {
            await admin.query("UPDATE bootstrap_verification_jobs SET state = 'completed' WHERE id = $1", [proofA!.job_id]);
          }

          // Substitute the other customer's real completed proof at the exact selected key.
          await withTransaction(admin, async client => {
            await client.query('ALTER TABLE review_bootstrap_selections DISABLE TRIGGER review_bootstrap_selections_immutable');
            await client.query('UPDATE review_bootstrap_selections SET result_id = $1 WHERE selection_hash = $2',
              [proofB!.result_id, proofA!.selection_hash]);
            await client.query('ALTER TABLE review_bootstrap_selections ENABLE TRIGGER review_bootstrap_selections_immutable');
          });
          const foreign = await post(route + '/prepare', {});
          expect(foreign.status).toBe(409);
          expect(await foreign.json()).toMatchObject({ code: 'BOOTSTRAP_VERIFICATION_MISMATCH' });
          await withTransaction(admin, async client => {
            await client.query('ALTER TABLE review_bootstrap_selections DISABLE TRIGGER review_bootstrap_selections_immutable');
            await client.query('UPDATE review_bootstrap_selections SET result_id = $1 WHERE selection_hash = $2',
              [proofA!.result_id, proofA!.selection_hash]);
            await client.query('ALTER TABLE review_bootstrap_selections ENABLE TRIGGER review_bootstrap_selections_immutable');
          });

          const { rows: [financial] } = await db.query<{ report_bytes: Buffer }>(
            'SELECT report_bytes FROM financial_verification_attestations WHERE report_id = $1', [a.report.id],
          );
          try {
            const forgedReport = Buffer.from(canonicalJson({ ...a.report, eligible: false }));
            await admin.query('UPDATE financial_verification_attestations SET report_bytes = $1 WHERE report_id = $2', [forgedReport, a.report.id]);
            const forged = await post(route + '/prepare', {});
            expect(forged.status).toBe(409);
            expect(await forged.json()).toMatchObject({ code: 'FINANCIAL_ATTESTATION_MISMATCH' });
          } finally {
            await admin.query('UPDATE financial_verification_attestations SET report_bytes = $1 WHERE report_id = $2', [financial!.report_bytes, a.report.id]);
          }

          const { rows: [row] } = await db.query<{ manifest: unknown }>(
            'SELECT manifest FROM source_manifests WHERE manifest_id = $1', [a.capture.manifestId],
          );
          const manifest = BootstrapManifestSchema.parse(row!.manifest);
          const latest = { ...manifest, id: manifest.id + ':later', epoch: manifest.epoch + 1 };
          for (const [draft, expectedStatus, code] of [
            [{ ...latest, semanticVersions: {} }, 409, 'SOURCE_SEMANTICS_MISMATCH'],
            [{ ...latest, semanticVersions: { ...manifest.semanticVersions, '*': 'governing' } }, 409, 'SOURCE_SEMANTICS_MISMATCH'],
            [{ ...latest, streams: latest.streams.filter(stream => stream.streamId !== 'a-semantics') }, 503, 'REVIEW_UNAVAILABLE'],
          ] as const) {
            await admin.query(
              'INSERT INTO source_manifests (manifest_id, company_id, source_ref, epoch, manifest) VALUES ($1,$2,$3,$4,$5)',
              [draft.id, draft.companyId, draft.sourceRef, draft.epoch, { ...draft, hash: hashManifest(draft) }],
            );
            try {
              const denied = await post(route + '/prepare', {});
              expect(denied.status).toBe(expectedStatus);
              expect(await denied.json()).toMatchObject({ code });
            } finally {
              await admin.query('DELETE FROM source_manifests WHERE manifest_id = $1', [draft.id]);
            }
          }
          expect((await repository.readHead(a.accountId))!.review).toEqual(prepared);
        } finally {
          await admin.end();
        }

        // The stock adapter requires a source account. Use a test-only contract allowing an unresolved semantic event.
        const variantSource: SourceDefinition = {
          ...companyA, contracts: companyA.contracts.map(contract => contract.kind === 'semantic_change'
            ? { ...contract, accountIdField: null } : contract),
        };
        const manifestPath = join(visibleRoot, 'manifest-a.json');
        const originalManifest = BootstrapManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
        const apiPath = join(visibleRoot, 'api-a.json');
        const api = RawSourceEventSchema.array().parse(JSON.parse(await readFile(apiPath, 'utf8')));
        const semanticEvents = api.filter(event => event.streamId === 'a-semantics');
        const probe = eventA({
          kind: 'semantic_change', recordId: 'captured-source-wide', sourceAccountId: 'unresolved',
          effectiveDate: '2026-10-01', semanticVersion: 'unreviewed', fields: { revision: 'unreviewed' },
        }, semanticEvents.length + 1, asOf);
        const { sourceAccountId: _unresolved, ...rawIdentity } = probe.rawIdentity;
        const draftEvent = { ...probe, rawIdentity };
        const blocker = RawSourceEventSchema.parse({ ...draftEvent, contentHash: hashEvent(draftEvent) });
        const nextEvents = [...semanticEvents, blocker];
        const nextId = originalManifest.id + ':source-wide';
        const manifestDraft = {
          ...originalManifest, id: nextId, epoch: originalManifest.epoch + 1,
          streams: originalManifest.streams.map(stream => {
            const snapshotId = nextId + ':' + stream.streamId;
            if (stream.streamId !== 'a-semantics') return { ...stream, snapshotId };
            const resumeAfter = String(nextEvents.length);
            return {
              ...stream, snapshotId, resumeAfter, eventIds: nextEvents.map(event => event.id),
              snapshotHash: streamContentHash(variantSource.sourceRef, stream.streamId, resumeAfter, nextEvents),
            };
          }),
        };
        const originalsPath = join(visibleRoot, 'api-originals-a.json');
        const originals = JSON.parse(await readFile(originalsPath, 'utf8')) as { eventId: string; path: string }[];
        const blockerOriginal = 'source-wide-original.json';
        const nextManifest = { ...manifestDraft, hash: hashManifest(manifestDraft) };
        const truthPath = join(truthRoot, 'expected-a.json');
        const producerPath = join(truthRoot, 'evidence-a.json');
        const { hash: _truthHash, ...originalTruth } = decodeTruth(await readFile(truthPath, 'utf8'));
        const nextTruth = {
          ...originalTruth, manifestId: nextId, manifestHash: nextManifest.hash,
          inputEvents: [...originalTruth.inputEvents, { id: blocker.id, contentHash: blocker.contentHash }]
            .sort((left, right) => left.id.localeCompare(right.id)),
        };
        const { hash: _producerHash, ...originalProducer } = decodeEvidenceProducer(await readFile(producerPath, 'utf8'));
        const nextProducer = {
          ...originalProducer, manifestId: nextId, manifestHash: nextManifest.hash, producerTruthHash: hashCanonical(nextTruth),
        };
        await Promise.all([
          writeFile(manifestPath, canonicalJson(nextManifest)),
          writeFile(truthPath, canonicalJson({ ...nextTruth, hash: nextProducer.producerTruthHash })),
          writeFile(producerPath, canonicalJson({ ...nextProducer, hash: hashCanonical(nextProducer) })),
          writeFile(apiPath, canonicalJson([...api, blocker])),
          writeFile(originalsPath, canonicalJson([...originals, { eventId: blocker.id, path: blockerOriginal }])),
          writeFile(join(visibleRoot, blockerOriginal), canonicalJson(blocker.payload)),
        ]);
        const variantRoots = { ...bootstrapRoots, sidecarRoot: join(root, 'variant-bootstrap'), evidencePinRoot: join(root, 'variant-evaluator') };
        const variant = await issue('a', { source: variantSource, proofRoots: variantRoots });
        const variantCatalog = new Map([[variantSource.companyId, variantSource]]);
        const variantService = createSourceService(dependencies, variantCatalog);
        const variantReader = createFinancialCaptureReader({ dependencies, service: variantService, catalog: variantCatalog, registry: candidates });
        const variantSelection = { policyId: 'source-wide-policy', entries: [variant.selection] };
        const variantPolicyRoot = join(root, 'variant-policy');
        await prepareAndPublishActivationPolicy({
          candidates, captureReader: variantReader, financialRegistry, bootstrapRoots: variantRoots,
          readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
        }, variantSelection, { policyRoot: variantPolicyRoot, install: true });
        const variantPolicy = await loadActivationPolicy({ policyPath: join(variantPolicyRoot, 'current.json') });
        const variantPreparation = createReviewPreparation({
          repository, setup: { policy: variantPolicy, selection: variantSelection },
          registered: scopeReader, captureReader: variantReader, financial: financialRegistry,
          selectBootstrap: createReviewProofSelection(db, candidates, variantRoots), parent,
          observe: variantService.readCurrentSemantics,
        });
        const grants = { demoOnly: true as const, reviewer: { reviewerId: 'fixture-reviewer', sessionId: 'fixture-session' },
          allowedAccountIds: [variant.accountId], allowedSourceRefs: [variant.sourceRef] };
        const beforeVariantJobs = (await db.query('SELECT id FROM bootstrap_verification_jobs ORDER BY id')).rows;
        await expect(variantPreparation.prepare(variant.accountId, grants)).rejects.toMatchObject({ code: 'REVIEW_NOT_READY' });
        expect((await db.query('SELECT id FROM bootstrap_verification_jobs ORDER BY id')).rows).toEqual(beforeVariantJobs);
        expect((await repository.readHead(a.accountId))!.review).toEqual(prepared);
        await publishScopes([a.selection]);

        const operatorToken = 'integration-operator-token';
        const operator = createScenarioAdmin({ ...dependencies, clock }, {
          DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
        });
        const scenario = { effectiveDate: '2026-10-01', observedAt: '2026-11-08T00:00:00.000Z' };
        await operator.semanticChangeA(operatorToken, {
          ...scenario, id: 'review-unrelated', accountId: 'unrelated-account', revision: 'unrelated-v2',
        });

        await operator.freshInvoiceA(operatorToken, {
          ...scenario, id: 'review-ordinary-financial-append', accountId: 'unrelated-account',
          amount: '5.00', dueDate: '2026-10-31', semanticVersion: 'financial-only',
        });

        const approval = {
          reviewPackageId: prepared.id, expectedPackageHash: prepared.hash,
          expectedArtifactHash: prepared.artifactHash, expectedProfileHash: prepared.profileHash,
          expectedTargetVersion: prepared.expectedTargetVersion, idempotencyKey: 'approve-a',
        };
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

        // The normal demo session grants both sources. Exercise a narrower reviewer against the real stored intent.
        const activate = createActivationReview({
          repository,
          preparation: {
            async revalidate() { throw new Error('Retry must not revalidate preparation'); },
            async prepare() { throw new Error('Retry must not prepare'); },
            async get() { throw new Error('Retry must not read a saved review'); },
          },
          publisher: createActivationPublication({ registryRoot, readCommittedIntent: repository.readCommittedIntent }),
          publicationFailed: () => { throw new Error('Unexpected publication attempt'); },
        });
        const sourceForbidden = {
          demoOnly: true as const, reviewer: { reviewerId: 'restricted-reviewer', sessionId: 'restricted-session' },
          allowedAccountIds: [a.accountId, b.accountId], allowedSourceRefs: [],
        };
        for (const [accountId, payload] of [
          [a.accountId, approval],
          [a.accountId, { ...approval, expectedTargetVersion: approval.expectedTargetVersion + 1 }],
          [b.accountId, approval],
        ] as const) {
          await expect(activate(accountId, payload, sourceForbidden)).rejects.toMatchObject({
            statusCode: 403, code: 'REVIEW_FORBIDDEN',
          });
        }
        await expect(activate(b.accountId, approval, {
          ...sourceForbidden, allowedSourceRefs: [b.sourceRef],
        })).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' });
        await expect(activate('no-saved-review', approval, {
          ...sourceForbidden, allowedAccountIds: ['no-saved-review'], allowedSourceRefs: [b.sourceRef],
        })).rejects.toMatchObject({ statusCode: 404, code: 'REVIEW_NOT_FOUND' });
        await expect(readActivationBundle({ registryRoot }, committed!.bundleHash)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
        expect(await repository.readIntentByKey(approval.idempotencyKey)).toEqual(committed);

        // Hold each winning transaction after it acquires the actual PostgreSQL head lock.
        const raceHead = (await repository.readHead(a.accountId))!;
        const raceDraft = (key: string) => {
          const draft = { ...committed!.bundle, request: { ...approval, idempotencyKey: key } };
          return { ...draft, hash: hashBundleV2(draft) };
        };
        const heldGrant = barrier();
        const grantRepo = createReviewRepository(gatedTransactions(db, heldGrant.hold), clock);
        const firstGrant = grantRepo.commitIntent(headToken(raceHead.review), raceDraft('grant-first'));
        await heldGrant.entered;
        const correctionLockAttempt = Promise.withResolvers<void>();
        const correctionContender = createReviewRepository(gatedTransactions(db, async () => {}, correctionLockAttempt.resolve), clock);
        const correction = correctionContender.savePreparation(headToken(raceHead.review), replacement(raceHead, 'grant-first-correction'));
        await correctionLockAttempt.promise;
        expect(await repository.readIntentByKey('grant-first')).toBeNull();
        heldGrant.release();
        const [winningGrant, newHead] = await Promise.all([firstGrant, correction]);
        expect(winningGrant.request.reviewPackageId).toBe(prepared.id);
        expect(newHead.revision).toBe(prepared.revision + 1);
        expect(await repository.readIntentByKey('grant-first')).toEqual(winningGrant);

        const heldCorrection = barrier();
        const current = (await repository.readHead(a.accountId))!;
        const correctionRepo = createReviewRepository(gatedTransactions(db, heldCorrection.hold), clock);
        const firstCorrection = correctionRepo.savePreparation(headToken(current.review), replacement(current, 'correction-first'));
        await heldCorrection.entered;
        const obsoleteDraft = {
          ...committed!.bundle, reviewPackage: current.review,
          request: { ...approval, reviewPackageId: current.review.id, expectedPackageHash: current.review.hash, idempotencyKey: 'correction-first' },
        };
        const grantLockAttempt = Promise.withResolvers<void>();
        const grantContender = createReviewRepository(gatedTransactions(db, async () => {}, grantLockAttempt.resolve), clock);
        const losingGrant = grantContender.commitIntent(headToken(current.review), { ...obsoleteDraft, hash: hashBundleV2(obsoleteDraft) });
        const staleGrant = expect(losingGrant).rejects.toThrow('STALE_REVIEW');
        await grantLockAttempt.promise;
        heldCorrection.release();
        await Promise.all([firstCorrection, staleGrant]);
        expect(await repository.readIntentByKey('correction-first')).toBeNull();
        const rePrepared = await prepare(a.accountId);
        const member = (await scopeReader.readSnapshot()).resolveRegisteredScope(a.accountId)!;
        await operator.semanticChangeA(operatorToken, {
          ...scenario, id: 'review-selected', accountId: member.profile.sourceAccountIds[0]!, revision: 'selected-v2',
        });
        const blocked = await post(route + '/activate', {
          ...approval, reviewPackageId: rePrepared.id, expectedPackageHash: rePrepared.hash, idempotencyKey: 'changed-semantics',
        });
        expect(blocked.status).toBe(409);
        expect(await blocked.json()).toMatchObject({ code: 'SOURCE_SEMANTICS_MISMATCH' });
        expect((await post(route + '/prepare', {})).status).toBe(409);

        const saved = (await repository.readHead(a.accountId))!;
        const savedRequest = { ...approval, reviewPackageId: saved.review.id, expectedPackageHash: saved.review.hash };
        const malformedDraft = { ...committed!.bundle, reviewPackage: saved.review, request: { ...savedRequest, idempotencyKey: 'rollback-grant' } };
        await expect(repository.commitIntent(headToken(saved.review), malformedDraft)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
        expect(await repository.readIntentByKey('rollback-grant')).toBeNull();

        const { id: _id, hash: _hash, revision: _revision, ...fields } = saved.review;
        const corrected = await repository.savePreparation(headToken(saved.review), {
          fields, sourceRef: saved.sourceRef, fingerprint: hashCanonical('corrected'), companion: saved.companion,
        });
        expect(corrected.revision).toBe(saved.review.revision + 1);
        const staleDraft = { ...malformedDraft, request: { ...savedRequest, idempotencyKey: 'stale-grant' } };
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

        const owner = createControlDb({ connectionString: pair.control.migrationUrl });
        try {
          await owner.query("ALTER TABLE activation_receipt_observations ADD CHECK (receipt_id <> 'synthetic-observation')");
          await expect(repository.recordWorkerReceiptObservation(observation)).rejects.toMatchObject({ code: '23514' });
          expect(await repository.readWorkerReceiptObservation(committed!.intentId)).toBeNull();
          expect(await repository.readIntentByKey(approval.idempotencyKey)).toEqual(committed);
          await owner.query('ALTER TABLE activation_receipt_observations DROP CONSTRAINT activation_receipt_observations_receipt_id_check');
        } finally {
          await owner.end();
        }

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

        const bAuthority = (bHead.companion as { authorityContent: { plannerTarget: unknown; plan: unknown } }).authorityContent;
        const bTarget = TargetStateSchema.parse(bAuthority.plannerTarget);
        const invoice = MutationPlanSchema.parse(bAuthority.plan).operations.find(operation => operation.op === 'insert_invoice')!.record;
        const identity = { ...invoice.identity, recordId: 'parent-only-invoice' };
        const recordedTarget = {
          ...bTarget, asOf: '2026-09-30T00:00:00.000Z', version: 1,
          invoices: [{ ...invoice, id: targetRecordId(identity), identity, sourceEventId: 'parent-only-event' }],
        };
        const targetHash = hashTargetSnapshot(recordedTarget);
        await withTransaction(runtime, async client => {
          const { accountId, companyId, sellerEntityId } = bTarget.scope;
          const key = [accountId, companyId, sellerEntityId];
          await client.query('INSERT INTO parent_scopes VALUES ($1,$2,$3)', key);
          await client.query('INSERT INTO parent_snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [...key, 1, targetHash, recordedTarget.asOf, canonicalJson(recordedTarget), hashCanonical(recordedTarget)]);
          await client.query('INSERT INTO parent_targets VALUES ($1,$2,$3,$4,$5)', [...key, 1, targetHash]);
        });
        before = await runtimeState();
        await control.close();
        await writeFile(policyPath, policyBytes, { mode: 0o600 });
        const legacyJobId = 'a4-unattested-legacy-job';
        const legacyReport = { ...b.report, id: 'report:' + legacyJobId };
        await db.query(
          `INSERT INTO verification_jobs (id, state, source_refs, account_ids, artifact_hash, manifest_id, summary)
           SELECT $1, state, source_refs, account_ids, artifact_hash, manifest_id,
                  jsonb_set(summary, '{reportId}', to_jsonb($3::text)) FROM verification_jobs WHERE id = $2`,
          [legacyJobId, b.request.jobId, legacyReport.id],
        );
        await db.query('INSERT INTO verification_reports VALUES ($1,$2,$3)', [legacyReport.id, legacyJobId, canonicalJson(legacyReport)]);
        for (const [financialReportId, status, code] of [
          ['missing-report', 503, 'FINANCIAL_ATTESTATION_UNAVAILABLE'],
          [legacyReport.id, 503, 'FINANCIAL_ATTESTATION_UNAVAILABLE'],
          [a.report.id, 409, 'FINANCIAL_ATTESTATION_MISMATCH'],
        ] as const) {
          await writeFile(selectionPath, canonicalJson({ ...selection, entries: [a.selection, { ...b.selection, financialReportId }] }));
          control = await startControl();
          const response = await post('/api/review/' + b.accountId + '/prepare', {}, await reviewer());
          expect(response.status).toBe(status);
          expect(await response.json()).toMatchObject({ code });
          await control.close();
        }
        await writeFile(selectionPath, canonicalJson(selection));
        // Rotate one installed tuple's financial build without rotating the referenced completed proof.
        const installed = ActivationTrustPolicyV1Schema.parse(JSON.parse(policyBytes.toString('utf8')));
        const rotated = ActivationTrustPolicyV1Schema.parse({
          ...installed,
          entries: installed.entries.map(entry => entry.scope.accountId === b.accountId ? {
            ...entry, financial: { ...entry.financial, evaluatorBuildHash: hashCanonical('other-financial-build') },
          } : entry),
        });
        await writeFile(policyPath, canonicalJson({ ...rotated, hash: hashActivationTrustPolicy(rotated) }));
        control = await startControl();
        const oldProof = await post('/api/review/' + b.accountId + '/prepare', {}, await reviewer());
        expect(oldProof.status).toBe(409);
        expect(await oldProof.json()).toMatchObject({ code: 'FINANCIAL_ATTESTATION_MISMATCH' });
        await control.close();
        await writeFile(policyPath, policyBytes);
        control = await startControl();
        const bRoute = '/api/review/' + b.accountId;
        const bCurrent = (await repository.readHead(b.accountId))!.review;
        const staleTarget = await post(bRoute + '/activate', {
          reviewPackageId: bCurrent.id, expectedPackageHash: bCurrent.hash, expectedArtifactHash: bCurrent.artifactHash,
          expectedProfileHash: bCurrent.profileHash, expectedTargetVersion: 0, idempotencyKey: 'old-target',
        }, await reviewer());
        expect(staleTarget.status).toBe(409);
        expect(await staleTarget.json()).toMatchObject({ code: 'REVIEW_STALE' });
        expect(await repository.readIntentByKey('old-target')).toBeNull();
        const withExistingParent = await post(bRoute + '/prepare', {}, await reviewer());
        const existingParentResult: unknown = await withExistingParent.json();
        expect(withExistingParent.status, JSON.stringify(existingParentResult)).toBe(409);
        expect(existingParentResult).toMatchObject({ code: 'BOOTSTRAP_VERIFICATION_MISMATCH' });
        const plannerTarget = { ...recordedTarget, asOf };
        expect(targetHash).not.toBe(hashTargetSnapshot(plannerTarget));
        const { rows: [targetJob] } = await db.query<{ binding: unknown; target_bytes: Buffer }>(
          'SELECT binding, target_bytes FROM bootstrap_verification_jobs WHERE account_id = $1 AND target_hash = $2',
          [b.accountId, hashTargetSnapshot(plannerTarget)],
        );
        expect(targetJob?.binding).toMatchObject({ expectedTargetVersion: 1, targetSnapshotHash: hashTargetSnapshot(plannerTarget) });
        expect(targetJob?.target_bytes.toString('utf8')).toBe(canonicalJson(plannerTarget));
        expect((await repository.readHead(b.accountId))!.review).toEqual(bCurrent);
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
