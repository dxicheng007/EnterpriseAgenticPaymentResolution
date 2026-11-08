import { expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createPreviewPlugin } from '../../apps/control/src/routes/preview.js';
import type { CandidateRegistration, PreviewReadContext, SnapshotRead } from '@eapr/compiler/preview-adapters';
import {
  ApiErrorSchema, PreviewResponseSchema, TargetStateSchema, hashCanonical, hashEvent, hashManifest, hashProfile,
  type BootstrapManifest, type EvidenceRef, type RawSourceEvent,
} from '@eapr/contracts';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { localPort } from '../../scripts/native-db.js';
import {
  baselineEventsA, baselineEventsB, baselineManifestA, baselineManifestB,
  emailFixturesA, emailFixturesB, emptyTargetA, emptyTargetB, profileA, profileB, validSpecA, validSpecB,
} from '../fixtures/index.js';

function fixtureCapture(manifest: BootstrapManifest, events: RawSourceEvent[], evidence: EvidenceRef[]): SnapshotRead {
  const id = 'snapshot:' + manifest.id;
  const eventIds = events.map(event => event.id).sort();
  const evidenceIds = evidence.map(ref => ref.id).sort();
  const streams = [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
    .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash }));
  const files = [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 }));
  const snapshot = {
    id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
    contentHash: hashCanonical({ manifestHash: manifest.hash, streams, files, eventIds, evidenceIds }),
    eventIds, evidenceIds,
  };
  return {
    manifest, events, evidence, snapshot,
    dossier: {
      companyId: manifest.companyId, manifestId: manifest.id, snapshotIds: [id],
      evidenceIds, complete: true, missingMembers: [], diagnostics: [],
    },
  };
}

const developmentCaptures = [
  fixtureCapture(baselineManifestA, baselineEventsA, emailFixturesA.flatMap(file => file.refs)),
  fixtureCapture(baselineManifestB, baselineEventsB, emailFixturesB.flatMap(file => file.refs)),
];
const inputA = { spec: validSpecA, profiles: [profileA], snapshotId: developmentCaptures[0].snapshot.id, asOf: baselineManifestA.asOf };
const inputB = { spec: validSpecB, profiles: [profileB], snapshotId: developmentCaptures[1].snapshot.id, asOf: baselineManifestB.asOf };

function failure(statusCode: number): Error {
  return Object.assign(new Error('private adapter details must not escape'), { statusCode });
}

async function databaseState(pool: Pool) {
  const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return {
    tables: tables.rows,
    migration: (await pool.query('SELECT * FROM migration_ledger ORDER BY version')).rows,
    seed: (await pool.query('SELECT * FROM seed_ledger ORDER BY version')).rows,
    counter: (await pool.query('SELECT * FROM activity_counter')).rows,
    activity: (await pool.query('SELECT * FROM activity_events ORDER BY sequence')).rows,
  };
}

