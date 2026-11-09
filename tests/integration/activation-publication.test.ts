import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import {
  ActivationBundleV2Schema, canonicalJson, bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases,
  hashBootstrapVerificationResult, hashProfile, hashActivationTrustPolicy, hashBundleV2,
  hashFinancialAttestation, hashFinancialReport, hashFinancialReservation, type ActivationBundleV2,
} from '@eapr/contracts';
import { publishActivationPolicy } from '@eapr/storage/activation-policy';
import { readActivationBundle } from '@eapr/storage/activation-registry';
import { createActivationPublication } from '../../apps/control/src/activation-publication.js';
import { baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../fixtures/index.js';

const h = (digit: string) => digit.repeat(64);
const issuerId = 'eapr-control-registry-1' as const;

function fixture(): ActivationBundleV2 {
  const [base, spec, manifest, bootstrapEvents, emptyTarget] = [profileA, validSpecA, baselineManifestA, baselineEventsA, emptyTargetA] as const;
  const company = 'a';
  const profile = {
    ...base,
    bootstrap: {
      customer: { id: base.parentCustomerId, displayName: ' Shared Buyer ', evidenceRefs: ['ev-name', 'ev-id'] },
      billingConfigurationIds: base.contractTerms.map(term => ({ termId: term.id, id: 'config:' + term.id })),
    },
  };
  profile.hash = hashProfile(profile);
  const compiled = compile(spec, [profile]);
  if (!compiled.ok) throw new Error('Expected a compiled public artifact');
  const artifact = compiled.value;
  const target = { ...emptyTarget, asOf: manifest.asOf };
  const previewPlan = planBootstrap(artifact, profile, bootstrapEvents, target).plans[0];
  if (!previewPlan) throw new Error('Expected public bootstrap preview plan');
  const jobId = 'financial:' + company;
  const verificationReport: ActivationBundleV2['verificationReport'] = {
    id: 'report:' + jobId, artifactHash: artifact.hash, profileHashes: [profile.hash], manifestHash: manifest.hash,
    harnessVersion: '1', evaluatorBuildHash: h('a'), fixtureSetId: 'financial-fixtures', fixtureSetVersion: '2',
    checks: [
      { id: 'new_record', status: 'unavailable', diagnosticCodes: ['FIRST', 'SECOND'], cases: 0 },
      { id: 'baseline_reconcile', status: 'unavailable', diagnosticCodes: [], cases: 0 },
    ],
    coverage: {
      required: ['new_record', 'baseline_reconcile'], executed: [], sourceRefs: [manifest.sourceRef],
      profileHashes: [profile.hash], eventKinds: ['payment', 'invoice'],
    },
    unexplainedDifferenceCents: 0, eligible: false, createdAt: manifest.asOf,
  };
  const snapshot = {
    id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
    contentHash: h('b'), evidenceIds: ['ev-id', 'ev-name'], eventIds: bootstrapEvents.map(event => event.id),
  };
  const reservation: ActivationBundleV2['financialAttestation']['reservation'] = {
    schemaVersion: '1', jobId, issuerId, runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1',
    evaluatorBuildHash: verificationReport.evaluatorBuildHash, purpose: 'construction',
    evidencePin: { fixtureSetId: verificationReport.fixtureSetId, fixtureSetVersion: '2', bundleHash: h('c') },
    artifactHash: artifact.hash, requiredProfileHashes: [profile.hash], hash: h('0'),
    capture: {
      companyId: profile.scope.companyId, sourceRef: manifest.sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
      snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, snapshotObjectHash: h('d'), eventsHash: h('e'),
    },
  };
  reservation.hash = hashFinancialReservation(reservation);
  const financialAttestation: ActivationBundleV2['financialAttestation'] = {
    schemaVersion: '1', reservation, reportId: verificationReport.id, reportHash: hashFinancialReport(verificationReport), hash: h('0'),
  };
  financialAttestation.hash = hashFinancialAttestation(financialAttestation);
  const bootstrapVerification: ActivationBundleV2['bootstrapVerification'] = {
    schemaVersion: '1', id: 'bootstrap-result:bootstrap-' + company, jobId: 'bootstrap-' + company,
    pin: {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: h('1'), subjectBuildHash: h('2'),
      fixtureSetId: 'bootstrap-fixtures', fixtureSetVersion: '1', fixtureHash: h('3'),
    },
    binding: {
      artifactHash: artifact.hash, profileHash: profile.hash, requiredProfileHashes: [profile.hash], scope: profile.scope,
      manifestId: manifest.id, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotHash: snapshot.contentHash,
      eventsHash: reservation.capture.eventsHash, targetSnapshotHash: h('4'), expectedTargetVersion: 0, asOf: manifest.asOf,
    },
    planHash: previewPlan.hash, passed: true, createdAt: manifest.asOf, hash: h('0'),
    assertions: bootstrapRequiredAssertions.map(id => ({ id, status: 'passed', caseIds: [...bootstrapAssertionCases[id]] })),
    cases: bootstrapRequiredCases.map(id => ({ id, status: 'passed' })),
  };
  bootstrapVerification.hash = hashBootstrapVerificationResult(bootstrapVerification);
  const reviewPackage = {
    id: 'review:' + company, revision: 1, hash: h('5'), scope: profile.scope,
    artifactHash: artifact.hash, profileHash: profile.hash, manifestHash: manifest.hash,
    verificationReportId: verificationReport.id, previewPlanHash: previewPlan.hash, expectedTargetVersion: 0,
    ready: false, diagnostics: [],
  };
  return {
    schemaVersion: '2', hash: h('0'), artifact, manifest, previewPlan, snapshot, profiles: [profile],
    bootstrapEvents, reviewPackage, verificationReport, bootstrapVerification, financialAttestation,
    request: {
      reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash, expectedArtifactHash: artifact.hash,
      expectedProfileHash: profile.hash, expectedTargetVersion: 0, idempotencyKey: 'development-request:' + company,
    },
    reviewer: { reviewerId: 'development-reviewer', sessionId: 'development-session' },
    semanticPreflight: { sourceRef: manifest.sourceRef, checkedAt: manifest.asOf, versions: manifest.semanticVersions },
    authorityPolicy: { issuerId, policyId: 'public-policy', policyHash: h('6') },
  };
}

test('publishes exact committed intent bytes after a transport failure and reads across policy rotation', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-intent-'));
  const registryRoot = join(root, 'artifacts');
  const policyRoot = join(root, 'policy');
  const bundle = ActivationBundleV2Schema.parse(fixture());
  bundle.hash = hashBundleV2(bundle);
  const intent = {
    intentId: 'committed-intent', bundleHash: bundle.hash, bundleBytes: Buffer.from(canonicalJson(bundle)),
    request: bundle.request, reviewer: bundle.reviewer,
  };
  const directory = join(registryRoot, 'activation-bundles');
  const file = join(directory, bundle.hash + '.json');
  const publisher = createActivationPublication({
    registryRoot, readCommittedIntent: async id => id === intent.intentId ? intent : null,
  });
  try {
    await expect(publisher.publishIntent('absent')).rejects.toThrow('ACTIVATION_INTENT_UNAVAILABLE');
    await mkdir(registryRoot, { mode: 0o700 });
    await writeFile(directory, 'interrupted local transport', { mode: 0o600 });
    await expect(publisher.publishIntent(intent.intentId)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
    await rm(directory);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(publisher.publishIntent(intent.intentId)).resolves.toEqual({
        bundleHash: bundle.hash, idempotencyKey: intent.request.idempotencyKey,
      });
      expect(await readFile(file)).toEqual(intent.bundleBytes);
    }
    const reservation = bundle.financialAttestation.reservation;
    for (const policyId of ['first-policy', 'second-policy']) {
      const policy = {
        schemaVersion: '1' as const, policyId, entries: [{
          issuerId, artifactHash: reservation.artifactHash, requiredProfileHashes: reservation.requiredProfileHashes,
          selectedProfileHash: bundle.request.expectedProfileHash, scope: bundle.reviewPackage.scope,
          capture: reservation.capture, bootstrapPin: bundle.bootstrapVerification.pin,
          financial: {
            runnerId: reservation.runnerId, protocolVersion: reservation.protocolVersion,
            harnessVersion: reservation.harnessVersion, evaluatorBuildHash: reservation.evaluatorBuildHash,
            evidencePin: reservation.evidencePin,
          },
        }],
      };
      await publishActivationPolicy({ policyRoot }, { ...policy, hash: hashActivationTrustPolicy(policy) }, true);
      expect((await readActivationBundle({ registryRoot }, bundle.hash)).hash).toBe(bundle.hash);
    }
    await rm(file);
    await writeFile(file, intent.bundleBytes.subarray(0, -1), { mode: 0o600 });
    await expect(publisher.publishIntent(intent.intentId)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
    await expect(readActivationBundle({ registryRoot }, bundle.hash)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
    expect(await readFile(file)).toEqual(intent.bundleBytes.subarray(0, -1));
    await rm(file);
    const target = join(directory, 'external.json');
    await writeFile(target, intent.bundleBytes, { mode: 0o600 });
    await symlink(target, file);
    await expect(publisher.publishIntent(intent.intentId)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
    await expect(readActivationBundle({ registryRoot }, bundle.hash)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects association and byte mismatches before writing a registry', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-intent-mismatch-'));
  const registryRoot = join(root, 'missing-registry');
  const bundle = ActivationBundleV2Schema.parse(fixture());
  bundle.hash = hashBundleV2(bundle);
  const intent = {
    intentId: 'committed-intent', bundleHash: bundle.hash, bundleBytes: Buffer.from(canonicalJson(bundle)),
    request: bundle.request, reviewer: bundle.reviewer,
  };
  try {
    for (const altered of [
      { ...intent, intentId: 'other' },
      { ...intent, request: { ...intent.request, expectedTargetVersion: 1 } },
      { ...intent, request: { ...intent.request, idempotencyKey: 'other' } },
      { ...intent, reviewer: { ...intent.reviewer, reviewerId: 'other' } },
      { ...intent, bundleHash: h('0') },
      { ...intent, bundleBytes: Buffer.from(canonicalJson(bundle) + '\n') },
      { ...intent, bundleBytes: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ]) {
      const publisher = createActivationPublication({ registryRoot, readCommittedIntent: async () => altered });
      await expect(publisher.publishIntent(intent.intentId)).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
    }
    await expect(readFile(join(registryRoot, 'activation-bundles', bundle.hash + '.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
