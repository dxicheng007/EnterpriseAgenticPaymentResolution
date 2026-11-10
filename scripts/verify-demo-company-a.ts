import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { hashBytes } from '../packages/contracts/src/canonical.js';
import { scrubModelCredentials } from '../tests/fixtures/v5-ai-off.js';
import { companyACommands, companyAGate, companyAGateOutcome, readCompanyAObservation } from './verify-demo-company-a-evidence.js';
import { commandResult, normalizeReport } from './verify-slice-evidence.js';
import { readV2File, readV2Json } from './verify-v2-evidence.js';

type SourceIdentity = { commit: string; clean: boolean; evidenceKey: string };

function version(command: string, pattern: RegExp, env: NodeJS.ProcessEnv) {
  const child = spawnSync(command, ['--version'], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000, maxBuffer: 4096,
  });
  const match = child.stdout?.trim().match(pattern);
  if (child.status !== 0 || child.error || child.signal || !match) throw new Error();
  return match[1];
}

async function runMetadata(root: string, env: NodeJS.ProcessEnv) {
  const { migrationIdentities, migrationStreams, readMigrationCatalog } = await import('./migrate.js');
  const { localPort, testLeasePrefix } = await import('./native-db.js');
  const catalog = readMigrationCatalog();
  const packageLock = readV2File(join(root, 'package-lock.json'), 8 * 1024 * 1024);
  const lock = JSON.parse(packageLock.toString('utf8')) as { packages?: Record<string, { version?: unknown }> };
  const dependencies = Object.fromEntries(['vitest', 'typescript', 'tsx', 'pg', 'zod'].map(name => {
    const installed = lock.packages?.['node_modules/' + name]?.version;
    if (typeof installed !== 'string' || !/^\d+\.\d+\.\d+$/.test(installed)) throw new Error();
    return [name, installed];
  }));
  if (!/^v24\.\d+\.\d+$/.test(process.version)) throw new Error();
  const documentHash = (file: string) => hashBytes(readV2File(join(root, file), 1024 * 1024));
  return {
    runtime: {
      node: process.version, npm: version('npm', /^(\d+\.\d+\.\d+)$/, env),
      postgres: version('postgres', /^postgres \(PostgreSQL\) (18\.\d+)(?: \([^\r\n()]*\))?$/, env),
      packageLockHash: hashBytes(packageLock), dependencies,
    },
    contract: {
      version: 1, sha256: documentHash('docs/superpowers/plans/2026-11-08-contract-freeze.md'),
      demoSha256: documentHash('docs/demo/demo-contract.md'),
    },
    configuration: {
      host: '127.0.0.1', postgresPort: localPort('EAPR_PG_PORT', 55432),
      controlPort: localPort('EAPR_CONTROL_PORT', 3241), workerPort: localPort('EAPR_WORKER_PORT', 3242),
      webPort: 5182, testPrefix: testLeasePrefix(), demoNamespace: env.EAPR_DEMO_NAMESPACE ?? 'eapr_v0',
    },
    migrations: migrationStreams.flatMap(stream => migrationIdentities(catalog[stream]).map(({ version, sha256 }) => ({
      stream, expectedVersion: version, sha256,
    }))),
  };
}

export async function verifyDemoCompanyA(source: SourceIdentity) {
  const root = realpathSync(process.cwd());
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const evidence = resolve(root, '.evidence', source.evidenceKey, companyAGate, runId);
  const env = { ...process.env };
  scrubModelCredentials(env);
  delete env.EAPR_COMPANY_A_OBSERVATION;
  delete env.EAPR_COMPANY_A_RUN_TOKEN;

  const commands: ReturnType<typeof commandResult>[] = [];
  const diagnostics: string[] = [];
  let metadata: Awaited<ReturnType<typeof runMetadata>> | undefined;
  let observation: ReturnType<typeof readCompanyAObservation>;
  let temp: string | undefined;
  try {
    metadata = await runMetadata(root, env);
  } catch {
    diagnostics.push('run-metadata-unavailable');
  }

  if (metadata) {
    try {
      temp = mkdtempSync(join(realpathSync(tmpdir()), 'verify-demo-company-a-'));
      const token = randomBytes(32).toString('hex');
      const observed = join(temp, 'observation.json');
      for (const [index, { script, command, file, names }] of companyACommands.entries()) {
        const report = join(temp, 'report-' + index + '.json');
        const args = ['run', script];
        if (file) args.push('--', file, '--reporter=json', '--outputFile=' + report);
        const child = spawnSync('npm', args, {
          cwd: root,
          env: index === 0 ? { ...env, EAPR_COMPANY_A_OBSERVATION: observed, EAPR_COMPANY_A_RUN_TOKEN: token } : env,
          stdio: 'ignore', timeout: 600_000,
        });
        let normalized: ReturnType<typeof normalizeReport> | undefined;
        if (file) {
          try {
            normalized = normalizeReport('vitest', readV2Json(report, 8 * 1024 * 1024), root, file, names);
          } catch {
            normalized = { cases: [], diagnostics: ['report-unavailable-or-invalid'] };
          }
        }
        const result = commandResult(command, child, normalized);
        commands.push(result);
        console.log(companyAGate + ' ' + result.result + ' ' + command);
      }
      observation = readCompanyAObservation(observed, token);
    } catch {
      diagnostics.push('bounded-run-failed');
    } finally {
      if (temp) {
        try { rmSync(temp, { recursive: true, force: true }); }
        catch { diagnostics.push('private-output-cleanup-failed'); }
      }
    }
  }

  const { exitCode, ...outcome } = companyAGateOutcome(commands, diagnostics, observation);
  mkdirSync(evidence, { recursive: true, mode: 0o700 });
  writeFileSync(join(evidence, 'manifest.json'), JSON.stringify({
    schemaVersion: 1, gate: companyAGate, scope: 'single-company-a-fixture-mounted-sync',
    constructionMode: 'development-fixture', independentReview: 'pending', jointAcceptance: 'pending',
    runId, source, ...metadata, commands, observation, ...outcome,
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(companyAGate + ' verification ' + outcome.result + ' (bounded fixture scope; full V5 not established)');
  console.log('Evidence: ' + relative(root, evidence));
  process.exitCode = exitCode;
}
