import { request as httpRequest } from 'node:http';
import { mkdtemp, realpath, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import {
  canonicalJson, hashCanonical, hashPlan, hashReviewPackage, hashTargetSnapshot, targetRecordId,
  LocalSessionResponseSchema, ReviewDetailsV1Schema, ReviewPackageSchema, type MutationPlan, type ParentView,
  type ReviewPackage, type TargetState,
} from '@eapr/contracts';
import { deriveFinancialCapture, type FinancialCaptureV1 } from '@eapr/evaluator/financial-attestation-verify';
import { createSourceService, readCurrentSemantics } from '@eapr/sources';
import { projectStoredParentView } from '@eapr/parent/snapshots';
import { withTransaction } from '@eapr/storage/transaction';
import { aggregateHash } from '../../packages/sources/src/dossier.js';
import { createScenarioAdmin } from '../../packages/sources/src/scenario-admin.js';
import { composeActivationReview } from '../../apps/control/src/activation-composition.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { buildControl } from '../../apps/control/src/server.js';
import { createReviewRepository } from '../../apps/control/src/review-repository.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { launchWorker } from '../../apps/worker/src/server.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { migrate, migrationIdentities, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, localPort, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { activationCutover, issueActivationProofs } from '../fixtures/activation-proof.js';
import { testNamespace } from '../fixtures/harness.js';

type SavedCompanion = {
  authorityContent: {
    fields: Omit<ReviewPackage, 'id' | 'revision' | 'hash'>;
    capture: FinancialCaptureV1;
    captureAttestation: ReturnType<typeof deriveFinancialCapture>;
    parentView: ParentView;
    recordedTargetHash: string;
    plannerTarget: TargetState;
    plannerTargetHash: string;
    plan: MutationPlan;
    planBytesHash: string;
    observedPlanBytesHash: string;
  } & Record<string, unknown>;
  authorityDigest: string;
  observation: unknown;
};

async function installParent(runtime: Pool, state: TargetState) {
  const { accountId, companyId, sellerEntityId } = state.scope;
  const scope = [accountId, companyId, sellerEntityId];
  const snapshotHash = hashTargetSnapshot(state);
  await withTransaction(runtime, async client => {
    await client.query('INSERT INTO parent_scopes VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', scope);
    await client.query('INSERT INTO parent_snapshots VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [...scope, state.version, snapshotHash, state.asOf, canonicalJson(state), hashCanonical(state)]);
    await client.query(`INSERT INTO parent_targets VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (account_id)
      DO UPDATE SET target_version = EXCLUDED.target_version, snapshot_hash = EXCLUDED.snapshot_hash`,
    [...scope, state.version, snapshotHash]);
  });
}

async function rowsFingerprint(db: Pool) {
  const { rows } = await db.query<{ name: string }>(
    "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return hashCanonical(await Promise.all(rows.map(async ({ name }) => [name, (await db.query(
    'SELECT to_jsonb(t) FROM public.' + name + ' t ORDER BY to_jsonb(t)',
  )).rows])));
}

