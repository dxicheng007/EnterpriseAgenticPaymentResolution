import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, type Pool, type PoolClient } from 'pg';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, hashBytes, hashCanonical } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import {
  createDiscoveryVerification, discoveryVerificationSubject, type DiscoveryVerificationOwnerGate,
  type DiscoveryVerificationInput, type GateOutcome, type PersistedBinding, type RequestIdentity,
} from '@eapr/evaluator/discovery-verification';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createSourceService, readManifest } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { createRuntimeDb } from '../../packages/storage/src/runtime-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { testNamespace } from '../fixtures/harness.js';

async function seedSteps(db: Pool, runId: string, keys: string[]) {
  const taskId = runId + '-task';
  const investigationId = runId + '-investigation';
  const proposalStep = runId + '-proposal-step';
  const proposalId = runId + '-proposal';
  await db.query(
    `INSERT INTO discovery_runs (id,reviewer_id,start_key,start_hash,start_response,binding,mode,model_id,policy,grants)
     VALUES ($1,'reviewer',$1,'hash','{}','{}','scripted','model','{}','{}')`, [runId],
  );
  await db.query('INSERT INTO discovery_investigations (run_id,id) VALUES ($1,$2)', [runId, investigationId]);
  await db.query(
    `INSERT INTO discovery_tasks (run_id,id,investigation_id,role,question,grants)
     VALUES ($1,$2,$3,'connector','question','{}')`, [runId, taskId, investigationId],
  );
  for (const [index, key] of [proposalStep, ...keys].entries()) {
    const dispatchId = key + '-dispatch';
    await db.query(
      `INSERT INTO discovery_dispatches (id,run_id,task_id,attempt,generation,task_revision,request_hash)
       VALUES ($1,$2,$3,$4,1,1,'hash')`, [dispatchId, runId, taskId, index + 1],
    );
    await db.query(
      `INSERT INTO discovery_tool_steps (id,dispatch_id,run_id,task_id,native_id,ordinal,name,input_hash,arguments,generation)
       VALUES ($1,$2,$3,$4,'reused-provider-id',0,$5,'hash','{}',1)`,
      [key, dispatchId, runId, taskId, index === 0 ? 'propose' : 'requestVerification'],
    );
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO discovery_proposal_identities VALUES ($1,$2,1)', [runId, proposalId]);
    await client.query(
      `INSERT INTO discovery_proposal_revisions VALUES ($1,$2,1,$3,$4,'{}','{}',$5)`,
      [runId, proposalId, taskId, proposalStep, hashCanonical('proposal')],
    );
    await client.query(`INSERT INTO discovery_proposal_assessments VALUES ($1,$2,1,1,1,'{}')`, [runId, proposalId]);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}

type Phase = 'lookup' | 'admit' | 'recover';
type Fault = 'rollback' | 'lost_ack' | 'before_claim';
type HarnessHooks = {
  fault?: (phase: Phase) => Fault | undefined;
  afterLookup?: () => Promise<void>;
  afterAdmissionCommit?: () => Promise<void>;
  afterClaimCommit?: () => void | Promise<void>;
  beforeCommit?: (phase: Phase) => Promise<void>;
  authorizedAccount?: (accountId: string) => boolean;
};

/** Test-owned transactions exercise producer SQL only. The actual supervisor belongs to Gate J. */
function testGate(db: Pool, expected: DiscoveryVerificationInput, hooks: HarnessHooks = {}): DiscoveryVerificationOwnerGate {
  const subject = discoveryVerificationSubject(expected.candidate, expected.task);
  async function transact<T>(phase: Phase, input: RequestIdentity, operation: (client: PoolClient) => Promise<T>): Promise<GateOutcome<T>> {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const lock = phase === 'lookup' ? '' : ' FOR UPDATE';
      const step = await client.query(
        `SELECT id FROM discovery_tool_steps WHERE id = $1 AND run_id = $2 AND task_id = $3` + lock,
        [input.requestKey, input.runId, input.taskId],
      );
      if (!step.rowCount || input.runId !== expected.task.runId ||
          !(hooks.authorizedAccount?.(input.accountId) ?? input.accountId === expected.task.accountId)) {
        await client.query('ROLLBACK');
        return { kind: 'denied', code: 'DISCOVERY_FORBIDDEN' };
      }
      const fault = hooks.fault?.(phase);
      if (fault === 'before_claim') {
        await client.query('ROLLBACK');
        return { kind: 'owner_lost', commit: 'not_committed' };
      }
      const value = await operation(client);
      await hooks.beforeCommit?.(phase);
      if (fault === 'rollback') {
        await client.query('ROLLBACK');
        return { kind: 'owner_lost', commit: 'not_committed' };
      }
      await client.query('COMMIT');
      if (phase === 'recover') await hooks.afterClaimCommit?.();
      if (phase === 'admit') await hooks.afterAdmissionCommit?.();
      if (phase === 'lookup') await hooks.afterLookup?.();
      if (fault === 'lost_ack') return { kind: 'owner_lost', commit: 'unknown' };
      return { kind: 'committed', value };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const original = (input: RequestIdentity) => ({
    ...input, ...subject, dispatchId: input.requestKey + '-dispatch', admittedGeneration: 1,
    admittedTaskRevision: 1, proposalId: input.runId + '-proposal', proposalRevision: 1, assessmentRevision: 1,
  });
  return {
    lookup: (input, sql) => transact('lookup', input, client => sql(client, input)),
    admit: (input, sql) => transact('admit', input, client => sql(client, original(input))),
    recoverQueued: (input, sql) => transact('recover', input, async client => {
      const { rows: [row] } = await client.query<{ job_id: string; request_hash: string }>(
        'SELECT job_id,request_hash FROM discovery_verification_requests WHERE request_key = $1', [input.requestKey],
      );
      if (!row) throw new Error('Test gate expected an admitted request');
      const binding: PersistedBinding = { ...original(input), jobId: row.job_id, requestHash: row.request_hash };
      return sql(client, binding);
    }),
  };
}

function barrier() {
  let arrive!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { arrive = resolve; });
  const resumed = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, wait: async () => { arrive(); await resumed; } };
}

