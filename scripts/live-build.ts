import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configurationUnavailableMessage =
  'LIVE_CONFIGURATION_UNAVAILABLE: A genuine provider requires OPENAI_API_KEY.';
const constructionUnavailableMessage =
  'LIVE_CONSTRUCTION_UNAVAILABLE: Genuine live connector construction is unavailable.';

export type LiveConfigurationStatus =
  | { ok: true; apiKeyPresent: true }
  | { ok: false; code: 'LIVE_CONFIGURATION_UNAVAILABLE'; message: string };

/** Harness/operator check only — not a product env binding inside packages/discovery. */
export function liveConfigurationStatus(): LiveConfigurationStatus {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, code: 'LIVE_CONFIGURATION_UNAVAILABLE', message: configurationUnavailableMessage };
  }
  return { ok: true, apiKeyPresent: true };
}

export function requireLiveProviderConfiguration(): void {
  const status = liveConfigurationStatus();
  if (!status.ok) throw new Error(status.message);
}

function validateLiveFile(argument: string) {
  const relativePath = relative(process.cwd(), resolve(argument));
  if (
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !relativePath.startsWith('tests/live/') ||
    !relativePath.endsWith('.test.ts')
  ) {
    throw new Error('Live tests must be files under tests/live/');
  }
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = 1;
  const fileArg = process.argv.slice(2).find(arg => !arg.startsWith('-'));
  if (!fileArg) {
    console.error('Usage: npm run test:live -- <tests/live/*.test.ts>');
  } else {
    try {
      validateLiveFile(fileArg);
      const status = liveConfigurationStatus();
      console.error(status.ok ? constructionUnavailableMessage : status.message);
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Live build runner failed');
    }
  }
}
