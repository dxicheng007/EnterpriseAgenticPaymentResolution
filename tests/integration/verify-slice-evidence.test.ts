import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import {
  chromiumVersion, collectScreenshots, commandResult, normalizeReport, v1ExitCode, v4GateOutcome,
} from '../../scripts/verify-slice-evidence.js';

const root = '/repo';
const unit = 'packages/evidence/test/locate.test.ts';
const browser = 'tests/e2e/v1-sources.spec.ts';
const secret = 'private-cookie-and-csrf-sentinel';
const names = ['exact describe first', 'second'];
const vitest = () => ({
  success: true,
  numFailedTests: 0,
  testResults: [{
    name: join(root, unit),
    assertionResults: names.map(fullName => ({ fullName, status: 'passed', failureMessages: [secret] })),
  }],
});
const execution = () => ({
  status: 'expected', expectedStatus: 'passed',
  results: [{ status: 'passed', retry: 0, attachments: [{ body: secret }], stdout: [{ text: secret }] }],
});
const playwright = () => ({
  errors: [],
  stats: { unexpected: 0, skipped: 0, flaky: 0, expected: 1 },
  suites: [{
    file: 'v1-sources.spec.ts',
    suites: [{
      file: 'v1-sources.spec.ts',
      specs: [{ title: 'mandatory browser case', tests: [execution()] }],
    }],
  }],
});
const normalizeUnit = (report: unknown) => normalizeReport('vitest', report, root, unit, names);
const normalizeBrowser = (report: unknown) => normalizeReport('playwright', report, root, browser, ['mandatory browser case']);

test('normalizes only the expected file, names and statuses', () => {
  expect(normalizeUnit(vitest())).toEqual({
    cases: names.map(name => ({ file: unit, name, status: 'passed' })), diagnostics: [],
  });
  expect(normalizeBrowser(playwright())).toEqual({
    cases: [{ file: browser, name: 'mandatory browser case', status: 'passed' }], diagnostics: [],
  });
});

const multiBrowser = 'tests/e2e/v3-review.spec.ts';
const multiFile = 'v3-review.spec.ts';
const browserNames = ['approve one customer', 'recover an earlier approval'];
const browserProject = { id: 'default', name: 'Default' };
const multiPlaywright = () => ({
  config: { projects: [browserProject] },
  errors: [] as unknown[],
  stats: { unexpected: 0, skipped: 0, flaky: 0, expected: 2 },
  suites: [{
    file: multiFile,
    specs: [...browserNames].reverse().map(title => ({
      title, file: multiFile, ok: true,
      tests: [{ ...execution(), projectId: browserProject.id, projectName: browserProject.name }],
    })),
  }],
});
const normalizeMultiBrowser = (report: unknown) => normalizeReport('playwright', report, root, multiBrowser, browserNames);

const multiBrowserResult = {
  cases: [
    { file: multiBrowser, name: 'approve one customer', status: 'passed' },
    { file: multiBrowser, name: 'recover an earlier approval', status: 'passed' },
  ],
  diagnostics: [],
};

test('normalizes two mandatory specs in one file in allowlist order', () => {
  expect(normalizeMultiBrowser(multiPlaywright())).toEqual(multiBrowserResult);
});

test('normalizes mandatory specs across direct and nested suites of the same file', () => {
  const report = multiPlaywright();
  const [suite] = report.suites;
  const [nested] = suite.specs.splice(0, 1);
  expect(normalizeMultiBrowser({
    ...report, suites: [{ ...suite, suites: [{ file: multiFile, specs: [nested] }] }],
  })).toEqual(multiBrowserResult);
});

