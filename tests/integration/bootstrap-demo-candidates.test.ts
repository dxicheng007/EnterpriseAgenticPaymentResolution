import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { hashProfile } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, readEvidence, readManifest } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

test('builds bootstrap metadata from each designated visible agreement with protected fixtures absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eapr-bootstrap-candidates-'));
  const truthRoot = join(directory, 'protected');
  try {
    const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('bootmeta') });
    try {
      const db = system.db.control;
      const store = await createEvidenceStore(join(directory, 'originals'));
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      const { captures } = await loadDemo(dependencies, { visibleRoot: join(directory, 'visible'), truthRoot });
      await rm(truthRoot, { recursive: true });
      const service = createSourceService(dependencies, localSourceCatalog);
      for (const capture of captures) {
        const source = localSourceCatalog.get(capture.companyId)!;
        const snapshot = await service.getSnapshot('snapshot:' + capture.manifestId);
        const manifest = await readManifest(db, capture.companyId, capture.manifestId);
        const events = await service.getSnapshotRecords(snapshot.id);
        const citations = await Promise.all(snapshot.evidenceIds.map(id => readEvidence(db, id, async () => {})));
        const citation = citations.find(item => item.evidence.sourceId === capture.contractFileId);
        const otherAgreement = citations.find(item =>
          item.evidence.locator.kind === 'pdf' && item.evidence.sourceId !== capture.contractFileId);
        const displayName = /Legal name (.+?) +Monthly fee USD /.exec(citation?.text.value ?? '')?.[1];
        if (!citation || !otherAgreement || !displayName) throw new Error('Expected visible agreements');
        const input = { source, capture, manifest, snapshot, events };
        const built = buildDemoCandidate({ ...input, citation });
        if (!('candidate' in built)) throw new Error(built.diagnostic.message);
        const { label, request } = built.candidate;
        const [profile] = request.profiles;
        expect(label).not.toBe(displayName);
        expect(profile).toMatchObject({
          version: 2,
          bootstrap: {
            customer: { id: profile!.parentCustomerId, displayName, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: profile!.contractTerms.map(term => ({ termId: term.id, id: 'configuration:' + term.id })),
          },
        });
        expect(profile!.hash).toBe(hashProfile(profile!));
        expect(request.spec.version).toBe(1);
        expect(buildDemoCandidate({ ...input, citation: otherAgreement })).toMatchObject({
          diagnostic: { code: 'DEMO_CANDIDATE_UNSUPPORTED' },
        });
      }
      expect(captures).toHaveLength(2);
    } finally {
      await system.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
