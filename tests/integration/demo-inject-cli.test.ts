import { execFile } from 'node:child_process';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { companyADemo as demo } from '../../packages/contracts/src/demo-company-a.js';

const token = 'cli-private-test-token';
const privateBody = 'private-diagnostic-from-server';
const injected = { sourceRef: demo.sourceRef, eventIds: demo.eventIds };
const receipt = {
  id: 'sync-receipt-test', scope: demo.scope, activationId: 'demo-activation-test', epoch: 1,
  artifactHash: 'a'.repeat(64), planHash: 'b'.repeat(64), eventIds: demo.eventIds,
  targetRecordIds: ['payment', 'allocation'], beforeBalanceCents: 80000,
  afterBalanceCents: 50000, status: 'applied', committedAt: demo.scenario.observedAt,
};

async function listen(handle: RequestListener) {
  const server = createServer(handle);
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return {
    port: String((server.address() as AddressInfo).port),
    close: () => {
      server.closeAllConnections();
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function cli(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ code: unknown; stdout: string; stderr: string }>(resolve => {
    execFile('npm', ['run', '--silent', 'demo:inject', '--', ...args], {
      env: { PATH: process.env.PATH, ...env }, timeout: 15_000,
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? (error ? -1 : 0), stdout, stderr }));
  });
}

test('demo CLI sends the fixed commands and safely reports the authoritative receipt', async () => {
  const requests: unknown[] = [];
  function respond(body: unknown): RequestListener {
    return async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push([request.method, request.url, request.headers.authorization, Buffer.concat(chunks).toString()]);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    };
  }
  const control = await listen(respond(injected));
  const worker = await listen(respond({ receipt, replayed: false }));
  try {
    const result = await cli(['freshPaymentA'], {
      DEMO_OPERATOR_TOKEN: token, EAPR_CONTROL_PORT: control.port, EAPR_WORKER_PORT: worker.port,
    });
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      receiptId: receipt.id, replayed: false, beforeBalanceCents: 80000, afterBalanceCents: 50000,
    });
    expect(requests).toEqual([
      ['POST', '/internal/demo/company-a/payment', 'Bearer ' + token, '{}'],
      ['POST', '/internal/demo/company-a/sync', 'Bearer ' + token, '{}'],
    ]);
  } finally {
    await Promise.all([control.close(), worker.close()]);
  }
});

test.each([
  ['wrong scenario', ['batchB'], 'input'],
  ['extra input', ['freshPaymentA', 'other'], 'input'],
  ['missing bearer', ['freshPaymentA'], 'input'],
  ['source non-2xx', ['freshPaymentA'], 'source'],
  ['source malformed', ['freshPaymentA'], 'source'],
  ['worker non-2xx', ['freshPaymentA'], 'worker'],
  ['worker malformed', ['freshPaymentA'], 'worker'],
  ['worker wrong scope', ['freshPaymentA'], 'worker'],
  ['worker oversized', ['freshPaymentA'], 'worker'],
  ['worker timeout', ['freshPaymentA'], 'worker'],
  ['worker response lost', ['freshPaymentA'], 'worker'],
] as const)('demo CLI fails safely for %s', async (name, args, phase) => {
  let sourceCalls = 0;
  let workerCalls = 0;
  const control = await listen((_request, response) => {
    sourceCalls++;
    response.setHeader('content-type', 'application/json');
    if (name === 'source non-2xx') response.writeHead(503).end(privateBody);
    else response.end(JSON.stringify(name === 'source malformed' ? { privateBody } : injected));
  });
  const worker = await listen((_request, response) => {
    workerCalls++;
    response.setHeader('content-type', 'application/json');
    if (name === 'worker non-2xx') response.writeHead(409).end(privateBody);
    else if (name === 'worker malformed') response.end(JSON.stringify({ privateBody }));
    else if (name === 'worker wrong scope') response.end(JSON.stringify({
      receipt: { ...receipt, scope: { ...demo.scope, accountId: 'other' } }, replayed: false,
    }));
    else if (name === 'worker oversized') response.end(' '.repeat(40_000));
    else if (name === 'worker response lost') response.destroy();
    // The timeout case deliberately leaves the worker response pending.
  });
  try {
    const result = await cli([...args], {
      DEMO_OPERATOR_TOKEN: name === 'missing bearer' ? undefined : token,
      EAPR_CONTROL_PORT: control.port, EAPR_WORKER_PORT: worker.port,
    });
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain(token);
    expect(result.stderr).not.toContain(privateBody);
    expect(result.stderr).toContain(phase === 'input' ? 'freshPaymentA' : 'Retry the same command');
    expect(sourceCalls).toBe(phase === 'input' ? 0 : 1);
    expect(workerCalls).toBe(phase === 'worker' ? 1 : 0);
  } finally {
    await Promise.all([control.close(), worker.close()]);
  }
});
