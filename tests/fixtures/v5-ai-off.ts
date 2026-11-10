import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const checkout = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../..'));

function toCheckoutRelative(path: string) {
  return relative(checkout, realpathSync(path));
}

/** Model-provider env names that must stay absent from the model-free worker. */
export const modelCredentialEnvNames = [
  'OPENAI_API_KEY', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN',
  'EAPR_MODEL_API_KEY', 'EAPR_MODEL_BASE_URL', 'EAPR_MODEL_PROVIDER',
] as const;

export function scrubModelCredentials(env: NodeJS.ProcessEnv = process.env) {
  const removed: string[] = [];
  for (const name of modelCredentialEnvNames) {
    if (env[name] !== undefined) {
      delete env[name];
      removed.push(name);
    }
  }
  return removed;
}

export function assertModelCredentialsAbsent(env: NodeJS.ProcessEnv = process.env) {
  for (const name of modelCredentialEnvNames) {
    if (env[name] !== undefined && env[name] !== '') {
      throw new Error('Model credential must remain absent for AI-off worker proof: ' + name);
    }
  }
}

/** Throws if anything in the worker path attempts a model provider call. */
export function createModelCallTrap() {
  let attempts = 0;
  return {
    get attempts() { return attempts; },
    call(label = 'model'): never {
      attempts += 1;
      throw new Error('WORKER_MODEL_CALL_FORBIDDEN: ' + label);
    },
  };
}

const forbiddenSpecifiers = [
  'openai', '@openai/', 'anthropic', '@anthropic-ai/', '@anthropic/',
  '@eapr/discovery', 'packages/discovery/', 'packages/runtime/',
];

function collectTypeScriptFiles(root: string) {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...collectTypeScriptFiles(path));
    else if (entry.endsWith('.ts')) files.push(path);
  }
  return files;
}

/**
 * Recursive relative import closure from worker entrypoints that stays inside this
 * checkout. Package-name imports are forbid-checked but not walked, so a shared
 * node_modules symlink cannot pull a sibling tree into the graph.
 */
export function workerProductionImportGraph(entrypoints: readonly string[]) {
  const paths = new Set(entrypoints.map(name => realpathSync(join(checkout, name))));
  for (const file of paths) {
    const source = readFileSync(file, 'utf8');
    const imports = [
      ...source.matchAll(/^(?:import|export) (?!type\b)(?:[^'";]+?\bfrom\s*)?['"]([^'"]+)['"]/gm),
      ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map(match => match[1]!);
    for (const specifier of imports) {
      if (forbiddenSpecifiers.some(prefix => specifier === prefix || specifier.startsWith(prefix))) {
        throw new Error('Worker import graph forbids ' + specifier + ' from ' + toCheckoutRelative(file));
      }
      if (!specifier.startsWith('.')) continue;
      const resolved = realpathSync(join(dirname(file), specifier.replace(/\.js$/, '.ts')));
      const relativePath = toCheckoutRelative(resolved);
      if (relativePath.startsWith('..') || relativePath.includes('packages/discovery/') ||
          relativePath.includes('packages/runtime/')) {
        throw new Error('Worker import graph forbids ' + relativePath + ' from ' + toCheckoutRelative(file));
      }
      paths.add(resolved);
    }
  }
  return [...paths].map(toCheckoutRelative).sort();
}

export function workerSourceFiles() {
  return collectTypeScriptFiles(join(checkout, 'apps/worker/src'))
    .map(toCheckoutRelative)
    .sort();
}

export function assertWorkerSourcesModelFree(files: readonly string[] = workerSourceFiles()) {
  for (const name of files) {
    const source = readFileSync(join(checkout, name), 'utf8');
    for (const pattern of [
      /OPENAI_/, /ANTHROPIC_/, /EAPR_MODEL_/,
      /from ['"]openai['"]/, /from ['"]@openai\//,
      /from ['"]anthropic['"]/, /from ['"]@anthropic/,
      /from ['"]@eapr\/discovery['"]/, /from ['"]@eapr\/discovery\//,
    ]) {
      if (pattern.test(source)) throw new Error('Worker source is not model-free: ' + name + ' matched ' + pattern);
    }
  }
}
