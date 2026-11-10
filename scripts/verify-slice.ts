import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { hashBytes, hashCanonical } from '../packages/contracts/src/canonical.js';
import {
  chromiumVersion, collectScreenshots, commandResult, normalizeReport, v1ExitCode, v3ExitCode,
  syncGateOutcome, v4GateOutcome, v7GateOutcome,
} from './verify-slice-evidence.js';

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
  V3: ['tests/integration/v3-activation.test.ts', 'tests/e2e/v3-review.spec.ts', 'tests/integration/v3-corrections.test.ts'],
  V4: ['tests/integration/v4-agent-tools.test.ts', 'tests/e2e/v4-monitor.spec.ts', 'tests/live/v4-build-connectors.test.ts'],
  V5: [
    'tests/integration/v5-sync.test.ts', 'apps/worker/test/sync-dependencies.test.ts', 'tests/e2e/v5-ai-off.spec.ts',
    'tests/integration/v5-runtime-isolation.test.ts',
  ],
  V6: [
    'tests/integration/v6-recovery.test.ts', 'tests/integration/v6-drift.test.ts', 'tests/e2e/v6-containment.spec.ts',
    'tests/integration/v5-sync.test.ts', 'apps/worker/test/sync-dependencies.test.ts', 'tests/e2e/v5-ai-off.spec.ts',
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

function capture(program: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(program, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, env });
  if (result.status !== 0) throw new Error('Unable to record ' + program + ' version or source identity');
  return result.stdout.trim();
}

