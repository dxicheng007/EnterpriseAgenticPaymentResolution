import { VerificationReportSchema } from '@eapr/contracts';
import { EvaluatorInputSchema, SubjectInputSchema, SubjectOutputSchema } from './protocol.js';
import { exchange } from './transport.js';

const maxMessageBytes = 10 * 1024 * 1024;
const evaluatorTimeoutMs = 120_000;
const subjectTimeoutMs = 5_000;

type LowerLimits = { maxBytes?: number; timeoutMs?: number };

function bounded(value: number | undefined, cap: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, cap) : cap;
}

/** The file URL is fixed by trusted composition. The caller may only lower the F6 caps. */
export function runSubject(entrypoint: URL, input: unknown, lower: LowerLimits = {}) {
  return exchange(entrypoint, input, SubjectInputSchema, SubjectOutputSchema, {
    maxBytes: bounded(lower.maxBytes, maxMessageBytes),
    timeoutMs: bounded(lower.timeoutMs, subjectTimeoutMs),
  }, 'message', (request, response) => request.requestId === response.requestId);
}

/** A valid report line establishes transport success. Registry checks bind its authority separately. */
export function runEvaluator(entrypoint: URL, input: unknown, lower: LowerLimits = {}) {
  return exchange(entrypoint, input, EvaluatorInputSchema, VerificationReportSchema, {
    maxBytes: bounded(lower.maxBytes, maxMessageBytes),
    timeoutMs: bounded(lower.timeoutMs, evaluatorTimeoutMs),
  }, 'report-line');
}