test('preview_preserves_parent', async () => {
  const capability: PreviewReadContext = {
    caller: 'reviewer',
    allowedSourceRefs: [profileA.sourceRef, profileB.sourceRef],
    allowedAccountIds: [profileA.scope.accountId, profileB.scope.accountId],
  };
  const published: CandidateRegistration[] = [];
  const targetReads: string[] = [];
  const workerOrigin = 'http://127.0.0.1:' + localPort('EAPR_WORKER_PORT', 3002);
  const fixtureToken = 'development-preview-read-test';
  const targetFixtures = [emptyTargetA, emptyTargetB];
  const originalFixtures = structuredClone(targetFixtures);

  const system = await createTestSystem({
    modelMode: 'disabled', dbNamespace: testNamespace('preview'),
    controlPlugins: [createPreviewPlugin({
      async authorizeRead() { return capability; },
      async readSnapshot(id, caller) {
        expect(caller).toBe(capability);
        const capture = developmentCaptures.find(value => value.snapshot.id === id);
        if (!capture) throw failure(404);
        return capture;
      },
      async readTarget(scope, asOf, caller) {
        expect(caller).toBe(capability);
        const url = new URL('/internal/test-preview-target', workerOrigin);
        url.searchParams.set('account', scope.accountId);
        url.searchParams.set('asOf', asOf);
        const response = await fetch(url, {
          headers: { Authorization: 'Bearer ' + fixtureToken }, signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) throw failure(response.status);
        return TargetStateSchema.parse(await response.json());
      },
      async registerCandidate(candidate) { published.push(candidate); },
    })],
    workerPlugins: [async worker => {
      // This test-only HTTP read stands in for T3's eventual persisted parent reader.
      worker.get<{ Querystring: { account: string; asOf: string } }>('/internal/test-preview-target', async (request, reply) => {
        if (request.headers.authorization !== 'Bearer ' + fixtureToken) return reply.code(401).send();
        const target = targetFixtures.find(candidate => candidate.scope.accountId === request.query.account);
        if (!target) return reply.code(404).send();
        targetReads.push(request.query.account + '/' + request.query.asOf);
        return target;
      });
    }],
  });

  try {
    const before = await Promise.all([databaseState(system.db.control), databaseState(system.db.runtime)]);
    expect((await system.control.getHealth()).status).toBe(200);
    for (const input of [inputA, inputB]) {
      const response = await system.control.request('/api/connectors/preview', { method: 'POST', body: input });
      expect(response.status).toBe(200);
      const body = PreviewResponseSchema.parse(response.body);
      expect(body.artifact?.sourceRef).toBe(input.spec.sourceRef);
      expect(body.parentWrites).toBe(0);
      expect(body.diagnostics).toEqual([]);
      expect(body.unsupportedRows).toEqual([]);
      expect(body.outcome.plans).toHaveLength(1);
      expect(body.diffs).toEqual([expect.objectContaining({
        scope: input.profiles[0].scope, beforeVersion: 0, beforeBalanceCents: 0, afterBalanceCents: 80000,
      })]);
      expect(body.diffs[0].operations).toHaveLength(5);
      expect(body.diffs[0].lineage).toEqual(expect.arrayContaining([
        expect.objectContaining({ targetField: '/amountCents' }),
      ]));
      const repeat = await system.control.request('/api/connectors/preview', { method: 'POST', body: input });
      expect(repeat).toEqual(response);
    }
    expect(targetReads).toEqual([inputA, inputA, inputB, inputB].map(input => input.profiles[0].scope.accountId + '/' + input.asOf));
    expect(published.map(candidate => candidate.artifact.sourceRef)).toEqual(['legacy-a', 'legacy-a', 'legacy-b', 'legacy-b']);
    expect(targetFixtures).toEqual(originalFixtures);
    const after = await Promise.all([databaseState(system.db.control), databaseState(system.db.runtime)]);
    expect(after).toEqual(before);
  } finally {
    await system.close();
  }
});

test('preview rejects malformed, unauthorized, missing, stale and unavailable dependencies', async () => {
  const capability: PreviewReadContext = {
    caller: 'task', allowedSourceRefs: [profileA.sourceRef], allowedAccountIds: [profileA.scope.accountId],
  };
  const baselineCapture = developmentCaptures[0];
  let capture = structuredClone(baselineCapture);
  let sourceFailure: number | undefined;
  let targetFailure: number | undefined;
  let denied = false;
  let registryFailure: number | undefined;
  let sourceReads = 0;
  let targetReads = 0;
  let registrationAttempts = 0;

  const system = await createTestSystem({
    modelMode: 'disabled', dbNamespace: testNamespace('previewerror'),
    controlPlugins: [createPreviewPlugin({
      async authorizeRead() {
        if (denied) throw failure(401);
        return capability;
      },
      async readSnapshot() {
        sourceReads++;
        if (sourceFailure) throw failure(sourceFailure);
        return capture;
      },
      async readTarget() {
        targetReads++;
        if (targetFailure) throw failure(targetFailure);
        return emptyTargetA;
      },
      async registerCandidate() {
        registrationAttempts++;
        if (registryFailure) throw failure(registryFailure);
      },
    })],
  });
  async function post(body: unknown) {
    return system.control.request('/api/connectors/preview', { method: 'POST', body });
  }
  async function assertFailure(status: number, body: unknown = inputA) {
    const response = await post(body);
    expect(response.status).toBe(status);
    expect(ApiErrorSchema.parse(response.body)).toMatchObject({ diagnostics: [] });
    expect(JSON.stringify(response.body)).not.toContain('private adapter details');
  }

  try {
    await assertFailure(400, { ...inputA, target: emptyTargetA });
    await assertFailure(400, { ...inputA, artifact: {} });
    await assertFailure(403, inputB);
    denied = true;
    await assertFailure(401);
    denied = false;
    const staleProfile = { ...profileA, version: 2 };
    await assertFailure(409, { ...inputA, profiles: [staleProfile] });
    expect(sourceReads).toBe(0);

    sourceFailure = 404;
    await assertFailure(404);
    sourceFailure = 503;
    await assertFailure(503);
    sourceFailure = undefined;

    capture.snapshot.contentHash = 'a'.repeat(64);
    await assertFailure(409);
    capture = structuredClone(baselineCapture);
    capture.events[0].payload.amount = '1.00';
    await assertFailure(409);
    capture = structuredClone(baselineCapture);
    capture.evidence = capture.evidence.filter(ref => ref.id !== 'ev-a-currency');
    await assertFailure(404);
    capture = fixtureCapture(baselineCapture.manifest, baselineCapture.events,
      baselineCapture.evidence.filter(ref => ref.id !== 'ev-a-currency'));
    capture.evidence.push(baselineCapture.evidence.find(ref => ref.id === 'ev-a-currency')!);
    await assertFailure(404);
    capture = structuredClone(baselineCapture);
    capture.evidence.find(ref => ref.id === 'ev-a-currency')!.sha256 = 'b'.repeat(64);
    await assertFailure(409);
    capture = structuredClone(baselineCapture);
    capture.evidence.find(ref => ref.id === 'ev-a-currency')!.snapshotId = capture.manifest.streams[0].snapshotId;
    await assertFailure(409);
    expect(targetReads).toBe(0);
    expect(registrationAttempts).toBe(0);

    capture = structuredClone(baselineCapture);
    const unsupported = structuredClone(inputA);
    const invoice = unsupported.spec.mappings.find(mapping => mapping.kind === 'invoice')!;
    invoice.fields.amountCents = { op: 'field', path: '/version' };
    const result = await post(unsupported);
    expect(result.status).toBe(200);
    expect(PreviewResponseSchema.parse(result.body)).toMatchObject({
      artifact: null, outcome: { plans: [], holds: [] }, diffs: [], parentWrites: 0,
      diagnostics: [expect.objectContaining({ code: 'MAPPING_TYPE' })],
    });
    expect(targetReads).toBe(0);

    targetFailure = 503;
    await assertFailure(503);
    expect(registrationAttempts).toBe(0);
    targetFailure = undefined;
    registryFailure = 409;
    await assertFailure(409);
    expect(registrationAttempts).toBe(1);
  } finally {
    await system.close();
  }
});

function fixtureCaptureWithEvent(event: RawSourceEvent, semanticVersions = baselineManifestA.semanticVersions): SnapshotRead {
  const events = [...baselineEventsA, event];
  const manifest = {
    ...baselineManifestA,
    semanticVersions,
    streams: baselineManifestA.streams.map(stream => stream.streamId === event.streamId ? {
      ...stream, resumeAfter: String(event.sequence), eventIds: [...stream.eventIds, event.id],
      snapshotHash: hashCanonical({
        sourceRef: event.sourceRef, streamId: stream.streamId, resumeAfter: String(event.sequence),
        events: events.map(({ id, contentHash }) => ({ id, contentHash })),
      }),
    } : stream),
  };
  manifest.hash = hashManifest(manifest);
  return fixtureCapture(manifest, events, developmentCaptures[0].evidence);
}

test('preview holds unknown accounts, partitions reviewed sellers, and pauses an unknown seller', async () => {
  const sourceEvent = baselineEventsA[1];
  const other = {
    ...sourceEvent, id: 'evt-other-seller', recordId: 'pay-other-seller', sequence: 6,
    rawIdentity: { ...sourceEvent.rawIdentity, sellerEntityId: 'seller-other', sourceAccountId: 'cust-other' },
    payload: { ...sourceEvent.payload, id: 'pay-other-seller', account: 'cust-other' },
  };
  const otherSeller = { ...other, contentHash: hashEvent(other) };
  const unknown = { ...other, rawIdentity: { ...other.rawIdentity, sellerEntityId: profileA.scope.sellerEntityId } };
  const unknownAccount = { ...unknown, contentHash: hashEvent(unknown) };
  let capture = fixtureCaptureWithEvent(unknownAccount);
  const profileOther = {
    ...profileA, id: 'profile-other', scope: { ...profileA.scope, sellerEntityId: 'seller-other', accountId: 'account-other' },
    sourceAccountIds: ['cust-other'], approvedLookups: [], contractTerms: [],
  };
  profileOther.hash = hashProfile(profileOther);
  const capability: PreviewReadContext = {
    caller: 'reviewer', allowedSourceRefs: [profileA.sourceRef], allowedAccountIds: [profileA.scope.accountId, profileOther.scope.accountId],
  };
  const system = await createTestSystem({
    modelMode: 'disabled', dbNamespace: testNamespace('previewholds'),
    controlPlugins: [createPreviewPlugin({
      async authorizeRead() { return capability; },
      async readSnapshot() { return capture; },
      async readTarget(scope) { return { ...emptyTargetA, scope }; },
    })],
  });
  async function preview(profiles = inputA.profiles) {
    const response = await system.control.request('/api/connectors/preview', {
      method: 'POST', body: { ...inputA, profiles },
    });
    expect(response.status).toBe(200);
    return PreviewResponseSchema.parse(response.body);
  }

  try {
    const oneHold = await preview();
    expect(oneHold.outcome.plans).toHaveLength(1);
    expect(oneHold.unsupportedRows).toEqual([expect.objectContaining({ code: 'UNKNOWN_ACCOUNT', eventIds: [unknownAccount.id] })]);
    expect(oneHold.unsupportedRows[0]).not.toHaveProperty('scope');

    capture = fixtureCaptureWithEvent(otherSeller, {
      ...baselineManifestA.semanticVersions, 'seller-other/cust-other': profileOther.semanticVersion,
    });
    const unknownSeller = await preview();
    expect(unknownSeller.outcome.plans).toEqual([]);
    expect(unknownSeller.unsupportedRows[0]).toMatchObject({ code: 'IDENTITY_SCOPE' });
    expect(unknownSeller.unsupportedRows[0]).not.toHaveProperty('scope');

    const knownSellers = await preview([profileA, profileOther]);
    expect(knownSellers.unsupportedRows).toEqual([]);
    expect(knownSellers.outcome.plans).toHaveLength(2);
    expect(knownSellers.diffs).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: profileA.scope, afterBalanceCents: 80000 }),
      expect.objectContaining({ scope: profileOther.scope, afterBalanceCents: 0 }),
    ]));

    capture = fixtureCaptureWithEvent(otherSeller, {
      ...baselineManifestA.semanticVersions, '*': 'unreviewed',
    });
    const semanticPause = await preview([profileA, profileOther]);
    expect(semanticPause.outcome.plans).toEqual([]);
    expect(semanticPause.unsupportedRows[0]).toMatchObject({ code: 'SEMANTIC_VERSION' });
  } finally {
    await system.close();
  }
});
