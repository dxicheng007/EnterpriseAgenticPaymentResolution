import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { expect } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { canonicalJson, hashFinancialReservation, type TargetState } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { readFixedBootstrapBuildPins } from '@eapr/evaluator/bootstrap-launcher';
import { createProtectedFinancialLauncher, readFixedFinancialBuildHash } from '@eapr/evaluator/financial-attestation-launcher';
import { createFinancialAttestationRegistry } from '@eapr/evaluator/financial-attestation-registry';
import { createCandidateRegistry } from '@eapr/evaluator/registry';
import { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import { createRegisteredScopePublication } from '../../apps/control/src/activation-publication.js';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createFinancialCaptureReader } from '../../apps/control/src/financial-capture.js';
import type { BootstrapExpectationReview } from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { fixtureA, fixtureB } from '../../packages/sources/src/canonical-fixtures.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { prepareAndPublishActivationPolicy } from '../../scripts/prepare-activation-policy.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { captureEvidenceFixture } from './evidence-v2-capture.js';

export const activationCutover = '2026-10-01T00:00:00.000Z';
const fixtureSeed = 'activation-policy';

export function verifyOriginals(target: TargetState, company: 'a' | 'b') {
  const fixture = company === 'a' ? fixtureA(fixtureSeed, activationCutover) : fixtureB(fixtureSeed, activationCutover);
  const expected = fixture.records.filter(record => record.sourceAccountId === fixture.accounts[0]!.accountId)
    .map(({ sourceAccountId: _account, recordId, effectiveDate, ...facts }) => ({
      ...facts, recordId, effectiveAt: effectiveDate + 'T00:00:00.000Z',
    })).sort((a, b) => a.recordId.localeCompare(b.recordId));
  const actual = [...target.invoices, ...target.payments, ...target.credits, ...target.allocations].map(
    ({ id: _id, identity, scope: _scope, currency: _currency, sourceEventId: _eventId,
      sourceRecordVersion: _version, ...facts }) => ({ ...facts, recordId: identity.recordId }),
  ).sort((a, b) => a.recordId.localeCompare(b.recordId));
  expect(actual).toEqual(expected);
  expect(target.reversals).toEqual([]);
}

export async function issueActivationProofs(root: string, db: Pool) {
  const visibleRoot = join(root, 'visible');
  const truthRoot = join(root, 'truth');
  const storeRoot = join(root, 'originals');
  const registryRoot = join(root, 'registry');
  const policyRoot = join(root, 'policy');
  const policyPath = join(policyRoot, 'current.json');
  const bootstrapRoots = {
    sidecarRoot: join(root, 'bootstrap'), evidencePinRoot: join(root, 'evaluator'),
    servedRoots: [visibleRoot, storeRoot, registryRoot],
  };
  const store = await createEvidenceStore(storeRoot);
  const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
  const service = createSourceService(dependencies, localSourceCatalog);
  const candidates = createCandidateRegistry(db, registryRoot);
  const financialRegistry = createFinancialAttestationRegistry(db, candidates);
  const captureReader = createFinancialCaptureReader({ dependencies, service, catalog: localSourceCatalog, registry: candidates });
  const publishScopes = createRegisteredScopePublication({ registryRoot, candidates }).publishRegisteredScopes;
  const scopeReader = createRegisteredScopeReader({ registryRoot });
  await expect(scopeReader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
  await generateFixtures({ seed: fixtureSeed, asOf: activationCutover, visibleRoot, truthRoot });
  const evaluatorBuildHash = await readFixedFinancialBuildHash();

  async function issue(company: 'a' | 'b') {
    const { input, source, contractFileId } = await captureEvidenceFixture(dependencies, { visibleRoot, truthRoot }, company);
    const launcher = createProtectedFinancialLauncher({ registry: candidates, roots: {
      evidencePinRoot: bootstrapRoots.evidencePinRoot, servedRoots: bootstrapRoots.servedRoots,
    } });
    const { manifest, snapshot, events } = input;
    const citation = input.citations.find(item => item.evidence.sourceId === contractFileId &&
      item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1);
    const built = buildDemoCandidate({
      source, capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
      manifest, snapshot, events, citation,
    });
    if (!('candidate' in built) || !citation) throw new Error('Expected captured agreement and candidate');
    const { spec, profiles } = built.candidate.request;
    const [profile] = profiles;
    const compiled = compile(spec, profiles);
    if (!compiled.ok || !profile?.bootstrap) throw new Error('Expected a metadata-bearing compiled candidate');
    const artifact = compiled.value;
    await candidates.registerCandidate({ spec, profiles, artifact, manifest, snapshot });
    const selection = { artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: profile.hash };
    await publishScopes([selection]);
    const scopes = await scopeReader.readSnapshot();
    expect(scopes.resolveRegisteredScope(profile.scope.accountId)?.profile).toEqual(profile);
    expect(scopes.resolveRegisteredScope('unknown')).toBeNull();

    const producer = decodeEvidenceProducer(input.producerJson);
    const identity = producer.identities.find(item => item.sourceAccountId === profile.sourceAccountIds[0])!;
    const term = producer.contracts.find(item => item.sourceAccountId === identity.sourceAccountId)!;
    await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
    const capture = await captureReader.readCapture(selection);
    const jobId = 'activation-policy:' + company + ':first';
    const probe = await launcher.probe({
      protocolVersion: 'financial-attestation-probe-1', jobId, capture, evaluatorBuildHash,
      selection: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', purpose: 'construction',
        snapshotHash: snapshot.contentHash },
    });
    const review: BootstrapExpectationReview = {
      fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-v1', evidencePin: probe.evidencePin,
      subjects: [{
        profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
        customerId: identity.buyerId, customerEvidenceRefs: [citation.evidence.id],
        terms: profile.bootstrap.billingConfigurationIds.map(({ termId, id }) => ({
          factId: term.id, termId, configurationId: id, evidenceRefs: [citation.evidence.id],
        })),
      }],
    };
    const pin = await prepareBootstrapVerification(candidates, service, { ...selection, review }, bootstrapRoots);
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
    const { report } = await financialRegistry.complete(jobId, await launcher.launch(request));
    expect(report.eligible).toBe(true);
    return {
      selection: { ...selection, financialReportId: report.id, bootstrapFixture: {
        fixtureSetId: pin.fixtureSetId, fixtureSetVersion: pin.fixtureSetVersion, fixtureHash: pin.hash,
      } },
      accountId: profile.scope.accountId, sourceRef: manifest.sourceRef,
      capture: { companyId: source.companyId, manifestId: manifest.id, contractFileId },
    };
  }

  const a = await issue('a');
  const b = await issue('b');

  const selection = { policyId: 'review-policy', entries: [a.selection, b.selection] };
  await prepareAndPublishActivationPolicy({
    candidates, captureReader, financialRegistry, bootstrapRoots,
    readFinancialBuildHash: readFixedFinancialBuildHash, readBootstrapBuildPins: readFixedBootstrapBuildPins,
  }, selection, { policyRoot, install: true });
  const policyBytes = await readFile(policyPath);
  const selectionPath = join(root, 'selection.json');
  await writeFile(selectionPath, canonicalJson(selection), { mode: 0o600 });
  return { a, b, candidates, dependencies, registryRoot, scopeReader, bootstrapRoots, policyPath, policyBytes, selectionPath };
}
