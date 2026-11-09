import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { z } from 'zod';
import { hashBytes } from '../packages/contracts/src/canonical.js';
import { VerificationCheckIdSchema } from '../packages/contracts/src/review.js';
import { type commandResult, normalizeReport } from './verify-slice-evidence.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const jobId = z.uuidv4();
const checks = z.array(z.strictObject({
  id: VerificationCheckIdSchema,
  status: z.literal('passed'),
  cases: z.int().positive(),
  // The public summary derives an empty diagnostic list for a passed check.
  diagnosticCodes: z.tuple([]),
})).length(VerificationCheckIdSchema.options.length).refine(items =>
  new Set(items.map(item => item.id)).size === items.length &&
  items.find(item => item.id === 'evidence_support')?.cases === 4);

function company(id: 'company-a' | 'company-b', balance: 80000 | 0) {
  return z.strictObject({
    companyId: z.literal(id), jobId, state: z.literal('completed'), reportId: z.string().max(43),
    artifactHash: hash, manifestHash: hash, evaluatorBuildHash: hash,
    profileHashes: z.array(hash).nonempty().refine(items => items.every((item, index) => index === 0 || items[index - 1] < item)),
    fixtureSetVersion: z.literal('2'), parentWrites: z.literal(0), previewBalanceCents: z.literal(balance),
    coverageComplete: z.literal(true), eligible: z.literal(true), checks,
  }).refine(value => value.reportId === 'report:' + value.jobId);
}

const browserResult = z.strictObject({
  schemaVersion: z.literal(1), test: z.string(),
  assertions: z.strictObject({
    runtimeUnchanged: z.literal(true), parentWritesZero: z.literal(true), summariesBound: z.literal(true),
    rowsMatch: z.literal(true), privateBoundary: z.literal(true), noActivation: z.literal(true),
  }),
  companies: z.tuple([company('company-a', 80000), company('company-b', 0)]),
}).refine(({ companies: [a, b] }) => a.jobId !== b.jobId && a.reportId !== b.reportId && a.artifactHash !== b.artifactHash);

export function parseV2BrowserResult(value: unknown, observedTitle: string) {
  const parsed = browserResult.safeParse(value);
  if (parsed.success && parsed.data.test === observedTitle) return parsed.data;
}

const vitestSummary = z.object({
  success: z.literal(true),
  numTotalTests: z.int(), numPassedTests: z.int(),
  numFailedTests: z.literal(0), numPendingTests: z.literal(0), numTodoTests: z.literal(0),
  testResults: z.tuple([z.object({
    status: z.literal('passed'), message: z.literal(''),
    assertionResults: z.array(z.object({ failureMessages: z.tuple([]) })),
  })]),
});
const project = z.object({
  id: z.string(), name: z.string(), outputDir: z.string(),
  repeatEach: z.literal(1), retries: z.literal(0),
});
function traceOrVideo(path: string) {
  return /(?:^|[\\/])trace\.zip$/i.test(path) || /\.(?:webm|mp4|mov|mkv|avi|m4v)$/i.test(path);
}

const playwrightSummary = z.object({
  config: z.object({ projects: z.tuple([project]) }), errors: z.tuple([]),
  stats: z.object({ expected: z.literal(1), unexpected: z.literal(0), skipped: z.literal(0), flaky: z.literal(0) }),
  suites: z.tuple([z.object({ specs: z.tuple([z.object({
    ok: z.literal(true),
    tests: z.tuple([z.object({
      projectId: z.string(), projectName: z.string(),
      results: z.tuple([z.object({
        retry: z.literal(0), errors: z.tuple([]),
        attachments: z.array(z.object({
          name: z.string().optional(), path: z.string().optional(), contentType: z.string().optional(),
        })),
      })]),
    })]),
  })]) })]),
});

