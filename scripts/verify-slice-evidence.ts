import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';
import { hashBytes } from '../packages/contracts/src/canonical.js';

type NormalizedCase = { file: string; name: string; status: 'passed' | 'failed' };
type ReportResult = { cases: NormalizedCase[]; diagnostics: string[] };

const vitestShape = z.object({
  testResults: z.array(z.object({
    name: z.string(),
    status: z.string().optional(),
    assertionResults: z.array(z.object({ fullName: z.string(), status: z.string() })),
  })),
});
const browserSpec = z.object({
  title: z.string(),
  file: z.string().optional(),
  ok: z.boolean().optional(),
  tests: z.array(z.object({
    status: z.string(),
    expectedStatus: z.string(),
    projectId: z.string().optional(),
    projectName: z.string().optional(),
    results: z.array(z.object({
      status: z.string(), retry: z.number().optional(), error: z.unknown().optional(), errors: z.array(z.unknown()).optional(),
    })),
  })),
});
const browserSuite = z.object({
  file: z.string().optional(),
  specs: z.array(browserSpec).optional(),
  suites: z.array(z.unknown()).optional(),
});
const browserShape = z.object({
  suites: z.array(z.unknown()).length(1),
  config: z.object({ projects: z.tuple([z.object({ id: z.string(), name: z.string() })]) }).optional(),
  stats: z.object({
    expected: z.number(), unexpected: z.literal(0), skipped: z.literal(0), flaky: z.literal(0),
    failed: z.literal(0).optional(),
  }),
});
const summaryShape = z.looseObject({
  success: z.literal(true).optional(),
  error: z.null().optional(),
  errors: z.array(z.unknown()).length(0).optional(),
});

function cleanSummary(report: unknown) {
  const summary = summaryShape.safeParse(report);
  return summary.success && Object.entries(summary.data).every(([key, value]) =>
    !/^num(?:Failed|Pending|Skipped|Todo|RuntimeError)/.test(key) || value === 0);
}

function vitestCases(report: unknown, root: string, file: string) {
  const parsed = vitestShape.safeParse(report);
  if (!parsed.success || parsed.data.testResults.length !== 1) return;
  const [suite] = parsed.data.testResults;
  if (!isAbsolute(suite.name) || resolve(suite.name) !== resolve(root, file) ||
      (suite.status !== undefined && suite.status !== 'passed')) return;
  return suite.assertionResults.map(assertion => ({
    name: assertion.fullName, passed: assertion.status === 'passed',
  }));
}

function playwrightCases(report: unknown, file: string, expectedCount: number) {
  const parsed = browserShape.safeParse(report);
  if (!parsed.success || parsed.data.stats.expected !== expectedCount) return;
  const { suites, config } = parsed.data;

  const expectedFile = relative('tests/e2e', file);
  const specs: z.infer<typeof browserSpec>[] = [];
  function visit(raw: unknown, depth: number): boolean {
    if (depth > 32) return false;
    const suite = browserSuite.safeParse(raw);
    if (!suite.success || (depth === 0 && suite.data.file !== expectedFile) ||
        (suite.data.file !== undefined && suite.data.file !== expectedFile)) return false;
    const children = suite.data.suites ?? [];
    const currentSpecs = suite.data.specs ?? [];
    if (children.length === 0 && currentSpecs.length === 0) return false;
    for (const spec of currentSpecs) {
      if (spec.file !== undefined && spec.file !== expectedFile) return false;
      if (spec.tests.length !== 1) return false;
      specs.push(spec);
    }
    return children.every(child => visit(child, depth + 1));
  }
  if (!visit(suites[0], 0) || specs.length < 1) return;
  const firstTest = specs[0].tests[0];
  const project = config?.projects[0] ?? { id: firstTest.projectId, name: firstTest.projectName };
  return specs.map(spec => {
    const [test] = spec.tests;
    const result = test.results[0];
    return {
      name: spec.title,
      passed: spec.ok !== false && test.projectId === project.id && test.projectName === project.name &&
        test.status === 'expected' && test.expectedStatus === 'passed' && test.results.length === 1 && result.status === 'passed' &&
        (result.retry === undefined || result.retry === 0) && result.error == null && !result.errors?.length,
    };
  });
}

export function normalizeReport(
  kind: 'vitest' | 'playwright', report: unknown, root: string, file: string, expected: readonly string[],
): ReportResult {
  if (!cleanSummary(report)) return { cases: [], diagnostics: ['report-summary-invalid'] };
  const received = kind === 'vitest'
    ? vitestCases(report, root, file)
    : playwrightCases(report, file, expected.length);
  if (!received) return { cases: [], diagnostics: ['report-shape-or-file-invalid'] };

  const cases: NormalizedCase[] = [];
  for (const name of expected) {
    const matching = received.filter(test => test.name === name);
    if (matching.length === 1) cases.push({ file, name, status: matching[0].passed ? 'passed' : 'failed' });
  }
  const coverage = received.length === expected.length && cases.length === expected.length;
  const diagnostics: string[] = [];
  if (!coverage) diagnostics.push('assertion-coverage-invalid');
  if (cases.some(test => test.status !== 'passed')) diagnostics.push('assertion-not-passed');
  return { cases, diagnostics };
}

