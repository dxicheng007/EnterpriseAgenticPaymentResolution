import { createServer } from 'node:http';
import { projectBootstrapTarget } from '@eapr/parent/bootstrap';
import { lockImportIdentities } from '@eapr/parent/persistence';
import { withTransaction } from '@eapr/storage/transaction';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { expect, test } from 'vitest';
import {
  ActivationStateV1Schema, ActivationTrustPolicyV1Schema, ParentViewSchema, ReceiptResponseSchema, SemanticPreflightSchema,
  LocalSessionResponseSchema, ReviewPackageSchema, canonicalJson, hashActivationTrustPolicy, hashBootstrapVerificationResult,
  hashBundleV2, hashCanonical, hashEvent, hashManifest, hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, hashPlan,
  hashProfile, hashReviewPackage, hashTargetSnapshot, type ActivationBundleV2, type RawSourceEvent,
} from '@eapr/contracts';
import { streamContentHash } from '@eapr/sources';
import { aggregateHash } from '../../packages/sources/src/dossier.js';
import { deriveFinancialCapture } from '../../packages/evaluator/src/financial-attestation-verify.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { createRegisteredScopeReader, publishActivationBundle, publishRegisteredScopeMembers, readActivationBundle } from '@eapr/storage/activation-registry';
import { createLocalComposition } from '../../apps/control/src/composition.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { activationCutover as asOf, issueActivationProofs, verifyOriginals } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';
import { createWorkerClient, launchControl } from '../../apps/control/src/server.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createReviewRepository, headToken } from '../../apps/control/src/review-repository.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';

import { composeWorkerActivation } from '../../apps/worker/src/activation-composition.js';
import { createActivationWorkerClient } from '../../apps/control/src/activation-worker-client.js';
import { createWorkerActivation } from '../../apps/worker/src/activation.js';
import { createWorkerActivationPlugin } from '../../apps/worker/src/routes/activation.js';

