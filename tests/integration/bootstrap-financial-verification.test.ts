import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import {
  CustomerProfileSchema, FindingSchema, VerificationReportSchema, hashBytes, hashCanonical, hashProfile,
  type ConnectorSpec, type CustomerProfile,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { createCandidateRegistry, createVerificationJobs } from '../../packages/evaluator/src/registry.js';
import { createProtectedVerificationLauncher, mandatoryChecks, validateReport } from '../../packages/evaluator/src/verify.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { captureEvidenceFixture } from '../fixtures/evidence-v2-capture.js';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

function sealProfile(profile: CustomerProfile) {
  return CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });
}

test('reissues full financial coverage for the exact registered bootstrap-bearing A and B subjects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eapr-bootstrap-financial-'));
  const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'private') };
  const ownedPins = new Set<URL>();
  try {
    const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('bootfinance') });
    try {
      const db = system.db.control;
      const store = await createEvidenceStore(join(directory, 'originals'));
      const registry = createCandidateRegistry(db, join(directory, 'registry'));
      await generateFixtures({ ...roots, seed: 'bootstrap-financial-' + randomUUID(), asOf: '2026-10-01T00:00:00.000Z' });
      for (const company of ['a', 'b'] as const) {
        const { input, source, contractFileId } = await captureEvidenceFixture({
          db, store, clock: () => new Date('2026-11-08T00:00:00.000Z'),
        }, roots, company);
        const { manifest, snapshot, events } = input;
        const producer = decodeTruth(input.producerTruthJson);
        const pinPath = new URL('../../.local/protected-evaluator/' +
          hashCanonical([producer.fixtureSetId, '2']) + '.json', import.meta.url);
        await expect(lstat(pinPath)).rejects.toMatchObject({ code: 'ENOENT' });
        const pin = await pinProtectedEvidenceFixture(input);
        ownedPins.add(pinPath);
        const pinHash = hashBytes(await readFile(pinPath));
        const launcher = createProtectedVerificationLauncher(async () => pin);
        const jobs = createVerificationJobs(db, launcher);
        const citation = input.citations.find(item => item.evidence.sourceId === contractFileId);
        const built = buildDemoCandidate({
          source, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
          manifest, snapshot, events, citation,
        });
        if (!('candidate' in built) || !citation) throw new Error('Expected captured agreement and candidate');
        const { spec, profiles: [original] } = built.candidate.request;
        const displayName = /Legal name (.+?) +Monthly fee USD /.exec(citation.text.value)?.[1];
        if (!displayName) throw new Error('Expected visible legal name');
        const reviewed = sealProfile({
          ...original, version: original.version + 1,
          bootstrap: {
            customer: { id: original.parentCustomerId, displayName, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: original.contractTerms.map(term => ({ termId: term.id, id: 'configuration:' + term.id })),
          },
        });

        async function verify(profile: CustomerProfile, connector: ConnectorSpec = spec) {
          const compiled = compile(connector, [profile]);
          if (!compiled.ok) throw new Error('Expected test subject to compile: ' + JSON.stringify(compiled.diagnostics));
          const registration = { spec: connector, profiles: [profile], artifact: compiled.value, manifest, snapshot };
          await registry.registerCandidate(registration);
          const subject = await registry.getCandidate(compiled.value.hash, manifest.id);
          expect(subject).toEqual(registration);
          const { jobId } = await jobs.enqueue(subject);
          await jobs.drain();
          const { job } = await jobs.get(jobId);
          expect(job.state).toBe('completed');
          const { rows } = await db.query('SELECT report FROM verification_reports WHERE job_id = $1', [jobId]);
          expect(rows).toHaveLength(1);
          const report = VerificationReportSchema.parse(rows[0].report);
          return { jobId, subject, report };
        }

        const old = await verify(original);
        expect(old.report.eligible).toBe(true);
        const fresh = await verify(reviewed);
        expect(fresh.report.checks.map(({ id, status }) => [id, status]))
          .toEqual(mandatoryChecks.map(id => [id, 'passed']));
        expect(fresh.report).toMatchObject({
          id: 'report:' + fresh.jobId, artifactHash: fresh.subject.artifact.hash,
          manifestHash: manifest.hash, profileHashes: [reviewed.hash], fixtureSetVersion: '2',
          eligible: true, unexplainedDifferenceCents: 0,
        });
        expect(fresh.report.checks.reduce((total, check) => total + check.cases, 0)).toBe(company === 'a' ? 53 : 57);
        expect(fresh.subject.artifact.hash).not.toBe(old.subject.artifact.hash);
        expect(fresh.report.id).not.toBe(old.report.id);
        expect(fresh.report.profileHashes).not.toEqual(old.report.profileHashes);
        const resolved = await launcher.resolve(fresh.subject);
        expect(fresh.report.evaluatorBuildHash).toBe(resolved.evaluatorBuildHash);
        expect(() => validateReport(old.jobId, fresh.subject, resolved, old.report))
          .toThrow('Verification report binding failed');

        if (company === 'a') {
          const money = sealProfile({
            ...reviewed, version: reviewed.version + 1,
            contractTerms: reviewed.contractTerms.map(term => ({ ...term, fixedMonthlyFeeCents: term.fixedMonthlyFeeCents + 1 })),
          });
          const evidence = sealProfile({
            ...reviewed, version: reviewed.version + 2,
            contractTerms: reviewed.contractTerms.map(term => ({ ...term, evidenceRefs: ['unsupported-citation'] })),
          });
          const finding = sealProfile({
            ...reviewed, version: reviewed.version + 3,
            findings: [FindingSchema.parse({
              id: 'reviewed-observation', scope: reviewed.scope, taskId: 'test-review', fieldPath: '/amountCents',
              value: 300000, origin: 'reviewer', provenanceClass: 'observed', evidenceStatus: 'supported',
              reviewDisposition: 'confirmed', evidenceRefs: [citation.evidence.id], derivationInputs: [], revision: 1,
            })],
          });
          for (const [profile, status] of [[money, 'failed'], [evidence, 'failed'], [finding, 'unavailable']] as const) {
            const { report } = await verify(profile);
            expect(report.eligible).toBe(false);
            expect(report.checks.find(check => check.id === 'evidence_support')).toMatchObject({ status });
          }
        } else {
          const wrongMapping = structuredClone(spec);
          wrongMapping.version += 1;
          wrongMapping.mappings.find(mapping => mapping.kind === 'allocation')!.fields.fundingKind = {
            op: 'enum_lookup', path: '/receipt_type', values: { payment: 'payment', credit: 'payment' },
          };
          const { report } = await verify(reviewed, wrongMapping);
          expect(report.eligible).toBe(false);
          expect(report.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'baseline_reconcile', status: 'passed' }),
            expect.objectContaining({ id: 'new_record', status: 'failed' }),
            expect.objectContaining({ id: 'evidence_support', status: 'failed' }),
          ]));
        }
        expect(hashBytes(await readFile(pinPath))).toBe(pinHash);
      }
    } finally {
      await system.close();
    }
  } finally {
    await Promise.all([...ownedPins].map(path => rm(path, { force: true })));
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
