import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { compile } from '@eapr/compiler/compile';
import { pinProtectedFixture } from '../src/fixture-store.js';
import { createProtectedVerificationLauncher, validateReport } from '../src/verify.js';
import { expect, test } from 'vitest';
import { hashCanonical, hashProfile } from '@eapr/contracts';
import { baselineEventsA, baselineManifestA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { bindTruth, decodeTruth, verifyTruthMembers } from '../src/fixtures.js';

import { publicTruthFixture } from './public-truth-fixture.js';

test('truth_member_integrity rejects substituted or missing members and unknown truth fields', () => {
  const input = publicTruthFixture();
  const truth = decodeTruth(JSON.stringify({ ...input, inputEvents: [...input.inputEvents].reverse() }));
  expect(truth).toEqual(decodeTruth(JSON.stringify(input)));
  expect(() => decodeTruth(JSON.stringify({ ...input, extra: true }))).toThrow('Protected fixture invalid');
  expect(() => decodeTruth(JSON.stringify({ ...input, hash: '0'.repeat(64) }))).toThrow('Protected fixture invalid');
  const snapshot = { eventIds: baselineEventsA.map(event => event.id) };
  expect(() => verifyTruthMembers(truth, baselineManifestA, snapshot, baselineEventsA)).not.toThrow();
  expect(() => verifyTruthMembers(truth, baselineManifestA, snapshot, baselineEventsA.slice(1))).toThrow('Protected fixture invalid');
  expect(() => verifyTruthMembers(truth, baselineManifestA, snapshot, [...baselineEventsA, baselineEventsA[0]])).toThrow('Protected fixture invalid');
});

test('truth_profile_binding requires one exact approved scope and computes the public fixture anchor', () => {
  const truth = decodeTruth(JSON.stringify(publicTruthFixture()));
  expect(bindTruth(truth, [profileA])[0].reference.balanceCents).toBe(80000);
  const { hash: _hash, ...original } = truth;
  const subset = { ...original, accounts: [...truth.accounts, { sourceAccountId: 'other-account', records: [], balanceAnchorCents: null }] };
  expect(bindTruth(decodeTruth(JSON.stringify({ ...subset, hash: hashCanonical(subset) })), [profileA])).toHaveLength(1);
  const wrongAccount = { ...profileA, sourceAccountIds: ['wrong-account'] };
  wrongAccount.hash = hashProfile(wrongAccount);
  expect(() => bindTruth(truth, [wrongAccount])).toThrow('Protected fixture invalid');
  expect(() => bindTruth(truth, [profileA, profileA])).toThrow('Protected fixture invalid');
});

test('truth_isolation pins immutable fixture versions and uses the real bounded evaluator without exposing expected values', async () => {
  const manifest = baselineManifestA;
  const artifactResult = compile(validSpecA, [profileA]);
  if (!artifactResult.ok) throw new Error('Public fixture must compile');
  const { hash: _hash, ...publicFixture } = publicTruthFixture();
  const file = manifest.files[0];
  const truth = {
    ...publicFixture,
    fixtureSetId: 'public-test-' + randomUUID(),
    evidence: [{ fileId: file.fileId, originalSha256: file.sha256, text: 'PROTECTED-SENTINEL-EXPECTED-TEXT' }],
  };
  const evidenceIds: string[] = [];
  const eventIds = baselineEventsA.map(event => event.id).sort();
  const contentHash = hashCanonical({
    manifestHash: manifest.hash,
    streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
      .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
    files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 })),
    eventIds, evidenceIds,
  });
  const snapshot = {
    id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef,
    capturedAt: manifest.asOf, contentHash, eventIds, evidenceIds,
  };
  const candidate = { artifact: artifactResult.value, spec: validSpecA, profiles: [profileA], manifest, snapshot };
  const pinPath = new URL('../../../.local/protected-evaluator/' +
    hashCanonical([truth.fixtureSetId, truth.fixtureSetVersion]) + '.json', import.meta.url);
  try {
    const bundle = { manifest, snapshot, events: baselineEventsA };
    const pin = await pinProtectedFixture({ ...bundle, truthJson: JSON.stringify({ ...truth, hash: hashCanonical(truth) }) });
    expect(await pinProtectedFixture({ ...bundle, truthJson: JSON.stringify({ ...truth, hash: hashCanonical(truth) }) })).toEqual(pin);
    const changed = { ...truth, evidence: [{ ...truth.evidence[0], text: 'changed' }] };
    await expect(pinProtectedFixture({ ...bundle, truthJson: JSON.stringify({ ...changed, hash: hashCanonical(changed) }) })).rejects.toThrow();
    const launcher = createProtectedVerificationLauncher(async () => pin);
    const resolved = await launcher.resolve(candidate);
    const result = await launcher.launch('test-job', candidate, resolved);
    const { report, summary } = validateReport('test-job', candidate, resolved, result);
    expect(report.checks.find(check => check.id === 'baseline_reconcile')).toMatchObject({ status: 'passed', cases: 1 });
    expect(report.checks.find(check => check.id === 'evidence_support')).toMatchObject({ status: 'unavailable', cases: 0 });
    expect(summary).toMatchObject({ eligible: false, coverageComplete: false });
    expect(JSON.stringify(result)).not.toContain('PROTECTED-SENTINEL');
  } finally {
    await rm(pinPath, { force: true });
  }
});
