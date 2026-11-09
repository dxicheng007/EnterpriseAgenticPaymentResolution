import { mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { compile } from '@eapr/compiler/compile';
import { planBootstrap } from '@eapr/compiler/plan-bootstrap';
import { BootstrapManifestSchema, CustomerProfileSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBytes, hashCanonical, hashProfile, type TargetState } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { buildBootstrapCases } from '../../packages/evaluator/src/bootstrap-cases.js';
import {
  pinBootstrapExpectation, readBootstrapExpectation, resolveBootstrapSubject,
  type BootstrapCapture, type BootstrapExpectationReview,
} from '../../packages/evaluator/src/bootstrap-fixtures.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { createCandidateRegistry } from '../../packages/evaluator/src/registry.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { assembleEvidenceVerificationInput } from '../../scripts/evidence-verification-input.js';
import { generateFixtures } from '../../scripts/generate-fixtures.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareBootstrapVerification } from '../../scripts/prepare-bootstrap-verification.js';
import { testNamespace } from '../fixtures/harness.js';

const asOf = '2026-10-01T00:00:00.000Z';
const rejected = 'Protected bootstrap fixture invalid';
const pinPath = (root: string, id: string, version: string) => join(root, hashCanonical([id, version]) + '.json');
const signProfile = (profile: Parameters<typeof hashProfile>[0]) =>
  CustomerProfileSchema.parse({ ...profile, hash: hashProfile(profile) });
const holdKey = ({ code, scope, eventIds }: { code: string; scope?: unknown; eventIds: string[] }) =>
  hashCanonical({ code, scope: scope ?? null, eventIds: [...eventIds].sort() });

test('captured bootstrap descriptors bind independent A/B evidence and immutable candidate bytes', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-bootstrap-'));
  const namespace = testNamespace('bootstrap');
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const visibleRoot = join(directory, 'visible');
      const truthRoot = join(directory, 'protected');
      const storeRoot = join(directory, 'served-evidence');
      const registryRoot = join(directory, 'registry');
      const roots = {
        sidecarRoot: join(directory, 'protected-bootstrap'), evidencePinRoot: join(directory, 'protected-evaluator'),
        servedRoots: [visibleRoot, storeRoot, registryRoot],
      };
      const store = await createEvidenceStore(storeRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      await generateFixtures({ seed: 'bootstrap-v1', asOf, visibleRoot, truthRoot });
      const service = createSourceService(dependencies, localSourceCatalog);
      const registry = createCandidateRegistry(db, registryRoot);
      for (const company of ['a', 'b'] as const) {
        const readVisible = (path: string) => readFile(join(visibleRoot, path));
        const json = async (path: string) => JSON.parse((await readVisible(path)).toString('utf8'));
        const manifest = BootstrapManifestSchema.parse(await json('manifest-' + company + '.json'));
        const source = localSourceCatalog.get(manifest.companyId)!;
        const uploads = await json('uploads-' + company + '.json') as { metadata: unknown; path: string }[];
        let contractFileId: string | null = null;
        for (const upload of uploads) {
          const metadata = UploadMetadataSchema.parse(upload.metadata);
          if (metadata.kind === 'contract_pdf' && contractFileId === null) contractFileId = sourceFileId(metadata);
          await storeSourceUpload(dependencies, metadata, await readVisible(upload.path));
        }
        const originals = await json('api-originals-' + company + '.json') as { eventId: string; path: string }[];
        const apiEvents = RawSourceEventSchema.array().parse(await json('api-' + company + '.json'));
        const prepared = await Promise.all(apiEvents.map(async event => prepareApiRecord(
          source, store, event, await readVisible(originals.find(item => item.eventId === event.id)!.path),
        )));
        await publishManifest(dependencies, localSourceCatalog, manifest, prepared);
        const result = await service.captureSnapshot(manifest.id);
        if (!result.ok || !result.dossier.complete) throw new Error('Construction capture unavailable');
        const { snapshot } = result;
        const capture = { companyId: manifest.companyId, manifestId: manifest.id, contractFileId };
        const events = await service.getSnapshotRecords(snapshot.id);
        const producerTruthJson = await readFile(join(truthRoot, 'expected-' + company + '.json'), 'utf8');
        const producerJson = await readFile(join(truthRoot, 'evidence-' + company + '.json'), 'utf8');
        const producer = decodeEvidenceProducer(producerJson);
        const evidence = await assembleEvidenceVerificationInput(
          db, store, { source, manifest, snapshot, events }, producerTruthJson, producerJson, producer,
        );
        await pinProtectedEvidenceFixture(evidence, new URL(roots.evidencePinRoot + '/', 'file:'));
        const existingPin = pinPath(roots.evidencePinRoot, producer.fixtureSetId, '2');
        const v2Bytes = await readFile(existingPin);
        const v2 = JSON.parse(v2Bytes.toString('utf8'));
        const citation = evidence.citations.find(item => item.evidence.sourceId === capture.contractFileId &&
          item.evidence.locator.kind === 'pdf' && item.evidence.locator.page === 1)!;
        const candidate = buildDemoCandidate({ source, capture, manifest, snapshot, events, citation });
        if (!('candidate' in candidate)) throw new Error('Designated candidate unavailable');
        const request = candidate.candidate!.request;
        const original = request.profiles[0]!;
        const identity = producer.identities.find(item => item.sourceAccountId === original.sourceAccountIds[0])!;
        const term = producer.contracts.find(item => item.sourceAccountId === identity.sourceAccountId)!;
        const profile = signProfile({
          ...original, version: original.version + 1,
          bootstrap: {
            customer: { id: original.parentCustomerId, displayName: /Legal name (.+?) Monthly fee/.exec(citation.text.value)![1]!, evidenceRefs: [citation.evidence.id] },
            billingConfigurationIds: [{ termId: original.contractTerms[0]!.id, id: 'bootstrap-config-' + company }],
          },
        });
        const spec = { ...request.spec, version: request.spec.version + 1 };
        const compiled = compile(spec, [profile]);
        if (!compiled.ok) throw new Error('Construction subject failed to compile');
        const artifact = compiled.value;
        await registry.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
        const registration = {
          artifactHash: artifact.hash, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotObjectHash: hashCanonical(snapshot),
        };
        const input: BootstrapCapture = { artifact, profiles: [profile], manifest, snapshot, events, registration };
        const review: BootstrapExpectationReview = {
          fixtureSetId: producer.fixtureSetId, fixtureSetVersion: 'bootstrap-v1',
          evidencePin: { fixtureSetId: producer.fixtureSetId, fixtureSetVersion: '2', bundleHash: v2.bundleHash },
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citation.evidence.id],
            terms: [{ factId: term.id, termId: profile.contractTerms[0]!.id, configurationId: 'bootstrap-config-' + company,
              evidenceRefs: [citation.evidence.id] }],
          }],
        };
        const prepare = () => prepareBootstrapVerification(registry, service, { artifactHash: artifact.hash, manifestId: manifest.id, review }, roots);
        const pin = await prepare();
        expect(await prepare()).toEqual(pin);
        const validated = await readBootstrapExpectation(pin, input, roots);
        expect(validated.descriptor.snapshotHash).toBe(snapshot.contentHash);
        expect(validated.descriptor.snapshotHash).not.toBe(registration.snapshotObjectHash);
        expect(await readFile(existingPin).then(hashBytes)).toBe(hashBytes(v2Bytes));
        const target: TargetState = {
          scope: profile.scope, asOf, version: 0, customers: [], accounts: [], billingConfigurations: [],
          invoices: [], credits: [], payments: [], allocations: [], reversals: [],
        };
        const cases = buildBootstrapCases(validated, profile.hash, target);
        expect(cases?.length).toBe(10);
        for (const probe of cases!) {
          const outcome = planBootstrap(artifact, profile, probe.events, probe.target);
          expect(outcome.plans.length, probe.id).toBe(probe.expectedPlan ? 1 : 0);
          expect(hashCanonical(outcome.plans[0] ?? null), probe.id).toBe(hashCanonical(probe.expectedPlan));
          expect(outcome.holds.map(holdKey).sort(), probe.id).toEqual(probe.expectedHolds.map(holdKey).sort());
        }
        if (company === 'b') expect(cases![0]!.expectedPlan?.expectedBalanceCents).toBe(0);

        const sidecar = pinPath(roots.sidecarRoot, pin.fixtureSetId, pin.fixtureSetVersion);
        const originalBytes = await readFile(sidecar, 'utf8');
        const { hash: _hash, ...descriptor } = validated.descriptor;
        const substituted = { ...descriptor, snapshotHash: hashCanonical(snapshot) };
        const substitutedHash = hashCanonical(substituted);
        await unlink(sidecar);
        await writeFile(sidecar, canonicalJson({ ...substituted, hash: substitutedHash }), { mode: 0o400 });
        await expect(readBootstrapExpectation({ ...pin, hash: substitutedHash }, input, roots)).rejects.toThrow(rejected);
        await unlink(sidecar);
        await writeFile(sidecar, originalBytes, { mode: 0o400 });
        const reordered = { ...snapshot, eventIds: [...snapshot.eventIds].reverse() };
        expect(hashCanonical(reordered)).not.toBe(registration.snapshotObjectHash);
        await expect(readBootstrapExpectation(pin, { ...input, snapshot: reordered }, roots)).rejects.toThrow(rejected);
        const evidenceIds = [...snapshot.evidenceIds, 'foreign-evidence-id'].sort();
        const rebuiltContentHash = hashCanonical({
          manifestHash: manifest.hash, eventIds: [...snapshot.eventIds].sort(), evidenceIds,
          streams: [...manifest.streams].sort((a, b) => a.streamId < b.streamId ? -1 : 1)
            .map(({ streamId, snapshotId, snapshotHash }) => ({ streamId, snapshotId, snapshotHash })),
          files: [...manifest.files].sort((a, b) => a.fileId < b.fileId ? -1 : 1).map(({ fileId, sha256 }) => ({ fileId, sha256 })),
        });
        const rebuiltSnapshot = { ...snapshot, evidenceIds, contentHash: rebuiltContentHash };
        expect(hashCanonical(rebuiltSnapshot)).not.toBe(registration.snapshotObjectHash);
        await expect(readBootstrapExpectation(pin, { ...input, snapshot: rebuiltSnapshot }, roots)).rejects.toThrow(rejected);
        await expect(readBootstrapExpectation(pin, {
          ...input, snapshot: { ...snapshot, capturedAt: '2026-11-09T00:00:00.000Z' },
        }, roots)).rejects.toThrow(rejected);
        await expect(readBootstrapExpectation(pin, {
          ...input, registration: { ...registration, artifactHash: '0'.repeat(64) },
        }, roots)).rejects.toThrow(rejected);

        const subject = review.subjects[0]!;
        const mismatchedFact = producer.contracts.find(fact => fact.sourceAccountId !== identity.sourceAccountId)!;
        const foreignCitation = evidence.resolvedSupport.find(row => row.factId === mismatchedFact.id)!.evidenceId;
        for (const mutation of [
          { ...subject, customerEvidenceRefs: [foreignCitation] },
          { ...subject, terms: [{ ...subject.terms[0]!, factId: mismatchedFact.id }] },
          { ...subject, profileHash: '0'.repeat(64) },
        ]) {
          await expect(pinBootstrapExpectation({ ...review, subjects: [mutation] }, input, roots)).rejects.toThrow(rejected);
        }
        await expect(pinBootstrapExpectation({ ...review, evidencePin: {
          ...review.evidencePin, bundleHash: '0'.repeat(64),
        } }, input, roots)).rejects.toThrow(rejected);
        await expect(pinBootstrapExpectation({ ...review, subjects: [{
          ...subject, terms: [{ ...subject.terms[0]!, evidenceRefs: [foreignCitation] }],
        }] }, input, roots)).rejects.toThrow(rejected);
        await expect(pinBootstrapExpectation(review, input, { ...roots, servedRoots: [roots.sidecarRoot] })).rejects.toThrow(rejected);

        const symlinkRoot = join(directory, 'linked-bootstrap');
        if (company === 'a') await symlink(roots.sidecarRoot, symlinkRoot);
        await expect(readBootstrapExpectation(pin, input, { ...roots, sidecarRoot: symlinkRoot })).rejects.toThrow(rejected);

        const nextProfile = signProfile({
          ...profile, version: profile.version + 1, bootstrap: {
            ...profile.bootstrap!, billingConfigurationIds: [{ termId: profile.contractTerms[0]!.id, id: 'revised-config' }],
          },
        });
        const next = compile(spec, [nextProfile]);
        if (!next.ok) throw new Error('Revised construction subject failed to compile');
        await registry.registerCandidate({ spec, profiles: [nextProfile], artifact: next.value, manifest, snapshot });
        const revised = {
          ...review, subjects: [{
            ...subject, profileHash: nextProfile.hash, terms: [{ ...subject.terms[0]!, configurationId: 'revised-config' }],
          }],
        };
        const publishRevised = (fixtureSetVersion: string) => prepareBootstrapVerification(registry, service, {
          artifactHash: next.value.hash, manifestId: manifest.id, review: { ...revised, fixtureSetVersion },
        }, roots);
        await expect(publishRevised(review.fixtureSetVersion)).rejects.toThrow(rejected);
        const revisedPin = await publishRevised('bootstrap-v2');
        expect(revisedPin.hash).not.toBe(pin.hash);
        await expect(readBootstrapExpectation(pin, {
          ...input, artifact: next.value, profiles: [nextProfile],
          registration: { ...registration, artifactHash: next.value.hash },
        }, roots)).rejects.toThrow(rejected);

        for (const changes of [
          { bootstrap: { ...profile.bootstrap!, customer: { ...profile.bootstrap!.customer, displayName: 'Wrong review name' } } },
          { contractTerms: [{ ...profile.contractTerms[0]!, fixedMonthlyFeeCents: profile.contractTerms[0]!.fixedMonthlyFeeCents + 1 }] },
          { bootstrap: { ...profile.bootstrap!, billingConfigurationIds: [{ id: 'wrong-config', termId: profile.contractTerms[0]!.id }] } },
          { scope: { ...profile.scope, accountId: 'wrong-account' } },
        ]) {
          const changed = signProfile({ ...profile, ...changes });
          const rebuilt = compile(spec, [changed]);
          if (!rebuilt.ok) throw new Error('Self-consistent subject mutation did not compile');
          const changedArtifact = rebuilt.value;
          await expect(pinBootstrapExpectation({
            ...review, fixtureSetVersion: 'mutation-test', subjects: [{ ...subject, profileHash: changed.hash, scope: changed.scope }],
          }, {
            ...input, artifact: changedArtifact, profiles: [changed],
            registration: { ...registration, artifactHash: changedArtifact.hash },
          }, roots)).rejects.toThrow(rejected);
        }
        if (company === 'a') {
          const amendedIdentity = producer.identities.find(item => producer.contracts.filter(fact =>
            fact.sourceAccountId === item.sourceAccountId).length === 2)!;
          const citations = (factId: string) => [...new Set(evidence.resolvedSupport.filter(row =>
            row.factId === factId).map(row => row.evidenceId))].sort();
          const facts = producer.contracts.filter(fact => fact.sourceAccountId === amendedIdentity.sourceAccountId)
            .sort((a, b) => a.validFrom < b.validFrom ? -1 : 1);
          const amended = {
            ...subject, scope: { ...subject.scope, accountId: evidence.demoBindings.find(row =>
              row.identityFactId === amendedIdentity.id)!.accountId },
            identityFactId: amendedIdentity.id, customerId: amendedIdentity.buyerId, customerEvidenceRefs: citations(amendedIdentity.id),
            terms: facts.map((fact, i) => ({
              factId: fact.id, termId: 'term-' + i, configurationId: 'config-' + (1 - i), evidenceRefs: citations(fact.id),
            })),
          };
          const supported = resolveBootstrapSubject(validated.descriptor, validated.evidence, manifest, amended);
          expect(supported.terms.map(item => item.endProvenance)).toEqual(['observed-amendment', 'derived-terminal']);
          expect(supported.terms[1]!.term.validToExclusive).toBeNull();
          expect(amended.terms.map(item => item.evidenceRefs.length)).toEqual([2, 2]);
          expect(() => resolveBootstrapSubject(validated.descriptor, validated.evidence, manifest, {
            ...amended, terms: [amended.terms[0]!, { ...amended.terms[1]!, evidenceRefs: [amended.terms[1]!.evidenceRefs[0]!] }],
          })).toThrow(rejected);
        }
        expect(await readFile(sidecar).then(hashBytes)).toBe(hashBytes(Buffer.from(originalBytes)));
        expect(await readFile(existingPin).then(hashBytes)).toBe(hashBytes(v2Bytes));
        process.stdout.write('bootstrap-v1 ' + company + ' sidecar=' + pin.hash + ' capture=' + snapshot.contentHash + '\n');
      }
    } finally {
      await db.end();
      await dropTest(namespace);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
