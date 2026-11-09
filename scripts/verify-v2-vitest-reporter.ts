import { writeFileSync } from 'node:fs';
import type { Reporter, TestCase } from 'vitest/node';

// Match stock Vitest JSON fullName without altering names that themselves contain separators.
function fullName(test: TestCase) {
  const names = [test.name];
  for (let parent = test.parent; parent.type === 'suite'; parent = parent.parent) names.unshift(parent.name);
  return names.join(' ');
}

export default class V2VitestReporter implements Reporter {
  onTestRunEnd(...[modules, errors, reason]: Parameters<NonNullable<Reporter['onTestRunEnd']>>) {
    const destination = process.env.EAPR_V2_VITEST_GUARD_REPORT;
    if (!destination) throw new Error('V2 execution guard output is required');
    const report = {
      completed: reason === 'passed' && errors.length === 0,
      modules: modules.map(module => ({
        file: module.moduleId, project: module.project.name,
        assertions: [...module.children.allTests()].map(test => {
          const diagnostic = test.diagnostic();
          return {
            name: fullName(test), status: test.result().state,
            expectedFailure: test.options.fails === true, attempts: test.attempts().length,
            retries: diagnostic?.retryCount ?? null, repeats: diagnostic?.repeatCount ?? null,
            flaky: diagnostic?.flaky ?? null,
          };
        }),
      })),
    };
    writeFileSync(destination, JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' });
  }
}
