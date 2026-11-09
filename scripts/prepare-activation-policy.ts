import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  ActivationTrustPolicyEntryV1Schema, ActivationTrustPolicyV1Schema, HashSchema, IdSchema, canonicalJson,
  hashActivationTrustPolicy, strict, type ActivationTrustPolicyEntryV1,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { readFixedFinancialBuildHash, type FinancialCaptureReader } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry, requireFinancialCandidate } from '@eapr/evaluator/financial-attestation-registry';
import { deriveFinancialCapture } from '@eapr/evaluator/financial-attestation-verify';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createControlDb } from '@eapr/storage/control-db';
import { createRegisteredScopePublication } from '../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../apps/control/src/composition.js';
import { createFinancialCaptureReader } from '../apps/control/src/financial-capture.js';
import { readBootstrapExpectation } from '../packages/evaluator/src/bootstrap-fixtures.js';
import { publishActivationPolicy, readPrivateBytes } from '../packages/storage/src/activation-files.js';
import { getDemoPair } from './native-db.js';

const scopeSelection = { artifactHash: HashSchema, manifestId: IdSchema, selectedProfileHash: HashSchema };
const scopeSelectionFile = strict({ entries: strict(scopeSelection).array().min(1) });
const policySelectionFile = strict({
  policyId: IdSchema,
  entries: strict({
    ...scopeSelection, financialReportId: IdSchema,
    bootstrapFixture: strict({ fixtureSetId: IdSchema, fixtureSetVersion: IdSchema, fixtureHash: HashSchema }),
  }).array().min(1),
});
type Selection = ReturnType<typeof policySelectionFile.parse>;
type CandidateReader = Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
type Dependencies = {
  candidates: CandidateReader;
  captureReader: FinancialCaptureReader;
  financialRegistry: Pick<ReturnType<typeof createFinancialAttestationRegistry>, 'readRegisteredFinancialAttestation'>;
  readFinancialBuildHash: typeof readFixedFinancialBuildHash;
  readBootstrapBuildPins: typeof readFixedBootstrapBuildPins;
  bootstrapRoots?: Parameters<typeof readBootstrapExpectation>[2];
};

function policyFrom(policyId: string, entries: ActivationTrustPolicyEntryV1[]) {
  const input = { schemaVersion: '1' as const, policyId, entries };
  return ActivationTrustPolicyV1Schema.parse({ ...input, hash: hashActivationTrustPolicy(input) });
}

async function readBuilds(deps: Dependencies) {
  const [financial, bootstrap] = await Promise.all([deps.readFinancialBuildHash(), deps.readBootstrapBuildPins()]);
  return { financial, bootstrap };
}

async function deriveEntry(deps: Dependencies, selection: Selection['entries'][number], builds: Awaited<ReturnType<typeof readBuilds>>) {
  const { artifactHash, manifestId, selectedProfileHash, bootstrapFixture } = selection;
  const subject = await deps.captureReader.readCapture({ artifactHash, manifestId });
  const { artifact, manifest, profiles, snapshot } = subject;
  const [selected, duplicate] = profiles.filter(profile => profile.hash === selectedProfileHash);
  if (!selected?.bootstrap || duplicate || artifact.hash !== artifactHash || manifest.id !== manifestId) {
    throw new Error('ACTIVATION_POLICY_MISMATCH');
  }
  await requireFinancialCandidate(deps.candidates, subject);
  const capture = deriveFinancialCapture(subject);
  const { fixtureSetId, fixtureSetVersion, fixtureHash } = bootstrapFixture;
  const { descriptor } = await readBootstrapExpectation({ fixtureSetId, fixtureSetVersion, hash: fixtureHash }, {
    artifact, manifest, profiles, snapshot, events: subject.events,
    registration: { artifactHash, manifestHash: capture.manifestHash, snapshotId: capture.snapshotId, snapshotObjectHash: capture.snapshotObjectHash },
  }, deps.bootstrapRoots).catch(() => { throw new Error('BOOTSTRAP_FIXTURE_SETUP_REQUIRED'); });
  if (!descriptor.subjects.some(member => member.profileHash === selectedProfileHash && member.profileId === selected.id &&
    canonicalJson(member.scope) === canonicalJson(selected.scope))) throw new Error('ACTIVATION_POLICY_MISMATCH');
  return ActivationTrustPolicyEntryV1Schema.parse({
    issuerId: 'eapr-control-registry-1', artifactHash, capture, selectedProfileHash,
    requiredProfileHashes: artifact.requiredProfileHashes, scope: selected.scope,
    financial: {
      runnerId: 'eapr-financial-1', protocolVersion: '1', harnessVersion: '1',
      evaluatorBuildHash: builds.financial, evidencePin: descriptor.evidencePin,
    },
    bootstrapPin: {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', ...builds.bootstrap,
      fixtureSetId: descriptor.fixtureSetId, fixtureSetVersion: descriptor.fixtureSetVersion, fixtureHash: descriptor.hash,
    },
  });
}

