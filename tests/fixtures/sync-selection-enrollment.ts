import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import {
  VerificationCheckIdSchema, canonicalJson, hashFinancialReservation, type Id,
} from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createSourceService, type UploadDependencies } from '@eapr/sources';
import { createControlDb } from '@eapr/storage/control-db';
import { createRuntimeDb } from '@eapr/storage/runtime-db';
import { createRegisteredScopePublication, type RegisteredScopeSelection } from '../../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import type { BootstrapRoots } from '../../apps/control/src/review-proof-selection.js';
import type { BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest } from '../../scripts/native-db.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { testNamespace } from './harness.js';
import { openInstalledSelectionReviewer, type SelectionProof, type SelectionSubject } from './sync-selection-reviewer.js';

export type { SelectionProof, SelectionSubject } from './sync-selection-reviewer.js';

const clock = () => new Date('2026-11-09T08:00:00.000Z');
const mandatoryChecks = [...VerificationCheckIdSchema.options].sort();

async function closeAll(actions: readonly (() => Promise<unknown>)[]) {
  const failures: unknown[] = [];
  for (const action of actions.toReversed()) {
    try { await action(); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Selection fixture cleanup failed');
}

export async function createSelectionEnrollment(): Promise<{
  db: Pool;
  root: string;
  roots: { visibleRoot: string; truthRoot: string };
  dependencies: UploadDependencies;
  service: ReturnType<typeof createSourceService>;
  candidates: ReturnType<typeof createCandidateRegistry>;
  bootstrapRoots: BootstrapRoots;
  prove(input: {
    selection: RegisteredScopeSelection;
    jobId: Id;
    review: Omit<BootstrapExpectationReview, 'evidencePin'>;
  }): Promise<SelectionProof>;
  openReviewer(input: {
    policyId: Id;
    proofs: readonly SelectionProof[];
  }): Promise<{
    approve(proof: SelectionProof, idempotencyKey: Id): Promise<SelectionSubject>;
    stop(): Promise<void>;
  }>;
  close(): Promise<void>;
}> {
  const cleanup: (() => Promise<unknown>)[] = [];
  let closed: Promise<void> | undefined;
  const close = () => closed ??= closeAll(cleanup);

  try {
    const namespace = testNamespace('selpeers');
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eapr-sync-selection-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    const pair = await provisionTest(namespace);
    cleanup.push(() => dropTest(namespace));
    const controlDb = createControlDb({ connectionString: pair.control.appUrl });
    cleanup.push(() => controlDb.end());
    const db = createRuntimeDb({ connectionString: pair.runtime.appUrl });
    cleanup.push(() => db.end());
    const migrations = readMigrationCatalog();
    await migrate(pair, migrationStreams, migrations);
    const roots = { visibleRoot: join(root, 'visible'), truthRoot: join(root, 'truth') };
    const registryRoot = join(root, 'registry');
    const storeRoot = join(root, 'originals');
    const bootstrapRoots: BootstrapRoots = {
      sidecarRoot: join(root, 'bootstrap'), evidencePinRoot: join(root, 'evaluator'),
      servedRoots: [roots.visibleRoot, storeRoot, registryRoot],
    };
    const dependencies = { db: controlDb, clock, store: await createEvidenceStore(storeRoot) };
    const service = createSourceService(dependencies, localSourceCatalog);
    const candidates = createCandidateRegistry(controlDb, registryRoot);
    const sourceDependencies = { dependencies, catalog: localSourceCatalog, service };
    const captureReader = createFinancialCaptureReader({ ...sourceDependencies, registry: candidates });
    const financialRegistry = createFinancialAttestationRegistry(controlDb, candidates);
    const launcher = createProtectedFinancialLauncher({
      registry: candidates, roots: { evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots },
    });
    let buildHash: Promise<string> | undefined;
    let reviewerOpened = false;

    return {
      db, root, roots, dependencies, service, candidates, bootstrapRoots, close,
      async prove({ selection, jobId, review }) {
        const evaluatorBuildHash = await (buildHash ??= readFixedFinancialBuildHash());
        const capture = await captureReader.readCapture(selection);
        const probe = await launcher.probe({
          protocolVersion: 'financial-attestation-probe-1', jobId, capture, evaluatorBuildHash,
          selection: {
            fixtureSetId: review.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
            snapshotHash: capture.snapshot.contentHash,
          },
        });
        const pin = await prepareBootstrapVerification(candidates, service, {
          ...selection, review: { ...review, evidencePin: probe.evidencePin },
        }, bootstrapRoots);
        const { artifact } = capture;
        const reservation = {
          schemaVersion: '1', jobId, issuerId: 'eapr-control-registry-1', runnerId: 'eapr-financial-1',
          protocolVersion: '1', harnessVersion: '1', purpose: 'construction', evaluatorBuildHash,
          artifactHash: artifact.hash, requiredProfileHashes: artifact.requiredProfileHashes,
          capture: probe.capture, evidencePin: probe.evidencePin,
        } as const;
        await financialRegistry.reserve({
          protocolVersion: 'financial-attestation-1', jobId, capture,
          reservation: { ...reservation, hash: hashFinancialReservation(reservation) },
        });
        const request = await financialRegistry.start(jobId);
        const { report, attestation } = await financialRegistry.complete(jobId, await launcher.launch(request));
        const gaps = report.checks.filter(check => check.status !== 'passed' || check.cases === 0)
          .map(({ id, status, cases }) => id + '=' + status + '(' + cases + ')');
        assert(report.eligible && report.unexplainedDifferenceCents === 0 && gaps.length === 0,
          'Financial proof failed for ' + jobId + ' (' + report.id + '): ' + gaps.join(', '));
        assert.deepEqual(report.coverage.required.toSorted(), mandatoryChecks);
        assert.deepEqual(report.coverage.executed.toSorted(), mandatoryChecks);
        return {
          report, attestation, entry: {
            ...selection, financialReportId: report.id,
            bootstrapFixture: { fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash },
          },
        };
      },
      async openReviewer({ policyId, proofs }) {
        assert(!reviewerOpened, 'Selection fixture reviewer already opened');
        reviewerOpened = true;
        const entries = proofs.map(proof => proof.entry);
        const index = await createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes(entries);
        assert.equal(index.entries.length, entries.length, 'Unexpected registered scope count');
        const selection = { policyId, entries };
        const policyRoot = join(root, 'policy');
        await prepareAndPublishActivationPolicy({
          candidates, captureReader, financialRegistry, bootstrapRoots,
          readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
        }, selection, { policyRoot, install: true });
        const policyPath = join(policyRoot, 'current.json');
        const selectionPath = join(root, 'selection.json');
        await writeFile(selectionPath, canonicalJson(selection), { flag: 'wx', mode: 0o600 });

        const reviewer = await openInstalledSelectionReviewer({
          db, dependencies, candidates, service, registryRoot, bootstrapRoots, policyPath, selectionPath, proofs,
        });
        cleanup.push(reviewer.stop);
        return reviewer;
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      try {
        if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
          console.error('Selection fixture cleanup failed while preserving the original construction error');
        }
      } catch {
        console.error('Selection fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