function sourceIdentity(env?: NodeJS.ProcessEnv) {
  const commit = capture('git', ['rev-parse', 'HEAD'], env);
  const clean = !capture('git', ['status', '--porcelain'], env);
  if (clean) return { commit, clean, evidenceKey: commit };
  const trackedDiff = capture('git', ['diff', '--binary', 'HEAD'], env);
  const untracked = capture('git', ['ls-files', '--others', '--exclude-standard', '-z'], env)
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

async function verifyV0() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort } = await import('./native-db.js');
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
    const catalog = readMigrationCatalog({ throughVersion: 1 });
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
      migrations: migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      }))),
      requiredTests: registry.V0, requiredCases: requiredV0Cases, commands: results, browserTraces,
    };
    writeFileSync(join(evidence, 'manifest.json'), JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 });
    console.log('V0 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
    if (!passed) process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const requiredV1Cases = {
  'packages/evidence/test/locate.test.ts': [
    'exact source locators uses page-local UTF-16 offsets',
    'exact source locators resolves escaped JSON keys and canonicalizes non-string values',
    'exact source locators indexes decoded CSV records and checks email message identity',
    'immutable original bytes rejects traversal and symlinked content',
    'original extraction rejects duplicate CSV headers and accepts multiline records',
    'original extraction extracts actual PDF text and rejects image-only or malformed input',
    'searches only authorized excerpts and requires full coverage for original scope',
  ],
  'packages/sources/test/change-feed.test.ts': [
    'source change contract accepts only a contiguous complete page and an unchanged empty cursor',
    'source change contract preserves exact B transport columns and unknown raw account identity',
  ],
  'tests/integration/v1-evidence.test.ts': [
    'V1 evidence generates repeatable original bytes, preserves distinct same-name identities and explicit links',
    'V1 evidence serializes repeated versions and authorizes uploads before publication',
  ],
  'tests/integration/v1-manifests.test.ts': [
    'pins a B epoch and serializes publication with live append across all three streams',
  ],
  'tests/e2e/v1-sources.spec.ts': [
    'stores immutable uploads and opens exact originals only after a complete source capture',
  ],
} satisfies Record<typeof registry.V1[number], string[]>;

const v1Commands = [
  { script: 'test:unit', file: 'packages/evidence/test/locate.test.ts' },
  { script: 'test:unit', file: 'packages/sources/test/change-feed.test.ts' },
  { script: 'test:integration', file: 'tests/integration/v1-evidence.test.ts' },
  { script: 'test:integration', file: 'tests/integration/v1-manifests.test.ts' },
  { script: 'test:e2e', file: 'tests/e2e/v1-sources.spec.ts' },
  { script: 'typecheck', file: undefined },
] as const;

const chromiumProbe = `
  import { chromium } from '@playwright/test';
  const browser = await chromium.launch();
  try { console.log(browser.version()); }
  finally { await browser.close(); }
`;

function readV1Report(report: string, browser: boolean, file: typeof registry.V1[number]) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      browser ? 'playwright' : 'vitest', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, requiredV1Cases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV1() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V1', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let screenshots: { path: string; sha256: string }[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = registry.V1.filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V1 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v1-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v1Commands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        const browser = script === 'test:e2e';
        if (file) {
          args.push('--', file, '--reporter=json');
          args.push(browser ? '--trace=off' : '--outputFile=' + report);
        }
        const command = ['npm', ...args.map(arg => arg === '--outputFile=' + report
          ? '--outputFile=<private-report>' : arg)].join(' ');
        const child = spawnSync('npm', args, {
          env: { ...env, EAPR_TRACE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024, timeout: 120_000,
        });
        const result = commandResult(command, child, file ? readV1Report(report, browser, file) : undefined);
        commands.push(result);
        console.log('V1 ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');

      const artifacts = collectScreenshots(browserOutput);
      diagnostics.push(...artifacts.diagnostics);
      if (artifacts.screenshots.length) {
        mkdirSync(join(evidence, 'screenshots'), { mode: 0o700 });
        screenshots = artifacts.screenshots.map(({ path, sha256, bytes }) => {
          writeFileSync(join(evidence, path), bytes, { mode: 0o600 });
          return { path, sha256 };
        });
      }
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const exitCode = v1ExitCode(commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V1', source, jointAcceptance: 'pending',
    result: exitCode === 0 ? 'passed' : 'failed',
    mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V1, requiredCases: requiredV1Cases, commands, screenshots, diagnostics,
    authenticatedTrace: 'disabled',
    limitations: ['Development sources only', 'Full V2 verification unavailable', 'Independent review and joint G1 acceptance pending'],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V1 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  if (diagnostics.length) console.error('V1 diagnostics: ' + diagnostics.join(', '));
  process.exitCode = exitCode;
}

const requiredV3Cases = {
  'tests/integration/v3-activation.test.ts': [
    'activates one approved customer from real A and B proofs and recovers the authoritative receipt',
  ],
  'tests/e2e/v3-review.spec.ts': [
    'binds one-customer approval, reuses the saved key, gates stale packages, and keeps parent reads GET-only',
    'retries a failed details read and offers earlier unresolved approvals only as an explicit action',
    'inspects source evidence before approval and shows a server-held unsupported term as blocked',
    'recovers the original receipt after a lost reply and a newer head, and sends one request per double click',
  ],
  'tests/integration/v3-corrections.test.ts': [
    'unsupported invented money stays blocked with no invented resolution write',
  ],
} satisfies Record<typeof registry.V3[number], string[]>;

const v3Commands = [
  { script: 'test:integration', file: 'tests/integration/v3-activation.test.ts' },
  { script: 'test:integration', file: 'tests/integration/v3-corrections.test.ts' },
  { script: 'test:e2e', file: 'tests/e2e/v3-review.spec.ts' },
  { script: 'typecheck', file: undefined },
] as const;

function readV3Report(report: string, browser: boolean, file: typeof registry.V3[number]) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      browser ? 'playwright' : 'vitest', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, requiredV3Cases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV3() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V3', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = registry.V3.filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V3 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v3-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v3Commands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        const browser = script === 'test:e2e';
        if (file) {
          args.push('--', file, '--reporter=json');
          args.push(browser ? '--trace=off' : '--outputFile=' + report);
        }
        const command = ['npm', ...args.map(arg => arg === '--outputFile=' + report
          ? '--outputFile=<private-report>' : arg)].join(' ');
        const child = spawnSync('npm', args, {
          env: { ...env, EAPR_TRACE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 600_000,
        });
        const result = commandResult(command, child, file ? readV3Report(report, browser, file) : undefined);
        commands.push(result);
        console.log('V3 ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const exitCode = v3ExitCode(commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V3', source, jointAcceptance: 'pending',
    result: exitCode === 0 ? 'passed' : 'failed',
    mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V3, requiredCases: requiredV3Cases, commands, screenshots: [], diagnostics,
    authenticatedTrace: 'disabled',
    limitations: [
      'Development sources only',
      'E3 full correction authority remains a joint design gate',
      'Independent review and joint G3 acceptance pending',
    ],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V3 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  if (diagnostics.length) console.error('V3 diagnostics: ' + diagnostics.join(', '));
  process.exitCode = exitCode;
}

const v4PrerequisiteCases = {
  'tests/integration/v4-agent-tools.test.ts': [
    'denies unknown and role-incompatible tools while keeping repair/finish unavailable',
    'stops at attempt and tool-round budgets without accepting further tool steps',
    'preserves pending tool steps and budgets across pause and resume',
    'keeps packages/discovery free of product env names and live composition mounts',
  ],
  'tests/e2e/v4-monitor.spec.ts': [
    'default local discovery reports unavailable model and start',
    'monitors durable scripted activity and persists pause, resume, and usage across reload',
  ],
} satisfies Partial<Record<typeof registry.V4[number], string[]>>;

const v4PrerequisiteCommands = [
  { script: 'test:integration', file: 'tests/integration/v4-agent-tools.test.ts' as const },
  { script: 'test:e2e', file: 'tests/e2e/v4-monitor.spec.ts' as const },
  { script: 'typecheck', file: undefined },
] as const;

function readV4Report(report: string, browser: boolean, file: keyof typeof v4PrerequisiteCases) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      browser ? 'playwright' : 'vitest', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, v4PrerequisiteCases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV4() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V4', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = Object.keys(v4PrerequisiteCases).filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V4 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v4-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v4PrerequisiteCommands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        const browser = script === 'test:e2e';
        if (file) {
          args.push('--', file, '--reporter=json');
          args.push(browser ? '--trace=off' : '--outputFile=' + report);
        }
        const command = ['npm', ...args.map(arg => arg === '--outputFile=' + report
          ? '--outputFile=<private-report>' : arg)].join(' ');
        const child = spawnSync('npm', args, {
          env: {
            ...env,
            EAPR_TRACE_DIR: browserOutput,
            PLAYWRIGHT_JSON_OUTPUT_FILE: report,
          },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 600_000,
        });
        const result = commandResult(command, child, file ? readV4Report(report, browser, file) : undefined);
        commands.push(result);
        console.log('V4 prerequisite ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const { exitCode, ...outcome } = v4GateOutcome(commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V4', source, independentReview: 'pending', jointAcceptance: 'pending',
    ...outcome,
    mode: { sourceFixtures: 'development-only', model: 'scripted-prerequisites', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V4, prerequisiteCases: v4PrerequisiteCases, commands, screenshots: [],
    authenticatedTrace: 'disabled',
    limitations: [
      'Development sources only',
      'Genuine live connector builds and holdout verification are unavailable',
      'Blocker D product live composition mount remains unmounted',
    ],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V4 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  console.error('V4 diagnostics: ' + packet.diagnostics.join(', '));
  process.exitCode = exitCode;
}

const v7PrerequisiteCases = {
  'tests/e2e/v7-demo.spec.ts': [
    'deterministic fixture wires both demo companies on sources and preview',
  ],
} satisfies Partial<Record<typeof registry.V7[number], string[]>>;

const v7PrerequisiteCommands = [
  { script: 'test:e2e', file: 'tests/e2e/v7-demo.spec.ts' as const },
  { script: 'typecheck', file: undefined },
] as const;

function readV7Report(report: string, file: keyof typeof v7PrerequisiteCases) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      'playwright', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, v7PrerequisiteCases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV7() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V7', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = Object.keys(v7PrerequisiteCases).filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V7 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v7-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v7PrerequisiteCommands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        if (file) args.push('--', file, '--reporter=json', '--trace=off');
        const command = ['npm', ...args].join(' ');
        const child = spawnSync('npm', args, {
          env: {
            ...env,
            EAPR_TRACE_DIR: browserOutput,
            PLAYWRIGHT_JSON_OUTPUT_FILE: report,
          },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 600_000,
        });
        const result = commandResult(command, child, file ? readV7Report(report, file) : undefined);
        commands.push(result);
        console.log('V7 prerequisite ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const { exitCode, ...outcome } = v7GateOutcome(commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V7', source, independentReview: 'pending', jointAcceptance: 'pending',
    ...outcome,
    mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V7, prerequisiteCases: v7PrerequisiteCases, commands, screenshots: [],
    authenticatedTrace: 'disabled',
    limitations: [
      'Development sources only',
      'Full V7 requires G0–G6 machine evidence, genuine live construction, an unseen holdout, and three live rehearsals',
    ],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V7 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  console.error('V7 diagnostics: ' + packet.diagnostics.join(', '));
  process.exitCode = exitCode;
}

const requiredV5Cases = {
  'tests/integration/v5-sync.test.ts': [
    'admits standing authority for the activated customer and denies unknown accounts',
    'captures a fresh post-activation API page without parent writes or model credentials',
    'applies a fresh invoice once, replays the receipt and fences stale input',
  ],
  'apps/worker/test/sync-dependencies.test.ts': [
    'orders providers before consumers and reports missing prerequisites',
    'cycles are explicit exceptions',
    'selection never splits a group and keeps stable order',
    'rejects a provider index absent from the materialized dependency graph',
    'rejects duplicate materialized input indexes',
    'rejects invalid materialized input index -1',
    'rejects invalid materialized input index 0.5',
    'rejects invalid materialized input index NaN',
    'rejects invalid materialized input index Infinity',
    'rejects invalid materialized input index 9007199254740992',
    'orders held provider candidates from the real classifier without releasing the hold',
    'rejects invalid group selection limit 0',
    'rejects invalid group selection limit -1',
    'rejects invalid group selection limit 0.5',
    'rejects invalid group selection limit NaN',
    'rejects invalid group selection limit Infinity',
    'rejects invalid group selection limit 1001',
    'accepts a whole 1000-event group at the default and explicit limit',
    'third unresolved examination quarantines and transport backoff is bounded',
  ],
  'tests/e2e/v5-ai-off.spec.ts': [
    'AI-off worker stays ready without model credentials or provider attempts',
  ],
  'tests/integration/v5-runtime-isolation.test.ts': [
    'worker production sources and import graph stay free of model and discovery packages',
    'model-call trap fires on attempted provider use while capture remains model-free',
  ],
} satisfies Record<typeof registry.V5[number], string[]>;

const v5Commands = [
  { script: 'test:integration', file: 'tests/integration/v5-sync.test.ts' as const },
  { script: 'test:unit', file: 'apps/worker/test/sync-dependencies.test.ts' as const },
  { script: 'test:e2e', file: 'tests/e2e/v5-ai-off.spec.ts' as const },
  { script: 'test:integration', file: 'tests/integration/v5-runtime-isolation.test.ts' as const },
  { script: 'typecheck', file: undefined },
] as const;

function readV5Report(report: string, browser: boolean, file: typeof registry.V5[number]) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      browser ? 'playwright' : 'vitest', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, requiredV5Cases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV5() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V5', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = registry.V5.filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V5 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v5-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v5Commands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        const browser = script === 'test:e2e';
        if (file) {
          args.push('--', file, '--reporter=json');
          args.push(browser ? '--trace=off' : '--outputFile=' + report);
        }
        const command = ['npm', ...args.map(arg => arg === '--outputFile=' + report
          ? '--outputFile=<private-report>' : arg)].join(' ');
        const child = spawnSync('npm', args, {
          env: { ...env, EAPR_TRACE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 600_000,
        });
        const result = commandResult(command, child, file ? readV5Report(report, browser, file) : undefined);
        commands.push(result);
        console.log('V5 prerequisite ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const { exitCode, ...outcome } = syncGateOutcome('V5', commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V5', source, independentReview: 'pending', jointAcceptance: 'pending',
    ...outcome,
    mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V5, prerequisiteCases: requiredV5Cases, commands, screenshots: [],
    authenticatedTrace: 'disabled',
    limitations: [
      'Development sources only',
      'End-to-end AI-off synchronization across both source modes remains unverified',
    ],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V5 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  console.error('V5 diagnostics: ' + packet.diagnostics.join(', '));
  process.exitCode = exitCode;
}

const requiredV6Cases = {
  'tests/integration/v6-recovery.test.ts': [
    'exact activation replay and capture restart preserve committed financial rows',
    'revoke fences stale epochs while replaying earlier pause and leaving financial rows intact',
  ],
  'tests/integration/v6-drift.test.ts': [
    'schema-renamed capture stays out of committed financial rows while peer authority stays active',
    'semantic drift blocks resume while independent peer connection remains active',
  ],
  'tests/e2e/v6-containment.spec.ts': [
    'containment surfaces stay ready without model credentials or financial writes',
  ],
  'tests/integration/v5-sync.test.ts': requiredV5Cases['tests/integration/v5-sync.test.ts'],
  'apps/worker/test/sync-dependencies.test.ts': requiredV5Cases['apps/worker/test/sync-dependencies.test.ts'],
  'tests/e2e/v5-ai-off.spec.ts': requiredV5Cases['tests/e2e/v5-ai-off.spec.ts'],
  'tests/integration/v5-runtime-isolation.test.ts': requiredV5Cases['tests/integration/v5-runtime-isolation.test.ts'],
} satisfies Record<typeof registry.V6[number], string[]>;

const v6Commands = [
  { script: 'test:integration', file: 'tests/integration/v6-recovery.test.ts' as const },
  { script: 'test:integration', file: 'tests/integration/v6-drift.test.ts' as const },
  { script: 'test:e2e', file: 'tests/e2e/v6-containment.spec.ts' as const },
  { script: 'test:integration', file: 'tests/integration/v5-sync.test.ts' as const },
  { script: 'test:unit', file: 'apps/worker/test/sync-dependencies.test.ts' as const },
  { script: 'test:e2e', file: 'tests/e2e/v5-ai-off.spec.ts' as const },
  { script: 'test:integration', file: 'tests/integration/v5-runtime-isolation.test.ts' as const },
  { script: 'typecheck', file: undefined },
] as const;

function readV6Report(report: string, browser: boolean, file: typeof registry.V6[number]) {
  try {
    const stat = lstatSync(report);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error();
    return normalizeReport(
      browser ? 'playwright' : 'vitest', JSON.parse(readFileSync(report, 'utf8')),
      process.cwd(), file, requiredV6Cases[file],
    );
  } catch {
    return { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
  }
}

async function verifyV6() {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  delete env.NO_COLOR;
  const source = sourceIdentity(env);
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve('.evidence', source.evidenceKey, 'V6', runId);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let chromium: string | undefined;
  let runtime;
  let contract;
  let configuration;
  let migrations;
  let temp: string | undefined;

  try {
    const missing = registry.V6.filter(file => !existsSync(file) || !lstatSync(file).isFile());
    if (missing.length) diagnostics.push('required-test-files-missing');
    for (const file of missing) console.error('V6 required test file unavailable: ' + file);

    try {
      runtime = {
        node: process.version, npm: capture('npm', ['--version'], env),
        postgres: capture('postgres', ['--version'], env),
        packageLockHash: hashBytes(readFileSync('package-lock.json')),
      };
      contract = { version: 1, sha256: hashBytes(readFileSync('docs/superpowers/plans/2026-11-08-contract-freeze.md')) };
      configuration = {
        host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432), webPort: localPort('EAPR_WEB_PORT', 5173),
        controlPort: localPort('EAPR_CONTROL_PORT', 3001), workerPort: localPort('EAPR_WORKER_PORT', 3002),
        demoNamespace: process.env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
        testPrefix: testLeasePrefix(),
      };
      const catalog = readMigrationCatalog();
      migrations = migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
        stream, expectedVersion: version, sha256,
      })));
    } catch {
      diagnostics.push('run-metadata-unavailable');
    }

    if (!diagnostics.length) {
      mkdirSync('.local', { recursive: true, mode: 0o700 });
      temp = mkdtempSync(resolve('.local', 'verify-v6-'));
      const browserOutput = join(temp, 'browser');
      for (const [index, { script, file }] of v6Commands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        const browser = script === 'test:e2e';
        if (file) {
          args.push('--', file, '--reporter=json');
          args.push(browser ? '--trace=off' : '--outputFile=' + report);
        }
        const command = ['npm', ...args.map(arg => arg === '--outputFile=' + report
          ? '--outputFile=<private-report>' : arg)].join(' ');
        const child = spawnSync('npm', args, {
          env: { ...env, EAPR_TRACE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 600_000,
        });
        const result = commandResult(command, child, file ? readV6Report(report, browser, file) : undefined);
        commands.push(result);
        console.log('V6 prerequisite ' + result.result + ' ' + command +
          (result.diagnostics.length ? ' (' + result.diagnostics.join(', ') + ')' : ''));
      }

      chromium = chromiumVersion(spawnSync(process.execPath, ['--input-type=module', '-e', chromiumProbe], {
        env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024, timeout: 10_000,
      }));
      if (!chromium) diagnostics.push('chromium-version-unavailable');
    }
  } catch {
    diagnostics.push('verification-setup-or-evidence-error');
  } finally {
    if (temp) {
      try {
        rmSync(temp, { recursive: true, force: true });
      } catch {
        diagnostics.push('private-output-cleanup-failed');
      }
    }
  }

  const { exitCode, ...outcome } = syncGateOutcome('V6', commands, diagnostics, chromium);
  const packet = {
    schemaVersion: 1, runId, slice: 'V6', source, independentReview: 'pending', jointAcceptance: 'pending',
    ...outcome,
    mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
    runtime: { ...runtime, chromium: chromium ? [chromium] : [] },
    contract, configuration, migrations,
    requiredTests: registry.V6, prerequisiteCases: requiredV6Cases, commands, screenshots: [],
    authenticatedTrace: 'disabled',
    limitations: [
      'Development sources only',
      'Application crash recovery, concurrent authority fencing, and operating drift containment remain unverified',
    ],
  };
  const write = (file: string, value: unknown) =>
    writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  write('commands.json', commands);
  write('assertions.json', commands.flatMap(command => command.cases));
  write('manifest.json', packet);
  console.log('V6 verification ' + packet.result + '. Evidence: ' + relative(process.cwd(), evidence));
  console.error('V6 diagnostics: ' + packet.diagnostics.join(', '));
  process.exitCode = exitCode;
}

const requested = process.argv[2];
if (requested === 'live') {
  console.error('Use npm run test:live -- <tests/live/*.test.ts> (scripts/live-build.ts).');
  process.exitCode = 1;
} else if (requested === 'inject') {
  const { runDemoInject } = await import('./demo-inject.js');
  process.exitCode = await runDemoInject(process.argv.slice(3));
} else if (requested === 'V1') {
  await verifyV1();
} else if (requested === 'V2') {
  const { verifyV2 } = await import('./verify-v2.js');
  verifyV2();
} else if (requested === 'V3') {
  await verifyV3();
} else if (requested === 'V4') {
  await verifyV4();
} else if (requested === 'V5') {
  await verifyV5();
} else if (requested === 'V6') {
  await verifyV6();
} else if (requested === 'V7') {
  await verifyV7();
} else if (requested !== 'V0') {
  const required = Object.hasOwn(registry, requested) ? registry[requested as keyof typeof registry] : undefined;
  const missing = required?.filter(file => !existsSync(file));
  if (missing?.length) console.error('Mandatory test files unavailable: ' + missing.join(', '));
  console.error(required ? requested + ' verification is unavailable in the foundation slice.' : 'Usage: npm run verify:slice -- <V0|V1|V2|V3|V4|V5|V6|V7>');
  process.exitCode = 1;
} else {
  await verifyV0();
}