test('activates one approved customer from real A and B proofs and recovers the authoritative receipt', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-activation-setup-'));
  const namespace = testNamespace('v3activate');
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
      const clearRuntimeFixtures = async () => {
        const owner = createRuntimeDb({ connectionString: pair.runtime.migrationUrl });
        try {
          // Fixture cleanup stays inside this test's randomized, disposable database.
          await owner.query('TRUNCATE parent_scopes CASCADE');
        } finally {
          await owner.end();
        }
      };
      const before = await runtimeState();
      const { a, b, candidates, dependencies, registryRoot, scopeReader, bootstrapRoots, policyPath, policyBytes, selectionPath } =
        await issueActivationProofs(root, db);
      const workerPort = localPort('EAPR_WORKER_PORT', 3002);
      const controlPort = localPort('EAPR_CONTROL_PORT', 3001);
      const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
      const workerOrigin = 'http://127.0.0.1:' + workerPort;
      const controlOrigin = 'http://127.0.0.1:' + controlPort;
      const serviceToken = 'integration-service-token';
      const sourceReadToken = 'integration-source-read-token';
      const clock = () => new Date();
      const workerClock = () => new Date('2026-11-09T08:00:00.000Z');
      const migrations = readMigrationCatalog();
      type SourceReply = { status: number; body: string };
      let sourceIntercept: ((reply: SourceReply) => Promise<SourceReply>) | undefined;
      let sourceReads = 0;
      const sourceProxy = createServer(async (request, response) => {
        sourceReads++;
        try {
          const upstream = await fetch(controlOrigin + request.url, {
            headers: { authorization: request.headers.authorization ?? '' },
          });
          const original = { status: upstream.status, body: await upstream.text() };
          const outgoing = sourceIntercept ? await sourceIntercept(original) : original;
          response.writeHead(outgoing.status, { 'content-type': 'application/json' });
          response.end(outgoing.body);
        } catch {
          response.writeHead(503).end();
        }
      });
      sourceProxy.listen(0, '127.0.0.1');
      await once(sourceProxy, 'listening');
      const sourceAddress = sourceProxy.address();
      if (!sourceAddress || typeof sourceAddress === 'string') throw new Error('No source test listener');
      const sourceOrigin = 'http://127.0.0.1:' + sourceAddress.port;
      type SqlFault = { write: RegExp; states: string[] };
      let fault: SqlFault | undefined;
      let duringQuery: ((sql: string, values: unknown[] | undefined) => void) | undefined;
      const transactions: { client: PoolClient; sql: string[] }[] = [];
      const instrumentedRuntime = new Proxy(runtime, {
        get(pool, property) {
          if (property === 'connect') return async () => {
            const client = await pool.connect();
            let transaction: (typeof transactions)[number] | undefined;
            return new Proxy(client, {
              get(connection, member) {
                if (member === 'query') return async (sql: string, values?: unknown[]) => {
                  if (sql === 'BEGIN') {
                    transaction = { client, sql: [] };
                    transactions.push(transaction);
                  }
                  transaction?.sql.push(sql);
                  const pending = connection.query(sql, values);
                  duringQuery?.(sql, values);
                  const result = await pending;
                  if (transaction && fault?.write.test(sql)) {
                    const state = fault.states.shift();
                    if (state) await connection.query("DO $$ BEGIN RAISE EXCEPTION 'injected test fault' USING ERRCODE = '" + state + "'; END $$");
                  }
                  if (sql === 'ROLLBACK' || sql === 'COMMIT') transaction = undefined;
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
      const startWorker = () => launchWorker({
        db: instrumentedRuntime, clock: workerClock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
        featurePlugins: [
          composeWorkerParentReads(registryRoot),
          composeWorkerActivation({ registryRoot, policyPath, sourceOrigin, sourceReadToken, sourceRefs: [a.sourceRef, b.sourceRef] }),
        ],
      }, workerPort);
      const parent = createParentReadClient(workerOrigin, serviceToken, registryRoot);
      const activationWorker = createActivationWorkerClient(workerOrigin, serviceToken);
      let loseWorkerResponse = false;
      let lostReceipt: ReturnType<typeof ReceiptResponseSchema.parse> | undefined;
      const workerProxy = createServer(async (request, response) => {
        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = Buffer.concat(chunks);
          const upstream = await fetch(workerOrigin + request.url, {
            method: request.method,
            headers: {
              authorization: request.headers.authorization ?? '',
              ...(body.length ? { 'content-type': 'application/json' } : {}),
            },
            ...(body.length ? { body } : {}),
          });
          const output = await upstream.text();
          if (loseWorkerResponse && request.method === 'POST' && upstream.status === 200) {
            loseWorkerResponse = false;
            lostReceipt = ReceiptResponseSchema.parse(JSON.parse(output));
            response.destroy();
            return;
          }
          response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(output);
        } catch {
          response.writeHead(503).end();
        }
      });
      workerProxy.listen(0, '127.0.0.1');
      await once(workerProxy, 'listening');
      const proxyAddress = workerProxy.address();
      if (!proxyAddress || typeof proxyAddress === 'string') throw new Error('No worker test listener');
      const deliveryWorker = createActivationWorkerClient('http://127.0.0.1:' + proxyAddress.port, serviceToken);
      const repository = createReviewRepository(db, clock);
      async function startControl() {
        const local = await createLocalComposition({ ...dependencies, clock }, {
          captures: [a.capture, b.capture], webOrigin, registry: candidates, sourceReadToken, parentReads: parent,
          activationReview: { registryRoot, policyPath, selectionPath, bootstrapRoots, worker: deliveryWorker },
        });
        return launchControl({
          db, clock, workerClient: createWorkerClient(workerOrigin, serviceToken),
          expectedMigrations: migrationIdentities(migrations.control), featurePlugins: local.featurePlugins,
        }, controlPort);
      }

      let worker = await startWorker();
      let control;
      try {
        control = await startControl();
        async function reviewer() {
          const session = await fetch(controlOrigin + '/api/local-session', {
            method: 'POST', headers: { origin: webOrigin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, body: '{}',
          });
          expect(session.status).toBe(200);
          const cookie = session.headers.getSetCookie()[0]!.split(';', 1)[0]!;
          const context = LocalSessionResponseSchema.parse(await session.json());
          return { cookie, origin: webOrigin, 'x-eapr-csrf': context.csrfToken, 'content-type': 'application/json' };
        }
        const headers = await reviewer();
        const route = '/api/review/' + a.accountId;
        const post = (path: string, body: object, requestHeaders = headers) =>
          fetch(controlOrigin + path, { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
        const prepare = async (accountId: string) => {
          const response = await post('/api/review/' + accountId + '/prepare', {});
          const payload: unknown = await response.json();
          expect(response.status, JSON.stringify(payload)).toBe(200);
          return ReviewPackageSchema.parse(payload);
        };
        const prepared = await prepare(a.accountId);
        const preparedB = await prepare(b.accountId);
        expect(preparedB.ready).toBe(true);
        expect(await runtimeState()).toEqual(before);
        const approval = {
          reviewPackageId: prepared.id, expectedPackageHash: prepared.hash,
          expectedArtifactHash: prepared.artifactHash, expectedProfileHash: prepared.profileHash,
          expectedTargetVersion: prepared.expectedTargetVersion, idempotencyKey: 'approve-a',
        };
        const operatorToken = 'integration-operator-token';
        const operator = createScenarioAdmin({ ...dependencies, clock }, {
          DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: operatorToken,
        });
        const scenario = { effectiveDate: '2026-10-01', observedAt: '2026-11-08T00:00:00.000Z' };
        await operator.semanticChangeA(operatorToken, {
          ...scenario, id: 'unrelated-revision', accountId: 'unrelated-account', revision: 'other-v2',
        });
        const selectedSourceAccount = (await scopeReader.readSnapshot())
          .resolveRegisteredScope(a.accountId)!.profile.sourceAccountIds[0]!;
        await operator.freshInvoiceA(operatorToken, {
          ...scenario, id: 'ordinary-financial-event', accountId: selectedSourceAccount,
          amount: '5.00', dueDate: '2026-10-31', semanticVersion: 'financial-only',
        });

        const bundleDirectory = join(registryRoot, 'activation-bundles');
        await writeFile(bundleDirectory, 'deliberately obstruct publication');
        const pending = await post(route + '/activate', approval);
        expect(pending.status).toBe(202);
        const intent = (await repository.readIntentByKey(approval.idempotencyKey))!;
        expect(intent).toBeTruthy();
        expect(await runtimeState()).toEqual(before);
        await unlink(bundleDirectory);

        const dispatch = { idempotencyKey: approval.idempotencyKey, bundleHash: intent.bundleHash };
        await publishActivationBundle({ registryRoot }, intent.bundleHash, intent.bundleBytes);
        const strictPost = (body: object, authorization?: string) => fetch(workerOrigin + '/internal/activate', {
          method: 'POST', headers: { ...headers, ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
        });
        expect((await strictPost(dispatch)).status).toBe(401);
        expect((await strictPost(dispatch, 'Bearer ' + sourceReadToken)).status).toBe(401);
        expect((await strictPost({ ...dispatch, bundleHash: '../../protected' }, 'Bearer ' + serviceToken)).status).toBe(400);
        expect((await strictPost({ ...dispatch, reviewer: intent.reviewer }, 'Bearer ' + serviceToken)).status).toBe(400);

        const forgedIssuer = {
          ...intent.bundle, request: { ...intent.request, idempotencyKey: 'forged-issuer' },
          authorityPolicy: { ...intent.bundle.authorityPolicy, issuerId: 'self-issued' },
        };
        forgedIssuer.hash = hashCanonical(forgedIssuer);
        const issuerBytes = Buffer.from(canonicalJson(forgedIssuer));
        await expect(publishActivationBundle({ registryRoot }, forgedIssuer.hash, issuerBytes))
          .rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
        await writeFile(join(bundleDirectory, forgedIssuer.hash + '.json'), issuerBytes, { mode: 0o600 });
        await expect(activationWorker.activate({
          idempotencyKey: forgedIssuer.request.idempotencyKey, bundleHash: forgedIssuer.hash,
        })).rejects.toMatchObject({ code: 'ACTIVATION_BUNDLE_MISMATCH' });
        const installed = ActivationTrustPolicyV1Schema.parse(JSON.parse(policyBytes.toString('utf8')));
        const [aEntry] = installed.entries.filter(entry => entry.selectedProfileHash === approval.expectedProfileHash);
        const bEntry = installed.entries.find(entry => entry.selectedProfileHash !== approval.expectedProfileHash)!;
        const resealFinancial = (draft: ActivationBundleV2) => {
          const { financialAttestation: proof } = draft;
          proof.reservation.hash = hashFinancialReservation(proof.reservation);
          proof.reportHash = hashFinancialReport(draft.verificationReport);
          proof.hash = hashFinancialAttestation(proof);
        };
        const forged = async (label: string, change: (draft: ActivationBundleV2) => void) => {
          const draft = structuredClone(intent.bundle);
          draft.request.idempotencyKey = label;
          change(draft);
          draft.hash = hashBundleV2(draft);
          await publishActivationBundle({ registryRoot }, draft.hash, Buffer.from(canonicalJson(draft)));
          return activationWorker.activate({ idempotencyKey: label, bundleHash: draft.hash });
        };
        const resealPlan = (draft: ActivationBundleV2) => {
          draft.previewPlan.hash = hashPlan(draft.previewPlan);
          draft.reviewPackage.previewPlanHash = draft.previewPlan.hash;
          draft.reviewPackage.hash = hashReviewPackage(draft.reviewPackage);
          draft.request.expectedPackageHash = draft.reviewPackage.hash;
          draft.bootstrapVerification.planHash = draft.previewPlan.hash;
          draft.bootstrapVerification.hash = hashBootstrapVerificationResult(draft.bootstrapVerification);
        };
        const malformed: [string, string, (draft: ActivationBundleV2) => void][] = [
          ['financial-eligible-self-hash', 'FINANCIAL_ATTESTATION_MISMATCH', draft => {
            draft.verificationReport.checks.pop();
            resealFinancial(draft);
          }],
          ['reordered-report', 'FINANCIAL_ATTESTATION_MISMATCH', draft => {
            draft.verificationReport.checks.reverse();
          }],
          ['wrong-capture-hash-kind', 'FINANCIAL_ATTESTATION_MISMATCH', draft => {
            const capture = draft.financialAttestation.reservation.capture;
            capture.snapshotObjectHash = capture.snapshotHash;
            resealFinancial(draft);
          }],
          ['partial-capture', 'ACTIVATION_BUNDLE_MISMATCH', draft => { draft.bootstrapEvents.pop(); }],
          ['partial-profile-set', 'ACTIVATION_BUNDLE_MISMATCH', draft => { draft.profiles = []; }],
          ['wrong-financial-build', 'ACTIVATION_POLICY_MISMATCH', draft => {
            const other = bEntry.financial.evaluatorBuildHash === draft.verificationReport.evaluatorBuildHash
              ? hashCanonical('another build') : bEntry.financial.evaluatorBuildHash;
            draft.verificationReport.evaluatorBuildHash = other;
            draft.financialAttestation.reservation.evaluatorBuildHash = other;
            resealFinancial(draft);
          }],
          ['wrong-bootstrap-descriptor', 'ACTIVATION_POLICY_MISMATCH', draft => {
            draft.bootstrapVerification.pin.fixtureHash = draft.financialAttestation.reservation.evidencePin.bundleHash;
            draft.bootstrapVerification.hash = hashBootstrapVerificationResult(draft.bootstrapVerification);
          }],
          ['unavailable-bootstrap', 'BOOTSTRAP_VERIFICATION_MISMATCH', draft => {
            const proof = draft.bootstrapVerification;
            proof.planHash = null;
            proof.passed = false;
            proof.assertions = proof.assertions.map(item => ({ ...item, status: 'unavailable', caseIds: [] }));
            proof.cases = proof.cases.map(item => ({ ...item, status: 'unavailable' }));
            proof.hash = hashBootstrapVerificationResult(proof);
          }],
          ['metadata-tampered', 'REVIEW_NOT_READY', draft => {
            const operation = draft.previewPlan.operations.find(item => item.op === 'ensure_customer')!;
            operation.record.displayName = 'Changed Name';
            resealPlan(draft);
          }],
          ['operation-order-tampered', 'REVIEW_NOT_READY', draft => {
            draft.previewPlan.operations.reverse();
            resealPlan(draft);
          }],
          ['ensure-only', 'REVIEW_NOT_READY', draft => {
            draft.previewPlan.operations = draft.previewPlan.operations.filter(item => !('identity' in item.record));
            draft.previewPlan.eventIds = [];
            resealPlan(draft);
          }],
          ['wrong-financial-pin', 'ACTIVATION_POLICY_MISMATCH', draft => {
            draft.financialAttestation.reservation.evidencePin.bundleHash = hashCanonical('different evidence pin');
            resealFinancial(draft);
          }],
          ['mixed-policy-tuple', 'ACTIVATION_POLICY_MISMATCH', draft => {
            draft.bootstrapVerification.pin = bEntry.bootstrapPin;
            draft.bootstrapVerification.hash = hashBootstrapVerificationResult(draft.bootstrapVerification);
          }],
          ['wrong-bootstrap-target', 'TARGET_STALE', draft => {
            draft.bootstrapVerification.binding.targetSnapshotHash = hashCanonical('different target');
            draft.bootstrapVerification.hash = hashBootstrapVerificationResult(draft.bootstrapVerification);
          }],
          ['lineage-tampered', 'REVIEW_NOT_READY', draft => {
            draft.previewPlan.lineage.reverse();
            resealPlan(draft);
          }],
        ];
        expect(aEntry).toBeTruthy();
        for (const [label, code, change] of malformed) {
          await expect(forged(label, change), label).rejects.toMatchObject({ code });
          expect(await runtimeState(), label).toEqual(before);
        }

        // The competing transaction stands in for a runtime writer with a different account alias.
        // It inserts the same original identity under the same global locks as A5 before releasing them.
        const original = intent.bundle.previewPlan.operations.find(operation => operation.op === 'insert_invoice')!.record;
        const alias = { ...original.scope, accountId: 'economic-alias' };
        const aliasRecord = { ...original, scope: alias, sourceEventId: 'alias-event', sourceRecordVersion: original.sourceRecordVersion + 1 };
        const aliasKey = [alias.accountId, alias.companyId, alias.sellerEntityId];
        const aliasLocked = Promise.withResolvers<void>();
        const releaseAlias = Promise.withResolvers<void>();
        const competingWriter = withTransaction(runtime, async client => {
          await client.query('INSERT INTO parent_scopes VALUES ($1,$2,$3)', aliasKey);
          await lockImportIdentities(client, [aliasRecord.identity], []);
          await client.query(
            `INSERT INTO parent_financial_records
             (account_id, company_id, seller_entity_id, source_ref, kind, source_record_id, record_id,
              source_record_version, event_id, canonical, digest) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [...aliasKey, aliasRecord.identity.sourceRef, aliasRecord.kind, aliasRecord.identity.recordId, aliasRecord.id,
              aliasRecord.sourceRecordVersion, aliasRecord.sourceEventId, canonicalJson(aliasRecord), hashCanonical(aliasRecord)],
          );
          aliasLocked.resolve();
          await releaseAlias.promise;
        });
        await Promise.race([aliasLocked.promise, competingWriter]);
        const awaitingEconomicLock = Promise.withResolvers<void>();
        const lockId = (await runtime.query<{ lock_id: string }>(
          'SELECT hashtextextended($1, 0) AS lock_id', [canonicalJson(['parent-economic', original.identity])],
        )).rows[0]!.lock_id;
        const otherLockId = (await runtime.query<{ lock_id: string }>(
          'SELECT hashtextextended($1, 0) AS lock_id', [canonicalJson(['parent-record', original.id])],
        )).rows[0]!.lock_id;
        duringQuery = (sql, values) => {
          if (sql.includes('pg_advisory_xact_lock') && [lockId, otherLockId].includes(String(values?.[0]))) awaitingEconomicLock.resolve();
        };
        const collidingWorker = activationWorker.activate(dispatch);
        try {
          await Promise.race([awaitingEconomicLock.promise, collidingWorker.then(() => { throw new Error('Worker skipped global lock'); })]);
          expect(await runtimeState()).toEqual(before);
        } finally {
          releaseAlias.resolve();
          await competingWriter;
          duringQuery = undefined;
        }
        await expect(collidingWorker).resolves.toEqual({ status: 'pending' });
        expect((await runtime.query('SELECT account_id FROM parent_financial_records')).rows).toEqual([{ account_id: alias.accountId }]);
        expect((await runtime.query('SELECT * FROM runtime_activation_imports')).rowCount).toBe(0);
        await clearRuntimeFixtures();
        expect(await runtimeState()).toEqual(before);

        const replayOnlyTarget = {
          ...projectBootstrapTarget({
            scope: original.scope, version: 0, asOf, invoices: [], payments: [], credits: [], allocations: [],
            reversals: [], customers: [], accounts: [], billingConfigurations: [],
          }, intent.bundle.previewPlan.operations),
          version: 1,
        };
        const replayScope = replayOnlyTarget.scope;
        const replayKey = [replayScope.accountId, replayScope.companyId, replayScope.sellerEntityId];
        const replayTargetHash = hashTargetSnapshot(replayOnlyTarget);
        await withTransaction(runtime, async client => {
          await client.query('INSERT INTO parent_scopes VALUES ($1,$2,$3)', replayKey);
          await client.query('INSERT INTO parent_snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [...replayKey, 1, replayTargetHash, asOf, canonicalJson(replayOnlyTarget), hashCanonical(replayOnlyTarget)]);
          await client.query('INSERT INTO parent_targets VALUES ($1,$2,$3,$4,$5)', [...replayKey, 1, replayTargetHash]);
        });
        const beforeReplayOnly = await runtimeState();
        await expect(forged('replay-only-target', draft => {
          draft.previewPlan.expectedTargetVersion = 1;
          draft.reviewPackage.expectedTargetVersion = 1;
          draft.request.expectedTargetVersion = 1;
          draft.bootstrapVerification.binding.expectedTargetVersion = 1;
          draft.bootstrapVerification.binding.targetSnapshotHash = replayTargetHash;
          resealPlan(draft);
        })).rejects.toMatchObject({ code: 'REVIEW_NOT_READY' });
        expect(await runtimeState()).toEqual(beforeReplayOnly);
        await clearRuntimeFixtures();
        expect(await runtimeState()).toEqual(before);

        // Deliberately reseal an altered capture under a test-only policy to reach the worker's independent
        // planner guard. The original issued A/B bundles remain the only successful subjects.
        const selectedProfile = intent.bundle.profiles.find(item => item.hash === intent.request.expectedProfileHash)!;
        for (const [label, change] of [
          ['selected-blocker', (event: RawSourceEvent) => { event.payload.amount = 'unsupported-money'; }],
          ['source-wide-blocker', (event: RawSourceEvent) => { delete event.rawIdentity.sourceAccountId; }],
        ] as const) {
          const draft = structuredClone(intent.bundle);
          draft.request.idempotencyKey = label;
          const selected = draft.bootstrapEvents.find(event => event.id === original.sourceEventId)!;
          change(selected);
          selected.contentHash = hashEvent(selected);
          const { manifest, snapshot, bootstrapEvents } = draft;
          const events = new Map(bootstrapEvents.map(event => [event.id, event]));
          for (const stream of manifest.streams) {
            stream.snapshotHash = streamContentHash(manifest.sourceRef, stream.streamId, stream.resumeAfter,
              stream.eventIds.map(id => events.get(id)!));
          }
          manifest.hash = hashManifest(manifest);
          snapshot.contentHash = aggregateHash(manifest, snapshot.eventIds, snapshot.evidenceIds);
          const capture = deriveFinancialCapture({
            artifact: draft.artifact, profiles: draft.profiles, manifest, snapshot, events: bootstrapEvents,
          });
          draft.financialAttestation.reservation.capture = capture;
          draft.verificationReport.manifestHash = manifest.hash;
          draft.reviewPackage.manifestHash = manifest.hash;
          Object.assign(draft.bootstrapVerification.binding, {
            manifestHash: manifest.hash, snapshotHash: capture.snapshotHash, eventsHash: capture.eventsHash,
          });
          resealPlan(draft);
          resealFinancial(draft);
          const synthetic = { ...installed, entries: [{ ...aEntry!, capture }] };
          const policy = { ...synthetic, hash: hashActivationTrustPolicy(synthetic) };
          draft.authorityPolicy.policyHash = policy.hash;
          draft.hash = hashBundleV2(draft);
          const blockerRoot = join(root, label);
          const blockerPolicy = join(blockerRoot, 'current.json');
          await publishRegisteredScopeMembers({ registryRoot: blockerRoot }, [{
            entry: { accountId: a.accountId, scope: selectedProfile.scope, profileHash: selectedProfile.hash,
              manifestId: manifest.id, manifestHash: manifest.hash, manifestAsOf: manifest.asOf },
            profile: selectedProfile, manifest,
          }]);
          await writeFile(blockerPolicy, canonicalJson(policy), { mode: 0o600 });
          await publishActivationBundle({ registryRoot: blockerRoot }, draft.hash, Buffer.from(canonicalJson(draft)));
          const blockerWorker = await launchWorker({
            db: instrumentedRuntime, clock: workerClock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
            featurePlugins: [composeWorkerActivation({
              registryRoot: blockerRoot, policyPath: blockerPolicy, sourceOrigin, sourceReadToken, sourceRefs: [a.sourceRef],
            })],
          }, 0);
          try {
            const address = blockerWorker.server.address();
            if (!address || typeof address === 'string') throw new Error('No blocker test listener');
            const client = createActivationWorkerClient('http://127.0.0.1:' + address.port, serviceToken);
            const previousAttempts = transactions.length;
            await expect(client.activate({ bundleHash: draft.hash, idempotencyKey: label })).rejects.toMatchObject({ code: 'REVIEW_NOT_READY' });
            expect(transactions).toHaveLength(previousAttempts + 1);
          } finally {
            await blockerWorker.close();
          }
          expect(await runtimeState()).toEqual(before);
        }

        const sourceObservation = (original: SourceReply) => SemanticPreflightSchema.parse(JSON.parse(original.body));
        const profile = intent.bundle.profiles.find(item => item.hash === intent.request.expectedProfileHash)!;
        const semanticKey = profile.scope.sellerEntityId + '/' + profile.sourceAccountIds[0];
        for (const [code, intercept] of [
          ['SOURCE_SEMANTICS_MISMATCH', (original: SourceReply) => {
            const observation = sourceObservation(original);
            return { status: 200, body: JSON.stringify({ ...observation, versions: { ...observation.versions, [semanticKey]: 'different' } }) };
          }],
          ['SOURCE_SEMANTICS_MISMATCH', (original: SourceReply) => {
            const observation = sourceObservation(original);
            delete observation.versions[semanticKey];
            return { status: 200, body: JSON.stringify(observation) };
          }],
          ['SOURCE_SEMANTICS_MISMATCH', (original: SourceReply) => {
            const observation = sourceObservation(original);
            return { status: 200, body: JSON.stringify({ ...observation, versions: { ...observation.versions, '*': 'unavailable' } }) };
          }],
          ['SOURCE_SEMANTICS_UNAVAILABLE', () => ({ status: 503, body: '' })],
          ['SOURCE_SEMANTICS_UNAVAILABLE', () => ({ status: 200, body: '{}' })],
          ['SOURCE_SEMANTICS_UNAVAILABLE', (original: SourceReply) => {
            const observation = sourceObservation(original);
            return { status: 200, body: JSON.stringify({ ...observation, sourceRef: 'different' }) };
          }],
        ] as const) {
          const count = transactions.length;
          sourceIntercept = async original => intercept(original);
          await expect(activationWorker.activate(dispatch)).rejects.toMatchObject({ code });
          expect(transactions).toHaveLength(count);
          expect(await runtimeState()).toEqual(before);
        }
        sourceIntercept = undefined;
        for (const write of [
          /INSERT INTO parent_scopes/, /INSERT INTO parent_snapshots/, /INSERT INTO parent_targets/,
          /INSERT INTO runtime_activation_imports/, /INSERT INTO parent_metadata/, /INSERT INTO parent_financial_records/,
          /INSERT INTO runtime_economic_outcomes/, /INSERT INTO runtime_deliveries/, /INSERT INTO runtime_delivery_outcomes/,
          /INSERT INTO runtime_import_lineage/, /UPDATE activity_counter/, /INSERT INTO activity_events/,
        ]) {
          fault = { write, states: ['23514'] };
          await expect(activationWorker.activate(dispatch), write.source).resolves.toEqual({ status: 'pending' });
          expect(fault.states, write.source).toEqual([]);
          expect(await runtimeState(), write.source).toEqual(before);
        }
        const emptyRecorded = {
          scope: original.scope, version: 0, asOf: '2026-09-30T00:00:00.000Z',
          invoices: [], payments: [], credits: [], allocations: [], reversals: [], customers: [], accounts: [], billingConfigurations: [],
        };
        const recordedHash = hashTargetSnapshot(emptyRecorded);
        await withTransaction(runtime, async client => {
          await client.query('INSERT INTO parent_scopes VALUES ($1,$2,$3)', replayKey);
          await client.query('INSERT INTO parent_snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [...replayKey, 0, recordedHash, emptyRecorded.asOf, canonicalJson(emptyRecorded), hashCanonical(emptyRecorded)]);
          await client.query('INSERT INTO parent_targets VALUES ($1,$2,$3,$4,$5)', [...replayKey, 0, recordedHash]);
        });
        const beforePointerUpdate = await runtimeState();
        fault = { write: /UPDATE parent_targets/, states: ['23514'] };
        await expect(activationWorker.activate(dispatch)).resolves.toEqual({ status: 'pending' });
        expect(fault.states).toEqual([]);
        expect(await runtimeState()).toEqual(beforePointerUpdate);
        await clearRuntimeFixtures();
        expect(await runtimeState()).toEqual(before);
        fault = { write: /INSERT INTO runtime_activation_imports/, states: ['40001', '40P01', '40001'] };
        transactions.length = 0;
        const readsBeforeRetries = sourceReads;
        await expect(activationWorker.activate(dispatch)).resolves.toEqual({ status: 'pending' });
        expect(fault.states).toEqual([]);
        expect(transactions).toHaveLength(3);
        expect(sourceReads).toBe(readsBeforeRetries + 1);
        expect(new Set(transactions.map(transaction => transaction.client)).size).toBe(1);
        for (const { sql } of transactions) {
          expect(sql.some(query => query.includes('pg_advisory_xact_lock'))).toBe(true);
          expect(sql.some(query => query.includes('FROM parent_targets'))).toBe(true);
          expect(sql.at(-1)).toBe('ROLLBACK');
        }
        expect(await runtimeState()).toEqual(before);
        const wrongPolicyEntered = Promise.withResolvers<void>();
        const releaseWrongPolicy = Promise.withResolvers<void>();
        const wrongPolicy = { ...installed, policyId: 'other-worker-policy' };
        const otherRuntime = new Proxy(runtime, {
          get(pool, property) {
            if (property === 'connect') return async () => {
              const client = await pool.connect();
              return new Proxy(client, {
                get(connection, member) {
                  if (member === 'query') return async (sql: string, values?: unknown[]) => {
                    const result = await connection.query(sql, values);
                    if (sql.includes('FROM runtime_activation_imports WHERE account_id') && !result.rowCount) {
                      wrongPolicyEntered.resolve();
                      await releaseWrongPolicy.promise;
                    }
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
        const otherService = createWorkerActivation({
          db: otherRuntime, clock, registered: scopeReader,
          policy: { ...wrongPolicy, hash: hashActivationTrustPolicy(wrongPolicy) },
          readBundle: hash => readActivationBundle({ registryRoot }, hash),
          async observe() { throw new Error('Invalid policy must stop before source observation'); },
        });
        const otherWorker = await launchWorker({
          db: runtime, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
          featurePlugins: [createWorkerActivationPlugin(otherService, serviceToken)],
        }, 0);
        const otherAddress = otherWorker.server.address();
        if (!otherAddress || typeof otherAddress === 'string') throw new Error('No competing worker listener');
        const otherClient = createActivationWorkerClient('http://127.0.0.1:' + otherAddress.port, serviceToken);
        const policyPeerResponse = otherClient.activate(dispatch);
        await Promise.race([wrongPolicyEntered.promise, policyPeerResponse.then(() => { throw new Error('Expected held inactive-scope read'); })]);
        fault = { write: /INSERT INTO runtime_activation_imports/, states: ['40001', '40P01'] };
        const preflightEntered = Promise.withResolvers<void>();
        const failPreflight = Promise.withResolvers<void>();
        sourceIntercept = async () => {
          preflightEntered.resolve();
          await failPreflight.promise;
          return { status: 503, body: '' };
        };
        const peerResponse = post(route + '/activate', approval, await reviewer());
        await preflightEntered.promise;
        const matchingPreflightEntered = Promise.withResolvers<void>();
        const finishMatchingPreflight = Promise.withResolvers<void>();
        sourceIntercept = async original => {
          matchingPreflightEntered.resolve();
          await finishMatchingPreflight.promise;
          return original;
        };
        const matchingPeerResponse = post(route + '/activate', approval, await reviewer());
        await matchingPreflightEntered.promise;
        sourceIntercept = undefined;
        let applied;
        try {
          applied = await post(route + '/activate', approval, await reviewer());
        } finally {
          failPreflight.resolve();
          finishMatchingPreflight.resolve();
          releaseWrongPolicy.resolve();
        }
        let policyReplay;
        try {
          policyReplay = await policyPeerResponse;
        } finally {
          await otherWorker.close();
        }
        const [peer, matchingPeer] = await Promise.all([peerResponse, matchingPeerResponse]);
        const responses = await Promise.all([applied, peer, matchingPeer].map(async response => {
          const json: unknown = await response.json();
          expect(response.status, JSON.stringify(json)).toBe(200);
          return ReceiptResponseSchema.parse(json);
        }));
        expect(fault.states).toEqual([]);
        fault = undefined;
        expect(responses.map(item => item.replayed).sort()).toEqual([false, true, true]);
        const [first] = responses;
        expect(new Set(responses.map(response => canonicalJson(response.receipt))).size).toBe(1);
        const receipt = first!.receipt;
        expect(receipt.committedAt).toBe(workerClock().toISOString());
        expect(policyReplay).toEqual({ status: 'receipt', result: { receipt, replayed: true } });
        expect(await repository.readWorkerReceiptObservation(intent.intentId)).toMatchObject({ receipt });
        expect((await db.query('SELECT * FROM activation_receipt_observations')).rowCount).toBe(1);

        const aParent = await fetch(controlOrigin + '/api/parent/' + a.accountId + '?asOf=' + encodeURIComponent(asOf), { headers });
        expect(aParent.status).toBe(200);
        const view = ParentViewSchema.parse(await aParent.json());
        expect(view.records).toMatchObject({ version: 1, asOf });
        expect(view.records.customers).toHaveLength(1);
        expect(view.records.accounts).toHaveLength(1);
        expect(view.records.billingConfigurations).toHaveLength(1);
        expect(view.balanceCents).toBe(receipt.afterBalanceCents);
        expect(view.balanceCents).toBe(80000);
        verifyOriginals(view.records, 'a');
        const state = async (accountId: string) => {
          const response = await fetch(controlOrigin + '/api/accounts/' + accountId + '/activation', { headers });
          expect(response.status).toBe(200);
          return ActivationStateV1Schema.parse(await response.json());
        };
        expect(await state(a.accountId)).toMatchObject({
          activation: {
            reviewerId: intent.reviewer.reviewerId, epoch: 1, status: 'active', approvedAt: workerClock().toISOString(),
            baselineCursors: intent.bundle.manifest.streams.map(({ streamId, resumeAfter }) => ({ streamId, resumeAfter })),
          },
          initialReceipt: receipt,
        });
        expect(await state(b.accountId)).toMatchObject({ activation: null, initialReceipt: null });
        expect((await runtime.query('SELECT * FROM runtime_activation_imports')).rowCount).toBe(1);
        const lineage = await runtime.query<{ canonical: string }>(
          'SELECT canonical FROM runtime_import_lineage WHERE account_id = $1 ORDER BY ordinal', [a.accountId],
        );
        expect(lineage.rows.map(row => row.canonical)).toEqual(intent.bundle.previewPlan.lineage.map(canonicalJson));
        expect((await runtime.query('SELECT * FROM runtime_delivery_outcomes')).rowCount).toBe(receipt.eventIds.length);
        expect((await runtime.query("SELECT * FROM activity_events WHERE event->>'type' = 'customer.activated'")).rowCount).toBe(1);

        const exactQuery = { scope: intent.bundle.reviewPackage.scope, expectedRequestHash: intent.requestHash, expectedBundleHash: intent.bundleHash };
        const stableState = await runtimeState();
        await expect(activationWorker.receipt('missing-key', exactQuery)).resolves.toEqual({ status: 'absent' });
        await expect(activationWorker.receipt(approval.idempotencyKey, {
          ...exactQuery, scope: { ...exactQuery.scope, accountId: b.accountId },
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        await expect(activationWorker.receipt(approval.idempotencyKey, {
          ...exactQuery, expectedBundleHash: hashCanonical('wrong bundle'),
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        expect(await runtimeState()).toEqual(stableState);
        await expect(activationWorker.receipt(approval.idempotencyKey, {
          ...exactQuery, expectedRequestHash: hashCanonical('wrong request'),
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
        await expect(activationWorker.activate({
          idempotencyKey: approval.idempotencyKey, bundleHash: hashCanonical('wrong bundle'),
        })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

        const nextDraft = { ...intent.bundle, request: { ...approval, idempotencyKey: 'new-key' } };
        const nextBundle = { ...nextDraft, hash: hashBundleV2(nextDraft) };
        await publishActivationBundle({ registryRoot }, nextBundle.hash, Buffer.from(canonicalJson(nextBundle)));
        await expect(activationWorker.activate({
          idempotencyKey: 'new-key', bundleHash: nextBundle.hash,
        })).rejects.toMatchObject({ code: 'ALREADY_ACTIVE' });

        const priorHead = (await repository.readHead(a.accountId))!;
        const { id: _id, hash: _hash, revision: _revision, ...fields } = priorHead.review;
        await repository.savePreparation(headToken(priorHead.review), {
          fields, fingerprint: hashCanonical('corrected head'), companion: priorHead.companion, sourceRef: priorHead.sourceRef,
        });
        const advanced = { ...view.records, version: 2, asOf: '2026-10-03T00:00:00.000Z' };
        await withTransaction(runtime, async client => {
          const { accountId, companyId, sellerEntityId } = advanced.scope;
          const values = [accountId, companyId, sellerEntityId];
          const hash = hashTargetSnapshot(advanced);
          await client.query('INSERT INTO parent_snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [...values, 2, hash, advanced.asOf, canonicalJson(advanced), hashCanonical(advanced)]);
          await client.query('UPDATE parent_targets SET target_version = $4, snapshot_hash = $5 WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3',
            [...values, 2, hash]);
        });
        const historic = await fetch(controlOrigin + '/api/parent/' + a.accountId +
          '?snapshotHash=' + view.snapshotHash + '&asOf=' + encodeURIComponent(asOf), { headers });
        expect(ParentViewSchema.parse(await historic.json())).toEqual(view);
        expect((await state(a.accountId)).initialReceipt).toEqual(receipt);

        const bRoute = '/api/review/' + b.accountId + '/activate';
        const bApproval = {
          reviewPackageId: preparedB.id, expectedPackageHash: preparedB.hash, expectedArtifactHash: preparedB.artifactHash,
          expectedProfileHash: preparedB.profileHash, expectedTargetVersion: preparedB.expectedTargetVersion,
          idempotencyKey: 'approve-b',
        };
        sourceIntercept = async () => ({ status: 503, body: '' });
        const bPending = await post(bRoute, bApproval);
        expect(bPending.status).toBe(503);
        expect(await bPending.json()).toMatchObject({ code: 'SOURCE_SEMANTICS_UNAVAILABLE' });
        const bIntent = (await repository.readIntentByKey(bApproval.idempotencyKey))!;
        expect(bIntent).toBeTruthy();
        const beforeRotation = await runtimeState();
        sourceIntercept = undefined;
        await worker.close();
        await unlink(policyPath);
        worker = await startWorker();
        const unavailablePolicy = await post(bRoute, bApproval);
        expect(unavailablePolicy.status).toBe(503);
        expect(await unavailablePolicy.json()).toMatchObject({ code: 'ACTIVATION_POLICY_UNAVAILABLE' });
        expect(await runtimeState()).toEqual(beforeRotation);
        await worker.close();
        const rotated = { ...installed, policyId: 'rotated-policy' };
        await writeFile(policyPath, canonicalJson({ ...rotated, hash: hashActivationTrustPolicy(rotated) }), { mode: 0o600 });
        worker = await startWorker();
        const bStale = await post(bRoute, bApproval);
        expect(bStale.status).toBe(409);
        expect(await bStale.json()).toMatchObject({ code: 'ACTIVATION_POLICY_MISMATCH' });
        expect(await runtimeState()).toEqual(beforeRotation);
        await worker.close();
        await unlink(policyPath);
        await writeFile(policyPath, policyBytes, { mode: 0o600 });
        worker = await startWorker();

        const arrivals = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
        const proceed = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
        let arrived = 0;
        sourceIntercept = async original => {
          const index = arrived++;
          arrivals[index]!.resolve();
          await proceed[index]!.promise;
          return original;
        };
        loseWorkerResponse = true;
        const bFirst = post(bRoute, bApproval);
        await arrivals[0]!.promise;
        const bSecond = post(bRoute, { ...bApproval, idempotencyKey: 'approve-b-race' }, await reviewer());
        try {
          await arrivals[1]!.promise;
          proceed[0]!.resolve();
          const lost = await bFirst;
          expect(lost.status).toBe(202);
          expect(lostReceipt?.replayed).toBe(false);
        } finally {
          proceed.forEach(gate => gate.resolve());
          sourceIntercept = undefined;
        }
        const bContender = await bSecond;
        expect(bContender.status).toBe(409);
        expect(await bContender.json()).toMatchObject({ code: 'ALREADY_ACTIVE' });
        expect(await repository.readWorkerReceiptObservation(bIntent.intentId)).toBeNull();
        const bState = await state(b.accountId);
        expect(bState.initialReceipt).toEqual(lostReceipt?.receipt);
        expect(bState.initialReceipt?.afterBalanceCents).toBe(0);
        expect(bState.initialReceipt?.targetRecordIds.length).toBeGreaterThan(0);
        const bParent = await fetch(controlOrigin + '/api/parent/' + b.accountId + '?asOf=' + encodeURIComponent(asOf), { headers });
        expect(bParent.status).toBe(200);
        verifyOriginals(ParentViewSchema.parse(await bParent.json()).records, 'b');
        expect(bIntent.bundle.bootstrapEvents.length).toBeGreaterThan(bState.initialReceipt!.eventIds.length);
        const unidentified = bIntent.bundle.bootstrapEvents.find(event => event.recordId.startsWith('pay-b:unresolved-'));
        expect(unidentified).toBeDefined();
        expect(bState.initialReceipt!.eventIds).not.toContain(unidentified!.id);
        const bDeliveries = await runtime.query<{ event_id: string }>(
          'SELECT event_id FROM runtime_delivery_outcomes WHERE account_id = $1 ORDER BY event_id', [b.accountId],
        );
        expect(bDeliveries.rows.map(row => row.event_id)).toEqual([...bState.initialReceipt!.eventIds].sort());
        const owner = createControlDb({ connectionString: pair.control.migrationUrl });
        try {
          await owner.query('ALTER TABLE activation_receipt_observations ADD CONSTRAINT deny_test_mirror CHECK (false) NOT VALID');
          expect((await post(bRoute, bApproval)).status).toBe(503);
          expect(await repository.readWorkerReceiptObservation(bIntent.intentId)).toBeNull();
          expect((await state(b.accountId)).initialReceipt).toEqual(lostReceipt?.receipt);
          await owner.query('ALTER TABLE activation_receipt_observations DROP CONSTRAINT deny_test_mirror');
        } finally {
          await owner.end();
        }

        const member = (await scopeReader.readSnapshot()).resolveRegisteredScope(a.accountId)!;
        const revisedProfile = { ...member.profile, version: member.profile.version + 1 };
        revisedProfile.hash = hashProfile(revisedProfile);
        await publishRegisteredScopeMembers({ registryRoot }, [{
          entry: { ...member.entry, profileHash: revisedProfile.hash }, profile: revisedProfile, manifest: member.manifest,
        }]);
        expect((await scopeReader.readSnapshot()).resolveRegisteredScope(a.accountId)?.profile.hash).toBe(revisedProfile.hash);
        const readsBeforeRecovery = sourceReads;
        await expect(activationWorker.receipt(approval.idempotencyKey, exactQuery)).resolves.toEqual({
          status: 'receipt', result: { receipt, replayed: true },
        });
        expect(sourceReads).toBe(readsBeforeRecovery);
        const after = await runtimeState();
        await control.close();
        await worker.close();
        await unlink(policyPath);
        await rm(registryRoot, { recursive: true });
        worker = await startWorker();
        await expect(activationWorker.receipt(approval.idempotencyKey, exactQuery)).resolves.toEqual({
          status: 'receipt', result: { receipt, replayed: true },
        });
        await expect(activationWorker.activate({
          idempotencyKey: approval.idempotencyKey, bundleHash: intent.bundleHash,
        })).resolves.toEqual({ status: 'receipt', result: { receipt, replayed: true } });
        control = await startControl();
        const recovered = await post(route + '/activate', approval, await reviewer());
        expect(recovered.status).toBe(200);
        expect(ReceiptResponseSchema.parse(await recovered.json())).toEqual({ receipt, replayed: true });
        const bRecovered = await post(bRoute, bApproval, await reviewer());
        expect(bRecovered.status).toBe(200);
        expect(ReceiptResponseSchema.parse(await bRecovered.json())).toEqual({ receipt: bState.initialReceipt, replayed: true });
        expect(await repository.readWorkerReceiptObservation(bIntent.intentId)).toMatchObject({ receipt: bState.initialReceipt });
        expect(await runtimeState()).toEqual(after);
        const reportPath = process.env.EAPR_A5_SAFE_TEST_REPORT_FILE;
        if (reportPath) {
          await writeFile(reportPath, JSON.stringify({
            policy: installed.hash, subjects: [intent.bundle, bIntent.bundle].map(bundle => ({
              artifact: bundle.artifact.hash, bundle: bundle.hash, manifest: bundle.manifest.hash,
              financialBuild: bundle.financialAttestation.reservation.evaluatorBuildHash,
              financialEvidence: bundle.financialAttestation.reservation.evidencePin.bundleHash,
              financialReport: bundle.financialAttestation.reportHash, financialProof: bundle.financialAttestation.hash,
              bootstrapBuild: bundle.bootstrapVerification.pin.evaluatorBuildHash,
              bootstrapSubjectBuild: bundle.bootstrapVerification.pin.subjectBuildHash,
              bootstrapDescriptor: bundle.bootstrapVerification.pin.fixtureHash,
              bootstrapProof: bundle.bootstrapVerification.hash,
            })),
          }, null, 2), { mode: 0o600 });
        }
      } finally {
        await control?.close();
        await worker.close();
        const closed = [once(sourceProxy, 'close'), once(workerProxy, 'close')];
        sourceProxy.close();
        workerProxy.close();
        await Promise.all(closed);
      }
    } finally {
      await Promise.all([db.end(), runtime.end()]);
    }
  } finally {
    await dropTest(namespace);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
