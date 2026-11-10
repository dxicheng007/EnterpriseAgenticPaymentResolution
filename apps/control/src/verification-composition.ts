import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { CandidateRegistration } from '@eapr/compiler/preview-adapters';
import { HashSchema, IdSchema, strict, type Diagnostic } from '@eapr/contracts';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import type { FinancialSourceDependencies } from './financial-capture.js';
import { composeFinancialVerification, type FinancialVerificationRoots } from './financial-verification-composition.js';
import { probeMigration, type MigrationIdentity } from '@eapr/storage/transaction';
import type { createLocalSessionService } from './local-session.js';
import { createVerificationPlugin } from './routes/verification.js';

const safeVerificationPin = strict({
  companyId: IdSchema, sourceRef: IdSchema, manifestId: IdSchema, manifestHash: HashSchema,
  snapshotHash: HashSchema, fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, purpose: z.literal('construction'),
});

export const safeVerificationPins = safeVerificationPin.array().length(2);
export type SafeVerificationPin = z.infer<typeof safeVerificationPin>;
export type CaptureBinding = Pick<SafeVerificationPin, 'companyId' | 'sourceRef' | 'manifestId' | 'manifestHash' | 'snapshotHash'>;
export type VerificationSetupCode = 'VERIFICATION_FIXTURE_SETUP_REQUIRED' | 'VERIFICATION_FIXTURE_CONFLICT';

export function verificationSetupDiagnostic(code: VerificationSetupCode): Diagnostic {
  return {
    code, severity: 'warning', sourceIds: [], fieldPaths: [],
    message: code === 'VERIFICATION_FIXTURE_SETUP_REQUIRED'
      ? 'Protected verification needs operator setup. See the demo verification setup guide.'
      : 'Protected verification setup conflicts with the captured fixtures or is unavailable. See the demo verification setup guide.',
  };
}

function matchesCapture(pin: SafeVerificationPin, capture: CaptureBinding) {
  return pin.companyId === capture.companyId && pin.sourceRef === capture.sourceRef &&
    pin.manifestId === capture.manifestId && pin.manifestHash === capture.manifestHash &&
    pin.snapshotHash === capture.snapshotHash;
}

export function createVerificationSelector(input: unknown, captures: readonly CaptureBinding[]) {
  const pins = safeVerificationPins.parse(input);
  const byManifest = new Map(pins.map(pin => [pin.manifestId, pin]));
  const fixtureKeys = new Set(pins.map(pin => JSON.stringify([pin.fixtureSetId, pin.fixtureSetVersion])));
  if (captures.length !== pins.length || byManifest.size !== pins.length || fixtureKeys.size !== pins.length ||
    new Set(pins.map(pin => pin.companyId)).size !== pins.length ||
    !captures.every(capture => {
      const pin = byManifest.get(capture.manifestId);
      return pin && matchesCapture(pin, capture);
    })) throw new Error('Verification fixture bindings conflict');

  return async ({ manifest, snapshot, artifact, profiles }: CandidateRegistration) => {
    const pin = byManifest.get(manifest.id);
    if (!pin || !matchesCapture(pin, {
      companyId: manifest.companyId, sourceRef: manifest.sourceRef, manifestId: manifest.id,
      manifestHash: manifest.hash, snapshotHash: snapshot.contentHash,
    }) || snapshot.id !== 'snapshot:' + manifest.id ||
      snapshot.manifestId !== manifest.id || snapshot.sourceRef !== manifest.sourceRef ||
      artifact.sourceRef !== manifest.sourceRef || !profiles.length ||
      profiles.some(profile => profile.sourceRef !== manifest.sourceRef || profile.scope.companyId !== manifest.companyId)) {
      throw new Error('Verification fixture bindings conflict');
    }
    const { fixtureSetId, fixtureSetVersion, purpose, snapshotHash } = pin;
    return { fixtureSetId, fixtureSetVersion, purpose, snapshotHash };
  };
}

export type LocalVerificationOptions = {
  pins: SafeVerificationPin[];
  registryRoot: string;
  roots: FinancialVerificationRoots;
  expectedMigrations: readonly MigrationIdentity[];
  /**
   * Gate J is not accepted. Keep production Discovery verification tools off until
   * the separately recorded accepted integration step; tests inject deps directly.
   */
  mountDiscoveryVerificationTools?: boolean;
};

export async function composeVerification(
  sources: FinancialSourceDependencies, options: LocalVerificationOptions, captures: readonly CaptureBinding[],
  authorizeReviewer: ReturnType<typeof createLocalSessionService>['authorizeReviewer'],
) {
  if (options.pins.some(pin => pin.fixtureSetVersion !== '2')) throw new Error('Verification fixture version is unavailable');
  const db = sources.dependencies.db;
  const select = createVerificationSelector(options.pins, captures);
  const migration = await probeMigration(db, options.expectedMigrations);
  if (migration.status !== 'ready' || (migration.migrationVersion ?? 0) < 6) {
    throw new Error('Verification registry migration is unavailable');
  }
  const root = resolve(options.registryRoot);
  if (await realpath(dirname(root)) !== dirname(root)) throw new Error('Verification registry directory is unavailable');
  await mkdir(root, { mode: 0o700, recursive: true });
  if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) {
    throw new Error('Verification registry directory is unavailable');
  }
  await access(root, constants.R_OK | constants.W_OK | constants.X_OK);

  const registry = createCandidateRegistry(db, root);
  const financial = await composeFinancialVerification(sources, registry, options.roots, select);
  const plugin = createVerificationPlugin({
    registry, jobs: financial.jobs,
    async authorizeVerification(request) {
      const { reviewer, allowedSourceRefs, allowedAccountIds } =
        await authorizeReviewer(request, { mutation: request.method === 'POST' });
      return { caller: 'reviewer', reviewer, allowedSourceRefs, allowedAccountIds };
    },
  });
  // Discovery verification tools require control009 mapping; reviewer jobs only need registry (>=6).
  // Remain off by default until Gate J acceptance (finding 9); opt-in is test/explicit only.
  const discoveryVerification = options.mountDiscoveryVerificationTools === true &&
    (migration.migrationVersion ?? 0) >= 9 ?
    financial.discoveryVerification : undefined;
  return { registry, plugin, discoveryVerification };
}
