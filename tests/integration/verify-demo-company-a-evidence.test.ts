import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { companyADemo as demo } from '../../packages/contracts/src/demo-company-a.js';
import {
  companyACommands, companyAGateOutcome, mountedCase, parseCompanyAObservation, readCompanyAObservation,
} from '../../scripts/verify-demo-company-a-evidence.js';
import { commandResult, normalizeReport, syncGateOutcome } from '../../scripts/verify-slice-evidence.js';

const token = '1'.repeat(64);
const snapshotHash = '2'.repeat(64);
const artifactHash = '3'.repeat(64);
const initialReceiptId = 'initial-receipt';
const receiptId = 'sync-receipt';

function observation() {
  return {
    schemaVersion: 1, gate: 'demo-company-a-ai-off', test: mountedCase, runToken: token,
    constructionMode: 'development-fixture', targetMode: 'persisted-parent', seed: demo.seed,
    scope: demo.scope, parentCustomerId: demo.parentCustomerId, sourceRef: demo.sourceRef,
    manifestId: demo.manifestId, manifestHash: '4'.repeat(64), artifactHash, profileHash: '5'.repeat(64),
    candidateId: demo.candidateId, profileId: demo.profileId, profileVersion: demo.profileVersion, specId: demo.connectorId, specVersion: demo.connectorVersion,
    activation: { activationId: 'activation-a', initialReceiptId, epoch: 1, initialAfterBalanceCents: 80000 },
    sync: { receiptId, activationId: 'activation-a', epoch: 1, artifactHash, replayed: false,
      beforeBalanceCents: 80000, afterBalanceCents: 50000, replayReceiptId: receiptId },
    sourceEventIds: demo.eventIds, paymentId: demo.recordIds[0], allocationId: demo.recordIds[1],
    amountCents: 30000, effectiveDate: demo.scenario.effectiveDate, observedAt: demo.scenario.observedAt,
    parent: { currentAsOf: demo.scenario.observedAt, currentBalanceCents: 50000,
      cutoverAsOf: demo.cutover, cutoverBalanceCents: 80000, beforeVersion: 1, afterVersion: 2, approvedSnapshotHash: snapshotHash },
    assertions: { baselineExcludesInjectedEvents: true, sameApproval: true, onePaymentAndAllocation: true,
      approvedSnapshotUnchanged: true, receiptMatchesStoredParent: true, actualSupervisorMount: true, privateBoundary: true },
    runtimeIsolation: { credentialsAbsent: true, modelFreeWorkerImports: true, mountedHttpPathProtected: true, positiveControlPassed: true },
  };
}

function passingCommands() {
  return companyACommands.map(({ command, file, names }) => commandResult(command, { status: 0, signal: null },
    file && names ? normalizeReport('vitest', {
      testResults: [{ name: resolve(file), assertionResults: names.map(fullName => ({ fullName, status: 'passed' })) }],
    }, process.cwd(), file, names) : undefined));
}

test('bounded success requires fresh observation and preserves the failed full V5 result', () => {
  const commands = passingCommands();
  const observed = parseCompanyAObservation(observation(), token);
  expect(observed).toMatchObject({ gate: 'demo-company-a-ai-off', sync: { receiptId, replayReceiptId: receiptId } });
  expect(observed).not.toHaveProperty('runToken');
  expect(companyAGateOutcome(commands, [], observed)).toMatchObject({ result: 'passed', exitCode: 0, fullV5: 'not-established' });
  expect(companyAGateOutcome(commands, [], undefined)).toMatchObject({ result: 'failed', exitCode: 1 });
  const legacy = Array.from({ length: 5 }, (_, i) => commandResult('legacy-' + i, { status: 0, signal: null }));
  expect(syncGateOutcome('V5', legacy, [], '145.0')).toMatchObject({
    prerequisiteResult: 'passed', result: 'failed', exitCode: 1, diagnostics: ['ai-off-sync-proof-unavailable'],
  });
  expect(syncGateOutcome('V5', commands, [], '145.0')).toMatchObject({ result: 'failed', exitCode: 1 });
});

