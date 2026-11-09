import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { hashBytes, hashCanonical } from '../packages/contracts/src/canonical.js';
import { chromiumVersion, commandResult } from './verify-slice-evidence.js';
import {
  collectV2Artifacts, normalizeV2Report, readV2File, readV2Json, validateV2VitestGuard,
  v2ExitCode, type V2BrowserRoots,
} from './verify-v2-evidence.js';

export const v2Requirements = {
  "packages/compiler/test/compile.test.ts": [
    "canonical_hash_ignores_object_key_order",
    "rejects_unknown_operation",
    "checks mapping source fields, input types and capture coverage",
    "blocks unsupported constants, lookup tables and overlapping contract terms",
    "parses canonical decimal money without rounding or unsafe inputs",
    "a cited fixed amount cannot overwrite observed source money"
  ],
  "packages/compiler/test/plan-batch.test.ts": [
    "maps both source schemas into exact scoped records and deterministic lineage",
    "rejects_ambiguous_date",
    "late payment only changes balance when an explicit allocation is supplied",
    "missing dependency holds the related group and releases it in dependency order",
    "holds an overallocated group without consuming unrelated unallocated funds",
    "economic replay ignores delivery and connector version, but conflicting content holds",
    "rejects conflicting delivery hashes before planning any group",
    "holds schema, identity and semantic drift before mapping",
    "checks artifact and reviewed profile hashes and target scope",
    "plans one full reversal, preserves originals and rejects reallocation of reversed funding",
    "cannot link an allocation to another seller or account using a shared buyer",
    "a later target version changes the expected version and plan hash"
  ],
  "packages/finance/test/finance.test.ts": [
    "preserves_source_money",
    "reverses_full_payment_once",
    "rejects funding and invoice over-allocation",
    "rejects wrong-source funding and invalid effective prerequisites",
    "a backdated reversal voids an existing future-effective allocation and preserves older recorded state",
    "full credit reversal restores its allocations at its effective instant"
  ],
  "packages/evaluator/test/reference-model.test.ts": [
    "independent public development oracle reference_baseline_80000",
    "independent public development oracle reference_late_payment_50000",
    "independent public development oracle reference_unallocated_funding_no_reduction",
    "independent public development oracle reference_full_reversal_as_of",
    "independent public development oracle reference_reversal_cannot_conceal_excessive_funding_allocation",
    "independent public development oracle reference_reversal_restores_invoice_capacity_for_other_funding",
    "independent public development oracle reference_scope_and_limits",
    "independent public development oracle balance_preserving_swap_rejected",
    "independent public development oracle reference_model_independent"
  ],
  "packages/evaluator/test/verify.test.ts": [
    "real_subject_wrong_mapping_rejected despite identical cents",
    "report_binding rejects any different job, immutable fixture version, or build hash",
    "mandatory_checks_required prevents forged eligibility and strips raw diagnostics"
  ],
  "packages/evaluator/test/cases.test.ts": [
    "inapplicable_matrix_launches_nothing for the entire requested profile matrix",
    "unsupported source contract has no synthetic cases and a case plan rejects another artifact",
    "B fractional and unsafe numbers fail their respective pre-money validation boundaries",
    "negative_mapping_rejected for an alternate B amount field or unsupported amount constant",
    "changed_case_code_changes_build_hash",
    "full_reversal and reversal_preserves_prior_asof with original records and allocations",
    "snapshot_boundary uses each stream cursor and boundary_validation_not_counted_as_planner",
    "missing_required_case_prevents_pass before any subject launches",
    "reversal is unavailable if the reviewed term supplies no supported later dates",
    "dependency_order exercises the exact supplied artifact in the real planner",
    "schema_drift exercises the exact supplied artifact in the real planner",
    "semantic_drift exercises the exact supplied artifact in the real planner"
  ],
  "packages/evaluator/test/fixtures.test.ts": [
    "truth_member_integrity rejects substituted or missing members and unknown truth fields",
    "truth_profile_binding requires one exact approved scope and computes the public fixture anchor",
    "truth_isolation pins immutable fixture versions and uses the real bounded evaluator without exposing expected values"
  ],
  "packages/evaluator/test/evidence-fixtures.test.ts": [
    "the private store accepts a separate evidence v2 pin without replacing the v1 API",
    "strict producer decoding normalizes order and checks fact IDs and amendment adjacency",
    "producer and v2 bundle reject oversized, unknown and prototype-bearing input"
  ],
  "packages/evaluator/test/protocol.test.ts": [
    "bounded evaluator process protocol subject_protocol_fail_closed (malformed)",
    "bounded evaluator process protocol subject_protocol_fail_closed (truncated)",
    "bounded evaluator process protocol subject_protocol_fail_closed (multiple)",
    "bounded evaluator process protocol subject_protocol_fail_closed (extra-field)",
    "bounded evaluator process protocol subject_protocol_fail_closed (invalid-outcome)",
    "bounded evaluator process protocol subject_protocol_fail_closed (wrong-request-id)",
    "bounded evaluator process protocol subject_protocol_fail_closed (invalid-utf8)",
    "bounded evaluator process protocol subject_protocol_fail_closed (stdout-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (stderr-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (combined-limit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (abnormal-exit)",
    "bounded evaluator process protocol subject_protocol_fail_closed (timeout)",
    "bounded evaluator process protocol subject_protocol_fail_closed (oversized and malformed stdin)",
    "bounded evaluator process protocol subject_protocol_fail_closed (limits cannot be raised)",
    "bounded evaluator process protocol subject_input_excludes_truth",
    "bounded evaluator process protocol evaluator transport accepts one strictly framed report",
    "bounded evaluator process protocol evaluator transport rejects extra fields and extra or truncated lines"
  ],
  "packages/evaluator/test/control-imports.test.ts": [
    "control evaluator entrypoints do not load the subject or protected oracle"
  ],
  "tests/integration/v2-preview.test.ts": [
    "preview_preserves_parent",
    "preview rejects malformed, unauthorized, missing, stale and unavailable dependencies",
    "preview holds unknown accounts, partitions reviewed sellers, and pauses an unknown seller"
  ],
  "tests/integration/v2-verification.test.ts": [
    "registry_immutable_republish, registry_hash_binding, registry_same_id_conflict, registry_parallel_republish",
    "verification_route_scope, verification_job_scope, forged_report_rejected, verification_async_failure_redacted, attempt_budget_reserved_atomically",
    "generated_b_zero_is_not_f8_balance, same_candidate_f8_transposition, different_artifact_pass_not_reused"
  ],
  "tests/integration/evidence-v2-store.test.ts": [
    "real generated A/B capture provenance survives immutable v2 roundtrips beside v1"
  ],
  "tests/integration/evidence-verification-setup.test.ts": [
    "paired operator inputs pin the exact stored captures and reject incomplete or conflicting evidence"
  ],
  "tests/integration/local-verification-startup.test.ts": [
    "real reviewer jobs use operator pins for the registered source captures",
    "the operator upgrade selects only exact regeneration in an isolated demo root",
    "the control composition import graph stays outside the operator and evaluator oracle"
  ],
  "tests/integration/c3-pin-isolation.test.ts": [
    "isolates browser pins on success",
    "isolates browser pins on collision",
    "isolates browser pins on partial"
  ],
  "tests/integration/c3-v2-pin-isolation.test.ts": [
    "v2_browser_copy_preserves_facts_and_rebinds_producer",
    "v2_browser_pin_collision_preserves_existing_files",
    "v2_browser_partial_publication_is_not_owned",
    "v2_browser_cleanup_preserves_replaced_and_changed_pins",
    "v2_browser_repeated_runs_preserve_prior_pins_and_inputs"
  ],
  "tests/e2e/v2-preview.spec.ts": [
    "previews both captured schemas and leaves real runtime state unchanged"
  ],
  "tests/e2e/v2-verification.spec.ts": [
    "verifies both captured companies through the real protected evaluator and renders bound summaries"
  ],
  "tests/e2e/v2-evidence-verification.spec.ts": [
    "verifies both captured companies with v2 evidence and all thirteen checks without parent writes"
  ]
} as const;