export function normalizeV2Report(
  raw: unknown, root: string, file: string, names: readonly string[], browserOutput?: string,
): ReturnType<typeof normalizeReport> {
  const invalid = { cases: [], diagnostics: ['report-shape-or-project-invalid'] };
  if (browserOutput) {
    const parsed = playwrightSummary.safeParse(raw);
    if (!parsed.success) return invalid;
    const [project] = parsed.data.config.projects;
    const [test] = parsed.data.suites[0].specs[0].tests;
    if (project.name !== '' || project.outputDir !== browserOutput ||
        project.id !== test.projectId || project.name !== test.projectName) return invalid;
    if (test.results[0].attachments.some(({ name, path, contentType }) =>
      name === 'trace' || name === 'video' || traceOrVideo(name ?? '') || traceOrVideo(path ?? '') ||
      contentType?.startsWith('video/'))) return { cases: [], diagnostics: ['authenticated-trace-or-video-present'] };
  } else {
    const parsed = vitestSummary.safeParse(raw);
    if (!parsed.success || parsed.data.numTotalTests !== names.length || parsed.data.numPassedTests !== names.length) {
      return invalid;
    }
  }
  return normalizeReport(browserOutput ? 'playwright' : 'vitest', raw, root, file, names);
}

export function readV2File(path: string, maxBytes: number): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.size < 1 || before.size > maxBytes || realpathSync(path) !== path) throw new Error();
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error();
    const bytes = Buffer.alloc(opened.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, read);
      if (count === 0) break;
      read += count;
    }
    const after = fstatSync(fd);
    if (read !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs || realpathSync(path) !== path) throw new Error();
    return bytes.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

export function readV2Json(path: string, maxBytes: number): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readV2File(path, maxBytes)));
}

const screenshotGroups = [
  ['preview-company-a-balance.png', 'preview-company-a-scope.png', 'preview-company-a-lineage.png',
    'preview-company-a-citation.png', 'preview-company-b-balance.png', 'preview-company-b-hold.png'],
  ['verification-company-a.png', 'verification-company-b.png'],
  ['verification-v2-company-a.png', 'verification-v2-company-b.png'],
] as const;
const screenshotNames = screenshotGroups.flat();
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