test.each([
  ['wrong seed', { seed: 'other' }],
  ['wrong scope', { scope: { ...demo.scope, companyId: 'company-b' } }],
  ['wrong manifest', { manifestId: 'manifest-a-1' }],
  ['wrong profile version', { profileVersion: 1 }],
  ['unbound artifact hash', { artifactHash: 'f'.repeat(64) }],
  ['wrong activation', { sync: { ...observation().sync, activationId: 'other-activation' } }],
  ['wrong epoch', { sync: { ...observation().sync, epoch: 2 } }],
  ['replay-only', { sync: { ...observation().sync, replayed: true } }],
  ['initial receipt substitution', { sync: { ...observation().sync, receiptId: initialReceiptId, replayReceiptId: initialReceiptId } }],
  ['wrong replay receipt', { sync: { ...observation().sync, replayReceiptId: 'other-receipt' } }],
  ['wrong cents', { amountCents: 30001 }],
  ['wrong observation time', { observedAt: demo.cutover }],
  ['missing allocation', { allocationId: undefined }],
  ['duplicate event', { sourceEventIds: [demo.eventIds[0], demo.eventIds[0]] }],
  ['unchanged version', { parent: { ...observation().parent, afterVersion: 1 } }],
  ['wrong cutover balance', { parent: { ...observation().parent, cutoverBalanceCents: 50000 } }],
  ['changed approval', { assertions: { ...observation().assertions, sameApproval: false } }],
  ['unprotected HTTP path', { runtimeIsolation: { ...observation().runtimeIsolation, mountedHttpPathProtected: undefined } }],
  ['failed positive control', { runtimeIsolation: { ...observation().runtimeIsolation, positiveControlPassed: false } }],
  ['extra secret-bearing field', { runtimeIsolation: { ...observation().runtimeIsolation, credentials: 'private-value' } }],
])('rejects %s', (_name, change) => {
  expect(parseCompanyAObservation({ ...observation(), ...change }, token)).toBeUndefined();
});

test('reads only a fresh bounded regular observation without exposing private keys or paths', () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'company-a-evidence-'));
  const path = join(root, 'observation.json');
  const link = join(root, 'observation-link.json');
  try {
    expect(readCompanyAObservation(path, token)).toBeUndefined();
    writeFileSync(path, JSON.stringify(observation()));
    expect(readCompanyAObservation(path, token)).toBeDefined();
    expect(readCompanyAObservation(path, '9'.repeat(64))).toBeUndefined();
    symlinkSync(path, link);
    expect(readCompanyAObservation(link, token)).toBeUndefined();
    writeFileSync(path, JSON.stringify(observation()) + ' '.repeat(70_000));
    expect(readCompanyAObservation(path, token)).toBeUndefined();
    writeFileSync(path, '{"unclosed"');
    expect(readCompanyAObservation(path, token)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects missing or duplicate commands, malformed coverage, unsuccessful commands and runner failures', () => {
  const commands = passingCommands();
  const observed = parseCompanyAObservation(observation(), token);
  expect(observed).toBeDefined();
  const [first, second, ...rest] = commands;
  const variants = [
    [second, ...rest], [second, second, ...rest],
    [{ ...first, cases: [] }, second, ...rest],
    [{ ...first, cases: [first.cases[0], ...first.cases] }, second, ...rest],
    [{ ...first, exitCode: 1 }, second, ...rest],
    [{ ...first, signal: 'SIGTERM' }, second, ...rest],
    [{ ...first, result: 'failed' as const }, second, ...rest],
  ];
  for (const variant of variants) expect(companyAGateOutcome(variant, [], observed).exitCode).toBe(1);
  for (const code of ['run-metadata-unavailable', 'private-output-cleanup-failed']) {
    expect(companyAGateOutcome(commands, [code], observed).exitCode).toBe(1);
  }
});

test('malformed, skipped, failed, duplicate, extra and wrong-file reports fail the gate', () => {
  const [first] = companyACommands;
  const file = first.file;
  const expected = first.names;
  const assertions = expected.map(fullName => ({ fullName, status: 'passed' }));
  const observed = parseCompanyAObservation(observation(), token);
  expect(observed).toBeDefined();
  const report = (assertionResults: unknown, path = file) => ({ testResults: [{ name: resolve(path), assertionResults }] });
  for (const input of [
    {}, report(assertions, 'other.test.ts'), report(assertions.slice(1)),
    report([assertions[0], ...assertions]),
    report([...assertions, { fullName: 'unrecognized', status: 'passed' }]),
    ...['skipped', 'failed', 'todo', 'flaky'].map(status => report([{ ...assertions[0], status }, ...assertions.slice(1)])),
  ]) {
    const result = commandResult(first.command, { status: 0, signal: null },
      normalizeReport('vitest', input, process.cwd(), file, expected));
    expect(companyAGateOutcome([result, ...passingCommands().slice(1)], [], observed).exitCode).toBe(1);
  }
});
