import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { ControlRolePaths, WorkerRolePaths } from '../../scripts/dev.js';
import { assertModelCredentialsAbsent, createModelCallTrap } from './v5-ai-off.js';

export type DemoRoleSetup =
  | { role: 'worker'; paths: WorkerRolePaths; interruptBeforeApply?: boolean }
  | { role: 'control'; paths: ControlRolePaths };

function assertWorkerEnvironment() {
  assertModelCredentialsAbsent();
  const allowed = new Set([
    'PATH', 'EAPR_CONTROL_PORT', 'EAPR_WORKER_PORT', 'EAPR_SERVICE_TOKEN', 'EAPR_SOURCE_READ_TOKEN',
    'EAPR_AUTHORITY_ADMISSION_TOKEN', 'DEMO_OPERATOR_ENABLED', 'DEMO_OPERATOR_TOKEN',
    'RUNTIME_DATABASE_URL', 'EAPR_SOURCE_READ_REFS',
  ]);
  // macOS can inject its own text encoding setting into an explicitly spawned environment.
  if (process.platform === 'darwin') allowed.add('__CF_USER_TEXT_ENCODING');
  assert(Object.keys(process.env).every(name => allowed.has(name)), 'Unexpected worker configuration');
}

async function protectWorkerHttp(interruptBeforeApply: boolean) {
  const origin = 'http://127.0.0.1:' + process.env.EAPR_CONTROL_PORT;
  const originalFetch = globalThis.fetch;
  const trap = createModelCallTrap();
  let sourceRead = false;
  let semanticsRead = false;
  let interruptedBeforeApply = false;

  const guardedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow');
    if (url.origin !== origin || url.username || url.password || redirect !== 'error') {
      trap.call('unexpected HTTP path');
    }
    if (url.pathname.startsWith('/internal/demo/company-a/changes/')) sourceRead = true;
    if (url.pathname === '/internal/sources/legacy-a/semantics') {
      semanticsRead = true;
      if (interruptBeforeApply && !interruptedBeforeApply) {
        interruptedBeforeApply = true;
        throw new Error('Test interruption before apply');
      }
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = guardedFetch;
  const forbidden = { message: 'WORKER_MODEL_CALL_FORBIDDEN: unexpected HTTP path' };
  await assert.rejects(globalThis.fetch('https://example.invalid', { redirect: 'error' }), forbidden);
  assert.equal(trap.attempts, 1);
  const localUrl = new URL(origin);
  localUrl.username = 'unexpected';
  await assert.rejects(globalThis.fetch(localUrl, { redirect: 'error' }), forbidden);
  localUrl.username = '';
  localUrl.hostname = 'localhost';
  await assert.rejects(globalThis.fetch(localUrl, { redirect: 'error' }), forbidden);
  await assert.rejects(globalThis.fetch(origin, { redirect: 'follow' }), forbidden);
  assert.equal(trap.attempts, 4);
  const baseline = trap.attempts;
  process.on('message', message => {
    if (message !== 'assert-isolation') return;
    assertWorkerEnvironment();
    assert.equal(globalThis.fetch, guardedFetch);
    assert.equal(trap.attempts, baseline);
    process.send?.({ mountedHttpPathProtected: true, sourceRead, semanticsRead, interruptedBeforeApply });
  });
  process.send?.('isolation-ready');
}

try {
  const role = process.argv[2];
  if (role === 'worker') {
    try { assertWorkerEnvironment(); }
    catch {
      process.send?.('worker-environment-rejected');
      throw new Error('Invalid worker environment');
    }
  }
  const [setup] = await once(process, 'message') as [DemoRoleSetup];
  assert.equal(setup.role, role);
  if (setup.role === 'worker') {
    assert.deepEqual(Object.keys(setup.paths).sort(), ['policyPath', 'registryRoot']);
    await protectWorkerHttp(setup.interruptBeforeApply ?? false);
    const { serve } = await import('../../scripts/dev.js');
    await serve('worker', setup.paths);
  } else {
    const { serve } = await import('../../scripts/dev.js');
    await serve('control', setup.paths);
  }
} catch {
  console.error('Demo child setup or service failed.');
  process.exitCode = 1;
} finally {
  if (process.connected) process.disconnect?.();
}