function rendezvous(participants: number) {
  const meeting = barrier();
  let arrivals = 0;
  return () => {
    arrivals++;
    if (arrivals === participants) meeting.release();
    return meeting.wait();
  };
}

async function counts(db: Pool, runId: string) {
  const { rows: [row] } = await db.query(
    `SELECT (SELECT count(*)::int FROM discovery_verification_requests WHERE run_id = $1) AS mappings,
       (SELECT coalesce(sum(attempts),0)::int FROM verification_attempt_budgets WHERE run_id = $1) AS attempts,
       count(*) FILTER (WHERE j.state = 'queued')::int AS queued,
       count(*) FILTER (WHERE j.state = 'running')::int AS running,
       count(*) FILTER (WHERE j.state = 'completed')::int AS completed,
       count(*) FILTER (WHERE j.state = 'failed')::int AS failed,
       count(r.job_id)::int AS reservations, count(v.job_id)::int AS reports, count(a.job_id)::int AS attestations
     FROM verification_jobs j
       LEFT JOIN financial_verification_reservations r ON r.job_id = j.id
       LEFT JOIN verification_reports v ON v.job_id = j.id
       LEFT JOIN financial_verification_attestations a ON a.job_id = j.id
     WHERE j.task_run_id = $1`, [runId],
  );
  return row;
}

const zero = { mappings: 0, attempts: 0, queued: 0, running: 0, completed: 0, failed: 0,
  reservations: 0, reports: 0, attestations: 0 };
