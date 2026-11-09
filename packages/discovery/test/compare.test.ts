import { expect, test } from 'vitest';
import { hashCanonical, type DiscoveryProposalV2 } from '../../contracts/src/index.js';
import { profileA, profileB, validSpecA, validSpecB } from '../../../tests/fixtures/index.js';
import { compareArtifactsResult, type CompareSubject } from '../src/compare.js';

function subject(
  overrides: Partial<CompareSubject> & { payload?: DiscoveryProposalV2 } = {},
): CompareSubject {
  const payload: DiscoveryProposalV2 = overrides.payload ?? {
    schemaVersion: 2, id: 'proposal', revision: 1, taskId: 'task',
    spec: validSpecA, profiles: [profileA], findingRefs: [], investigationIds: ['source'],
  };
  return {
    proposalId: payload.id,
    revision: payload.revision,
    payload,
    payloadHash: hashCanonical(payload),
    ...overrides,
    payload,
  };
}

test('identical refs and payloads yield empty sorted diffs', () => {
  const left = subject();
  const right = subject();
  const result = compareArtifactsResult(left, right);
  expect(result).toMatchObject({ ok: true, identical: true, diffs: [] });
});

test('mapping change yields a stable rule/changed diff', () => {
  const left = subject();
  const rightPayload: DiscoveryProposalV2 = {
    ...left.payload, revision: 2,
    spec: {
      ...validSpecA,
      version: 2,
      mappings: validSpecA.mappings.map(mapping => mapping.kind === 'invoice' ? {
        ...mapping,
        fields: {
          ...mapping.fields,
          amountCents: { op: 'constant', value: 1, evidenceRef: validSpecA.evidenceRefs[0]! },
        },
      } : mapping),
    },
  };
  const right = subject({ payload: rightPayload, artifactHash: 'b'.repeat(64) });
  const leftWithArtifact = subject({ artifactHash: 'a'.repeat(64) });
  const result = compareArtifactsResult(leftWithArtifact, right);
  expect(result).toMatchObject({ ok: true, identical: false });
  if (!result.ok) return;
  const paths = result.diffs.map(diff => diff.path);
  expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  expect(result.diffs.some(diff =>
    diff.category === 'rule' && diff.change === 'changed' && diff.path.startsWith('/spec/mappings/'),
  )).toBe(true);
});

test('scope and hash-only changes land in their categories', () => {
  const left = subject({ artifactHash: 'a'.repeat(64) });
  const scopeRight = subject({
    payload: {
      ...left.payload, revision: 2, profiles: [{ ...profileB, hash: profileB.hash }],
    },
  });
  const scopeResult = compareArtifactsResult(left, scopeRight);
  expect(scopeResult).toMatchObject({ ok: true, identical: false });
  if (!scopeResult.ok) return;
  expect(scopeResult.diffs.some(diff => diff.category === 'scope')).toBe(true);

  const hashRight = subject({
    payload: { ...left.payload, revision: 2, spec: { ...validSpecB, id: left.payload.spec.id } },
    artifactHash: 'c'.repeat(64),
  });
  // Force payload hash difference via revision while keeping a hash category entry for artifact.
  const hashOnly = compareArtifactsResult(left, {
    ...left, artifactHash: 'd'.repeat(64), revision: 1,
  });
  // Same proposalId+revision short-circuits to identical regardless of artifact field on subject.
  expect(hashOnly).toMatchObject({ ok: true, identical: true, diffs: [] });

  const differentRevisionSameShape = compareArtifactsResult(left, subject({
    payload: { ...left.payload, revision: 2 },
    artifactHash: 'e'.repeat(64),
  }));
  expect(differentRevisionSameShape).toMatchObject({ ok: true, identical: false });
  if (!differentRevisionSameShape.ok) return;
  expect(differentRevisionSameShape.diffs.some(diff =>
    diff.category === 'hash' && diff.path === '/artifactHash',
  )).toBe(true);
  expect(hashRight.payload.spec.sourceRef).toBe(validSpecB.sourceRef);
});
