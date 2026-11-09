import { fileURLToPath } from 'node:url';
import { hashCanonical } from '@eapr/contracts';
import {
  FinancialRequestSchema, FinancialResponseSchema, type FinancialContext, type FinancialRequest,
} from './financial-attestation-protocol.js';
import { exchange } from './transport.js';

export const financialMessageLimit = 10 * 1024 * 1024;
const limits = { maxBytes: financialMessageLimit, timeoutMs: 120_000 };
const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const evaluator = new URL('./financial-attestation-evaluator.ts', import.meta.url);

/** Internal seam for scripted transport tests. The production child and caps are fixed. */
export function exchangeFinancialEvaluator(
  entrypoint: URL, input: FinancialRequest, launchContext: Buffer, options = limits,
) {
  return exchange(entrypoint, input, FinancialRequestSchema, FinancialResponseSchema, options,
    'report-line', (request, response) => request.jobId === response.jobId &&
      hashCanonical(request) === response.requestHash, { cwd, launchContext });
}

export function runFinancialEvaluator(input: FinancialRequest, context: FinancialContext) {
  return exchangeFinancialEvaluator(evaluator, input, Buffer.from(JSON.stringify(context) + '\n'));
}

export async function readFinancialMessage(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > financialMessageLimit) throw new Error('FINANCIAL_ATTESTATION_UNAVAILABLE');
    chunks.push(bytes);
  }
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  if (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1) throw new Error('FINANCIAL_ATTESTATION_UNAVAILABLE');
  return JSON.parse(text);
}