const queued = { ...zero, mappings: 1, attempts: 1, queued: 1, reservations: 1 };
const running = { ...queued, queued: 0, running: 1 };
const failed = { ...running, running: 0, failed: 1 };
const completed = { ...running, running: 0, completed: 1, reports: 1, attestations: 1 };

test('persists a keyed request and completes a real protected attestation on the original bytes', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-discovery-verify-'));
  const namespace = testNamespace('discoverver');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const runtime = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    const admin = new Client({ connectionString: pair.control.migrationUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog({ throughVersion: 8 }));
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const migration = await readFile(new URL('../../db/control/009_discovery_verification_requests.sql', import.meta.url));
      expect((await db.query('SELECT version,sha256 FROM migration_ledger WHERE version = 9')).rows)
        .toEqual([{ version: 9, sha256: hashBytes(migration) }]);
      await expect(runtime.query('SELECT * FROM discovery_verification_requests')).rejects.toMatchObject({ code: '42P01' });
      const runtimeState = async () => {
        const { rows } = await runtime.query<{ table: string }>(
          "SELECT quote_ident(tablename) AS table FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        );
        return Promise.all(rows.map(async ({ table }) => ({
          table, rows: (await runtime.query('SELECT to_jsonb(t) AS row FROM public.' + table + ' AS t ORDER BY to_jsonb(t)')).rows,
        })));
      };
      const runtimeBefore = await runtimeState();

      const visibleRoot = join(directory, 'visible');
      const truthRoot = join(directory, 'truth');
      const evidenceRoot = join(directory, 'evidence');
      const registryRoot = join(directory, 'registry');
      const evidencePinRoot = join(directory, 'pin');
      const roots = { evidencePinRoot, servedRoots: [visibleRoot, evidenceRoot, registryRoot] };
      const store = await createEvidenceStore(evidenceRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      const { captures: [capture] } = await loadDemo(dependencies, { visibleRoot, truthRoot });
      if (!capture) throw new Error('Demo capture unavailable');
      const catalog = localSourceCatalog;
      const source = catalog.get(capture.companyId)!;
      const service = createSourceService(dependencies, catalog);
      const manifest = await readManifest(db, capture.companyId, capture.manifestId);
      const snapshot = await service.getSnapshot('snapshot:' + manifest.id);
      const events = await service.getSnapshotRecords(snapshot.id);
      const truth = await readFile(join(truthRoot, 'expected-a.json'), 'utf8');
      const raw = await readFile(join(truthRoot, 'evidence-a.json'), 'utf8');
      const producer = decodeEvidenceProducer(raw);
      const evidence = await assembleEvidenceVerificationInput(db, store, { source, manifest, snapshot, events }, truth, raw, producer);
      await pinProtectedEvidenceFixture(evidence, pathToFileURL(evidencePinRoot + '/'));
      const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
        item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
      const draft = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
      if (!('candidate' in draft) || !draft.candidate) throw new Error('Demo candidate unavailable');
      const { spec, profiles } = draft.candidate.request;
      const compiled = compile(spec, profiles);
      if (!compiled.ok) throw new Error('Demo candidate did not compile');
      const candidate = { spec, profiles, artifact: compiled.value, manifest, snapshot };
      const registry = createCandidateRegistry(db, registryRoot);
      await registry.registerCandidate(candidate);

      const accountId = profiles[0]!.scope.accountId;
      const input = { requestKey: 'real-step', candidate, task: { runId: 'real-run', accountId } };
      await seedSteps(db, input.task.runId, [input.requestKey]);
      const launcher = createProtectedFinancialLauncher({ registry, roots });
      const storage = createFinancialAttestationRegistry(db, registry);
      let probes = 0;
      let launches = 0;
      const options = {
        db, candidates: registry,
        captures: createFinancialCaptureReader({ registry, dependencies, catalog, service }),
        readBuildHash: readFixedFinancialBuildHash,
        selectFixture: async () => ({
          fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2' as const, purpose: 'construction' as const,
          snapshotHash: snapshot.contentHash,
        }),
        resolveTaskId: async ({ runId }: { runId: string }) => runId + '-task',
        launcher: {
          async probe(value: Parameters<typeof launcher.probe>[0]) { probes++; return launcher.probe(value); },
          async launch(value: Parameters<typeof launcher.launch>[0]) {
            launches++;
            const { rows: [saved] } = await db.query(
              `SELECT r.request_bytes,j.state FROM financial_verification_reservations r
               JOIN verification_jobs j ON r.job_id = j.id WHERE r.job_id = $1`, [value.jobId],
            );
            expect(saved.state).toBe('running');
            expect(saved.request_bytes).toEqual(Buffer.from(canonicalJson(value)));
            const result = await launcher.launch(value);
            await expect(storage.complete(value.jobId, result.report)).rejects.toMatchObject({ statusCode: 409 });
            await expect(storage.complete(value.jobId, { ...result, requestHash: hashCanonical('different') }))
              .rejects.toMatchObject({ statusCode: 409 });
            await expect(storage.complete(value.jobId, { ...result, report: { ...result.report, checks: result.report.checks.slice(1) } }))
              .rejects.toMatchObject({ statusCode: 409 });
            return result;
          },
        },
      };
      const jobs = createDiscoveryVerification({ ...options, gate: testGate(db, input) });
      const mismatch = { code: 'DISCOVERY_CONFLICT', statusCode: 409 };
      const wrongSpec = { ...input, candidate: { ...candidate, spec: { ...spec, version: spec.version + 1 } } };
      await expect(jobs.enqueueDiscoveryVerification(wrongSpec)).rejects.toMatchObject(mismatch);
      expect(probes).toBe(0);
      expect(await counts(db, input.task.runId)).toEqual(zero);
      const lostRealAdmission = createDiscoveryVerification({
        ...options, gate: testGate(db, input, { fault: phase => phase === 'admit' ? 'lost_ack' : undefined }),
      });
      await expect(lostRealAdmission.enqueueDiscoveryVerification(input))
        .rejects.toMatchObject({ code: 'DISCOVERY_OWNER_LOST', commit: 'unknown' });
      expect(await counts(db, input.task.runId)).toEqual(queued);
      const admitted = await jobs.enqueueDiscoveryVerification(input);
      await jobs.drain();
      expect(probes).toBe(1);
      expect(launches).toBe(1);
      expect((await jobs.get(admitted.jobId)).job).toMatchObject({
        state: 'completed', summary: { eligible: true, coverageComplete: true },
      });
      const { rows: [proof] } = await db.query(
        `SELECT a.*,v.report FROM financial_verification_attestations a JOIN verification_reports v ON v.id = a.report_id
         WHERE a.job_id = $1`, [admitted.jobId],
      );
      expect(proof.report.checks).toHaveLength(13);
      expect(proof.report.checks.every((check: { status: string; cases: number }) => check.status === 'passed' && check.cases > 0)).toBe(true);
      const completion = JSON.parse(proof.completion_bytes.toString('utf8'));
      expect((await storage.complete(admitted.jobId, completion)).report).toEqual(proof.report);
      await expect(storage.complete(admitted.jobId, { ...completion, report: { ...proof.report, checks: [...proof.report.checks].reverse() } }))
        .rejects.toMatchObject({ statusCode: 409 });

      const replay = createDiscoveryVerification({
        ...options, gate: testGate(db, input),
        readBuildHash: async () => { throw new Error('UNAVAILABLE_NEW_BUILD'); },
        selectFixture: async () => { throw new Error('UNAVAILABLE_NEW_PIN'); },
        candidates: { async getCandidate() { throw new Error('UNAVAILABLE_CANDIDATE'); } },
      });
      expect(await replay.enqueueDiscoveryVerification(input)).toEqual((await jobs.get(admitted.jobId)).job);
      const history = await replay.readByRequestKey(input);
      expect(history).toMatchObject({ kind: 'existing', job: { state: 'completed' }, executionUncertain: false });
      expect(JSON.stringify(history)).not.toMatch(/subjectBytes|requestBytes|fixtureSetId|servedRoots|evidencePin/);
      expect(probes).toBe(1);
      expect(launches).toBe(1);

      await expect(db.query('UPDATE discovery_verification_requests SET account_id = $1 WHERE job_id = $2',
        ['other', admitted.jobId])).rejects.toMatchObject({ code: '42501' });
      await expect(db.query('DELETE FROM discovery_verification_requests WHERE job_id = $1', [admitted.jobId]))
        .rejects.toMatchObject({ code: '42501' });
      await expect(db.query('DELETE FROM financial_verification_attestations WHERE job_id = $1', [admitted.jobId]))
        .rejects.toMatchObject({ code: '42501' });

      expect(await counts(db, input.task.runId)).toEqual(completed);
      for (const altered of [
        { ...candidate, spec: { ...spec, version: spec.version + 1 } },
        { ...candidate, artifact: { ...candidate.artifact, hash: hashCanonical('other artifact') } },
        { ...candidate, profiles: [{ ...profiles[0]!, hash: hashCanonical('other profile') }] },
        { ...candidate, profiles: [{ ...profiles[0]!, scope: { ...profiles[0]!.scope, currency: 'EUR' as const } }] },
        { ...candidate, manifest: { ...manifest, id: 'other-manifest' } },
        { ...candidate, snapshot: { ...snapshot, contentHash: hashCanonical('other snapshot') } },
      ]) await expect(replay.enqueueDiscoveryVerification({ ...input, candidate: altered })).rejects.toMatchObject(mismatch);
      for (const task of [{ runId: 'other-run', accountId }, { ...input.task, accountId: 'other-account' }]) {
        await expect(replay.readByRequestKey({ ...input, task })).rejects.toMatchObject({ code: 'DISCOVERY_FORBIDDEN' });
      }
      const multiAccountGate = createDiscoveryVerification({
        ...options, gate: testGate(db, input, { authorizedAccount: () => true }),
      });
      await expect(multiAccountGate.enqueueDiscoveryVerification({ ...input, task: { ...input.task, accountId: 'other-account' } }))
        .rejects.toMatchObject(mismatch);
      expect(await counts(db, input.task.runId)).toEqual(completed);

      await admin.connect();
      await expect(admin.query('UPDATE discovery_verification_requests SET request_hash = $1 WHERE job_id = $2',
        [hashCanonical('other request digest'), admitted.jobId])).rejects.toMatchObject({ code: '23503' });
      for (const [column, replacement] of [
        ['subject_bytes', Buffer.from('{}')], ['subject_hash', hashCanonical('other subject')],
      ] as const) {
        const original = (await admin.query(
          'SELECT ' + column + ' FROM discovery_verification_requests WHERE request_key = $1', [input.requestKey],
        )).rows[0][column];
        await admin.query('UPDATE discovery_verification_requests SET ' + column + ' = $1 WHERE request_key = $2',
          [replacement, input.requestKey]);
        await expect(replay.readByRequestKey(input)).rejects.toMatchObject(mismatch);
        await admin.query('UPDATE discovery_verification_requests SET ' + column + ' = $1 WHERE request_key = $2',
          [original, input.requestKey]);
      }
      for (const [column, replacement] of [
        ['request_bytes', Buffer.from('{}')], ['snapshot_id', 'other-snapshot'], ['capture_hash', hashCanonical('other capture')],
      ] as const) {
        const original = (await admin.query(
          'SELECT ' + column + ' FROM financial_verification_reservations WHERE job_id = $1', [admitted.jobId],
        )).rows[0][column];
        await admin.query('UPDATE financial_verification_reservations SET ' + column + ' = $1 WHERE job_id = $2',
          [replacement, admitted.jobId]);
        await expect(replay.readByRequestKey(input)).rejects.toMatchObject(mismatch);
        await admin.query('UPDATE financial_verification_reservations SET ' + column + ' = $1 WHERE job_id = $2',
          [original, admitted.jobId]);
      }

      const newRun = async (runId: string, ...keys: string[]) => {
        await seedSteps(db, runId, keys);
        return { ...input, requestKey: keys[0]!, task: { runId, accountId } };
      };
      const limited = (request: DiscoveryVerificationInput, hooks: HarnessHooks = {}, execute = options.launcher.launch) =>
        createDiscoveryVerification({ ...options, gate: testGate(db, request, hooks), launcher: { ...options.launcher, launch: execute } });
      const noLaunch = async () => { throw new Error('Unconfirmed launch must never run'); };

      const rollbackInput = await newRun('rollback-run', 'rollback-step');
      const beforeCommit = barrier();
      const rollback = limited(rollbackInput, {
        fault: phase => phase === 'admit' ? 'rollback' : undefined,
        beforeCommit: async phase => { if (phase === 'admit') await beforeCommit.wait(); },
      }, noLaunch);
      const rejectedRollback = expect(rollback.enqueueDiscoveryVerification(rollbackInput))
        .rejects.toMatchObject({ code: 'DISCOVERY_OWNER_LOST', commit: 'not_committed' });
      await beforeCommit.reached;
      try {
        expect(await counts(db, rollbackInput.task.runId)).toEqual(zero);
      } finally {
        beforeCommit.release();
      }
      await rejectedRollback;
      expect(await counts(db, rollbackInput.task.runId)).toEqual(zero);
      expect(await limited(rollbackInput).readByRequestKey(rollbackInput)).toEqual({ kind: 'absent' });

      const admissionInput = await newRun('admission-run', 'admission-step');
      const lostAdmission = limited(admissionInput, { fault: phase => phase === 'admit' ? 'lost_ack' : undefined }, noLaunch);
      await expect(lostAdmission.enqueueDiscoveryVerification(admissionInput))
        .rejects.toMatchObject({ code: 'DISCOVERY_OWNER_LOST', commit: 'unknown' });
      expect(await counts(db, admissionInput.task.runId)).toEqual(queued);
      const knownQueued = await lostAdmission.readByRequestKey(admissionInput);
      expect(knownQueued).toMatchObject({ kind: 'existing', job: { state: 'queued' } });
      if (knownQueued.kind !== 'existing') throw new Error('Expected immutable mapping');
      const crashBeforeClaim = limited(admissionInput, { fault: phase => phase === 'recover' ? 'before_claim' : undefined }, noLaunch);
      await expect(crashBeforeClaim.enqueueDiscoveryVerification(admissionInput))
        .rejects.toMatchObject({ code: 'DISCOVERY_OWNER_LOST', commit: 'not_committed' });
      expect(await counts(db, admissionInput.task.runId)).toEqual(queued);

      const beforeLaunch = barrier();
      const recoverCommitted = barrier();
      let recoveryLaunches = 0;
      const restart = createDiscoveryVerification({
        ...options, gate: testGate(db, admissionInput, { afterClaimCommit: recoverCommitted.wait }),
        selectFixture: async () => { throw new Error('Recovery must not select a pin'); },
        launcher: {
          ...options.launcher,
          async launch() { recoveryLaunches++; await beforeLaunch.wait(); throw new Error('PRIVATE_LAUNCH_SENTINEL'); },
        },
      });
      const probesBeforeRestart = probes;
      const restarted = restart.enqueueDiscoveryVerification(admissionInput);
      await recoverCommitted.reached;
      try {
        expect(await counts(db, admissionInput.task.runId)).toEqual(running);
        expect(recoveryLaunches).toBe(0);
      } finally {
        recoverCommitted.release();
      }
      await beforeLaunch.reached;
      try {
        expect(await restarted).toMatchObject({ jobId: knownQueued.job.jobId, state: 'running' });
        expect(await counts(db, admissionInput.task.runId)).toEqual(running);
        expect(await restart.readByRequestKey(admissionInput)).toMatchObject({ executionUncertain: false });
        expect(await lostAdmission.readByRequestKey(admissionInput)).toMatchObject({ executionUncertain: true });
      } finally {
        beforeLaunch.release();
      }
      await restart.drain();
      const failedReplay = await lostAdmission.enqueueDiscoveryVerification(admissionInput);
      expect(failedReplay).toMatchObject({ jobId: knownQueued.job.jobId, state: 'failed' });
      expect(JSON.stringify(failedReplay)).not.toContain('PRIVATE_LAUNCH_SENTINEL');
      expect(await counts(db, admissionInput.task.runId)).toEqual(failed);
      expect(recoveryLaunches).toBe(1);
      expect(probes).toBe(probesBeforeRestart);

      const uncertainInput = await newRun('uncertain-run', 'uncertain-step');
      let forbiddenLaunches = 0;
      const countForbiddenLaunch = async () => { forbiddenLaunches++; return noLaunch(); };
      const unknownClaim = limited(uncertainInput, { fault: phase => phase === 'recover' ? 'lost_ack' : undefined }, countForbiddenLaunch);
      await expect(unknownClaim.enqueueDiscoveryVerification(uncertainInput))
        .rejects.toMatchObject({ code: 'DISCOVERY_OWNER_LOST', commit: 'unknown' });
      const unknownRestart = limited(uncertainInput, {}, countForbiddenLaunch);
      expect(await counts(db, uncertainInput.task.runId)).toEqual(running);
      const uncertainRead = await unknownRestart.readByRequestKey(uncertainInput);
      expect(uncertainRead).toMatchObject({ kind: 'existing', executionUncertain: true, job: { state: 'running' } });
      if (uncertainRead.kind !== 'existing') throw new Error('Expected uncertain mapping');
      expect(await unknownRestart.enqueueDiscoveryVerification(uncertainInput)).toEqual(uncertainRead.job);
      await Promise.all([unknownClaim.drain(), unknownRestart.drain()]);
      expect(forbiddenLaunches).toBe(0);
      expect(await counts(db, uncertainInput.task.runId)).toEqual(running);

      const staleCandidateInput = await newRun('stale-candidate-run', 'stale-candidate-step');
      let failCandidate = false;
      const failedClaim = createDiscoveryVerification({
        ...options, gate: testGate(db, staleCandidateInput, { afterClaimCommit: () => { failCandidate = true; } }),
        candidates: { async getCandidate(...args: Parameters<typeof registry.getCandidate>) {
          if (failCandidate) throw new Error('PRIVATE_CANDIDATE_SENTINEL');
          return registry.getCandidate(...args);
        } },
        launcher: { ...options.launcher, launch: countForbiddenLaunch },
      });
      const failing = await failedClaim.enqueueDiscoveryVerification(staleCandidateInput);
      await failedClaim.drain();
      expect(await counts(db, staleCandidateInput.task.runId)).toEqual(failed);
      expect(await failedClaim.enqueueDiscoveryVerification(staleCandidateInput))
        .toMatchObject({ jobId: failing.jobId, state: 'failed' });
      expect(forbiddenLaunches).toBe(0);

      const raceInput = await newRun('same-key-run', 'same-key-step');
      const launchHold = barrier();
      let raceLaunches = 0;
      const raceLauncher = async () => { raceLaunches++; await launchHold.wait(); throw new Error('Test launch ends'); };
      const raceHooks = { afterLookup: rendezvous(2), afterAdmissionCommit: rendezvous(2) };
      const contenders = [limited(raceInput, raceHooks, raceLauncher), limited(raceInput, raceHooks, raceLauncher)];
      const results = await Promise.all(contenders.map(contender => contender.enqueueDiscoveryVerification(raceInput)));
      await launchHold.reached;
      try {
        expect(results[0]).toEqual(results[1]);
        expect(results[0]?.state).toBe('running');
        expect(raceLaunches).toBe(1);
        expect(await counts(db, raceInput.task.runId)).toEqual(running);
      } finally {
        launchHold.release();
      }
      await Promise.all(contenders.map(contender => contender.drain()));
      expect(await counts(db, raceInput.task.runId)).toEqual(failed);

      const budgetInput = await newRun('budget-run', 'budget-original', 'budget-contender-a', 'budget-contender-b');
      const originalBudget = limited(budgetInput, {}, noLaunch);
      const originalJob = await originalBudget.enqueueDiscoveryVerification(budgetInput);
      await originalBudget.drain();
      await db.query('UPDATE verification_attempt_budgets SET attempts = 2 WHERE run_id = $1 AND account_id = $2',
        [budgetInput.task.runId, accountId]);
      const budgetHooks = { afterLookup: rendezvous(2) };
      const differentKeys = ['budget-contender-a', 'budget-contender-b'].map(requestKey => ({ ...budgetInput, requestKey }));
      const budgetServices = differentKeys.map(request => limited(request, budgetHooks, noLaunch));
      const outcomes = await Promise.allSettled(budgetServices.map((service, index) => service.enqueueDiscoveryVerification(differentKeys[index]!)));
      await Promise.all(budgetServices.map(service => service.drain()));
      const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled');
      const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
      expect(accepted).toHaveLength(1);
      expect(accepted[0]!.value.jobId).not.toBe(originalJob.jobId);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toMatchObject(mismatch);
      expect(await counts(db, budgetInput.task.runId)).toEqual({ ...failed, attempts: 3, mappings: 2, reservations: 2, failed: 2 });
      const { rows: nativeIds } = await db.query(
        `SELECT s.native_id FROM discovery_verification_requests r JOIN discovery_tool_steps s ON s.id = r.request_key
          WHERE r.run_id = $1`, [budgetInput.task.runId],
      );
      expect(nativeIds).toEqual([{ native_id: 'reused-provider-id' }, { native_id: 'reused-provider-id' }]);

      const constraintInput = await newRun('constraint-run', 'constraint-a', 'constraint-b');
      const insertMapping = (key: string, runId: string, taskId: string, jobId: string, requestHash: string) =>
        db.query(
          `INSERT INTO discovery_verification_requests
           SELECT $1,$2,$3,account_id,$1 || '-dispatch',1,1,$2 || '-proposal',1,1,subject_hash,subject_bytes,$4,$5
           FROM discovery_verification_requests WHERE request_key = $6`,
          [key, runId, taskId, jobId, requestHash, input.requestKey],
        );
      await expect(insertMapping(input.requestKey, input.task.runId, input.task.runId + '-task', admitted.jobId, proof.request_hash))
        .rejects.toMatchObject({ code: '23505' });
      await expect(insertMapping(constraintInput.requestKey, constraintInput.task.runId, constraintInput.task.runId + '-task',
        admitted.jobId, proof.request_hash)).rejects.toMatchObject({ code: '23505' });
      await expect(insertMapping(constraintInput.requestKey, constraintInput.task.runId, constraintInput.task.runId + '-task',
        'missing-financial-reservation', proof.request_hash)).rejects.toMatchObject({ code: '23503' });
      await expect(insertMapping('missing-step', constraintInput.task.runId, constraintInput.task.runId + '-task',
        'missing-financial-reservation', proof.request_hash)).rejects.toMatchObject({
        code: '23503', constraint: 'discovery_verification_requests_run_id_task_id_request_key_fkey',
      });
      expect(await counts(db, constraintInput.task.runId)).toEqual(zero);
      expect(await runtimeState()).toEqual(runtimeBefore);
    } finally {
      await Promise.all([db.end(), runtime.end(), admin.end()]);
      await dropTest(namespace);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
