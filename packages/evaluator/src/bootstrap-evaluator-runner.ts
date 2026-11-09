import { createReadStream } from 'node:fs';
import {
  bootstrapAssertionCases, bootstrapRequiredAssertions, bootstrapRequiredCases,
  hashBootstrapVerificationResult, hashCanonical, type BootstrapVerificationResultV1,
} from '@eapr/contracts';
import { buildBootstrapCases } from './bootstrap-cases.js';
import { matchesBootstrapCase, observeBootstrapPlan } from './bootstrap-comparison.js';
import { readBootstrapExpectation } from './bootstrap-fixtures.js';
import { BootstrapEvaluatorInputV1Schema, readBootstrapMessage } from './bootstrap-protocol.js';
import { BootstrapLaunchContextV1Schema, requireBootstrapBuildPins, runBootstrapSubject } from './bootstrap-runner.js';
import { deriveBootstrapBinding, validateBootstrapCompletion } from './bootstrap-verify.js';

try {
  const [requestData, contextData] = await Promise.all([
    readBootstrapMessage(process.stdin), readBootstrapMessage(createReadStream('', { fd: 3 })),
  ]);
  const request = BootstrapEvaluatorInputV1Schema.parse(requestData);
  const context = BootstrapLaunchContextV1Schema.parse(contextData);
  const { jobId, pin, artifact, profiles, manifest, snapshot, events, target, selectedProfileHash } = request;
  const requestHash = hashCanonical(request);
  if (context.requestHash !== requestHash) throw new Error();
  const binding = deriveBootstrapBinding(request);
  await requireBootstrapBuildPins(pin);
  const expectation = await readBootstrapExpectation({
    fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, hash: pin.fixtureHash,
  }, { artifact, profiles, manifest, snapshot, events, registration: context.registration }, context.roots);
  const profile = profiles.find(item => item.hash === selectedProfileHash)!;
  const probes = buildBootstrapCases({ ...expectation, events }, selectedProfileHash, target);
  const cases: BootstrapVerificationResultV1['cases'] = [];
  let baseline: ReturnType<typeof observeBootstrapPlan> = null;
  for (const id of bootstrapRequiredCases) {
    const probe = probes?.find(item => item.id === id);
    if (!probe) {
      cases.push({ id, status: 'unavailable' });
      continue;
    }
    const executed = await runBootstrapSubject({
      protocolVersion: 'bootstrap-subject-1', requestId: 'bootstrap-subject:' + id,
      artifact, profile, events: probe.events, target: probe.target,
    });
    if (!executed.ok) throw new Error();
    const { outcome } = executed.value;
    if (id === 'captured_baseline') baseline = observeBootstrapPlan(outcome);
    cases.push({ id, status: matchesBootstrapCase(probe, outcome) ? 'passed' : 'failed' });
  }
  const assertions: BootstrapVerificationResultV1['assertions'] = bootstrapRequiredAssertions.map(id => {
    const required = bootstrapAssertionCases[id];
    const executed = cases.filter(item => required.includes(item.id) && item.status !== 'unavailable');
    if (!executed.length) return { id, status: 'unavailable', caseIds: [] };
    return {
      id, status: executed.length === required.length && executed.every(item => item.status === 'passed') ? 'passed' : 'failed',
      caseIds: executed.map(item => item.id),
    };
  });
  const result = {
    schemaVersion: '1', id: 'bootstrap-result:' + jobId, jobId, pin, binding, planHash: baseline?.plan.hash ?? null,
    assertions, cases, passed: baseline !== null && assertions.every(item => item.status === 'passed') &&
      cases.every(item => item.status === 'passed'), createdAt: new Date().toISOString(),
  } as const;
  const completion = validateBootstrapCompletion(request, {
    protocolVersion: 'bootstrap-completion-1', jobId, requestHash,
    result: { ...result, hash: hashBootstrapVerificationResult(result) },
    observedBaselinePlan: baseline?.plan ?? null, observedBaselinePlanBytesHash: baseline?.bytesHash ?? null,
  });
  await requireBootstrapBuildPins(pin);
  process.stdout.write(JSON.stringify(completion) + '\n');
} catch {
  process.exitCode = 1;
}