// Chromium produces 8-bit RGB/RGBA PNGs with only these chunks. Reject trailing bytes and
// ancillary chunks, which can contain free-form payloads unrelated to the screenshot.
function validScreenshot(bytes: Buffer): boolean {
  if (!bytes.subarray(0, 8).equals(pngSignature)) return false;
  let rowBytes = 0;
  let height = 0;
  const idat: Buffer[] = [];
  for (let start = 8; start + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(start);
    const end = start + size + 12;
    if (end > bytes.length || crc32(bytes.subarray(start + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    const kind = bytes.toString('ascii', start + 4, start + 8);
    const data = bytes.subarray(start + 8, end - 4);
    if (start === 8) {
      if (kind !== 'IHDR' || size !== 13) return false;
      const width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width < 1 || height < 1 || data[8] !== 8 || ![2, 6].includes(data[9]) ||
          data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return false;
      rowBytes = width * (data[9] === 2 ? 3 : 4) + 1;
      if (rowBytes * height > 64 * 1024 * 1024) return false;
    } else if (kind === 'IDAT') {
      idat.push(data);
    } else if (kind === 'IEND' && size === 0 && end === bytes.length && idat.length) {
      const compressed = Buffer.concat(idat);
      const pixels = inflateSync(compressed, { maxOutputLength: rowBytes * height, info: true }) as unknown as {
        engine: { bytesWritten: number }; buffer: Buffer;
      };
      if (pixels.engine.bytesWritten !== compressed.length || pixels.buffer.length !== rowBytes * height) return false;
      for (let row = 0; row < height; row++) if (pixels.buffer[row * rowBytes] > 4) return false;
      return true;
    } else {
      return false;
    }
    start = end;
  }
  return false;
}

type Screenshot = { path: string; sha256: string; bytes: Buffer };
type Artifacts = {
  screenshots: Screenshot[]; browser?: NonNullable<ReturnType<typeof parseV2BrowserResult>>; diagnostics: string[];
};
export type V2BrowserRoots = readonly [string, string, string];
const resultName = 'v2-browser-results.json';

export function collectV2Artifacts(roots: V2BrowserRoots, observedTitle: string): Artifacts {
  const diagnostics = new Set<string>();
  const files = new Map<string, string>();
  let count = 0;
  function visit(directory: string, group: readonly string[], actual: boolean, depth: number) {
    if (depth > 32 || realpathSync(directory) !== directory) throw new Error();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++count > 4096) throw new Error();
      const path = join(directory, entry.name);
      if (traceOrVideo(entry.name)) {
        diagnostics.add('authenticated-trace-or-video-present');
      }
      const screenshot = screenshotNames.some(name => name === entry.name);
      const result = entry.name === resultName;
      if (entry.isSymbolicLink()) diagnostics.add('artifact-unsafe-path');
      else if (screenshot || result) {
        if (!entry.isFile() || files.has(entry.name) || (result ? !actual : !group.includes(entry.name))) {
          diagnostics.add('artifact-origin-or-uniqueness-invalid');
        } else files.set(entry.name, path);
      } else if (entry.isDirectory()) visit(path, group, actual, depth + 1);
    }
  }

  try {
    if (roots.some((root, index) => !lstatSync(root).isDirectory() ||
        roots.some((other, position) => index !== position && (root === other || root.startsWith(other + '/'))))) throw new Error();
    roots.forEach((root, index) => visit(root, screenshotGroups[index], index === 2, 0));
    if (files.size !== screenshotNames.length + 1) diagnostics.add('required-artifacts-missing');
    if (diagnostics.size) return { screenshots: [], diagnostics: [...diagnostics] };
    const browser = parseV2BrowserResult(readV2Json(files.get(resultName)!, 256 * 1024), observedTitle);
    if (!browser) return { screenshots: [], diagnostics: ['v2-browser-result-invalid'] };
    const screenshots = screenshotNames.map(name => {
      const bytes = readV2File(files.get(name)!, 16 * 1024 * 1024);
      if (!validScreenshot(bytes)) throw new Error();
      return { path: 'screenshots/' + name, sha256: hashBytes(bytes), bytes };
    });
    return { screenshots, browser, diagnostics: [] };
  } catch {
    diagnostics.add('artifact-unavailable-or-invalid');
    return { screenshots: [], diagnostics: [...diagnostics] };
  }
}

type RequiredCommand = { command: string; file?: string; names: readonly string[] };
type CommandResult = ReturnType<typeof commandResult>;

export function v2ExitCode(
  required: readonly RequiredCommand[], commands: readonly CommandResult[],
  diagnostics: readonly string[], metadataComplete: boolean, artifacts: Artifacts,
): 0 | 1 {
  if (!metadataComplete || diagnostics.length || artifacts.diagnostics.length || !artifacts.browser ||
      artifacts.screenshots.length !== screenshotNames.length ||
      !screenshotNames.every((name, index) => artifacts.screenshots[index].path === 'screenshots/' + name) ||
      commands.length !== required.length) return 1;
  return required.every(({ command, file, names }, index) => {
    const result = commands[index];
    return result.command === command && result.exitCode === 0 && result.signal === null &&
      result.result === 'passed' && result.diagnostics.length === 0 && result.cases.length === names.length &&
      names.every((name, index) => {
        const observed = result.cases[index];
        return observed.file === file && observed.name === name && observed.status === 'passed';
      });
  }) ? 0 : 1;
}

const vitestGuard = z.strictObject({
  completed: z.literal(true),
  modules: z.tuple([z.strictObject({
    file: z.string(), project: z.string(),
    assertions: z.array(z.strictObject({
      name: z.string(), status: z.literal('passed'), expectedFailure: z.literal(false),
      attempts: z.literal(1), retries: z.literal(0), repeats: z.literal(0), flaky: z.literal(false),
    })),
  })]),
});

export function validateV2VitestGuard(
  raw: unknown, root: string, file: string, names: readonly string[], project = '',
): string[] {
  const parsed = vitestGuard.safeParse(raw);
  const module = parsed.success ? parsed.data.modules[0] : undefined;
  if (!module || module.project !== project || !isAbsolute(module.file) ||
      resolve(module.file) !== resolve(root, file) || module.assertions.length !== names.length ||
      !names.every(name => module.assertions.filter(assertion => assertion.name === name).length === 1)) {
    return ['vitest-assertion-execution-invalid'];
  }
  return [];
}
