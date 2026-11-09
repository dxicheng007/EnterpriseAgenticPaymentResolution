import { spawnSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync,
  truncateSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { commandResult } from '../../scripts/verify-slice-evidence.js';
import {
  collectV2Artifacts, normalizeV2Report, parseV2BrowserResult, validateV2VitestGuard, v2ExitCode,
} from '../../scripts/verify-v2-evidence.js';
import { v2Commands, v2Requirements } from '../../scripts/verify-v2.js';

const secret = 'private-credential-and-truth-sentinel';
const browserTest = 'verifies both captured companies with v2 evidence and all thirteen checks without parent writes';
const actualBrowser = 'tests/e2e/v2-evidence-verification.spec.ts';
const resultFile = 'v2-browser-results.json';
const screenshotGroups = [
  ['preview-company-a-balance.png', 'preview-company-a-scope.png', 'preview-company-a-lineage.png',
    'preview-company-a-citation.png', 'preview-company-b-balance.png', 'preview-company-b-hold.png'],
  ['verification-company-a.png', 'verification-company-b.png'],
  ['verification-v2-company-a.png', 'verification-v2-company-b.png'],
] as const;
const checkIds = ['baseline_reconcile', 'new_record', 'duplicate_delivery', 'retry_restart',
  'invalid_money', 'allocation_scope', 'full_reversal', 'dependency_order', 'schema_drift', 'semantic_drift',
  'unknown_identity', 'snapshot_boundary', 'evidence_support'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgZGIGAAAOAAfXb+R4AAAAAElFTkSuQmCC', 'base64');
const successfulChild = { status: 0, signal: null, stdout: secret, stderr: secret };

function browserResult() {
  return {
    schemaVersion: 1, test: browserTest,
    assertions: {
      runtimeUnchanged: true, parentWritesZero: true, summariesBound: true,
      rowsMatch: true, privateBoundary: true, noActivation: true,
    },
    companies: [0, 1].map(index => {
      const jobId = '4c3ba184-37d1-4aad-b32e-9b4348b8f62' + index;
      return {
        companyId: index ? 'company-b' : 'company-a', jobId, state: 'completed', reportId: 'report:' + jobId,
        artifactHash: String(index + 1).repeat(64), profileHashes: ['3'.repeat(64), '4'.repeat(64)],
        manifestHash: 'a'.repeat(64), evaluatorBuildHash: 'e'.repeat(64),
        fixtureSetVersion: '2', parentWrites: 0, previewBalanceCents: index ? 0 : 80000, coverageComplete: true,
        eligible: true, checks: checkIds.map(id => ({
          id, status: 'passed', cases: id === 'evidence_support' ? 4 : 1, diagnosticCodes: [] as string[],
        })),
      };
    }),
  };
}

function vitestReport(file: string, names: readonly string[]) {
  return {
    success: true, numTotalTests: names.length, numPassedTests: names.length,
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: [{
      name: join(output, file), status: 'passed', message: '',
      assertionResults: names.map(fullName => ({ fullName, status: 'passed', failureMessages: [] })),
    }],
  };
}

function playwrightReport(file: string, title: string, browserOutput: string) {
  return {
    config: { projects: [{ id: '', name: '', retries: 0, repeatEach: 1, outputDir: browserOutput }] },
    errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{
      file: file.replace('tests/e2e/', ''),
      specs: [{
        title, ok: true, tests: [{
          projectId: '', projectName: '', expectedStatus: 'passed', status: 'expected',
          results: [{ status: 'passed', retry: 0, errors: [], stdout: [secret], stderr: [secret], attachments: [] }],
        }],
      }],
    }],
  };
}

let output: string;
beforeEach(() => { output = mkdtempSync(join(realpathSync(tmpdir()), 'v2-runner-test-')); });
afterEach(() => rmSync(output, { recursive: true, force: true }));

function artifactInputs() {
  const roots = [join(output, 'preview'), join(output, 'v1'), join(output, 'v2')] as const;
  for (const [index, root] of roots.entries()) {
    mkdirSync(join(root, 'test'), { recursive: true });
    for (const name of screenshotGroups[index]) writeFileSync(join(root, 'test', name), png);
  }
  writeFileSync(join(roots[2], 'test', resultFile), JSON.stringify(browserResult()));
  writeFileSync(join(roots[2], 'test', 'error-context.md'), secret);
  return roots;
}

test('v2_gate_requires_every_named_assertion_and_command', () => {
  const roots = artifactInputs();
  const artifacts = collectV2Artifacts(roots, browserTest);
  const commands = v2Commands.map(({ command, file, names, script }) => {
    if (!file) return commandResult(command, successfulChild);
    const browser = script === 'test:e2e';
    const raw = browser ? playwrightReport(file, names[0], roots[0]) : vitestReport(file, names);
    return commandResult(command, successfulChild,
      normalizeV2Report(raw, output, file, names, browser ? roots[0] : undefined));
  });
  const exit = (results: typeof commands, metadata = true) => v2ExitCode(v2Commands, results, [], metadata, artifacts);
  expect(commands).toHaveLength(21);
  expect(commands.flatMap(command => command.cases)).toHaveLength(94);
  expect(exit(commands)).toBe(0);
  expect(exit(commands, false)).toBe(1);
  for (const missing of commands.keys()) expect(exit(commands.filter((_, index) => index !== missing))).toBe(1);
  expect(exit([...commands, commands[0]])).toBe(1);
  expect(exit([...commands.slice(0, -1), commandResult('npm run typecheck', { status: 1, signal: null })])).toBe(1);

  const [{ file, names, command }] = v2Commands;
  if (!file) throw new Error('Expected unit file');
  for (const alteration of ['omitted', 'duplicate', 'wrong-file', 'extra', 'skipped', 'pending', 'todo', 'failed', 'flaky']) {
    const report = vitestReport(file, names);
    const suite = report.testResults[0];
    const cases = suite.assertionResults;
    if (alteration === 'omitted') cases.pop();
    else if (alteration === 'duplicate') cases.push(cases[0]);
    else if (alteration === 'wrong-file') suite.name = join(output, 'other.test.ts');
    else if (alteration === 'extra') cases.push({ ...cases[0], fullName: secret });
    else cases[0].status = alteration;
    const normalized = normalizeV2Report(report, output, file, names);
    expect(exit([commandResult(command, successfulChild, normalized), ...commands.slice(1)]), alteration).toBe(1);
  }
  for (const patch of [
    { status: 3 }, { signal: 'SIGTERM' },
    { error: Object.assign(new Error(secret), { code: 'ETIMEDOUT' }) }, { error: new Error(secret) },
  ]) {
    const result = commandResult(command, { ...successfulChild, ...patch },
      normalizeV2Report(vitestReport(file, names), output, file, names));
    expect(exit([result, ...commands.slice(1)])).toBe(1);
  }
  const browserIndex = v2Commands.findIndex(entry => entry.file === actualBrowser);
  for (const alteration of ['retry', 'expected failure', 'project', 'other file', 'missing result', 'flaky', 'trace attachment', 'malformed']) {
    const raw = playwrightReport(actualBrowser, browserTest, roots[2]);
    const execution = raw.suites[0].specs[0].tests[0];
    if (alteration === 'retry') execution.results[0].retry = 1;
    if (alteration === 'expected failure') execution.expectedStatus = 'failed';
    if (alteration === 'project') execution.projectId = 'other';
    if (alteration === 'other file') raw.suites.push({ ...raw.suites[0], file: 'other.spec.ts' });
    if (alteration === 'missing result') execution.results.pop();
    if (alteration === 'flaky') execution.status = 'flaky';
    if (alteration === 'trace attachment') Object.assign(execution.results[0], { attachments: [{ name: 'trace', body: secret }] });
    const normalized = normalizeV2Report(alteration === 'malformed' ? null : raw, output, actualBrowser, [browserTest], roots[2]);
    expect(exit(commands.map((passed, index) => index === browserIndex
      ? commandResult(passed.command, successfulChild, normalized) : passed)), alteration).toBe(1);
  }
  const fixture = join(output, 'guard.test.js');
  const stock = join(output, 'stock.json');
  const sidecar = join(output, 'guard.json');
  const vitestEntry = fileURLToPath(import.meta.resolve('vitest/package.json'));
  writeFileSync(fixture, `
    test('ordinary pass', () => {});
    describe('one suite', () => {
      test.fails('expected failure', () => { throw new Error('${secret}'); });
      let attempts = 0;
      test('retry recovered', { retry: 1 }, () => { if (++attempts === 1) throw new Error('${secret}'); });
    });
  `);
  const child = spawnSync(process.execPath, [join(resolve(vitestEntry, '..'), 'vitest.mjs'),
    'run', '--root', output, '--globals', '--reporter=json', '--outputFile=' + stock,
    '--reporter=' + resolve('scripts/verify-v2-vitest-reporter.ts'), fixture], {
    env: { ...process.env, EAPR_V2_VITEST_GUARD_REPORT: sidecar }, encoding: 'utf8', timeout: 10_000,
  });
  expect(child.status).toBe(0);
  const namesFromFixture = ['ordinary pass', 'one suite expected failure', 'one suite retry recovered'];
  const stockCases = JSON.parse(readFileSync(stock, 'utf8')).testResults[0].assertionResults;
  expect(stockCases.map(({ fullName, status }: { fullName: string; status: string }) => [fullName, status]))
    .toEqual(namesFromFixture.map(name => [name, 'passed']));
  const privateGuard = readFileSync(sidecar, 'utf8');
  expect(privateGuard).not.toContain(secret);
  const guard = JSON.parse(privateGuard);
  expect(guard.modules[0].assertions).toMatchObject([
    { name: 'ordinary pass', expectedFailure: false, retries: 0, attempts: 1 },
    { name: 'one suite expected failure', expectedFailure: true, retries: 0, attempts: 1 },
    { name: 'one suite retry recovered', expectedFailure: false, retries: 1, attempts: 2 },
  ]);
  expect(validateV2VitestGuard(guard, output, 'guard.test.js', namesFromFixture)).toEqual(['vitest-assertion-execution-invalid']);
  guard.modules[0].assertions.splice(1);
  expect(validateV2VitestGuard(guard, output, 'guard.test.js', ['ordinary pass'])).toEqual([]);

});

test('v2_browser_result_requires_both_actual_eligible_subjects', () => {
  expect(parseV2BrowserResult(browserResult(), browserTest)).toEqual(browserResult());
  const invalid: Array<(value: ReturnType<typeof browserResult>) => void> = [
    value => { value.companies.reverse(); }, value => { value.companies.pop(); },
    value => { value.test = 'expected-only'; }, value => { value.assertions.privateBoundary = false; },
    value => { value.companies[0].fixtureSetVersion = '1'; }, value => { value.companies[1].previewBalanceCents = 80000; },
    value => { value.companies[1].jobId = value.companies[0].jobId; },
    value => { value.companies[1].reportId = value.companies[0].reportId; },
    value => { value.companies[1].artifactHash = value.companies[0].artifactHash; },
    value => { value.companies[0].evaluatorBuildHash = secret; },
    value => { value.companies[0].profileHashes.reverse(); }, value => { value.companies[0].profileHashes = []; },
    value => { value.companies[0].profileHashes[1] = value.companies[0].profileHashes[0]; },
    value => { value.companies[0].coverageComplete = false; }, value => { value.companies[0].eligible = false; },
    value => { value.companies[0].parentWrites = 1; }, value => { value.companies[0].checks[0].cases = 0; },
    value => { value.companies[0].checks.at(-1)!.cases = 5; }, value => { value.companies[0].checks.pop(); },
    value => { value.companies[0].checks[1].id = value.companies[0].checks[0].id; },
    value => { value.companies[0].checks[0].status = 'unavailable'; },
    value => { value.companies[0].checks[0].status = 'failed'; },
    value => { value.companies[0].checks[0].diagnosticCodes.push(secret); },
    value => { Object.assign(value.companies[0].checks[0], { truth: secret }); },
  ];
  for (const alter of invalid) {
    const value = browserResult();
    alter(value);
    expect(parseV2BrowserResult(value, browserTest)).toBeUndefined();
  }
});

test('v2_artifacts_require_exact_safe_screenshots_and_result', () => {
  let roots = artifactInputs();
  const collected = collectV2Artifacts(roots, browserTest);
  expect(collected.diagnostics).toEqual([]);
  expect(collected.browser).toEqual(browserResult());
  expect(collected.screenshots.map(value => value.path)).toEqual(screenshotGroups.flat().map(name => 'screenshots/' + name));
  const cases: Array<(shot: string, result: string) => void> = [
    shot => rmSync(shot),
    shot => writeFileSync(join(roots[0], screenshotGroups[0][0]), readFileSync(shot)),
    shot => writeFileSync(shot, Buffer.concat([png, Buffer.from(secret)])),
    shot => truncateSync(shot, 17 * 1024 * 1024),
    shot => { rmSync(shot); symlinkSync(join(roots[1], 'test', screenshotGroups[1][0]), shot); },
    shot => { rmSync(shot); mkdirSync(shot); },
    shot => renameSync(shot, join(roots[1], screenshotGroups[0][0])),
    (_, result) => renameSync(result, join(roots[1], resultFile)),
    (_, result) => writeFileSync(join(roots[2], resultFile), readFileSync(result)),
    (_, result) => writeFileSync(result, secret),
    (_, result) => truncateSync(result, 1024 * 1024),
    () => writeFileSync(join(roots[0], 'trace.zip'), secret),
    () => writeFileSync(join(roots[1], 'video.webm'), secret),
    () => { rmSync(roots[2], { recursive: true }); symlinkSync(roots[1], roots[2]); },
    () => rmSync(roots[0], { recursive: true }),
  ];
  for (const alter of cases) {
    alter(join(roots[0], 'test', screenshotGroups[0][0]), join(roots[2], 'test', resultFile));
    expect(collectV2Artifacts(roots, browserTest)).toMatchObject({
      screenshots: [], diagnostics: expect.arrayContaining([expect.any(String)]),
    });
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = artifactInputs();
  }
  expect(collectV2Artifacts(roots, 'another test').diagnostics).not.toEqual([]);
});

function git(...args: string[]) {
  expect(spawnSync('git', args, { cwd: output }).status).toBe(0);
}

function initFixture() {
  git('init', '-q');
  writeFileSync(join(output, '.gitignore'), '.evidence/\n.local/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Verifier Test', '-c', 'user.email=verifier@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Initialize verifier fixture');
}

function cli(env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/verify-slice.ts'), 'V2'], {
    cwd: output, env, encoding: 'utf8', timeout: 20_000,
  });
}

