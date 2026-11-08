import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

test('control evaluator entrypoints do not load the subject or protected oracle', () => {
  const script = String.raw`
    import { registerHooks } from 'node:module';
    const protectedModules = /(?:^|\/)(?:capture-boundary|case-recipes|cases|evidence-support|reference-model|fixtures|fixture-store|subject-runner|subject-comparison|evaluator-runner)\.(?:ts|js)$/;
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (protectedModules.test(specifier)) throw new Error('Unexpected protected import: ' + specifier);
        return nextResolve(specifier, context);
      },
    });
    try {
      const registry = await import('@eapr/evaluator/registry');
      const verification = await import('@eapr/evaluator/verify');
      if (typeof registry.createVerificationJobs !== 'function' ||
          typeof verification.validateReport !== 'function' ||
          typeof verification.createProtectedVerificationLauncher !== 'function') process.exitCode = 2;
    } finally {
      hooks.deregister();
    }
  `;
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const result = spawnSync(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
    timeout: 5000, encoding: 'utf8', env: {},
  });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
