import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const unavailableMessage =
  'LIVE_CONFIGURATION_UNAVAILABLE: A genuine provider requires OPENAI_API_KEY and the live slice.';

export type LiveConfigurationStatus =
  | { ok: true; apiKeyPresent: true }
  | { ok: false; code: 'LIVE_CONFIGURATION_UNAVAILABLE'; message: string };

/** Harness/operator check only — not a product env binding inside packages/discovery. */
export function liveConfigurationStatus(): LiveConfigurationStatus {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, code: 'LIVE_CONFIGURATION_UNAVAILABLE', message: unavailableMessage };
  }
  return { ok: true, apiKeyPresent: true };
}

export function requireLiveProviderConfiguration(): void {
  const status = liveConfigurationStatus();
  if (!status.ok) throw new Error(status.message);
}

function resolveLiveFile(argument: string) {
  const path = isAbsolute(argument) ? resolve(argument) : resolve(process.cwd(), argument);
  const relativePath = relative(process.cwd(), path);
  if (
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !relativePath.startsWith('tests/live/') ||
    !relativePath.endsWith('.test.ts')
  ) {
    throw new Error('Live tests must be files under tests/live/');
  }
  return relativePath;
}

function runLiveVitest(file: string, vitestArgs: string[]) {
  mkdirSync('.local', { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(resolve('.local', 'live-vitest-'));
  const configPath = resolve(temp, 'vitest.config.ts');
  writeFileSync(configPath, [
    "import { defineConfig } from 'vitest/config';",
    'export default defineConfig({',
    "  test: { name: 'live', include: ['tests/live/**/*.test.ts'], fileParallelism: false, testTimeout: 120_000 },",
    '});',
    '',
  ].join('\n'), { mode: 0o600 });
  try {
    const result = spawnSync('npm', ['exec', 'vitest', 'run', '--', '--config', configPath, file, ...vitestArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status === null ? 1 : result.status;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const evidence = args[0] === '--evidence';
  const rest = evidence ? args.slice(1) : args;
  const fileArg = rest.find(arg => !arg.startsWith('-'));
  if (!fileArg) {
    console.error('Usage: npm run test:live -- <tests/live/*.test.ts>');
    process.exitCode = 1;
  } else {
    try {
      const file = resolveLiveFile(fileArg);
      const vitestArgs = rest.filter(arg => arg !== fileArg);
      if (!evidence) {
        const status = liveConfigurationStatus();
        if (!status.ok) {
          console.error(status.message);
          process.exitCode = 1;
        } else {
          // Provider key is present; Blocker D still leaves product composition unmounted.
          // Run the registered live file — successful G4/G7 holdouts remain out of band.
          runLiveVitest(file, vitestArgs);
        }
      } else {
        // Slice verifier evidence mode: execute the fail-closed proof suite without claiming G4/G7.
        runLiveVitest(file, vitestArgs);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Live build runner failed');
      process.exitCode = 1;
    }
  }
}
