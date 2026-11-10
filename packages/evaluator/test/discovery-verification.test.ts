import { expect, test } from 'vitest';
import { hashCanonical } from '@eapr/contracts';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { discoveryVerificationSubject } from '../src/discovery-verification.js';

test('subject binds the full registered candidate and task while normalizing only profile order', () => {
  const candidate = {
    spec: { id: 'spec', version: 1 },
    artifact: { hash: 'artifact' },
    profiles: [{ hash: 'b', scope: { accountId: 'account' } }, { hash: 'a', scope: { accountId: 'account' } }],
    manifest: { id: 'manifest' },
    snapshot: { id: 'snapshot', contentHash: 'content' },
  } as CandidateRegistration;
  const task = { runId: 'run', accountId: 'account' };
  const base = discoveryVerificationSubject(candidate, task);
  expect(JSON.parse(Buffer.from(base.subjectBytes).toString('utf8'))).toMatchObject({
    schemaVersion: 'discovery-verification-subject-1', task, snapshotObjectHash: hashCanonical(candidate.snapshot),
  });
  expect(discoveryVerificationSubject({ ...candidate, profiles: [...candidate.profiles].reverse() }, task)).toEqual(base);
  for (const altered of [
    { ...candidate, spec: { ...candidate.spec, version: 2 } },
    { ...candidate, artifact: { ...candidate.artifact, hash: 'other' } },
    { ...candidate, profiles: candidate.profiles.slice(1) },
    { ...candidate, profiles: [{ ...candidate.profiles[0]!, scope: { ...candidate.profiles[0]!.scope, accountId: 'other' } }] },
    { ...candidate, manifest: { ...candidate.manifest, id: 'other' } },
    { ...candidate, snapshot: { ...candidate.snapshot, contentHash: 'other' } },
  ]) expect(discoveryVerificationSubject(altered, task).subjectHash).not.toBe(base.subjectHash);
  expect(discoveryVerificationSubject(candidate, { ...task, runId: 'other' }).subjectHash).not.toBe(base.subjectHash);
});
