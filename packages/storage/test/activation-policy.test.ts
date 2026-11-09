import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { canonicalJson, hashActivationTrustPolicy, type ActivationTrustPolicyEntryV1 } from '@eapr/contracts';
import { loadActivationPolicy, publishActivationPolicy } from '../src/activation-policy.js';

const h = (digit: string) => digit.repeat(64);
const entry: ActivationTrustPolicyEntryV1 = {
  issuerId: 'eapr-control-registry-1',
  financial: {
    runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1', evaluatorBuildHash: h('1'),
    evidencePin: { fixtureSetId: 'financial', fixtureSetVersion: '2', bundleHash: h('2') },
  },
  bootstrapPin: {
    runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: h('3'), subjectBuildHash: h('4'),
    fixtureSetId: 'bootstrap', fixtureSetVersion: '1', fixtureHash: h('5'),
  },
  scope: { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' },
  capture: {
    companyId: 'company', sourceRef: 'source', manifestId: 'manifest', manifestHash: h('6'),
    snapshotId: 'snapshot:manifest', snapshotHash: h('7'), snapshotObjectHash: h('8'), eventsHash: h('9'),
  },
  artifactHash: h('a'), requiredProfileHashes: [h('c'), h('b')], selectedProfileHash: h('b'),
};
const second = { ...entry, financial: { ...entry.financial, evaluatorBuildHash: h('e') }, artifactHash: h('f') };
const makePolicy = (entries = [entry, second], policyId = 'policy') => {
  const input = { schemaVersion: '1' as const, policyId, entries };
  return { ...input, hash: hashActivationTrustPolicy(input) };
};
let root: string;
let policyPath: string;
beforeEach(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-policy-'));
  policyPath = join(root, 'current.json');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test('prepares canonical history, explicitly installs, and isolates independently loaded policies', async () => {
  const policy = makePolicy();
  await publishActivationPolicy({ policyRoot: root }, policy);
  await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_UNAVAILABLE');
  await publishActivationPolicy({ policyRoot: root }, makePolicy([second, entry]), true);
  const a = await loadActivationPolicy({ policyPath });
  const b = await loadActivationPolicy({ policyPath });
  expect(a).toEqual(b);
  expect(a).not.toBe(b);
  expect(a.hash).toBe(policy.hash);
  expect(a.entries[0]?.requiredProfileHashes).toEqual([h('b'), h('c')]);
  expect(Object.isFrozen(a.entries[0]?.financial.evidencePin)).toBe(true);
  const rotated = makePolicy([second], 'rotated');
  await publishActivationPolicy({ policyRoot: root }, rotated, true);
  expect((await loadActivationPolicy({ policyPath })).hash).toBe(rotated.hash);
  expect(a.hash).toBe(policy.hash);
});

test('rejects empty, noncanonical, and altered indivisible authority tuples', async () => {
  await expect(publishActivationPolicy({ policyRoot: root }, makePolicy([]), true)).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
  const policy = makePolicy();
  for (const altered of [
    { ...entry, issuerId: 'foreign' },
    { ...entry, artifactHash: h('e') },
    { ...entry, selectedProfileHash: h('c') },
    { ...entry, requiredProfileHashes: [h('b')] },
    { ...entry, scope: { ...entry.scope, accountId: 'other' } },
    { ...entry, capture: { ...entry.capture, eventsHash: h('e') } },
    { ...entry, bootstrapPin: { ...entry.bootstrapPin, fixtureHash: h('e') } },
    { ...entry, financial: { ...entry.financial, evidencePin: { ...entry.financial.evidencePin, bundleHash: h('e') } } },
    { ...entry, financial: second.financial },
  ]) {
    await writeFile(policyPath, canonicalJson({ ...policy, entries: [altered, second] }), { mode: 0o600 });
    await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
  }
  await publishActivationPolicy({ policyRoot: root }, policy, true);
  const parsed = await loadActivationPolicy({ policyPath });
  await rm(policyPath);
  await writeFile(policyPath, canonicalJson(parsed) + '\n', { mode: 0o600 });
  await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
});

test('rejects untrusted directory, symlink, oversized content and immutable collisions', async () => {
  const policy = makePolicy();
  await publishActivationPolicy({ policyRoot: root }, policy, true);
  const candidatePath = join(root, 'policies', policy.hash + '.json');
  await chmod(root, 0o755);
  await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
  await chmod(root, 0o700);
  await rm(policyPath);
  await symlink(candidatePath, policyPath);
  await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
  await rm(policyPath);
  await writeFile(policyPath, Buffer.alloc(10 * 1024 * 1024 + 1), { mode: 0o600 });
  await expect(loadActivationPolicy({ policyPath })).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
  await rm(candidatePath);
  await writeFile(candidatePath, '{}', { mode: 0o600 });
  await expect(publishActivationPolicy({ policyRoot: root }, policy, true)).rejects.toThrow('ACTIVATION_POLICY_MISMATCH');
});
