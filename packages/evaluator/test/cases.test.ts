import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { hashBytes, hashCanonical, hashEvent, hashProfile, type ConnectorSpec } from '@eapr/contracts';
import {
  baselineEventsA, baselineEventsB, baselineManifestA, emptyTargetB, profileA, profileB, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';
import { buildCasePlan, runCasePlan } from '../src/cases.js';
import { decodeTruth } from '../src/fixtures.js';
import { evaluatorBuildHash } from '../src/launcher.js';
import { runVerificationSubject } from '../src/subject-comparison.js';
import { publicTruthFixture } from './public-truth-fixture.js';

function artifactFor(spec: ConnectorSpec, profiles = [profileA]) {
  const result = compile(spec, profiles);
  if (!result.ok) throw new Error('Test subject did not compile');
  return result.value;
}

test('inapplicable_profile_keeps_check_unavailable for the entire requested profile matrix', async () => {
  const { hash: _hash, ...truth } = publicTruthFixture();
  const otherSourceAccount = 'cust-a-unsupported';
  const other = {
    ...profileA, id: 'profile-unsupported', scope: { ...profileA.scope, accountId: 'parent-unsupported' },
    sourceAccountIds: [otherSourceAccount], contractTerms: [], approvedLookups: [],
  };
  other.hash = hashProfile(other);
  const profiles = [profileA, other];
  const artifact = artifactFor(validSpecA, profiles);
  const multi = {
    ...truth, accounts: [...truth.accounts, { sourceAccountId: otherSourceAccount, records: [], balanceAnchorCents: null }],
  };
  const fixture = decodeTruth(JSON.stringify({ ...multi, hash: hashCanonical(multi) }));
  const plan = buildCasePlan({ artifact, profiles, manifest: baselineManifestA }, fixture, baselineEventsA);
  const planned = plan.find(check => check.id === 'new_record');
  expect(planned).toEqual({
    id: 'new_record', cases: [], unavailable: [{ profileHash: other.hash, reason: 'NO_COMPATIBLE_RECIPE' }],
  });
  const executed = await runCasePlan(artifact, plan);
  expect(executed.eventKinds).toEqual([]);
  expect(executed.checks).toHaveLength(13);
  expect(executed.checks.every(check => check.status === 'unavailable' && check.cases === 0)).toBe(true);
});

test('unsupported source contract has no synthetic cases and a case plan rejects another artifact', async () => {
  const truth = decodeTruth(JSON.stringify(publicTruthFixture()));
  const subject = { artifact: artifactFor(validSpecA), profiles: [profileA], manifest: baselineManifestA };
  const plan = buildCasePlan(subject, truth, baselineEventsA);
  const changed = structuredClone(validSpecA);
  changed.sourceContracts.find(contract => contract.kind === 'invoice')!.fields.extra = {
    type: 'string', required: false, nullable: false, format: 'text',
  };
  const unsupported = artifactFor(changed);
  const different = buildCasePlan({ ...subject, artifact: unsupported }, truth, baselineEventsA);
  expect(different.filter(check => check.cases.length).map(check => check.id)).toEqual(['baseline_reconcile']);
  await expect(runCasePlan(unsupported, plan)).rejects.toThrow('Verification case binding failed');
});

test('B fractional and unsafe numbers fail their respective pre-money validation boundaries', async () => {
  const artifact = artifactFor(validSpecB, [profileB]);
  const event = baselineEventsB.find(value => value.kind === 'payment')!;
  const fractional = { ...event, payload: { ...event.payload, amount_minor: 1.5 } };
  const unsafe = { ...event, payload: { ...event.payload, amount_minor: Number.MAX_SAFE_INTEGER + 1 } };
  expect(() => hashEvent(fractional)).toThrow();
  expect(() => hashEvent(unsafe)).toThrow();
  expect(await runVerificationSubject(artifact, profileB, [fractional], emptyTargetB)).toMatchObject({
    ok: true, value: { outcome: { plans: [], holds: [{ code: 'SOURCE_SCHEMA', eventIds: [] }] } },
  });
  expect(await runVerificationSubject(artifact, profileB, [unsafe], emptyTargetB))
    .toEqual({ ok: false, code: 'INPUT_INVALID' });
});

test('negative_mapping_rejected for an alternate B amount field or unsupported amount constant', () => {
  for (const op of [
    { op: 'field', path: '/revision_no' },
    { op: 'constant', value: 300000, evidenceRef: validSpecB.evidenceRefs[0] },
  ] as const) {
    const bad = structuredClone(validSpecB);
    const payment = bad.mappings.find(mapping => mapping.kind === 'payment');
    if (payment?.kind !== 'payment') throw new Error('Missing public payment mapping');
    payment.fields.amountCents = op;
    const result = compile(bad, [profileB]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.map(diagnostic => diagnostic.code))
      .toContain(op.op === 'field' ? 'MAPPING_TYPE' : 'EVIDENCE_SUPPORT');
  }
});

test('new_case_files_change_build_hash', async () => {
  const oldPaths = [
    './evaluator-runner.ts', './fixture-store.ts', './fixtures.ts', './jobs.ts', './launcher.ts', './protocol.ts',
    './reference-model.ts', './registry.ts', './runner.ts', './subject-comparison.ts', './subject-runner.ts', './verify.ts', '../../../package-lock.json',
  ];
  const root = new URL('../src/', import.meta.url);
  const parts = async (paths: string[]) => Promise.all(paths.map(async name => ({
    name, hash: hashBytes(await readFile(new URL(name, root))),
  })));
  const oldHash = hashCanonical(await parts(oldPaths));
  const now = await evaluatorBuildHash();
  expect(now).toBe(hashCanonical(await parts(['./case-recipes.ts', './cases.ts', ...oldPaths])));
  expect(now).not.toBe(oldHash);
});