test.each<[string, (report: ReturnType<typeof multiPlaywright>) => unknown]>([
  ['missing spec', report => report.suites[0].specs.pop()],
  ['extra spec', report => report.suites[0].specs.push({ ...report.suites[0].specs[0], title: secret })],
  ['duplicate spec', report => { report.suites[0].specs[0].title = report.suites[0].specs[1].title; }],
  ['unlisted spec', report => { report.suites[0].specs[0].title = secret; }],
  ['wrong spec file', report => { report.suites[0].specs[0].file = 'other.spec.ts'; }],
  ['duplicate file suite', report => report.suites.push(report.suites[0])],
  ['extra project execution', report => report.suites[0].specs[0].tests.push(report.suites[0].specs[0].tests[0])],
  ['extra configured project', report => report.config.projects.push({ id: secret, name: secret })],
  ['different project ID', report => { report.suites[0].specs[0].tests[0].projectId = secret; }],
  ['different project name', report => { report.suites[0].specs[0].tests[0].projectName = secret; }],
  ['report error', report => report.errors.push({ message: secret })],
  ['incorrect expected count', report => { report.stats.expected = 1; }],
  ['unexpected count', report => { report.stats.unexpected = 1; }],
  ['skipped count', report => { report.stats.skipped = 1; }],
  ['flaky count', report => { report.stats.flaky = 1; }],
])('rejects %s in a multi-spec report without leaking reporter data', (_, mutate) => {
  const report = multiPlaywright();
  mutate(report);
  const result = normalizeMultiBrowser(report);
  expect(result.diagnostics).not.toEqual([]);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test('rejects empty suite branches even with both mandatory specs', () => {
  const report = multiPlaywright();
  const result = normalizeMultiBrowser({
    ...report, suites: [{ ...report.suites[0], suites: [{ file: multiFile, specs: [] }] }],
  });
  expect(result.diagnostics).not.toEqual([]);
});

test('rejects Playwright reports with incomplete summary counters', () => {
  const report = multiPlaywright();
  const result = normalizeMultiBrowser({ ...report, stats: { expected: 2 } });
  expect(result.diagnostics).not.toEqual([]);
});

test('rejects browser suites deeper than the traversal bound', () => {
  const report = multiPlaywright();
  let suite: unknown = report.suites[0];
  for (let depth = 0; depth < 33; depth++) suite = { file: multiFile, suites: [suite] };
  expect(normalizeMultiBrowser({ ...report, suites: [suite] }).diagnostics).not.toEqual([]);
});

test.each([
  ['missing file', { testResults: [] }],
  ['wrong file', { testResults: [{ ...vitest().testResults[0], name: '/repo/wrong' }] }],
  ['empty assertions', { testResults: [{ ...vitest().testResults[0], assertionResults: [] }] }],
  ['unsuccessful summary', { success: false }],
  ['failed summary', { numFailedTests: 1 }],
  ['report error', { errors: [{ message: secret }] }],
])('rejects Vitest %s with safe diagnostics', (_, patch) => {
  const result = normalizeUnit({ ...vitest(), ...patch });
  expect(result).toMatchObject({ diagnostics: [expect.any(String)] });
  expect(JSON.stringify(result)).not.toContain(secret);
});

test.each(['skipped', 'pending', 'todo', 'failed', 'unknown', 'missing', 'duplicate', 'unexpected'])(
  'rejects Vitest %s assertion coverage',
  state => {
    const report = vitest();
    const assertions = report.testResults[0].assertionResults;
    if (state === 'missing') assertions.pop();
    else if (state === 'duplicate') assertions.push(assertions[0]);
    else if (state === 'unexpected') assertions[0].fullName = 'first';
    else assertions[0].status = state;
    expect(normalizeUnit(report)).toMatchObject({ diagnostics: expect.arrayContaining([expect.any(String)]) });
  },
);

test.each([null, '', { testResults: [{}] }])('rejects malformed Vitest and Playwright reports', report => {
  expect(normalizeUnit(report)).toMatchObject({ diagnostics: [expect.any(String)] });
  expect(normalizeBrowser(report)).toMatchObject({ diagnostics: [expect.any(String)] });
});

test.each([
  ['skipped', { status: 'skipped' }],
  ['failed', { results: [{ status: 'failed', retry: 0 }] }],
  ['result error', { results: [{ status: 'passed', retry: 0, error: { message: secret } }] }],
  ['expected failure', { expectedStatus: 'failed' }],
  ['unexpected pass', { status: 'unexpected', expectedStatus: 'failed' }],
  ['flaky', { status: 'flaky' }],
  ['retry', { results: [{ status: 'passed', retry: 1 }] }],
  ['multiple attempts', { results: [execution().results[0], execution().results[0]] }],
])('rejects browser %s execution', (_, patch) => {
  const report = playwright();
  Object.assign(report.suites[0].suites[0].specs[0].tests[0], patch);
  expect(normalizeBrowser(report)).toMatchObject({ diagnostics: expect.arrayContaining([expect.any(String)]) });
});

test('rejects additional browser projects, files, report errors and skipped summary counters', () => {
  const projects = playwright();
  projects.suites[0].suites[0].specs[0].tests.push(execution());
  const otherFile = playwright();
  otherFile.suites[0].suites[0].file = 'other.spec.ts';
  const duplicateFile = playwright();
  duplicateFile.suites.push(duplicateFile.suites[0]);
  const duplicateNestedFile = playwright();
  duplicateNestedFile.suites[0].suites.push({ file: 'v1-sources.spec.ts', specs: [] });
  for (const report of [
    projects, otherFile, duplicateFile, duplicateNestedFile, { ...playwright(), errors: [{ message: secret }] },
    { ...playwright(), stats: { ...playwright().stats, skipped: 1 } },
  ]) {
    const result = normalizeBrowser(report);
    expect(result).toMatchObject({ diagnostics: expect.arrayContaining([expect.any(String)]) });
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});

let output: string;
const png = Buffer.from('89504e470d0a1a0a01', 'hex');
const incomplete = 'source-incomplete.png';
const complete = 'source-complete-pdf.png';
beforeEach(() => { output = mkdtempSync(join(tmpdir(), 'v1-runner-')); });
afterEach(() => rmSync(output, { recursive: true, force: true }));

test('validates exactly two screenshots and hashes their bytes', () => {
  mkdirSync(join(output, 'nested'));
  writeFileSync(join(output, 'nested', incomplete), png);
  writeFileSync(join(output, complete), png);
  writeFileSync(join(output, 'ignored.txt'), secret);
  const result = collectScreenshots(output);
  expect(result).toMatchObject({
    screenshots: [
      { path: 'screenshots/' + incomplete, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { path: 'screenshots/' + complete, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ],
    diagnostics: [],
  });
  expect(JSON.stringify(result)).not.toContain(secret);
  writeFileSync(join(output, complete), Buffer.concat([png, png]));
  expect(collectScreenshots(output)).not.toEqual(result);
});

test.each(['absent', 'duplicate', 'symlink', 'invalid', 'trace'])('rejects %s screenshot evidence', failure => {
  writeFileSync(join(output, incomplete), png);
  if (failure === 'duplicate') {
    mkdirSync(join(output, 'nested'));
    writeFileSync(join(output, 'nested', incomplete), png);
  }
  if (failure === 'symlink') symlinkSync('/outside-root/unsafe.png', join(output, complete));
  else if (failure !== 'absent') writeFileSync(join(output, complete), failure === 'invalid' ? secret : png);
  if (failure === 'trace') writeFileSync(join(output, 'trace.zip'), secret);
  expect(collectScreenshots(output)).toMatchObject({ diagnostics: expect.arrayContaining([expect.any(String)]) });
});

test('requires actual numeric Chromium and every command and evidence result', () => {
  const success = { status: 0, signal: null, stdout: secret, stderr: secret };
  const clean = commandResult('npm run typecheck', success);
  const passing = Array(6).fill(clean);
  expect(chromiumVersion({ ...success, stdout: '123.0.4.5\n' })).toBe('123.0.4.5');
  expect(v1ExitCode(passing, [], '123.0.4.5')).toBe(0);
  expect(v1ExitCode(passing.slice(1), [], '123.0.4.5')).toBe(1);
  expect(v1ExitCode(passing, ['artifact-invalid'], '123.0.4.5')).toBe(1);
  expect(v1ExitCode(passing, [], chromiumVersion(success))).toBe(1);
  for (const result of [
    commandResult('npm run typecheck', { ...success, status: 1 }),
    commandResult('npm run typecheck', { ...success, signal: 'SIGTERM' }),
    commandResult('npm run typecheck', { ...success, error: Object.assign(new Error(secret), { code: 'ETIMEDOUT' }) }),
    commandResult('npm run test:e2e', success, { cases: [], diagnostics: ['report-unavailable'] }),
  ]) {
    expect(v1ExitCode([result, ...passing.slice(1)], [], '123.0.4.5')).toBe(1);
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});


test('a V4 run with every prerequisite passing still fails the full gate', () => {
  const success = { status: 0, signal: null };
  const commands = [
    commandResult('npm run test:integration -- tests/integration/v4-agent-tools.test.ts', success),
    commandResult('npm run test:e2e -- tests/e2e/v4-monitor.spec.ts', success),
    commandResult('npm run typecheck', success),
  ];
  const browser = '123.0.4.5';
  expect(v4GateOutcome(commands, [], browser)).toEqual({
    exitCode: 1, result: 'failed', prerequisiteResult: 'passed', diagnostics: ['live-construction-unavailable'],
  });
  const negativeProof = commandResult('npm run test:live -- --evidence tests/live/v4-build-connectors.test.ts', success);
  expect(v4GateOutcome([...commands, negativeProof], [], browser)).toMatchObject({ exitCode: 1, result: 'failed' });
  const failed = commandResult('npm run typecheck', { ...success, status: 1 });
  expect(v4GateOutcome([...commands.slice(0, 2), failed], [], browser)).toMatchObject({ prerequisiteResult: 'failed' });
  expect(v4GateOutcome(commands, ['private-output-cleanup-failed'], browser)).toEqual({
    exitCode: 1, result: 'failed', prerequisiteResult: 'failed',
    diagnostics: ['private-output-cleanup-failed', 'live-construction-unavailable'],
  });
});

function runVerifier(slice: string, cwd: string) {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_ORG_ID;
  delete env.OPENAI_PROJECT_ID;
  return spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve('scripts/verify-slice.ts'), slice], {
    cwd, env, encoding: 'utf8', timeout: 10_000,
  });
}

test('CLI records a failed preflight and starts no commands when registered files are absent', () => {
  expect(spawnSync('git', ['init', '-q'], { cwd: output }).status).toBe(0);
  expect(spawnSync('git', [
    '-c', 'user.name=Verifier Test', '-c', 'user.email=verifier@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Initialize verifier fixture',
  ], { cwd: output }).status).toBe(0);
  const result = runVerifier('V1', output);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('V1 verification failed');
  const evidence = join(output, '.evidence');
  const [sourceKey] = readdirSync(evidence);
  const runs = join(evidence, sourceKey, 'V1');
  const [run] = readdirSync(runs);
  const manifest = JSON.parse(readFileSync(join(runs, run, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({
    result: 'failed', commands: [], diagnostics: expect.arrayContaining(['required-test-files-missing']),
  });
});

test('CLI routes V2 to its fail-closed preflight', () => {
  expect(spawnSync('git', ['init', '-q'], { cwd: output }).status).toBe(0);
  expect(spawnSync('git', [
    '-c', 'user.name=Verifier Test', '-c', 'user.email=verifier@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Initialize verifier fixture',
  ], { cwd: output }).status).toBe(0);
  const result = runVerifier('V2', output);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('required-test-files-missing');
  expect(result.stdout).toContain('V2 verification failed');
});


test('V4 CLI retains the missing live construction diagnostic on a failed preflight', () => {
  expect(spawnSync('git', ['init', '-q'], { cwd: output }).status).toBe(0);
  expect(spawnSync('git', [
    '-c', 'user.name=Verifier Test', '-c', 'user.email=verifier@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'Initialize verifier fixture',
  ], { cwd: output }).status).toBe(0);
  const result = runVerifier('V4', output);
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('V4 verification failed');
  expect(result.stderr).toContain('live-construction-unavailable');
  const evidence = join(output, '.evidence');
  const [sourceKey] = readdirSync(evidence);
  const runs = join(evidence, sourceKey, 'V4');
  const [run] = readdirSync(runs);
  const manifest = JSON.parse(readFileSync(join(runs, run, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({
    slice: 'V4', result: 'failed', prerequisiteResult: 'failed',
    independentReview: 'pending', jointAcceptance: 'pending', commands: [],
    diagnostics: expect.arrayContaining(['required-test-files-missing', 'live-construction-unavailable']),
  });
});
