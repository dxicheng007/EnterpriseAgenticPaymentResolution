import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { hashCanonical } from '@eapr/contracts';
import { baselineManifestA, profileA, validSpecA } from '../../../tests/fixtures/index.js';
import { FinancialProbeInputV1Schema } from '../src/financial-attestation-protocol.js';
import { exchangeFinancialEvaluator } from '../src/financial-attestation-runner.js';

const child = new URL('./children/financial-attestation-wire.mjs', import.meta.url);

test('financial private transport bounds frames and binds exact requests', async () => {
  const result = compile(validSpecA, [profileA]);
  if (!result.ok) throw new Error('Test subject did not compile');
  const artifact = result.value;
  const manifest = baselineManifestA;
  const digest = '1'.repeat(64);
  const makeRequest = (jobId: string) => FinancialProbeInputV1Schema.parse({
    protocolVersion: 'financial-attestation-probe-1', jobId, evaluatorBuildHash: digest,
    selection: { fixtureSetId: 'test-pin', fixtureSetVersion: '2', purpose: 'construction', snapshotHash: digest },
    capture: { artifact, profiles: [profileA], manifest, events: [],
      snapshot: { id: 'snapshot:' + manifest.id, manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
        contentHash: digest, eventIds: [], evidenceIds: [] } },
  });
  const execute = (jobId: string, maxBytes = 15_000, timeoutMs = 3_000, servedRoots: string[] = []) => {
    const request = makeRequest(jobId);
    return exchangeFinancialEvaluator(child, request, Buffer.from(JSON.stringify({
      protocolVersion: 'financial-attestation-context-1', requestHash: hashCanonical(request),
      roots: { evidencePinRoot: '/test-protected', servedRoots },
    }) + '\n'), { maxBytes, timeoutMs });
  };
  const vectors = [
    ['wrong-job', 'REQUEST_MISMATCH'], ['wrong-request', 'REQUEST_MISMATCH'],
    ['invalid-utf8', 'OUTPUT_INVALID'], ['extra-line', 'OUTPUT_INVALID'], ['no-newline', 'OUTPUT_INVALID'],
    ['stderr-limit', 'OUTPUT_TOO_LARGE'], ['stdout-limit', 'OUTPUT_TOO_LARGE'], ['aggregate-limit', 'OUTPUT_TOO_LARGE'],
    ['failed-exit', 'EXIT_FAILED'], ['child-mismatch', 'REQUEST_MISMATCH'],
    ['child-mismatch-unbound', 'REQUEST_MISMATCH'], ['child-mismatch-extra', 'OUTPUT_INVALID'],
  ];
  expect(await execute('correct')).toMatchObject({ ok: true, value: { jobId: 'correct' } });
  expect(await execute('correct', 100)).toEqual({ ok: false, code: 'INPUT_TOO_LARGE' });
  await Promise.all(vectors.map(async ([jobId, code]) => {
    expect(await execute(jobId!), jobId).toEqual({ ok: false, code });
  }));
  if (process.platform !== 'win32') {
    const directory = await mkdtemp(join(tmpdir(), 'financial-transport-'));
    try {
      expect(await execute('timeout', 15_000, 1_500, [directory])).toEqual({ ok: false, code: 'TIMED_OUT' });
      const pid = Number(await readFile(join(directory, 'descendant.pid'), 'utf8'));
      expect(pid).toBeGreaterThan(0);
      await expect.poll(() => {
        try {
          process.kill(pid, 0);
          return 'alive';
        } catch (error) {
          return (error as NodeJS.ErrnoException).code;
        }
      }).toBe('ESRCH');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 10_000);