export async function prepareActivationPolicy(deps: Dependencies, input: Selection) {
  const { entries, policyId } = policySelectionFile.parse(input);
  const builds = await readBuilds(deps);
  const derived: ActivationTrustPolicyEntryV1[] = [];
  for (const selection of entries) {
    const entry = await deriveEntry(deps, selection, builds);
    // The registry searches policy entries. Restrict it to the exact selected evidence pin.
    await deps.financialRegistry.readRegisteredFinancialAttestation(selection.financialReportId, {
      artifactHash: entry.artifactHash, requiredProfileHashes: entry.requiredProfileHashes,
      capture: entry.capture, policy: policyFrom(policyId, [entry]),
    });
    derived.push(entry);
  }
  return policyFrom(policyId, derived);
}

export async function prepareAndPublishActivationPolicy(
  deps: Dependencies, selection: Selection, options: { policyRoot: string; install?: boolean },
) {
  const policy = await prepareActivationPolicy(deps, selection);
  const builds = await readBuilds(deps);
  const rechecked = [];
  for (const entry of selection.entries) rechecked.push(await deriveEntry(deps, entry, builds));
  if (policyFrom(policy.policyId, rechecked).hash !== policy.hash ||
    canonicalJson(await readBuilds(deps)) !== canonicalJson(builds)) throw new Error('ACTIVATION_POLICY_MISMATCH');
  await publishActivationPolicy(options, policy, options.install);
  return policy;
}

const repository = fileURLToPath(new URL('..', import.meta.url));
const maxSelectionBytes = 1024 * 1024;
const safeErrors = new Set([
  'ACTIVATION_POLICY_MISMATCH', 'BOOTSTRAP_FIXTURE_SETUP_REQUIRED', 'FINANCIAL_ATTESTATION_MISMATCH',
  'FINANCIAL_ATTESTATION_UNAVAILABLE', 'REGISTERED_SCOPE_PUBLICATION_FAILED',
]);

async function runOperatorCommand() {
  const { values } = parseArgs({ options: {
    'selection-file': { type: 'string' }, 'install': { type: 'boolean' }, 'publish-scopes': { type: 'boolean' },
  } });
  const file = values['selection-file'];
  if (!file || (values.install && values['publish-scopes'])) throw new Error('Invalid activation setup arguments');
  const bytes = await readPrivateBytes(resolve(file), maxSelectionBytes);
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const registryRoot = join(repository, '.local/artifacts');
  const policyRoot = join(repository, '.local/activation-policy');
  const db = createControlDb({ connectionString: getDemoPair().control.appUrl });
  try {
    const candidates = createCandidateRegistry(db, registryRoot);
    if (values['publish-scopes']) {
      const { entries } = scopeSelectionFile.parse(input);
      const publisher = createRegisteredScopePublication({ registryRoot, candidates });
      const index = await publisher.publishRegisteredScopes(entries);
      console.log('REGISTERED_SCOPES_PUBLISHED ' + index.hash);
      return;
    }
    const selection = policySelectionFile.parse(input);
    const store = await createEvidenceStore(join(repository, '.local/demo/evidence'));
    const dependencies = { db, store, clock: () => new Date() };
    const service = createSourceService(dependencies, localSourceCatalog);
    const policy = await prepareAndPublishActivationPolicy({
      candidates,
      captureReader: createFinancialCaptureReader({ registry: candidates, dependencies, catalog: localSourceCatalog, service }),
      financialRegistry: createFinancialAttestationRegistry(db, candidates),
      readFinancialBuildHash: readFixedFinancialBuildHash,
      readBootstrapBuildPins: readFixedBootstrapBuildPins,
    }, selection, { policyRoot, install: values.install });
    console.log((values.install ? 'ACTIVATION_POLICY_INSTALLED ' : 'ACTIVATION_POLICY_PREPARED ') + policy.hash);
  } finally {
    await db.end();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runOperatorCommand();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    console.error(safeErrors.has(message) ? message : 'ACTIVATION_SETUP_REQUIRED');
    process.exitCode = 1;
  }
}
