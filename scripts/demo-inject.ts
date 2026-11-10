import { ReceiptResponseSchema } from '@eapr/contracts';
import {
  companyADemo as demo, CompanyADemoPaymentResponseSchema,
} from '../packages/contracts/src/demo-company-a.js';
import { validDemoBearer } from '../apps/worker/src/demo-source-client.js';
import { localPort } from './native-db.js';

const maxResponseBytes = 32 * 1024;

async function post(port: number, path: 'payment' | 'sync', token: string): Promise<unknown> {
  const response = await fetch('http://127.0.0.1:' + port + '/internal/demo/company-a/' + path, {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: '{}', redirect: 'error', signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !response.body ||
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel();
    throw new Error('Invalid demo response');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('Invalid demo response');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function runDemoInject(args: readonly string[]): Promise<number> {
  const token = process.env.DEMO_OPERATOR_TOKEN;
  let controlPort: number;
  let workerPort: number;
  try {
    if (args.length !== 1 || args[0] !== 'freshPaymentA' || !token || !validDemoBearer(token)) {
      throw new Error('Invalid demo operator input');
    }
    controlPort = localPort('EAPR_CONTROL_PORT', 3001);
    workerPort = localPort('EAPR_WORKER_PORT', 3002);
  } catch {
    console.error('Use npm run demo:inject -- freshPaymentA with DEMO_OPERATOR_TOKEN and valid local ports.');
    return 1;
  }

  try {
    CompanyADemoPaymentResponseSchema.parse(await post(controlPort, 'payment', token));
  } catch {
    console.error('Source injection could not be confirmed. Retry the same command.');
    return 1;
  }

  try {
    const { receipt, replayed } = ReceiptResponseSchema.parse(await post(workerPort, 'sync', token));
    if (receipt.scope.accountId !== demo.scope.accountId || receipt.scope.companyId !== demo.scope.companyId ||
        receipt.scope.sellerEntityId !== demo.scope.sellerEntityId || receipt.eventIds.length !== demo.eventIds.length ||
        !demo.eventIds.every(id => receipt.eventIds.includes(id)) || receipt.targetRecordIds.length !== demo.recordIds.length ||
        new Set(receipt.targetRecordIds).size !== demo.recordIds.length) {
      throw new Error('Invalid demo receipt');
    }
    console.log(JSON.stringify({
      receiptId: receipt.id, replayed, beforeBalanceCents: receipt.beforeBalanceCents,
      afterBalanceCents: receipt.afterBalanceCents,
    }));
    return 0;
  } catch {
    console.error('Source injection confirmed. Worker commit could not be confirmed. Retry the same command.');
    return 1;
  }
}
