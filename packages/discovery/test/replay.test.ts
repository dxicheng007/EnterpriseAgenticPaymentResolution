import { expect, test } from 'vitest';
import { hashCanonical } from '../../contracts/src/index.js';
import { compile } from '../../compiler/src/compile.js';
import { planBatch } from '../../compiler/src/plan-batch.js';
import {
  baselineEventsA, baselineManifestA, emptyTargetA, profileA, profileB, validSpecA,
} from '../../../tests/fixtures/index.js';
import { buildEmptySandboxTarget, executeSandboxReplay, type ReplaySubject } from '../src/replay.js';

test('buildEmptySandboxTarget mirrors fixture emptiness with proposed scope and asOf', () => {
  const asOf = baselineManifestA.asOf;
  const target = buildEmptySandboxTarget(profileA, asOf);
  expect(target).toEqual({
    scope: profileA.scope,
    version: 0,
    asOf,
    invoices: [], payments: [], credits: [], allocations: [], reversals: [],
    customers: [], accounts: [], billingConfigurations: [],
  });
  expect(emptyTargetA.version).toBe(0);
  expect(emptyTargetA.invoices).toEqual([]);
  expect(target.scope).toEqual(profileA.scope);
});

test('executeSandboxReplay plans against empty sandbox with parentWrites 0', () => {
  const compiled = compile(validSpecA, [profileA]);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const subject: ReplaySubject = {
    proposalId: 'proposal',
    proposalRevision: 1,
    assessmentRevision: 1,
    observedRunRevision: 2,
    payload: {
      schemaVersion: 2, id: 'proposal', revision: 1, taskId: 'task',
      spec: validSpecA, profiles: [profileA], findingRefs: [], investigationIds: ['source'],
    },
    payloadHash: 'a'.repeat(64),
    current: {
      proposalId: 'proposal', revision: 1, state: 'compiled',
      artifactHash: compiled.value.hash, profileHashes: [profileA.hash],
      diagnostics: [], assessment: {
        revision: 1, observedRunRevision: 2, investigationIds: ['source'],
        diagnosticCodes: [], blockerRefs: [],
      },
    },
    artifactHash: compiled.value.hash,
    profile: profileA,
  };
  const result = executeSandboxReplay({
    subject,
    artifact: compiled.value,
    events: baselineEventsA,
    asOf: baselineManifestA.asOf,
    snapshotId: 'snapshot',
    manifestId: baselineManifestA.id,
  });
  expect(result).toMatchObject({
    ok: true, targetMode: 'empty-sandbox', parentWrites: 0,
    artifactHash: compiled.value.hash, profileHash: profileA.hash,
  });
  if (!result.ok) return;
  expect(result.outcome.plans.length + result.outcome.holds.length).toBeGreaterThan(0);
});

test('helper empty target uses profile scope so accidental wrong scope surfaces TARGET_SCOPE', () => {
  const target = buildEmptySandboxTarget(profileA, baselineManifestA.asOf);
  expect(hashCanonical(target.scope)).toBe(hashCanonical(profileA.scope));
  const compiled = compile(validSpecA, [profileA]);
  expect(compiled.ok).toBe(true);
  if (!compiled.ok) return;
  const wrong = { ...target, scope: profileB.scope };
  const outcome = planBatch(compiled.value, profileA, baselineEventsA, wrong);
  expect(outcome.holds.some(hold => hold.code === 'TARGET_SCOPE')).toBe(true);
});