const screenshotNames = ['source-incomplete.png', 'source-complete-pdf.png'] as const;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

type Screenshot = { path: string; sha256: string; bytes: Buffer };

export function collectScreenshots(output: string): { screenshots: Screenshot[]; diagnostics: string[] } {
  const diagnostics = new Set<string>();
  const files = new Map<string, string>();
  function visit(directory: string, depth: number) {
    if (depth > 32) throw new Error();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === 'trace.zip') diagnostics.add('authenticated-trace-present');
      if (entry.isSymbolicLink()) diagnostics.add('artifact-unsafe-path');
      else if (entry.isDirectory()) visit(path, depth + 1);
      else if (screenshotNames.some(name => name === entry.name)) {
        if (!entry.isFile() || files.has(entry.name)) diagnostics.add('screenshot-not-unique-regular-file');
        else files.set(entry.name, path);
      }
    }
  }

  try {
    if (!lstatSync(output).isDirectory()) return { screenshots: [], diagnostics: ['artifact-unsafe-path'] };
    const root = realpathSync(output);
    visit(root, 0);
    if (files.size !== screenshotNames.length) diagnostics.add('screenshot-missing');
    if (diagnostics.size) return { screenshots: [], diagnostics: [...diagnostics] };
    const screenshots = screenshotNames.map(name => {
      const path = files.get(name)!;
      if (realpathSync(path) !== path || basename(path) !== name) throw new Error();
      const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.size <= pngSignature.length || stat.size > 16 * 1024 * 1024) throw new Error();
        const bytes = readFileSync(descriptor);
        if (!bytes.subarray(0, pngSignature.length).equals(pngSignature)) throw new Error();
        return { path: 'screenshots/' + name, sha256: hashBytes(bytes), bytes };
      } finally {
        closeSync(descriptor);
      }
    });
    return { screenshots, diagnostics: [] };
  } catch {
    return { screenshots: [], diagnostics: ['screenshot-unavailable-or-invalid'] };
  }
}

type ProcessResult = { status: number | null; signal: string | null; error?: Error & { code?: string } };

export function commandResult(command: string, process: ProcessResult, report?: ReportResult) {
  const diagnostics = [...(report?.diagnostics ?? [])];
  if (process.error) diagnostics.push(process.error.code === 'ETIMEDOUT' ? 'command-timeout' : 'command-error');
  if (process.signal !== null) diagnostics.push('command-signalled');
  if (process.status !== 0) diagnostics.push('command-exit-nonzero');
  return {
    command, exitCode: process.status, signal: process.signal,
    result: diagnostics.length ? 'failed' as const : 'passed' as const,
    cases: report?.cases ?? [], diagnostics,
  };
}

export function chromiumVersion(process: ProcessResult & { stdout?: string }) {
  const version = process.stdout?.trim();
  if (process.status === 0 && process.signal === null && !process.error && version &&
      /^\d+(?:\.\d+){1,4}$/.test(version)) return version;
}

export function v1ExitCode(
  commands: readonly ReturnType<typeof commandResult>[], diagnostics: readonly string[], chromium?: string,
) {
  return commands.length === 6 && commands.every(command => command.result === 'passed') &&
    diagnostics.length === 0 && chromium ? 0 : 1;
}

export function v3ExitCode(
  commands: readonly ReturnType<typeof commandResult>[], diagnostics: readonly string[], chromium?: string,
) {
  return commands.length === 4 && commands.every(command => command.result === 'passed') &&
    diagnostics.length === 0 && chromium ? 0 : 1;
}

export function v4GateOutcome(
  commands: readonly ReturnType<typeof commandResult>[], diagnostics: readonly string[], chromium?: string,
) {
  const prerequisitesPassed = commands.length === 3 && commands.every(command => command.result === 'passed') &&
    diagnostics.length === 0 && Boolean(chromium);
  return {
    prerequisiteResult: prerequisitesPassed ? 'passed' as const : 'failed' as const,
    diagnostics: [...diagnostics, 'live-construction-unavailable'],
    result: 'failed' as const,
    exitCode: 1,
  };
}

export function v7ExitCode(
  commands: readonly ReturnType<typeof commandResult>[], diagnostics: readonly string[], chromium?: string,
) {
  return commands.length === 3 && commands.every(command => command.result === 'passed') &&
    diagnostics.length === 0 && chromium ? 0 : 1;
}