test('composed exact-package details preserve prepared evidence, authorization and immutable history', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-review-details-'));
  const namespace = testNamespace('reviewdetail');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const owner = createControlDb({ connectionString: pair.control.migrationUrl });
    const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    try {
      const migrations = readMigrationCatalog();
      await migrate(pair, migrationStreams, migrations);
      const { a, b, candidates, dependencies, registryRoot, bootstrapRoots, policyPath, selectionPath } =
        await issueActivationProofs(root, db);
      const clock = () => new Date();
      const serviceToken = 'review-details-service-token';
      const workerPort = localPort('EAPR_WORKER_PORT', 3002);
      const worker = await launchWorker({
        db: runtime, clock, serviceToken, expectedMigrations: migrationIdentities(migrations.runtime),
        featurePlugins: [composeWorkerParentReads(registryRoot)],
      }, workerPort);
      const webOrigin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
      const parent = createParentReadClient('http://127.0.0.1:' + workerPort, serviceToken, registryRoot);
      const readParent = vi.fn(parent.readParent);
      const readActivation = vi.fn(parent.readActivation);
      const getCandidate = vi.fn(candidates.getCandidate);
      const observe = vi.fn((sourceRef: string) => readCurrentSemantics({ db, clock }, localSourceCatalog, sourceRef));
      let revokeSource = false;
      async function compose() {
        const sessions = createLocalSessionService({
          webOrigin, reviewerId: 'review-details-tester', allowedSourceRefs: [a.sourceRef, b.sourceRef],
          allowedAccountIds: [a.accountId, b.accountId],
        });
        const authorize: typeof sessions.authorizeReviewer = async (...args) => {
          const grants = await sessions.authorizeReviewer(...args);
          return revokeSource ? { ...grants, allowedSourceRefs: [b.sourceRef] } : grants;
        };
        const service = createSourceService(dependencies, localSourceCatalog);
        const plugins = await composeActivationReview({ dependencies, service, catalog: localSourceCatalog }, {
          registryRoot, bootstrapRoots, policyPath, selectionPath, parent: { ...parent, readParent, readActivation },
          candidates: { getCandidate }, observe, authorize,
        });
        return buildControl({
          db, clock, workerClient: { getHealth: async () => { throw new Error('Unexpected health check'); } },
          expectedMigrations: migrationIdentities(migrations.control), featurePlugins: [sessions.plugin, ...plugins],
        });
      }
      let app: Awaited<ReturnType<typeof compose>> | undefined;
      try {
        app = await compose();
        const session = await app.inject({
          method: 'POST', url: '/api/local-session', headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {},
        });
        expect(session.statusCode).toBe(200);
        const headers = { cookie: session.cookies[0]!.name + '=' + session.cookies[0]!.value, origin: webOrigin };
        const prepare = async (accountId: string) => {
          const response = await app!.inject({ method: 'POST', url: '/api/review/' + accountId + '/prepare',
            headers: { ...headers, 'x-eapr-csrf': LocalSessionResponseSchema.parse(session.json()).csrfToken }, payload: {} });
          expect(response.statusCode).toBe(200);
          return ReviewPackageSchema.parse(response.json());
        };
        const first = await prepare(a.accountId);
        const path = (accountId: string, hash: string) => '/api/review/' + accountId + '/packages/' + hash + '/details';
        const url = path(a.accountId, first.hash);
        const read = () => app!.inject({ method: 'GET', url, headers });
        const response = await read();
        expect(response.statusCode).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        const details = ReviewDetailsV1Schema.parse(response.json());
        expect(details).toMatchObject({
          reviewPackage: first, sourceRef: a.sourceRef, parentWrites: 0,
          artifact: { hash: first.artifactHash }, profile: { hash: first.profileHash },
          capture: { manifestHash: first.manifestHash },
          baseline: { version: 0, asOf: activationCutover, balanceCents: 0 },
          // July and August are paid in full. September is 300,000 minus a 200,000 payment
          // and 20,000 credit, both explicitly allocated.
          proposedImport: { hash: first.previewPlanHash, asOf: activationCutover, expectedBalanceCents: 80000 },
          futureScope: { limits: { maxTransactionCents: 5000000, maxRecordsPerCycle: 1000 }, runtimeModelCalls: 'forbidden' },
        });
        const repository = createReviewRepository(db, clock);
        const saved = (await repository.readHead(a.accountId))!;
        const companion = saved.companion as SavedCompanion;
        const { capture, plan, parentView } = companion.authorityContent;
        expect(details.proposedImport).toEqual(plan);
        expect(details.baseline).toEqual(parentView);
        const citation = capture.profiles[0]!.bootstrap!.customer.evidenceRefs[0]!;
        expect(details.evidence).toEqual({ snapshotId: capture.snapshot.id, referencedEvidenceIds: [citation] });
        expect(capture.snapshot.evidenceIds).toContain(citation);
        expect(capture.snapshot.evidenceIds.length).toBeGreaterThan(1);
        expect(details.futureScope.allowedKinds).toEqual([...capture.artifact.normalizedPlan.allowedKinds].sort());
        expect(details.futureScope.validators).toEqual([...capture.artifact.normalizedPlan.validators].sort());

        // Insert isolated owner-side copies. Keep the genuine row and head intact.
        let fixtureRevision = 10;
        async function copy(mutator: (draft: SavedCompanion) => void, digestMode: 'normal' | 'outer' | 'invalid' = 'normal') {
          const draft = structuredClone(companion);
          mutator(draft);
          if (digestMode === 'normal') draft.authorityDigest = hashCanonical(draft.authorityContent);
          const { id: _id, hash: _hash, revision: _revision, ...fields } = first;
          const revision = fixtureRevision++;
          const input = { ...fields, ...draft.authorityContent.fields, id: 'isolated-details-copy-' + revision, revision };
          const review = { ...input, hash: hashReviewPackage(input) };
          await owner.query(`INSERT INTO prepared_reviews
            (id, account_id, source_ref, revision, package_hash, fingerprint, package_canonical, companion_canonical, companion_digest)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
            review.id, a.accountId, a.sourceRef, review.revision, review.hash, hashCanonical(review.id),
            canonicalJson(review), canonicalJson(draft), digestMode === 'invalid' ? '0'.repeat(64) : hashCanonical(draft),
          ]);
          return review;
        }

        const sentinel = 'DO-NOT-DISCLOSE-DETAILS';
        const protectedCopy = await copy(({ authorityContent }) => {
          authorityContent.attestation = { proofId: sentinel + '-financial', privatePath: '/private/' + sentinel };
          authorityContent.bootstrapVerification = { proofId: sentinel + '-bootstrap', pinHash: sentinel + '-pin' };
          authorityContent.authorityPolicy = { id: sentinel + '-policy', policyHash: sentinel + '-hash' };
          authorityContent.entry = { holdout: [sentinel + '-holdout'] };
        });

        function changePlan(draft: SavedCompanion, change: Partial<MutationPlan>, bind = true) {
          const authority = draft.authorityContent;
          const plan = { ...authority.plan, ...change };
          plan.hash = hashPlan(plan);
          authority.plan = plan;
          authority.planBytesHash = authority.observedPlanBytesHash = hashCanonical(plan);
          if (bind) authority.fields.previewPlanHash = plan.hash;
        }

        const invalidCopies = [
          ['companion digest', await copy(() => {}, 'invalid')],
          ['authority digest', await copy(draft => { draft.authorityContent.recordedTargetHash = '1'.repeat(64); }, 'outer')],
          ['authority fields', await copy(draft => { draft.authorityContent.fields.ready = false; }, 'outer')],
          ['artifact ID', await copy(draft => { draft.authorityContent.capture.artifact.id = 'foreign-artifact'; })],
          ['profile hash', await copy(draft => { draft.authorityContent.capture.profiles[0]!.hash = '1'.repeat(64); })],
          ['saved plan hash', await copy(draft => changePlan(draft, { expectedBalanceCents: 1 }, false))],
          ['recorded baseline hash', await copy(draft => {
            draft.authorityContent.parentView.records.asOf = '2026-10-02T00:00:00.000Z';
          })],
          ['planner target equality', await copy(draft => {
            draft.authorityContent.plannerTarget.asOf = '2026-10-02T00:00:00.000Z';
            draft.authorityContent.plannerTargetHash = hashTargetSnapshot(draft.authorityContent.plannerTarget);
          })],
          ['scope', await copy(draft => changePlan(draft, { scope: { ...first.scope, sellerEntityId: 'foreign' } }))],
          ['version', await copy(draft => changePlan(draft, { expectedTargetVersion: 1 }))],
          ['evaluation time', await copy(draft => changePlan(draft, { asOf: '2026-10-02T00:00:00.000Z' }))],
          ['lineage range', await copy(draft => changePlan(draft, {
            lineage: [{ ...plan.lineage[0]!, operationIndex: plan.operations.length }, ...plan.lineage.slice(1)],
          }))],
          ['source event membership', await copy(draft => changePlan(draft, {
            lineage: [{ ...plan.lineage[0]!, sourceEventIds: ['absent-event'] }, ...plan.lineage.slice(1)],
          }))],
          ['snapshot evidence membership', await copy(({ authorityContent }) => {
            const { capture } = authorityContent;
            const { snapshot, manifest } = capture;
            snapshot.evidenceIds = snapshot.evidenceIds.filter(id => id !== citation);
            snapshot.contentHash = aggregateHash(manifest, snapshot.eventIds, snapshot.evidenceIds);
            authorityContent.captureAttestation = deriveFinancialCapture(capture);
          })],
        ] as const;

        // A4 accepts an empty versioned baseline. Its recorded time differs from its evaluation time.
        const emptyVersionedParent = { ...parentView.records, version: 1, asOf: '2026-09-30T00:00:00.000Z' };
        await installParent(runtime, emptyVersionedParent);
        const second = await prepare(a.accountId);
        expect(second.revision).toBe(first.revision + 1);
        const newer = ReviewDetailsV1Schema.parse((await app.inject({ url: path(a.accountId, second.hash), headers })).json());
        expect(newer.reviewPackage).toEqual(second);
        expect(newer.baseline).toMatchObject({ asOf: activationCutover, records: emptyVersionedParent, version: 1, balanceCents: 0 });
        expect(newer.proposedImport.expectedBalanceCents).toBe(80000);
        expect((await read()).body).toBe(response.body);

        const invoice = plan.operations.find(operation => operation.op === 'insert_invoice')!.record;
        const payment = plan.operations.find(operation => operation.op === 'insert_payment')!.record;
        const allocation = plan.operations.find(operation => operation.op === 'add_allocation')!.record;
        const parentInvoiceId = 'parent-only-invoice';
        const parentPaymentId = 'parent-only-payment';
        const { amountCents: _amount, ...paymentEnvelope } = payment;
        const identity = { ...payment.identity, kind: 'reversal' as const, recordId: 'parent-only-reversal' };
        const distinctParentRecord = <T extends typeof invoice | typeof payment | typeof allocation>(record: T, recordId: string): T => {
          const distinctIdentity = { ...record.identity, recordId };
          return { ...record, id: targetRecordId(distinctIdentity), identity: distinctIdentity, sourceEventId: 'event:' + recordId };
        };
        const changedParent: TargetState = {
          ...emptyVersionedParent, version: 2, asOf: '2026-11-09T00:00:00.000Z',
          invoices: [distinctParentRecord(invoice, parentInvoiceId)],
          payments: [distinctParentRecord(payment, parentPaymentId)],
          allocations: [{
            ...distinctParentRecord(allocation, 'parent-only-allocation'), fundingRecordId: parentPaymentId, invoiceRecordId: parentInvoiceId,
          }],
          reversals: [{
            ...paymentEnvelope, id: targetRecordId(identity), identity, kind: 'reversal',
            reversedKind: 'payment', reversedRecordId: parentPaymentId,
            effectiveAt: '2026-10-02T00:00:00.000Z', sourceEventId: 'event:parent-only-reversal',
          }],
        };
        await installParent(runtime, changedParent);
        // A projection-only fixture exercises a nonempty baseline. A4 does not issue
        // bootstrap proof for this target. Move the full reversal to cutover so
        // the parent's 300,000 reopens in addition to the source's 80,000.
        const reversalCopy = await copy(draft => {
          const authority = draft.authorityContent;
          const records = {
            ...changedParent, reversals: [{ ...changedParent.reversals[0]!, effectiveAt: activationCutover }],
          };
          authority.parentView = projectStoredParentView(records, activationCutover);
          authority.recordedTargetHash = authority.parentView.snapshotHash;
          authority.plannerTarget = { ...records, asOf: activationCutover };
          authority.plannerTargetHash = hashTargetSnapshot(authority.plannerTarget);
          authority.fields.expectedTargetVersion = records.version;
          changePlan(draft, { expectedTargetVersion: records.version, expectedBalanceCents: 380000 });
        });
        const grants = LocalSessionResponseSchema.parse(session.json());
        expect((await parent.readParent(a.accountId, { asOf: activationCutover }, grants)).balanceCents).toBe(0);
        expect((await parent.readParent(a.accountId, { asOf: '2026-10-02T00:00:00.000Z' }, grants)).balanceCents).toBe(300000);
        const operator = createScenarioAdmin(dependencies, { DEMO_OPERATOR_ENABLED: 'true', DEMO_OPERATOR_TOKEN: 'test-operator' });
        await operator.semanticChangeA('test-operator', {
          id: 'details-drift', accountId: details.profile.sourceAccountIds[0]!, revision: 'sem-a-details-drift',
          observedAt: '2026-11-09T00:00:00.000Z', effectiveDate: '2026-11-09',
        });
        const latest = await readCurrentSemantics({ db, clock }, localSourceCatalog, a.sourceRef);
        expect(Object.values(latest.versions)).toContain('sem-a-details-drift');
        await unlink(policyPath);
        await app.close();
        app = await compose();
        const renewed = await app.inject({ method: 'POST', url: '/api/local-session',
          headers: { origin: webOrigin, 'x-eapr-local-ui': '1' }, payload: {} });
        const newCookie = renewed.cookies[0]!;
        const current = { ...headers, cookie: newCookie.name + '=' + newCookie.value };

        const before = await Promise.all([rowsFingerprint(owner), rowsFingerprint(runtime)]);
        const calls = [readParent, readActivation, getCandidate, observe].map(spy => spy.mock.calls.length);
        async function checkError(error: Awaited<ReturnType<typeof read>>, status: number, code: string, label?: string) {
          expect(error.statusCode, label).toBe(status);
          expect(error.headers['cache-control']).toBe('no-store');
          expect(error.json()).toEqual({
            code, message: 'Review request could not be completed.', correlationId: expect.any(String), diagnostics: [],
          });
        }
        expect((await app.inject({ url, headers: current })).body).toBe(response.body);
        expect(ReviewDetailsV1Schema.parse((await app.inject({
          url: path(a.accountId, second.hash), headers: current,
        })).json())).toEqual(newer);
        const projectedCopy = await app.inject({ url: path(a.accountId, protectedCopy.hash), headers: current });
        expect(projectedCopy.statusCode).toBe(200);
        expect(projectedCopy.body).not.toContain(sentinel);
        // Strict schema traversal and deep equality expose additions anywhere in the returned graph.
        expect(projectedCopy.json()).toEqual({ ...details, reviewPackage: protectedCopy });
        expect(ReviewDetailsV1Schema.safeParse(projectedCopy.json()).success).toBe(true);
        const reversalProjection = ReviewDetailsV1Schema.parse((await app.inject({
          url: path(a.accountId, reversalCopy.hash), headers: current,
        })).json());
        expect(reversalProjection.baseline).toMatchObject({
          asOf: activationCutover, balanceCents: 300000,
          records: { asOf: changedParent.asOf, reversals: [{ effectiveAt: activationCutover }] },
        });
        expect(reversalProjection.proposedImport).toMatchObject({ asOf: activationCutover, expectedBalanceCents: 380000 });
        for (const [label, corrupt] of invalidCopies) {
          await checkError(await app.inject({ url: path(a.accountId, corrupt.hash), headers: current }),
            503, 'REVIEW_DETAILS_UNAVAILABLE', label);
        }
        await checkError(await read(), 401, 'LOCAL_SESSION_REQUIRED');
        await checkError(await app.inject({ url }), 401, 'LOCAL_SESSION_REQUIRED');
        await checkError(await app.inject({ url, headers: { ...current, authorization: 'Bearer test' } }), 403, 'LOCAL_SESSION_FORBIDDEN');
        await checkError(await app.inject({ url, headers: { ...current, 'x-eapr-task-token': 'task' } }), 403, 'LOCAL_SESSION_FORBIDDEN');
        await checkError(await app.inject({ url: path('other', first.hash), headers: current }), 403, 'REVIEW_FORBIDDEN');
        await checkError(await app.inject({ url: path(b.accountId, first.hash), headers: current }), 404, 'REVIEW_NOT_FOUND');
        await checkError(await app.inject({ url: path(a.accountId, 'f'.repeat(64)), headers: current }), 404, 'REVIEW_NOT_FOUND');
        for (const invalid of [
          path('bad%2Fid', first.hash), path('%C0%AF', first.hash), path('x'.repeat(161), first.hash),
          path(a.accountId, 'bad'), path(a.accountId, '%C0%AF'), path(a.accountId, 'a'.repeat(161)), url + '?accountId=other',
        ]) {
          await checkError(await app.inject({ url: invalid, headers: current }), 400, 'REVIEW_REQUEST_INVALID', invalid);
        }
        const port = localPort('EAPR_CONTROL_PORT', 3001);
        await app.listen({ port, host: '127.0.0.1' });
        await new Promise<void>((resolve, reject) => {
          const request = httpRequest({ host: '127.0.0.1', port, path: url + '?', headers: current }, response => {
            try {
              expect(response.statusCode).toBe(400);
              expect(response.headers['cache-control']).toBe('no-store');
              response.resume();
              response.on('end', resolve);
            } catch (error) { reject(error); }
          });
          request.on('error', reject);
          request.end();
        });
        await checkError(await app.inject({ url, method: 'GET', headers: current, payload: {} }), 400, 'REVIEW_REQUEST_INVALID');
        revokeSource = true;
        await checkError(await app.inject({ url, headers: current }), 403, 'REVIEW_FORBIDDEN');
        revokeSource = false;
        expect(await Promise.all([rowsFingerprint(owner), rowsFingerprint(runtime)])).toEqual(before);
        expect([readParent, readActivation, getCandidate, observe].map(spy => spy.mock.calls.length)).toEqual(calls);
      } finally {
        await app?.close();
        await worker.close();
      }
    } finally {
      await Promise.all([owner.end(), db.end(), runtime.end()]);
    }
  } finally {
    await dropTest(namespace);
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
