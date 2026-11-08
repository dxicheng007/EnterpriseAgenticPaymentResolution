import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { z } from 'zod';
import { VerificationReportSchema } from '@eapr/contracts';
import { EvaluatorInputSchema, SubjectInputSchema, SubjectOutputSchema } from './protocol.js';

const maxMessageBytes = 10 * 1024 * 1024;
const evaluatorTimeoutMs = 120_000;
const subjectTimeoutMs = 5_000;
const resolve = createRequire(import.meta.url).resolve;

type LowerLimits = { maxBytes?: number; timeoutMs?: number };
type FailureCode =
  | 'INPUT_INVALID' | 'INPUT_TOO_LARGE' | 'INPUT_FAILED'
  | 'START_FAILED' | 'TIMED_OUT' | 'EXIT_FAILED'
  | 'OUTPUT_INVALID' | 'OUTPUT_TOO_LARGE' | 'REQUEST_MISMATCH';
type Failure = { ok: false; code: FailureCode };
type ProcessResult<T> = { ok: true; value: T } | Failure;

function failure(code: FailureCode): Failure {
  return { ok: false, code };
}

function bounded(value: number | undefined, cap: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? Math.min(value, cap) : cap;
}

function runNode(
  entrypoint: URL,
  stdin: Buffer,
  maxBytes: number,
  timeoutMs: number,
  isolateGroup: boolean,
): Promise<ProcessResult<Buffer>> {
  const detached = isolateGroup && process.platform !== 'win32';
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(process.execPath, ['--import', resolve('tsx'), '--', fileURLToPath(entrypoint)], {
      detached, shell: false, env: {}, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return Promise.resolve(failure('START_FAILED'));
  }

  return new Promise(resolveResult => {
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let stdinFailed = false;
    let settled = false;

    function finish(result: ProcessResult<Buffer>): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    }

    function stop(code: FailureCode): void {
      if (settled) return;
      try {
        // The evaluator's subject children inherit its process group on POSIX.
        if (detached && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        // The process or process group may have already exited.
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      finish(failure(code));
    }

    function collect(chunk: Buffer, keep: boolean): void {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > maxBytes) stop('OUTPUT_TOO_LARGE');
      else if (keep) stdout.push(chunk);
    }

    const timer = setTimeout(() => stop('TIMED_OUT'), timeoutMs);
    child.stdin.on('error', () => { stdinFailed = true; });
    child.stdout.on('error', () => stop('OUTPUT_INVALID'));
    child.stderr.on('error', () => stop('OUTPUT_INVALID'));
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
    child.on('error', () => stop('START_FAILED'));
    child.once('close', code => {
      if (settled) return;
      if (code !== 0) stop('EXIT_FAILED');
      else if (stdinFailed) finish(failure('INPUT_FAILED'));
      else finish({ ok: true, value: Buffer.concat(stdout) });
    });
    child.stdin.end(stdin);
  });
}

async function exchange<Input, Output>(
  entrypoint: URL,
  input: unknown,
  requestSchema: z.ZodType<Input>,
  responseSchema: z.ZodType<Output>,
  limits: { maxBytes: number; timeoutMs: number },
  framing: 'report-line' | 'message',
  requestMatches?: (request: Input, response: Output) => boolean,
): Promise<ProcessResult<Output>> {
  let request: Input;
  let bytes: Buffer;
  try {
    const parsed = requestSchema.safeParse(input);
    if (!parsed.success) return failure('INPUT_INVALID');
    request = parsed.data;
    const json = JSON.stringify(request);
    if (Buffer.byteLength(json) + 1 > limits.maxBytes) return failure('INPUT_TOO_LARGE');
    bytes = Buffer.from(json + '\n');
  } catch {
    return failure('INPUT_INVALID');
  }

  const reportLine = framing === 'report-line';
  const result = await runNode(entrypoint, bytes, limits.maxBytes, limits.timeoutMs, reportLine);
  if (!result.ok) return result;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.value);
    if (reportLine && (!text.endsWith('\n') || text.indexOf('\n') !== text.length - 1)) {
      return failure('OUTPUT_INVALID');
    }
    const parsed = responseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return failure('OUTPUT_INVALID');
    if (requestMatches && !requestMatches(request, parsed.data)) return failure('REQUEST_MISMATCH');
    return { ok: true, value: parsed.data };
  } catch {
    return failure('OUTPUT_INVALID');
  }
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
