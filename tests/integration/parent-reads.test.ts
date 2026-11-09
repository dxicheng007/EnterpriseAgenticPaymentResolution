import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import {
  canonicalJson, hashCanonical, hashManifest, hashProfile, hashTargetSnapshot, ParentViewSchema,
  type BootstrapManifest, type ConnectorSpec, type CustomerProfile, type TargetState,
} from '@eapr/contracts';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { withTransaction } from '@eapr/storage/transaction';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { createParentReads } from '../../apps/worker/src/parent-reads.js';
import { createParentReadPlugin } from '../../apps/worker/src/routes/parent.js';
import { authorizeWorkerParentRead, composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';
import { parentStorageFixture, persistParentStorageFixture } from '../fixtures/parent-storage.js';
import { baselineA, baselineManifestA, baselineManifestB, profileA, profileB, validSpecA, validSpecB } from '../fixtures/index.js';

test('real registered reads isolate snapshots, preserve evaluation time and fail closed on registry damage', async () => {
  const registryRoot = await mkdtemp(join(await realpath(tmpdir()), 'eapr-parent-reads-'));
  const workerOrigin = 'http://127.0.0.1:' + localPort('EAPR_WORKER_PORT', 3002);
  let serviceToken = '';
  let holdRead: { captured: () => void; resume: Promise<void> } | undefined;
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  try {
    system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('parentreads'),
      workerPlugins: [async (app, services) => {
        serviceToken = services.serviceToken;
        if (!holdRead) {
          await composeWorkerParentReads(registryRoot)(app, services);
          return;
        }
        const held = holdRead;
        const registry = createRegisteredScopeReader({ registryRoot });
        app.register(createParentReadPlugin(createParentReads(services.db, services.clock, {
          async readSnapshot() {
            const snapshot = await registry.readSnapshot();
            held.captured();
            await held.resume;
            return snapshot;
          },
        }), request => authorizeWorkerParentRead(request, serviceToken)));
      }],
    });
    const { db, worker } = system;
    const registry = createCandidateRegistry(db.control, registryRoot);
    const publisher = createRegisteredScopePublication({ registryRoot, candidates: registry });
    const a = { ...profileA, scope: { ...profileA.scope, accountId: 'a'.repeat(160) } };
    a.approvedLookups = a.approvedLookups.map(lookup => ({
      ...lookup, entries: lookup.entries.map(entry => ({
        ...entry, target: entry.target === profileA.scope.accountId ? a.scope.accountId : entry.target,
      })),
    }));
    a.hash = hashProfile(a);
    const b = profileB;
    async function register(profile: CustomerProfile, spec: ConnectorSpec, manifest: BootstrapManifest) {
      const compiled = compile(spec, [profile]);
      if (!compiled.ok) throw new Error('Expected a compiled test subject');
      const streams = [...manifest.streams].sort((left, right) => left.streamId < right.streamId ? -1 : 1);
      const files = [...manifest.files].sort((left, right) => left.fileId < right.fileId ? -1 : 1);
      const eventIds = streams.flatMap(stream => stream.eventIds).sort();
      const evidenceIds = [...new Set([...spec.evidenceRefs, ...profile.contractTerms.flatMap(term => term.evidenceRefs)])].sort();
      const snapshot = {
        id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
        eventIds, evidenceIds, contentHash: hashCanonical({
          manifestHash: manifest.hash,
          streams: streams.map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
          files: files.map(({ fileId, sha256 }) => ({ fileId, sha256 })), eventIds, evidenceIds,
        }),
      };
      await registry.registerCandidate({ spec, manifest, artifact: compiled.value, profiles: [profile], snapshot });
      return { artifactHash: compiled.value.hash, manifestId: manifest.id, selectedProfileHash: profile.hash };
    }
    const entries = await Promise.all([
      register(a, validSpecA, baselineManifestA),
      register(b, validSpecB, baselineManifestB),
    ]);
    const request = (path: string, credential: string | null = serviceToken) => fetch(workerOrigin + path, {
      headers: { connection: 'close', ...(credential === null ? {} : { authorization: 'Bearer ' + credential }) },
    }).catch(error => { throw new Error('Worker HTTP request failed: ' + path, { cause: error }); });
    const parentPath = '/internal/parent/' + a.scope.accountId;
    const activationPath = '/internal/activations/' + a.scope.accountId;
    expect((await request(parentPath, null)).status).toBe(401);
    expect((await request(parentPath, 'invalid')).status).toBe(401);
    expect((await request(parentPath)).status).toBe(503);
    await publisher.publishRegisteredScopes(entries);
    expect((await request('/internal/parent/unknown')).status).toBe(404);
    const initialResponse = await request(parentPath);
    expect(initialResponse.status).toBe(200);
    expect(initialResponse.headers.get('cache-control')).toBe('no-store');
    const initial = ParentViewSchema.parse(await initialResponse.json());
    expect(initial).toMatchObject({ scope: a.scope, version: 0, records: { asOf: baselineManifestA.asOf } });
    expect(await (await request(activationPath)).json()).toEqual({ schemaVersion: '1', scope: a.scope, activation: null, initialReceipt: null });
    expect((await request(parentPath + '?snapshotHash=' + initial.snapshotHash)).status).toBe(404);
    for (const path of [
      parentPath + '?asOf=invalid', parentPath + '?asOf=2026-02-30T00:00:00Z', parentPath + '?snapshotHash=bad',
      parentPath + '?asOf[]=x', parentPath + '?asOf=x&%61sOf=y', parentPath + '?unknown=y', parentPath + '?asOf=%FF',
      '/internal/parent/%FF', '/internal/parent/' + 'a'.repeat(161), activationPath + '?asOf=1',
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ code: 'PARENT_READ_INVALID' });
    }

    const proxy = createParentReadClient(workerOrigin, serviceToken, registryRoot);
    await expect(proxy.readParent(a.scope.accountId, {}, {
      allowedAccountIds: [a.scope.accountId], allowedSourceRefs: [b.sourceRef],
    })).rejects.toMatchObject({ statusCode: 403 });
    await expect(proxy.readParent('unknown', {}, {
      allowedAccountIds: ['unknown'], allowedSourceRefs: [a.sourceRef],
    })).rejects.toMatchObject({ statusCode: 404 });

    // Storage seam for read proof. This does not execute reviewer activation.
    const invoice = { ...baselineA.invoices[0]!, scope: a.scope, effectiveAt: '2026-11-01T00:00:00.000Z' };
    const records: TargetState = {
      ...initial.records, version: 1, invoices: [invoice],
      customers: [{ id: b.parentCustomerId, displayName: 'Company A buyer', evidenceRefs: [] }],
    };
    const bImport = parentStorageFixture('b', { customerName: 'Company B buyer' });
    const approved = await withTransaction(db.runtime, client => persistParentStorageFixture(client, bImport));
    async function installSnapshot(state: TargetState) {
      await withTransaction(db.runtime, async client => {
        const scope = [state.scope.accountId, state.scope.companyId, state.scope.sellerEntityId];
        await client.query('INSERT INTO parent_scopes VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', scope);
        await client.query('INSERT INTO parent_snapshots VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [...scope, state.version, hashTargetSnapshot(state), state.asOf, canonicalJson(state), hashCanonical(state)]);
        await client.query(
          'INSERT INTO parent_targets VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id) DO UPDATE ' +
          'SET target_version = EXCLUDED.target_version, snapshot_hash = EXCLUDED.snapshot_hash',
          [...scope, state.version, hashTargetSnapshot(state)],
        );
      });
    }
    await installSnapshot(records);
    await installSnapshot({ ...approved.approvedTarget.records, version: 2, asOf: '2026-11-09T00:00:00.000Z' });
    await installSnapshot({ ...records, version: 2, asOf: '2026-11-09T00:00:00.000Z' });
    const tableNames = await db.runtime.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const runtimeState = () => Promise.all(tableNames.rows.map(({ tablename }) =>
      db.runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY to_jsonb(t)').then(result => result.rows)));
    const before = await runtimeState();
    const bActivation = '/internal/activations/' + b.scope.accountId;
    const paired = { schemaVersion: '1', scope: b.scope, activation: approved.activation, initialReceipt: approved.receipt };
    expect(b.hash).not.toBe(approved.activation.profileHash);
    expect(await (await request(bActivation)).json()).toEqual(paired);
    const hash = hashTargetSnapshot(records);
    const cutover = encodeURIComponent(records.asOf.replace('.000Z', 'Z'));
    const historicalPath = parentPath + '?snapshotHash=' + hash;
    const readView = async (path: string) => {
      const response = await request(path);
      expect(response.status).toBe(200);
      return ParentViewSchema.parse(await response.json());
    };
    expect(await readView(parentPath)).toMatchObject({ version: 2, balanceCents: invoice.amountCents });
    expect(await readView(parentPath + '?asOf=' + cutover)).toMatchObject({ version: 2, asOf: records.asOf, balanceCents: 0 });
    const historical = await readView(historicalPath);
    expect(historical).toMatchObject({ records, snapshotHash: hash, balanceCents: invoice.amountCents, asOf: '2026-11-08T00:00:00.000Z' });
    expect(await readView(historicalPath + '&asOf=' + cutover)).toMatchObject({ records, snapshotHash: hash, balanceCents: 0, asOf: records.asOf });
    expect((await request(parentPath + '?snapshotHash=' + approved.approvedTarget.snapshotHash)).status).toBe(404);
    const bParent = '/internal/parent/' + b.scope.accountId;
    const approvedPath = bParent + '?snapshotHash=' + approved.approvedTarget.snapshotHash +
      '&asOf=' + encodeURIComponent(approved.approvedTarget.records.asOf);
    expect(await readView(bParent)).toMatchObject({ version: 2, records: { customers: approved.approvedTarget.records.customers } });
    const approvedView = await readView(approvedPath);
    expect(approvedView).toMatchObject({
      records: approved.approvedTarget.records, balanceCents: approved.receipt.afterBalanceCents,
      snapshotHash: approved.approvedTarget.snapshotHash,
    });
    await worker.stop();
    await worker.start();
    expect(await readView(historicalPath)).toEqual(historical);

    const current = join(registryRoot, 'activation-registry', 'current.json');
    expect(await (await request(bActivation)).json()).toEqual(paired);
    await rename(current, current + '.valid');
    await writeFile(current, '{}', { mode: 0o400 });
    expect((await request(parentPath)).status).toBe(503);
    await rename(current + '.valid', current);
    const member = join(registryRoot, 'activation-registry', 'profiles', a.hash + '.json');
    await rename(member, member + '.missing');
    expect((await request(parentPath)).status).toBe(503);
    await writeFile(member, '{}', { mode: 0o400 });
    expect((await request(parentPath)).status).toBe(503);
    await rename(member + '.missing', member);
    expect(await readView(historicalPath)).toEqual(historical);

    // Use the real reader but pause one route after it captures the immutable index.
    const c = { ...a, id: 'held-read-profile', scope: { ...a.scope, accountId: 'held-read-account' } };
    c.approvedLookups = c.approvedLookups.map(lookup => ({
      ...lookup, entries: lookup.entries.map(entry => ({ ...entry, target: c.scope.accountId })),
    }));
    c.hash = hashProfile(c);
    const old = await register(c, validSpecA, baselineManifestA);
    await publisher.publishRegisteredScopes([old]);
    const newManifest = {
      ...baselineManifestA, id: 'held-read-replacement', asOf: '2026-10-02T00:00:00.000Z',
    };
    newManifest.hash = hashManifest(newManifest);
    const changed = { ...c, version: c.version + 1 };
    changed.hash = hashProfile(changed);
    const replacement = await register(changed, validSpecA, newManifest);
    const bReplacement = { ...b, version: b.version + 1 };
    bReplacement.hash = hashProfile(bReplacement);
    const bSelection = await register(bReplacement, validSpecB, baselineManifestB);

    await worker.stop();
    const captured = Promise.withResolvers<void>();
    const paused = Promise.withResolvers<void>();
    holdRead = { captured: captured.resolve, resume: paused.promise };
    await worker.start();
    const heldPath = '/internal/parent/' + c.scope.accountId;
    const pending = readView(heldPath);
    try {
      await Promise.race([captured.promise, pending.then(() => { throw new Error('Read was not held'); })]);
      await publisher.publishRegisteredScopes([replacement, bSelection]);
    } finally {
      paused.resolve();
      await pending;
    }
    expect((await pending).records.asOf).toBe(baselineManifestA.asOf);
    expect((await readView(heldPath)).records.asOf).toBe(newManifest.asOf);
    await worker.stop();
    holdRead = undefined;
    await worker.start();
    expect(await (await request(bActivation)).json()).toEqual(paired);
    expect(await readView(approvedPath)).toEqual(approvedView);
    expect(await readView(historicalPath)).toEqual(historical);
    expect(await runtimeState()).toEqual(before);

    const foreignView = await readView('/internal/parent/' + b.scope.accountId);
    let reply: unknown = foreignView;
    const forged = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(reply));
    }).listen(0, '127.0.0.1');
    try {
      await once(forged, 'listening');
      const address = forged.address();
      if (!address || typeof address === 'string') throw new Error('Expected local HTTP test server');
      const untrusted = createParentReadClient('http://127.0.0.1:' + address.port, serviceToken, registryRoot);
      const grants = { caller: 'reviewer' as const, allowedAccountIds: [a.scope.accountId], allowedSourceRefs: [a.sourceRef] };
      for (const body of [foreignView, { ...historical, snapshotHash: '0'.repeat(64) }, { records: [] }]) {
        reply = body;
        await expect(untrusted.readTarget(a.scope, historical.asOf, grants)).rejects.toMatchObject({ statusCode: 503 });
      }
    } finally {
      await new Promise<void>((resolve, reject) => forged.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    try {
      await system?.close();
    } finally {
      await rm(registryRoot, { recursive: true, force: true });
    }
  }
});
