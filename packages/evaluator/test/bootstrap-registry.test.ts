import { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { hashCanonical } from '@eapr/contracts';
import { baselineEventsA, baselineManifestA, emptyTargetA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { createBootstrapVerificationRegistry } from '../src/bootstrap-registry.js';

const compiled = compile(validSpecA, [profileA]);
if (!compiled.ok) throw new Error('Public test input unavailable');
const digest = hashCanonical('public-fixture');
const candidate = {
  spec: validSpecA, artifact: compiled.value, profiles: [profileA], manifest: baselineManifestA,
  snapshot: {
    id: 'snapshot:' + baselineManifestA.id, manifestId: baselineManifestA.id, sourceRef: baselineManifestA.sourceRef,
    contentHash: digest, capturedAt: baselineManifestA.asOf, evidenceIds: [],
    eventIds: baselineEventsA.map(event => event.id),
  },
};
const input = {
  ...candidate, protocolVersion: 'bootstrap-1' as const,
  pin: {
    runnerId: 'eapr-bootstrap-1' as const, protocolVersion: '1' as const, fixtureSetId: 'public-fixture',
    fixtureSetVersion: '1', evaluatorBuildHash: digest, subjectBuildHash: digest, fixtureHash: digest,
  },
  selectedProfileHash: profileA.hash, events: baselineEventsA, target: { ...emptyTargetA, asOf: baselineManifestA.asOf },
};
const { spec: _spec, ...request } = input;

test('rejects a foreign target before resolving a candidate', async () => {
  const pool = new Pool();
  const getCandidate = vi.fn(async () => candidate);
  const registry = createBootstrapVerificationRegistry(pool, { getCandidate });
  try {
    await expect(registry.reserveBootstrapVerification({
      ...request, target: { ...input.target, scope: { ...input.target.scope, accountId: 'foreign' } },
    })).rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
    expect(getCandidate).not.toHaveBeenCalled();
  } finally {
    await pool.end();
  }
});

test('rejects changed snapshot bytes even when capture identity and content hash match', async () => {
  const pool = new Pool();
  const registry = createBootstrapVerificationRegistry(pool, { getCandidate: async () => candidate });
  try {
    await expect(registry.reserveBootstrapVerification({
      ...request, snapshot: { ...candidate.snapshot, evidenceIds: ['substituted'] },
    })).rejects.toThrow('BOOTSTRAP_VERIFICATION_MISMATCH');
  } finally {
    await pool.end();
  }
});