type Script = 'test:unit' | 'test:integration' | 'test:e2e' | 'typecheck';
type RequiredCommand = { script: Script; file?: string; names: readonly string[]; command: string };
const typecheck: RequiredCommand = { script: 'typecheck', names: [], command: 'npm run typecheck' };
const requiredFiles = Object.entries(v2Requirements);
const actualBrowser = 'tests/e2e/v2-evidence-verification.spec.ts';
const requiredOutputArgs = (script: Script) => script === 'test:e2e'
  ? ['--trace=off', '--retries=0']
  : ['--outputFile=<private-report>', '--reporter=./scripts/verify-v2-vitest-reporter.ts'];

export const v2Commands: readonly RequiredCommand[] = [
  ...requiredFiles.map(([file, names]) => {
    const script = file.startsWith('packages/') ? 'test:unit'
      : file.startsWith('tests/e2e/') ? 'test:e2e' : 'test:integration';
    const command = ['npm', 'run', script, '--', file, '--reporter=json', ...requiredOutputArgs(script)].join(' ');
    return { script, file, names, command } satisfies RequiredCommand;
  }),
  typecheck,
];

// Pass only environment needed for local tools and the fixed lease. Service secrets and
// protected input configuration are created by the test harness at their own boundaries.
const environmentKeys = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SystemRoot',
  'PLAYWRIGHT_BROWSERS_PATH', 'EAPR_PG_PORT', 'EAPR_CONTROL_PORT', 'EAPR_WORKER_PORT', 'EAPR_WEB_PORT',
  'EAPR_TEST_PREFIX', 'EAPR_DEMO_NAMESPACE'];

function childEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(environmentKeys.flatMap(key => {
    const value = process.env[key];
    return value === undefined ? [] : [[key, value]];
  }));
}

function run(program: string, args: string[], env: NodeJS.ProcessEnv, timeout = 10_000, maxBuffer = 4 * 1024 * 1024) {
  return spawnSync(program, args, {
    env, timeout, maxBuffer, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], killSignal: 'SIGKILL',
  });
}

function capture(program: string, args: string[], env: NodeJS.ProcessEnv, maxBuffer?: number) {
  const child = run(program, args, env, 10_000, maxBuffer);
  if (child.status !== 0 || child.signal !== null || child.error) throw new Error();
  return child.stdout;
}

function sourceIdentity(root: string, env: NodeJS.ProcessEnv) {
  const commit = capture('git', ['rev-parse', 'HEAD'], env).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error();
  const status = capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], env);
  if (!status) return { commit, clean: true, evidenceKey: commit };
  const trackedDiff = capture('git', ['diff', '--binary', 'HEAD', '--'], env, 16 * 1024 * 1024);
  const untracked = capture('git', ['ls-files', '--others', '--exclude-standard', '-z'], env)
    .split('\0').filter(Boolean).sort().map(path => ({
      path, hash: hashBytes(readV2File(join(root, path), 16 * 1024 * 1024)),
    }));
  return { commit, clean: false, evidenceKey: 'dirty-' + hashCanonical({ commit, trackedDiff, untracked }) };
}

