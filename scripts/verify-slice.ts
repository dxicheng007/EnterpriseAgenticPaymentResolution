import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { hashBytes, hashCanonical } from '../packages/contracts/src/canonical.js';
import { localPort } from './native-db.js';

const registry = {
  V0: [
    'packages/contracts/test/fixtures.test.ts',
    'tests/integration/v0-foundation.test.ts',
    'tests/e2e/v0-health.spec.ts',
  ],
  V1: [
    'tests/integration/v1-evidence.test.ts', 'packages/evidence/test/locate.test.ts', 'tests/e2e/v1-sources.spec.ts',
    'tests/integration/v1-manifests.test.ts', 'packages/sources/test/change-feed.test.ts',
  ],
  V2: [
    'packages/compiler/test/compile.test.ts', 'packages/compiler/test/plan-batch.test.ts', 'packages/finance/test/finance.test.ts',
    'tests/integration/v2-preview.test.ts', 'tests/integration/v2-verification.test.ts', 'tests/e2e/v2-preview.spec.ts',
  ],
  V3: ['tests/integration/v3-activation.test.ts', 'tests/e2e/v3-review.spec.ts', 'tests/integration/v3-corrections.test.ts'],
  V4: ['tests/integration/v4-agent-tools.test.ts', 'tests/e2e/v4-monitor.spec.ts', 'tests/live/v4-build-connectors.test.ts'],
  V5: [
    'tests/integration/v5-sync.test.ts', 'packages/runtime/test/dependencies.test.ts', 'tests/e2e/v5-ai-off.spec.ts',
    'tests/integration/v5-runtime-isolation.test.ts',
  ],
  V6: [
    'tests/integration/v6-recovery.test.ts', 'tests/integration/v6-drift.test.ts', 'tests/e2e/v6-containment.spec.ts',
    'tests/integration/v5-sync.test.ts', 'packages/runtime/test/dependencies.test.ts', 'tests/e2e/v5-ai-off.spec.ts',
    'tests/integration/v5-runtime-isolation.test.ts',
  ],
  V7: ['tests/e2e/v7-demo.spec.ts', 'tests/live/v7-holdout.test.ts'],
  V8: [
    'tests/integration/v8-upgrade.test.ts', 'tests/e2e/v8-repair.spec.ts', 'tests/integration/v5-sync.test.ts',
    'tests/integration/v5-runtime-isolation.test.ts', 'tests/integration/v6-recovery.test.ts', 'tests/integration/v6-drift.test.ts',
  ],
} as const;

const requiredV0Cases: Record<string, string[]> = {
  'test:unit': [
    "validates UTC timestamps and rejects rolled-over source dates",
    "parses exact public development fixtures for both source shapes",
    "pins manifest watermarks, stream members, and original email and CSV bytes",
    "raw unknown identity is capturable without an approved scope",
    "manifest and preflight enforce identical semantic map keys",
    "money schemas reject unsafe cents and decimal2 values requiring rounding",
    "rejects unknown executable operations, paths and prototype properties",
    "canonical JSON sorts object keys recursively and preserves ordered arrays",
    "artifact and profile hashes sort sets and cover executable semantics",
    "receipt replay carries the identical stored receipt and conflict has no receipt",
    "activity cursor rejects invalid encodings, unexpected keys, and future offsets",
  ],
  'test:integration': [
    "public health requires both real migrations and reaches worker over authenticated HTTP",
    "both service roles are denied cross-database CONNECT and DDL",
    "seed twice preserves one version in each database and committed activity survives native restart",
    "rollback discards an activity insert and its sequence increment",
    "transaction start order cannot cause reconnect to lose a later committed publication",
    "a waiting publisher cannot commit while another transaction holds the counter lock",
    "serialization failures retry the whole transaction at most three times",
    "deterministic harness runs without a provider and fails unavailable capabilities explicitly",
  ],
  'test:e2e': [
    "renders ready and degraded PostgreSQL states and recovers on retry",
  ],
};

const vitestReport = z.object({
  testResults: z.array(z.object({
    name: z.string(),
    assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
  })),
});
const browserReport = z.object({
  suites: z.array(z.object({
    file: z.string(),
    specs: z.array(z.object({
      title: z.string(),
      tests: z.array(z.object({
        status: z.string(), expectedStatus: z.string(),
        results: z.array(z.object({
          status: z.string(),
          attachments: z.array(z.object({ name: z.string(), body: z.string().optional() })),
        })),
      })),
    })),
  })),
});

function capture(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
  if (result.status !== 0) throw new Error('Unable to record ' + program + ' version or source identity');
  return result.stdout.trim();
}

function sourceIdentity() {
  const commit = capture('git', ['rev-parse', 'HEAD']);
  const clean = !capture('git', ['status', '--porcelain']);
  if (clean) return { commit, clean, evidenceKey: commit };
  const trackedDiff = capture('git', ['diff', '--binary', 'HEAD']);
  const untracked = capture('git', ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean).map(path => ({ path, hash: hashBytes(readFileSync(path)) }));
  return { commit, clean, evidenceKey: 'dirty-' + hashCanonical({ commit, trackedDiff, untracked }) };
}

function traceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return traceFiles(path);
    return entry.isFile() && entry.name === 'trace.zip' ? [path] : [];
  });
}