function packet() {
  const evidence = join(output, '.evidence');
  const [source] = readdirSync(evidence);
  const directory = join(evidence, source, 'V2');
  const [run] = readdirSync(directory);
  return join(directory, run);
}

test('v2_packet_never_serializes_private_child_data', () => {
  const roots = artifactInputs();
  const raw = playwrightReport(actualBrowser, browserTest, roots[2]);
  Object.assign(raw.suites[0].specs[0].tests[0].results[0], { attachments: [{ body: secret }] });
  const normalized = normalizeV2Report(raw, output, actualBrowser, [browserTest], roots[2]);
  expect(normalized.diagnostics).toEqual([]);
  const artifacts = collectV2Artifacts(roots, browserTest);
  expect(artifacts.diagnostics).toEqual([]);
  expect(JSON.stringify([artifacts, commandResult('npm run test:e2e', successfulChild, normalized)])).not.toContain(secret);
  const privateValue = { ...browserResult(), fixtureSetId: secret };
  writeFileSync(join(roots[2], 'test', resultFile), JSON.stringify(privateValue));
  expect(JSON.stringify(collectV2Artifacts(roots, browserTest))).not.toContain(secret);
  expect(collectV2Artifacts(roots, browserTest).diagnostics).not.toEqual([]);
});

test('v2_cli_missing_preflight_writes_failed_packet_without_commands', () => {
  initFixture();
  for (const env of [process.env, { ...process.env, EAPR_PG_PORT: secret, EAPR_DEMO_NAMESPACE: secret }]) {
    const result = cli(env);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('V2 verification failed');
    expect(result.stderr).toContain('required-test-files-missing');
    expect(result.stdout + result.stderr).not.toContain(secret);
    const location = packet();
    expect(JSON.parse(readFileSync(join(location, 'manifest.json'), 'utf8'))).toMatchObject({
      result: 'failed', commands: [], diagnostics: expect.arrayContaining(['required-test-files-missing']),
    });
    expect(JSON.parse(readFileSync(join(location, 'commands.json'), 'utf8')).commands).toEqual([]);
    rmSync(join(output, '.evidence'), { recursive: true });
  }
});