function lease(env: NodeJS.ProcessEnv) {
  function port(key: string, fallback: number) {
    const value = env[key] ?? String(fallback);
    if (!/^\d{1,5}$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error();
    return Number(value);
  }
  const testPrefix = env.EAPR_TEST_PREFIX ?? 'eapr_test_v0';
  const demoNamespace = env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0';
  if (!/^eapr_test_(?:review_)?(?:v0|t1|t2)$/.test(testPrefix) ||
      !/^eapr_(?:review_)?(?:v0|t1|t2)$/.test(demoNamespace)) throw new Error();
  return {
    host: '127.0.0.1', postgresPort: port('EAPR_PG_PORT', 55432), webPort: port('EAPR_WEB_PORT', 5173),
    controlPort: port('EAPR_CONTROL_PORT', 3001), workerPort: port('EAPR_WORKER_PORT', 3002), demoNamespace, testPrefix,
  };
}

// The V2 preflight reads the local catalog without importing native-db, whose
// initialization validates environment before a failed packet could be written.
function migrationMetadata(root: string) {
  return (['control', 'runtime'] as const).flatMap(stream => {
    const directory = join(root, 'db', stream);
    if (realpathSync(directory) !== directory) throw new Error();
    const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
    if (files.length === 0 || files.length > 999) throw new Error();
    return files.map((file, index) => {
      const version = /^([0-9]{3})_[a-z0-9_]+\.sql$/.exec(file)?.[1];
      if (Number(version) !== index + 1) throw new Error();
      return { stream, expectedVersion: index + 1, sha256: hashBytes(readV2File(join(directory, file), 4 * 1024 * 1024)) };
    });
  });
}

function metadata(root: string, env: NodeJS.ProcessEnv) {
  const packageLock = readV2File(join(root, 'package-lock.json'), 8 * 1024 * 1024);
  const lock = JSON.parse(packageLock.toString('utf8')) as {
    lockfileVersion?: unknown; packages?: Record<string, { version?: unknown }>;
  };
  if (lock.lockfileVersion !== 3) throw new Error();
  const dependencies = Object.fromEntries(['@playwright/test', 'vitest', 'typescript', 'tsx', 'pg', 'zod'].map(name => {
    const version = lock.packages?.['node_modules/' + name]?.version;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error();
    return [name, version];
  }));
  const npm = capture('npm', ['--version'], env, 64 * 1024).trim();
  const postgres = /^postgres \(PostgreSQL\) (18\.\d+)(?: \([^\r\n()]*\))?$/.exec(
    capture('postgres', ['--version'], env, 64 * 1024).trim(),
  )?.[1];
  if (!/^v24\.\d+\.\d+$/.test(process.version) || !/^\d+\.\d+\.\d+$/.test(npm) || !postgres) throw new Error();
  const chromium = chromiumVersion(run(process.execPath, ['--input-type=module', '-e', `
    import { chromium } from ${JSON.stringify(import.meta.resolve('@playwright/test'))};
    const browser = await chromium.launch();
    try { console.log(browser.version()); }
    finally { await browser.close(); }
  `], env, 20_000, 64 * 1024));
  if (!chromium) throw new Error();
  return {
    runtime: { node: process.version, npm, postgres, chromium: [chromium], packageLockHash: hashBytes(packageLock), dependencies },
    contract: {
      version: 1,
      sha256: hashBytes(readV2File(join(root, 'docs/superpowers/plans/2026-11-08-contract-freeze.md'), 1024 * 1024)),
      privateEvidenceSha256: hashBytes(readV2File(join(root, 'docs/progress/2026-11-08/handoffs/evidence-v2-contract.md'), 1024 * 1024)),
    },
    migrations: migrationMetadata(root),
  };
}

function safeDirectory(path: string) {
  try {
    mkdirSync(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (!lstatSync(path).isDirectory() || realpathSync(path) !== path) throw new Error();
}

// Keep npm and its test processes in one killable process group. The supervisor
// drains bounded output and returns only a status, so a deadline can safely
// remove the run directory without an orphan reporter continuing to write.
const superviseNpm = `
  import { spawn } from 'node:child_process';
  const [timeout, ...args] = process.argv.slice(1);
  const child = spawn('npm', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure;
  function stop(code) {
    failure ??= code;
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  for (const stream of [child.stdout, child.stderr]) {
    let bytes = 0;
    stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) stop('output-limit');
    });
  }
  const timer = setTimeout(() => stop('timeout'), Number(timeout));
  child.on('error', () => { failure ??= 'spawn-error'; });
  child.on('close', (status, signal) => {
    clearTimeout(timer);
    console.log(JSON.stringify({ status, signal, failure }));
  });
`;

function runNpm(args: string[], env: NodeJS.ProcessEnv, timeout: number): Parameters<typeof commandResult>[1] {
  const child = run(process.execPath, ['--input-type=module', '-e', superviseNpm, String(timeout), ...args], env, timeout + 5000, 4096);
  if (child.status !== 0 || child.signal !== null || child.error) return child;
  try {
    const value = JSON.parse(child.stdout);
    const { status, signal, failure } = value;
    if ((status !== null && (!Number.isInteger(status) || status < 0 || status > 255)) ||
        (signal !== null && (typeof signal !== 'string' || !/^SIG[A-Z0-9]+$/.test(signal))) ||
        (failure !== undefined && !['timeout', 'output-limit', 'spawn-error'].includes(failure))) throw new Error();
    return { status, signal, error: failure === undefined ? undefined
      : Object.assign(new Error(), { code: failure === 'timeout' ? 'ETIMEDOUT' : 'CHILD_FAILED' }) };
  } catch {
    return { status: null, signal: null, error: new Error() };
  }
}

function runCommand(required: RequiredCommand, root: string, work: string, env: NodeJS.ProcessEnv) {
  const { script, file, names, command } = required;
  const report = join(work, 'report.json');
  const guard = file && script !== 'test:e2e' ? join(work, 'execution-guard.json') : undefined;
  const browserOutput = script === 'test:e2e' ? join(work, 'browser') : undefined;
  const args = ['run', script];
  if (file) args.push('--', file, '--reporter=json',
    ...requiredOutputArgs(script).map(arg => arg === '--outputFile=<private-report>' ? '--outputFile=' + report : arg));
  const child = runNpm(args, browserOutput
    ? { ...env, EAPR_TRACE_DIR: browserOutput, PLAYWRIGHT_JSON_OUTPUT_FILE: report }
    : guard ? { ...env, EAPR_V2_VITEST_GUARD_REPORT: guard } : env,
    browserOutput ? 300_000 : 120_000);
  let normalized;
  if (file) {
    try {
      normalized = normalizeV2Report(readV2Json(report, 8 * 1024 * 1024), root, file, names, browserOutput);
    } catch {
      normalized = { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
    }
  }
  if (guard && file && normalized) {
    try {
      normalized.diagnostics.push(...validateV2VitestGuard(
        readV2Json(guard, 1024 * 1024), root, file, names, script === 'test:unit' ? 'unit' : 'integration',
      ));
    } catch {
      normalized.diagnostics.push('vitest-execution-guard-unavailable-or-invalid');
    }
  }
  return { result: commandResult(command, child, normalized), browserOutput };
}

const limitations = [
  'Captured synthetic development sources and an explicitly empty target fixture.',
  'Generated A/B preview balances are 80000/0 cents. The separate F8 wrong-mapping probe uses the same B artifact.',
  'Retry and restart checks exercise fresh planner subprocess replay.',
  'Persisted parent reads, parent configuration execution, runtime restart, live discovery, final holdout, approval, activation, import, and sync require separate evidence.',
  'Independent review and joint G2 acceptance are pending.',
];
const outputPolicy = 'Raw stdout and stderr are intentionally excluded from authenticated and protected verification evidence.';

export function verifyV2(): void {
  process.exitCode = 1;
  try {
    const root = realpathSync(process.cwd());
    const utc = new Date().toISOString();
    const runId = utc.replace(/[:.]/g, '-') + '-' + process.pid;
    const env = childEnv();
    const diagnostics: string[] = [];
    let source: ReturnType<typeof sourceIdentity> | undefined;
    let configuration: ReturnType<typeof lease> | undefined;
    let recorded: ReturnType<typeof metadata> | undefined;
    try { source = sourceIdentity(root, env); }
    catch { diagnostics.push('source-identity-unavailable'); }
    try { configuration = lease(env); }
    catch { diagnostics.push('lease-configuration-invalid'); }
    for (const [file] of requiredFiles) {
      const path = join(root, file);
      try {
        const stat = lstatSync(path);
        if (!stat.isFile() || stat.size < 1 || stat.size > 4 * 1024 * 1024 || realpathSync(path) !== path) throw new Error();
      } catch {
        diagnostics.push('required-test-files-missing');
        break;
      }
    }
    if (!diagnostics.length) {
      try { recorded = metadata(root, env); }
      catch { diagnostics.push('run-metadata-unavailable'); }
    }

    let evidence = root;
    for (const name of ['.evidence', source?.evidenceKey ?? 'unidentified', 'V2', runId]) {
      evidence = join(evidence, name);
      safeDirectory(evidence);
    }

    const commands: ReturnType<typeof commandResult>[] = [];
    const roots: string[] = [];
    let artifacts: ReturnType<typeof collectV2Artifacts> = { screenshots: [], diagnostics: [] };
    let scratch: string | undefined;
    const screenshots: { path: string; sha256: string }[] = [];
    try {
      if (!diagnostics.length) {
        const local = join(root, '.local');
        safeDirectory(local);
        scratch = mkdtempSync(join(local, 'verify-v2-'));
        let observedTitle: string | undefined;
        for (const [index, required] of v2Commands.entries()) {
          const work = join(scratch, String(index));
          mkdirSync(work, { mode: 0o700 });
          const { result, browserOutput } = runCommand(required, root, work, env);
          commands.push(result);
          if (browserOutput) roots.push(browserOutput);
          if (required.file === actualBrowser && result.result === 'passed') observedTitle = result.cases[0].name;
        }

        if (roots.length === 3) {
          // Run the privacy scan even on failure. Only a passing actual-v2 report can supply the title.
          const browserRoots: V2BrowserRoots = [roots[0], roots[1], roots[2]];
          artifacts = collectV2Artifacts(browserRoots, observedTitle ?? '');
          diagnostics.push(...artifacts.diagnostics);
        }
        if (commands.some(command => command.result !== 'passed')) diagnostics.push('required-command-failed');
        if (source?.evidenceKey !== sourceIdentity(root, env).evidenceKey) diagnostics.push('source-changed-during-run');
        if (!diagnostics.length && artifacts.screenshots.length) {
          mkdirSync(join(evidence, 'screenshots'), { mode: 0o700 });
          for (const { path, sha256, bytes } of artifacts.screenshots) {
            writeFileSync(join(evidence, path), bytes, { mode: 0o600, flag: 'wx' });
            screenshots.push({ path, sha256 });
          }
        }
      }
    } catch {
      diagnostics.push('verification-execution-or-evidence-error');
    } finally {
      if (scratch) {
        try { rmSync(scratch, { recursive: true, force: true }); }
        catch { diagnostics.push('private-output-cleanup-failed'); }
      }
    }

    const code = v2ExitCode(v2Commands, commands, diagnostics, Boolean(source && configuration && recorded), artifacts);
    if (code && !diagnostics.length) diagnostics.push('pass-requirements-incomplete');
    const result = code === 0 ? 'passed' : 'failed';
    const browser = artifacts.browser;
    const bindings = browser?.companies.map(({ companyId, jobId, reportId, state,
      artifactHash, profileHashes, manifestHash, evaluatorBuildHash }) => ({
      companyId, jobId, reportId, state, artifactHash, profileHashes, manifestHash, evaluatorBuildHash,
    })) ?? [];
    const write = (file: string, value: unknown) =>
      writeFileSync(join(evidence, file), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    write('commands.json', { commands, outputPolicy,
      privatePaths: { report: '<private-report>', browserOutput: '<private-browser-output>',
        vitestExecutionGuard: '<private-vitest-execution-guard>' } });
    write('assertions.json', { assertions: commands.flatMap(command => command.cases), browser });
    write('trace.json', {
      scope: 'Terminal verification job observations only. Lifecycle, model and tool events are outside this record.',
      observations: bindings.map(binding => ({ kind: 'verification-job-observation', ...binding })),
    });
    writeFileSync(join(evidence, 'review.md'), [
      '# V2 verification review', '', '- Candidate ' + (source?.commit ?? 'unavailable'),
      '- Source identity ' + (source?.evidenceKey ?? 'unavailable'),
      '- Base and builder identities to be supplied by the handoff.',
      '- Independent review pending.', '- Joint G2 acceptance pending.', '',
    ].join('\n'), { mode: 0o600, flag: 'wx' });
    write('manifest.json', {
      schemaVersion: 1, utc, runId, slice: 'V2', source: source ?? null, result,
      mode: { sourceFixtures: 'development-only', model: 'disabled', database: 'native' },
      independentReview: 'pending', jointAcceptance: 'pending', configuration, ...recorded,
      requiredTests: requiredFiles.map(([file]) => file), requiredCases: v2Requirements,
      commands, bindings, screenshots, diagnostics, limitations, authenticatedTrace: 'disabled',
    });
    console.log('V2 verification ' + result + '. Evidence: ' + relative(root, evidence));
    if (diagnostics.length) console.error('V2 diagnostics: ' + diagnostics.join(', '));
    process.exitCode = code;
  } catch {
    console.error('V2 diagnostics: evidence-packet-unavailable');
  }
}
