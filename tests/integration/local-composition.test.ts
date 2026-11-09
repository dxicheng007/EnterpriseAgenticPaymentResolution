import Fastify from 'fastify';
import { expect, test } from 'vitest';
import { createLocalSessionService } from '../../apps/control/src/local-session.js';

const origin = 'http://127.0.0.1:5173';
const headers = { origin, 'X-EAPR-Local-UI': '1', 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json' };

test('bootstraps a transparent session and requires its CSRF token for mutations', async () => {
  const service = createLocalSessionService({
    webOrigin: origin, reviewerId: 'demo-reviewer',
    allowedSourceRefs: ['source-a'], allowedAccountIds: ['company-a.seller-a.account-a'],
  });
  const app = Fastify();
  await app.register(service.plugin);
  app.get('/api/read', request => service.authorizeReviewer(request, { mutation: false }));
  app.post('/api/mutate', request => service.authorizeReviewer(request, { mutation: true }));
  try {
    const bootstrap = (extra = {}, payload: unknown = {}, requestHeaders = headers) =>
      app.inject({ method: 'POST', url: '/api/local-session', headers: { ...requestHeaders, ...extra }, payload: JSON.stringify(payload) });
    const first = await bootstrap();
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.json()).toMatchObject({ demoOnly: true, reviewer: { reviewerId: 'demo-reviewer' } });
    const cookieHeader = first.cookies[0]!;
    expect(cookieHeader).toMatchObject({ name: 'eapr_local_reviewer', httpOnly: true, sameSite: 'Strict', path: '/api' });
    expect(cookieHeader).not.toHaveProperty('maxAge');
    expect(cookieHeader).not.toHaveProperty('domain');
    expect(first.body).not.toContain(cookieHeader.value);
    const cookie = cookieHeader.name + '=' + cookieHeader.value;
    const repeated = await bootstrap({ cookie });
    expect(repeated.json()).toEqual(first.json());
    expect(repeated.cookies).toHaveLength(0);
    expect((await bootstrap({ origin: 'http://127.0.0.1:5555' })).statusCode).toBe(403);
    expect((await bootstrap({}, {}, { ...headers, origin: '' })).statusCode).toBe(403);
    expect((await bootstrap({ 'Sec-Fetch-Site': 'cross-site' })).statusCode).toBe(403);
    expect((await bootstrap({}, { reviewerId: 'other' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'OPTIONS', url: '/api/local-session', headers: { origin: 'http://127.0.0.1:5555', 'access-control-request-method': 'POST' } })).headers['access-control-allow-origin']).toBeUndefined();
    for (const badCookie of ['', 'eapr_local_reviewer=forged']) {
      expect((await app.inject({ url: '/api/read', headers: { cookie: badCookie } })).statusCode).toBe(401);
    }
    expect((await app.inject({ url: '/api/read', headers: { cookie } })).statusCode).toBe(200);
    for (const name of ['authorization', 'x-eapr-service-token', 'x-eapr-task-token']) {
      expect((await app.inject({ url: '/api/read', headers: { cookie, [name]: 'present' } })).statusCode).toBe(403);
      expect((await bootstrap({ cookie, [name]: 'present' })).statusCode).toBe(403);
    }
    const mutate = (token: string, requestOrigin = origin) => app.inject({
      method: 'POST', url: '/api/mutate', headers: { cookie, origin: requestOrigin, 'x-eapr-csrf': token },
    });
    expect((await mutate('wrong')).statusCode).toBe(403);
    expect((await mutate(first.json().csrfToken, '')).statusCode).toBe(403);
    expect((await mutate(first.json().csrfToken)).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

test('loads both generated captures once and previews their cited candidate scopes without parent writes', async () => {
  const { mkdtemp, readFile, rm, symlink, unlink, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { createLocalComposition, localSourceCatalog } = await import('../../apps/control/src/composition.js');
  const { buildDemoCandidate } = await import('../../apps/control/src/demo-candidates.js');
  const { createSourceService, readManifest } = await import('@eapr/sources');
  const { loadDemo } = await import('../../scripts/load-demo.js');
  const { createEvidenceStore } = await import('@eapr/evidence');
  const { DemoCandidatesResponseSchema, EvidenceResponseSchema, PreviewResponseSchema, SourceDossierSchema, hashBytes } =
    await import('@eapr/contracts');
  const { createTestSystem, testNamespace } = await import('../fixtures/harness.js');
  const directory = await mkdtemp(join(tmpdir(), 'eapr-local-demo-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected') };
  const store = await createEvidenceStore(join(directory, 'evidence'));

  try {
    const system = await createTestSystem({
      modelMode: 'disabled', dbNamespace: testNamespace('localdemo'),
      async controlPluginFactory(services) {
        const dependencies = { ...services, store };
        const loaded = await loadDemo(dependencies, roots);
        const tables = ['source_files', 'source_events', 'source_manifests', 'source_snapshots',
          'source_dossiers', 'source_evidence', 'activity_events'];
        const readState = () => Promise.all(tables.map(table =>
          services.db.query('SELECT to_jsonb(t) AS row FROM ' + table + ' AS t ORDER BY to_jsonb(t)').then(result => result.rows)));
        const before = await readState();
        expect(await loadDemo(dependencies, roots)).toEqual(loaded);
        expect(await readState()).toEqual(before);
        const uploads = join(roots.visibleRoot, 'uploads-b.json');
        const original = await readFile(uploads, 'utf8');
        const changed = JSON.parse(original);
        changed[0].path = '../protected/expected-b.json';
        await writeFile(uploads, JSON.stringify(changed));
        await expect(loadDemo(dependencies, roots)).rejects.toThrow();
        expect(await readState()).toEqual(before);
        await writeFile(uploads, original);
        const symlinked = join(roots.visibleRoot, 'b-batch-1.csv');
        const originalBatch = await readFile(symlinked);
        await unlink(symlinked);
        await symlink(join(roots.truthRoot, 'expected-b.json'), symlinked);
        await expect(loadDemo(dependencies, roots)).rejects.toThrow('escapes its root');
        expect(await readState()).toEqual(before);
        await unlink(symlinked);
        await writeFile(symlinked, originalBatch);
        const fixtureTarget: import('@eapr/compiler/preview-adapters').TargetReader = {
  // Explicit version-zero fixture for this isolated source composition test.
  async readTarget(scope, asOf) {
    return {
      scope, asOf, version: 0, invoices: [], payments: [], credits: [], allocations: [], reversals: [],
      customers: [], accounts: [], billingConfigurations: [],
    };
  },
};
        const options = { webOrigin: origin, captures: loaded.captures, fixtureTarget };
        const first = await createLocalComposition(dependencies, options);
        const restarted = await createLocalComposition(dependencies, options);
        const inProcess = Fastify();
        for (const plugin of first.featurePlugins) inProcess.register(plugin, services);
        inProcess.get('/operator-probe', async request => {
          await expect(first.authorizeSource(request, {
            companyId: 'company-a', sourceRef: 'legacy-a', operation: 'operator',
          })).rejects.toMatchObject({ status: 403, code: 'LOCAL_SESSION_FORBIDDEN' });
          return { denied: true };
        });
        try {
          const result = await inProcess.inject({ method: 'POST', url: '/api/local-session', headers, payload: '{}' });
          expect(result.statusCode).toBe(200);
          const cookie = 'eapr_local_reviewer=' + result.cookies[0]!.value;
          expect((await inProcess.inject({ url: '/operator-probe', headers: { cookie } })).json()).toEqual({ denied: true });
          const beforeRestart = await inProcess.inject({ url: '/api/demo/candidates', headers: { cookie } });
          expect(beforeRestart.statusCode).toBe(200);
          const restartedApp = Fastify();
          for (const plugin of restarted.featurePlugins) restartedApp.register(plugin, services);
          try {
            expect((await restartedApp.inject({ url: '/api/demo/candidates', headers: { cookie } })).statusCode).toBe(401);
            const newSession = await restartedApp.inject({ method: 'POST', url: '/api/local-session', headers, payload: '{}' });
            expect(newSession.cookies[0]!.value).not.toBe(result.cookies[0]!.value);
            const afterRestart = await restartedApp.inject({
              url: '/api/demo/candidates', headers: { cookie: 'eapr_local_reviewer=' + newSession.cookies[0]!.value },
            });
            expect(afterRestart.json()).toEqual(beforeRestart.json());
          } finally {
            await restartedApp.close();
          }
        } finally {
          await inProcess.close();
        }
        return restarted.featurePlugins;
      },
    });

    try {
      expect((await system.control.getHealth()).status).toBe(200);
      const session = await fetch(system.control.origin + '/api/local-session', { method: 'POST', headers, body: '{}' });
      expect(session.status).toBe(200);
      const cookie = session.headers.getSetCookie()[0]!.split(';', 1)[0]!;
      const csrfToken = (await session.json()).csrfToken as string;
      const catalog = DemoCandidatesResponseSchema.parse(
        (await system.control.request('/api/demo/candidates', { headers: { cookie } })).body);
      expect(catalog).toMatchObject({ verificationAvailable: false, targetMode: 'empty-fixture', diagnostics: [] });
      expect(catalog.candidates.map(candidate => candidate.companyId)).toEqual(['company-a', 'company-b']);
      const runtimeState = async () => ({
        tables: (await system.db.runtime.query(
          "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")).rows,
        rows: await Promise.all(['migration_ledger', 'seed_ledger', 'activity_counter', 'activity_events'].map(table =>
          system.db.runtime.query('SELECT to_jsonb(t) AS row FROM ' + table + ' AS t ORDER BY to_jsonb(t)').then(result => result.rows))),
      });
      const runtimeBefore = await runtimeState();

      for (const candidate of catalog.candidates) {
        const { companyId, request, snapshotId } = candidate;
        const dossier = SourceDossierSchema.parse((await system.control.request('/api/sources/' + companyId + '/dossier', { headers: { cookie } })).body);
        expect(dossier).toMatchObject({ complete: true, snapshotIds: [snapshotId], missingMembers: [] });
        const citation = request.spec.evidenceRefs[0]!;
        expect(dossier.evidenceIds).toContain(citation);
        const path = '/api/evidence/' + citation;
        const denied = await system.control.request(path, { headers: { cookie, authorization: 'Bearer secret-test' } });
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({ code: 'LOCAL_SESSION_FORBIDDEN', diagnostics: [] });
        expect(denied.body).not.toHaveProperty('evidence');
        expect((await system.control.request(path)).status).toBe(401);
        const evidence = EvidenceResponseSchema.parse((await system.control.request(path, { headers: { cookie } })).body);
        expect(evidence.evidence).toMatchObject({ snapshotId, locator: { kind: 'pdf', page: 1 } });
        const source = localSourceCatalog.get(companyId)!;
        const manifest = await readManifest(system.db.control, companyId, dossier.manifestId);
        const sourceService = createSourceService({ db: system.db.control, store, clock: () => new Date() }, localSourceCatalog);
        const corruptText = evidence.text.value.replace('USD', 'EUR');
        expect(corruptText).not.toEqual(evidence.text.value);
        const unsupported = buildDemoCandidate({
          source, manifest, capture: { companyId, manifestId: manifest.id, contractFileId: evidence.evidence.sourceId },
          snapshot: await sourceService.getSnapshot(snapshotId), events: await sourceService.getSnapshotRecords(snapshotId),
          citation: { ...evidence, evidence: { ...evidence.evidence, excerpt: corruptText }, text: {
            ...evidence.text, value: corruptText, sha256: hashBytes(Buffer.from(corruptText)),
          } },
        });
        expect(unsupported).toEqual({ diagnostic: expect.objectContaining({
          code: 'DEMO_CANDIDATE_UNSUPPORTED', sourceIds: [citation],
        }) });
        const original = await fetch(system.control.origin + evidence.original.url, { headers: { cookie } });
        expect(original.status).toBe(200);
        expect(hashBytes(Buffer.from(await original.arrayBuffer()))).toBe(evidence.original.sha256);
        const deniedOriginal = await fetch(system.control.origin + evidence.original.url, { headers: { cookie: 'eapr_local_reviewer=forged' } });
        expect(deniedOriginal.status).toBe(401);
        expect(deniedOriginal.headers.get('content-type')).toContain('application/json');

        const previewPath = '/api/connectors/preview';
        const options = { method: 'POST', body: request, headers: { cookie, origin, 'x-eapr-csrf': csrfToken } };
        expect((await system.control.request(previewPath, { ...options, headers: { cookie, origin } })).status).toBe(403);
        expect((await system.control.request(previewPath, {
          ...options, body: { ...request, snapshotId: 'snapshot:missing' },
        })).status).toBe(404);
        const [profile] = request.profiles;
        expect((await system.control.request(previewPath, {
          ...options, body: { ...request, profiles: [{ ...profile, scope: { ...profile.scope, accountId: 'unauthorized' } }] },
        })).status).toBe(403);
        const response = await system.control.request(previewPath, options);
        expect(response.status).toBe(200);
        const preview = PreviewResponseSchema.parse(response.body);
        expect(preview.artifact?.sourceRef).toBe(candidate.sourceRef);
        expect(preview.parentWrites).toBe(0);
        expect(preview.diffs).toEqual([expect.objectContaining({
          scope: candidate.scope, beforeVersion: 0, beforeBalanceCents: 0,
          afterBalanceCents: companyId === 'company-a' ? 80000 : 0,
        })]);
        expect(preview.unsupportedRows.some(row => row.code === 'UNKNOWN_ACCOUNT')).toBe(true);
        if (companyId === 'company-b') {
          expect(preview.unsupportedRows.some(row => row.eventIds.some(id => id.startsWith('evt:pay-b:unresolved-')))).toBe(true);
        }
      }
      expect(await runtimeState()).toEqual(runtimeBefore);
    } finally {
      await system.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