type CaseResult = { name: string; status: string };
function unitCases(path: string, expectedFile: string) {
  const report = vitestReport.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (report.testResults.length !== 1 || relative(process.cwd(), report.testResults[0].name) !== expectedFile) {
    throw new Error('Required test file was absent or not uniquely executed');
  }
  return report.testResults[0].assertionResults.map(({ fullName, status }) => ({ name: fullName, status }));
}

function browserCases(path: string, expectedFile: string) {
  const report = browserReport.parse(JSON.parse(readFileSync(path, 'utf8')));
  if (report.suites.length !== 1 || report.suites[0].file !== relative('tests/e2e', expectedFile)) {
    throw new Error('Required browser test was absent or not uniquely executed');
  }
  const versions = new Set<string>();
  const cases = report.suites[0].specs.flatMap(spec => spec.tests.map(test => {
    const [result] = test.results;
    for (const attachment of result?.attachments ?? []) {
      if (attachment.name !== 'browser-version' || !attachment.body) continue;
      const version = Buffer.from(attachment.body, 'base64').toString('utf8');
      if (/^\d+(?:\.\d+){1,4}$/.test(version)) versions.add(version);
    }
    return {
      name: spec.title,
      status: test.status === 'expected' && test.expectedStatus === 'passed' && test.results.length === 1 &&
        result?.status === 'passed' ? 'passed' : 'failed',
    };
  }));
  return { cases, versions: [...versions] };
}

function verifyV0() {
  const source = sourceIdentity();
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V0', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  mkdirSync('.local', { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(resolve('.local', 'verify-'));
  const traces = join(temp, 'traces');
  const results: {
    command: string; exitCode: number | null; signal: string | null;
    result: 'passed' | 'failed'; cases: CaseResult[];
  }[] = [];
  const versions: string[] = [];
  const browserTraces: { path: string; sha256: string }[] = [];
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;

  try {
    const commands = [
      { script: 'test:unit', file: registry.V0[0] },
      { script: 'test:integration', file: registry.V0[1] },
      { script: 'test:e2e', file: registry.V0[2] },
      { script: 'typecheck' },
    ];
    for (const { script, file } of commands) {
      const report = join(temp, script.replace(':', '-') + '.json');
      const args = ['run', script];
      if (file) {
        args.push('--', file);
        if (script === 'test:e2e') args.push('--reporter=json');
        else args.push('--reporter=json', '--outputFile=' + report);
      }
      const command = ['npm', ...args].join(' ');
      const result = spawnSync('npm', args, {
        env: { ...env, EAPR_TRACE_DIR: traces, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
        stdio: ['ignore', 'inherit', 'inherit'], timeout: 120_000,
      });
      let cases: CaseResult[] = [];
      let verified = result.status === 0;
      if (file) {
        try {
          if (script === 'test:e2e') {
            const browser = browserCases(report, file);
            cases = browser.cases;
            versions.push(...browser.versions);
            const trace = traceFiles(traces);
            verified &&= trace.length === 1 && versions.length === 1;
            if (trace.length === 1) {
              copyFileSync(trace[0], join(evidence, 'browser-trace.zip'));
              browserTraces.push({ path: 'browser-trace.zip', sha256: hashBytes(readFileSync(trace[0])) });
            }
          } else cases = unitCases(report, file);
          verified &&= cases.length > 0 && cases.every(test => test.status === 'passed') &&
            requiredV0Cases[script].every(name => cases.some(test => test.name === name));
        } catch {
          verified = false;
        }
      }
      results.push({ command, exitCode: result.status, signal: result.signal, result: verified ? 'passed' : 'failed', cases });
    }

    const passed = results.every(result => result.result === 'passed');
    const packet = {
      schemaVersion: 1, runId, slice: 'V0', source, jointAcceptance: 'pending',
      result: passed ? 'passed' : 'failed', mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
      runtime: {
        node: process.version, npm: capture('npm', ['--version']), postgres: capture('postgres', ['--version']),
        chromium: versions, packageLockHash: hashBytes(readFileSync('package-lock.json')),
      },
      contract: {
        version: 1,
        sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')),
      },
      configuration: {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: process.env.EAPR_TEST_PREFIX ?? 'eapr_test_v0',
      },
      migrations: ['control', 'runtime'].map(stream => ({
        stream, expectedVersion: 1, sha256: hashBytes(readFileSync('db/' + stream + '/001_base.sql')),
      })),
      requiredTests: registry.V0, requiredCases: requiredV0Cases, commands: results, browserTraces,
    };
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
    console.log('V0 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
    if (!passed) process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const requested = process.argv[2];
if (requested === 'live') {
  console.error(process.env.OPENAI_API_KEY
    ? 'FEATURE_NOT_IMPLEMENTED: Live provider execution begins in V4.'
    : 'LIVE_CONFIGURATION_UNAVAILABLE: A genuine provider requires OPENAI_API_KEY and the live slice.');
  process.exitCode = 1;
} else if (requested === 'inject') {
  console.error('FEATURE_NOT_IMPLEMENTED: Source injection begins with the source adapters.');
  process.exitCode = 1;
} else if (requested !== 'V0') {
  const required = Object.hasOwn(registry, requested) ? registry[requested as keyof typeof registry] : undefined;
  const missing = required?.filter(file => !existsSync(file));
  if (missing?.length) console.error('Mandatory test files unavailable: ' + missing.join(', '));
  console.error(required ? requested + ' verification is unavailable in the foundation slice.' : 'Usage: npm run verify:slice -- V0');
  process.exitCode = 1;
} else {
  verifyV0();
}