test('v2_cli_execution_failure_retains_failed_packet_and_cleans_scratch', () => {
  initFixture();
  for (const file of [...Object.keys(v2Requirements), 'package-lock.json',
    'docs/superpowers/plans/2026-11-08-contract-freeze.md',
    'docs/progress/2026-11-08/handoffs/evidence-v2-contract.md',
    'db/control/001_fixture.sql', 'db/runtime/001_fixture.sql']) {
    const path = join(output, file);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, file === 'package-lock.json' ? readFileSync('package-lock.json') : 'fixture');
  }
  for (const key of ['EAPR_PG_PORT', 'EAPR_DEMO_NAMESPACE']) {
    const invalid = cli({ ...process.env, [key]: secret });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout + invalid.stderr).not.toContain(secret);
    expect(invalid.stderr).toContain('lease-configuration-invalid');
    expect(JSON.parse(readFileSync(join(packet(), 'manifest.json'), 'utf8')).commands).toEqual([]);
    rmSync(join(output, '.evidence'), { recursive: true });
  }
  mkdirSync(join(output, '.local'));
  writeFileSync(join(output, '.local', 'sentinel'), secret);
  const bin = join(output, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'postgres'), '#!/bin/sh\necho "postgres (PostgreSQL) 18.6"\n', { mode: 0o700 });
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
if [ "$1" = "--version" ]; then echo "11.0.0"; exit 0; fi
for arg in "$@"; do
  case "$arg" in --outputFile=*) printf '%s' '${secret}' > "${'\${arg#--outputFile=}'}";; esac
done
printf '%s' '${secret}'
printf '%s' '${secret}' >&2
exit 7
`, { mode: 0o700 });
  const result = cli({ ...process.env, PATH: bin + ':' + process.env.PATH });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('V2 verification failed');
  expect(result.stdout + result.stderr).not.toContain(secret);
  const location = packet();
  const commands = readFileSync(join(location, 'commands.json'), 'utf8');
  expect(JSON.parse(commands).commands).toEqual(expect.arrayContaining([
    expect.objectContaining({ exitCode: 7, diagnostics: expect.arrayContaining(['command-exit-nonzero']) }),
  ]));
  for (const file of readdirSync(location)) expect(readFileSync(join(location, file), 'utf8')).not.toContain(secret);
  expect(readdirSync(join(output, '.local'))).toEqual(['sentinel']);
  expect(readFileSync(join(output, '.local', 'sentinel'), 'utf8')).toBe(secret);
});
