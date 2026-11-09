import { expect, test, vi } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { baselineEventsA, baselineManifestA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { buildCasePlan, runCasePlan } from '../src/cases.js';
import { decodeTruth } from '../src/fixtures.js';
import { publicTruthFixture } from './public-truth-fixture.js';

vi.mock('../src/runner.js', () => ({
  runSubject: async () => ({ ok: false, code: 'EXIT_FAILED' }),
}));

test('legacy case evaluation records a transport failure while attested evaluation aborts', async () => {
  const compiled = compile(validSpecA, [profileA]);
  if (!compiled.ok) throw new Error('Test subject did not compile');
  const artifact = compiled.value;
  const truth = decodeTruth(JSON.stringify(publicTruthFixture()));
  const plan = buildCasePlan({ artifact, profiles: [profileA], manifest: baselineManifestA }, truth, baselineEventsA)
    .filter(check => check.id === 'baseline_reconcile');
  expect(plan[0]?.requiredCases).toHaveLength(1);
  const legacy = await runCasePlan(artifact, plan);
  expect(legacy.checks).toEqual([{ id: 'baseline_reconcile', status: 'failed', cases: 1, diagnosticCodes: [] }]);
  await expect(runCasePlan(artifact, plan, undefined, true)).rejects.toThrow('Protected subject execution failed');
});
