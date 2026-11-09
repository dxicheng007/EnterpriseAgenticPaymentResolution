import { expect, test } from 'vitest';
import { canonicalJson, hashCanonical, hashTargetSnapshot } from '@eapr/contracts';
import { decodeSnapshot, projectStoredParentView } from '../src/snapshots.js';
import { baselineA } from '../../../tests/fixtures/index.js';

test('decodes canonical historical bytes and rejects corrupted indexed bindings', () => {
  const row = {
    account_id: baselineA.scope.accountId, company_id: baselineA.scope.companyId,
    seller_entity_id: baselineA.scope.sellerEntityId, target_version: String(baselineA.version),
    recorded_as_of: baselineA.asOf, snapshot_hash: hashTargetSnapshot(baselineA),
    canonical: canonicalJson(baselineA), digest: hashCanonical(baselineA),
  };
  expect(decodeSnapshot(row).records).toEqual(baselineA);
  for (const patch of [
    { target_version: '9007199254740992' }, { seller_entity_id: 'wrong' },
    { digest: '0'.repeat(64) }, { canonical: row.canonical + ' ' },
    { snapshot_hash: '0'.repeat(64) }, { recorded_as_of: '2026-01-01T00:00:00.000Z' },
  ]) expect(() => decodeSnapshot({ ...row, ...patch })).toThrow();
});

test('projects balances at an explicit instant while preserving historical snapshot bytes', () => {
  const early = projectStoredParentView(baselineA, '2000-01-01T00:00:00.000Z');
  const recorded = projectStoredParentView(baselineA, baselineA.asOf);
  expect(early.balanceCents).toBe(0);
  expect(recorded.balanceCents).not.toBe(early.balanceCents);
  expect(early.snapshotHash).toBe(hashTargetSnapshot(baselineA));
  expect({ ...early, asOf: recorded.asOf, balanceCents: recorded.balanceCents }).toEqual(recorded);
});
