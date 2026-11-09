import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, DemoCandidatesResponseSchema, hashCanonical, hashTargetSnapshot, ParentViewSchema, PreviewResponseSchema, targetRecordId } from '@eapr/contracts';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { withTransaction } from '@eapr/storage/transaction';
import { createEvidenceStore } from '@eapr/evidence';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { createLocalComposition } from '../../apps/control/src/composition.js';
import { createParentReadClient } from '../../apps/control/src/parent-read-client.js';
import { composeWorkerParentReads } from '../../apps/worker/src/parent-read-composition.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { localPort } from '../../scripts/native-db.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

test('registers both source subjects before preview and enables real proxy reads after explicit publication', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-parent-composition-'));
  const registryRoot = join(directory, 'artifacts');
  const origin = 'http://127.0.0.1:' + localPort('EAPR_WEB_PORT', 5173);
  let serviceToken = '';
  let system: Awaited<ReturnType<typeof createTestSystem>> | undefined;
  try {
    const store = await createEvidenceStore(join(directory, 'evidence'));
    system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('parentcomp'),
      workerPlugins: [async (app, services) => {
        serviceToken = services.serviceToken;
        await composeWorkerParentReads(registryRoot)(app, services);
      }],
      async controlPluginFactory({ db, clock }) {
        const dependencies = { db, clock, store };
        const { captures } = await loadDemo(dependencies, {
          visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'truth'),
        });
        return (await createLocalComposition(dependencies, {
          webOrigin: origin, captures, registry: createCandidateRegistry(db, registryRoot),
          parentReads: createParentReadClient('http://127.0.0.1:' + localPort('EAPR_WORKER_PORT', 3002), serviceToken, registryRoot),
        })).featurePlugins;
      },
    });
    const { control, db, worker } = system;
    const tableNames = await db.runtime.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    );
    const runtimeState = () => Promise.all(tableNames.rows.map(({ tablename }) =>
      db.runtime.query('SELECT to_jsonb(t) AS row FROM ' + tablename + ' t ORDER BY to_jsonb(t)').then(result => result.rows)));
    const before = await runtimeState();
    const bootstrap = await fetch(control.origin + '/api/local-session', {
      method: 'POST', headers: { origin, 'x-eapr-local-ui': '1', 'content-type': 'application/json' }, body: '{}',
    });
    expect(bootstrap.status).toBe(200);
    const cookie = bootstrap.headers.getSetCookie()[0]!.split(';')[0]!;
    const headers = { cookie, origin, 'x-eapr-csrf': (await bootstrap.json()).csrfToken };
    const readCatalog = async () => DemoCandidatesResponseSchema.parse(
      (await control.request('/api/demo/candidates', { headers })).body,
    );
    const catalog = await readCatalog();
    expect(catalog).toMatchObject({
      targetMode: 'persisted-parent', verificationAvailable: false,
      diagnostics: [expect.objectContaining({ code: 'PARENT_READ_UNAVAILABLE', severity: 'blocker' })],
    });
    expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
    const registry = createCandidateRegistry(db.control, registryRoot);
    const selections = [];
    for (const candidate of catalog.candidates) {
      const { scope, request, snapshotId } = candidate;
      const compiled = compile(request.spec, request.profiles);
      if (!compiled.ok) throw new Error('Expected a compiled source candidate');
      const manifestId = snapshotId.slice('snapshot:'.length);
      const selectedProfileHash = request.profiles[0]!.hash;
      expect((await registry.getCandidate(compiled.value.hash, manifestId)).profiles[0]!.hash).toBe(selectedProfileHash);
      selections.push({ artifactHash: compiled.value.hash, manifestId, selectedProfileHash });

      const parentPath = '/api/parent/' + scope.accountId;
      expect((await control.request(parentPath)).status).toBe(401);
      expect((await control.request(parentPath, { headers })).status).toBe(503);
      expect((await control.request('/api/sources/' + scope.companyId + '/dossier', { headers })).status).toBe(200);
      expect(await control.request('/api/connectors/preview', { method: 'POST', headers, body: request }))
        .toMatchObject({ status: 503, body: { code: 'PREVIEW_DEPENDENCY_UNAVAILABLE' } });
    }
    await createRegisteredScopePublication({ registryRoot, candidates: registry }).publishRegisteredScopes(selections);
    expect((await readCatalog()).diagnostics).toEqual([]);
    expect((await control.request('/api/parent/ungranted', { headers })).status).toBe(403);
    const previews = [];
    for (const { scope, request } of catalog.candidates) {
      const parentPath = '/api/parent/' + scope.accountId;
      const parent = await control.request(parentPath + '?asOf=' + encodeURIComponent(request.asOf), { headers });
      expect(parent.status).toBe(200);
      const view = ParentViewSchema.parse(parent.body);
      expect(view).toMatchObject({ scope, version: 0, balanceCents: 0, asOf: request.asOf, records: { asOf: request.asOf } });
      expect(await control.request('/api/accounts/' + scope.accountId + '/activation', { headers }))
        .toMatchObject({ status: 200, body: { schemaVersion: '1', scope, activation: null, initialReceipt: null } });
      expect((await control.request(parentPath + '?snapshotHash=' + view.snapshotHash, { headers })).status).toBe(404);
      expect((await control.request(parentPath + '?snapshotHash=bad', { headers })).status).toBe(400);
      const preview = await control.request('/api/connectors/preview', { method: 'POST', headers, body: request });
      expect(preview.status).toBe(200);
      const result = PreviewResponseSchema.parse(preview.body);
      previews.push({ scope, view, request, result });
      expect(result).toMatchObject({
        parentWrites: 0, diffs: [{ scope, beforeVersion: 0, beforeBalanceCents: 0 }],
      });
      expect((await control.request('/api/connectors/preview', {
        method: 'POST', headers: { cookie, origin }, body: request,
      })).status).toBe(403);
    }
    await worker.stop();
    expect((await readCatalog()).diagnostics).toMatchObject([{ code: 'PARENT_READ_UNAVAILABLE' }]);
    await worker.start();
    expect((await readCatalog()).diagnostics).toEqual([]);
    expect(await runtimeState()).toEqual(before);

    // Install a persisted parent-only invoice to prove the preview uses worker records.
    const { scope, view, request, result } = previews[0]!;
    const invoice = result.diffs[0]!.operations.find(op => op.op === 'insert_invoice')!.record;
    const identity = { ...invoice.identity, recordId: 'existing-parent-invoice' };
    const records = { ...view.records, version: 1, invoices: [
      { ...invoice, id: targetRecordId(identity), identity, sourceEventId: 'existing-parent-delivery', amountCents: 12345 },
    ] };
    await withTransaction(db.runtime, async client => {
      const key = [scope.accountId, scope.companyId, scope.sellerEntityId];
      await client.query('INSERT INTO parent_scopes VALUES ($1, $2, $3)', key);
      await client.query('INSERT INTO parent_snapshots VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [...key, records.version, hashTargetSnapshot(records), records.asOf, canonicalJson(records), hashCanonical(records)]);
      await client.query('INSERT INTO parent_targets VALUES ($1, $2, $3, $4, $5)',
        [...key, records.version, hashTargetSnapshot(records)]);
    });
    const storedBefore = await runtimeState();
    const persisted = await control.request('/api/connectors/preview', { method: 'POST', headers, body: request });
    expect(persisted.status).toBe(200);
    expect(PreviewResponseSchema.parse(persisted.body)).toMatchObject({
      parentWrites: 0, diffs: [{ scope, beforeVersion: 1, beforeBalanceCents: 12345, afterBalanceCents: 92345 }],
    });
    expect(await runtimeState()).toEqual(storedBefore);
  } finally {
    try {
      await system?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
