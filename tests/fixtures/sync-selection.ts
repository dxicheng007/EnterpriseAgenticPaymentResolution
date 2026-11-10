import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import {
  BootstrapManifestSchema, IdSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBytes,
  hashCanonical, hashManifest, hashProfile, strict, targetRecordId, type CaptureResultV1, type ChangePage,
  type CommittedAuthorityIdentityV1, type Scope,
} from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { readStoredActivation, type StoredActivation } from '@eapr/parent/activation-store';
import { readStoredTarget } from '@eapr/parent/snapshots';
import { readFinancialOrigins } from '@eapr/parent/sync-store';
import { companyA, sourceFileId, streamContentHash } from '@eapr/sources';
import { withTransaction } from '@eapr/storage/transaction';
import { z } from 'zod';
import { buildDemoCandidate } from '../../apps/control/src/demo-candidates.js';
import { createRuntimeCapture } from '../../apps/worker/src/sync/capture.js';
import { decodeEvidenceProducer, type ProducerV1 } from '../../packages/evaluator/src/evidence-fixtures.js';
import { pinProtectedEvidenceFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth, type ProtectedFixtureSet } from '../../packages/evaluator/src/fixtures.js';
import { textPdf } from '../../packages/sources/src/canonical-fixtures.js';
import { eventA } from '../../packages/sources/src/company-a.js';
import { captureEvidenceFixture } from './evidence-v2-capture.js';
import { createSelectionEnrollment, type SelectionSubject } from './sync-selection-enrollment.js';

const cutover = '2026-10-01T00:00:00.000Z';
const fixtureSetId = 'truth-sync-selection-peers-v1';
const manifestId = 'manifest-sync-selection-peers-v1';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = { companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a' } as const;
const peers = [
  {
    label: 'one', sourceAccountId: 'sync-selection-one', accountId: 'company-a.seller-a.sync-selection-one',
    buyerId: 'sync-selection-buyer-one', legalName: 'Selection One', contractId: 'sync-selection-contract-one',
    documentId: 'doc-sync-selection-one', filename: 'contract-1.pdf', recordId: 'sync-selection-invoice-one',
    eventId: 'evt:sync-selection-invoice-one', sequence: 1, specId: 'sync-selection-spec-one',
    profileId: 'sync-selection-profile-one', approvalKey: 'sync-selection-approve-one',
    bootstrapVersion: 'bootstrap-peer-one-v1',
  },
  {
    label: 'two', sourceAccountId: 'sync-selection-two', accountId: 'company-a.seller-a.sync-selection-two',
    buyerId: 'sync-selection-buyer-two', legalName: 'Selection Two', contractId: 'sync-selection-contract-two',
    documentId: 'doc-sync-selection-two', filename: 'contract-2.pdf', recordId: 'sync-selection-invoice-two',
    eventId: 'evt:sync-selection-invoice-two', sequence: 2, specId: 'sync-selection-spec-two',
    profileId: 'sync-selection-profile-two', approvalKey: 'sync-selection-approve-two',
    bootstrapVersion: 'bootstrap-peer-two-v1',
  },
] as const;
type Peer = typeof peers[number];
type Roots = { visibleRoot: string; truthRoot: string };
type Support = ProducerV1['identities'][number]['support'][number];

const scopeFor = ({ accountId }: Peer): Scope => ({ companyId: source.companyId, sellerEntityId: source.sellerEntityId, accountId });
const ordered = <T>(values: readonly T[], key: (item: T) => string) =>
  values.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const writeOptions = { flag: 'wx', mode: 0o600 } as const;

async function authorOriginals({ visibleRoot, truthRoot }: Roots) {
  const documents = await Promise.all(peers.map(async peer => {
    const { sourceAccountId, buyerId, legalName, contractId, documentId, filename } = peer;
    const title = 'Fixed monthly agreement ' + contractId;
    const parties = 'Seller seller-a; buyer ' + buyerId + '; account ' + sourceAccountId;
    const name = 'Legal name ' + legalName;
    const fee = 'Monthly fee USD 3000.00';
    const effective = 'Effective 2026-09-01; monthly invoice anchor day 1.';
    const lines = [title, parties, name, fee, effective];
    const bytes = await textPdf(lines, cutover, title);
    const metadata = UploadMetadataSchema.parse({
      companyId: source.companyId, sourceRef: source.sourceRef, documentId,
      documentVersion: 1, kind: 'contract_pdf', originalName: filename,
    });
    const fileId = sourceFileId(metadata);
    const sha256 = hashBytes(bytes);
    const support = (expectedLiteral: string, ...fields: Support['field'][]): Support[] =>
      fields.map(field => ({ field, fileId, expectedLiteral }));
    const sortSupport = (items: Support[]) => ordered(items,
      ({ field, fileId, expectedLiteral }) => canonicalJson([field, fileId, expectedLiteral]));
    const identity: ProducerV1['identities'][number] = {
      id: 'identity:' + hashCanonical({ ...source, sourceAccountId }),
      sourceAccountId, sellerEntityId: source.sellerEntityId, buyerId, legalName,
      support: sortSupport([...support(parties, 'sourceAccountId', 'sellerEntityId', 'buyerId'), ...support(name, 'legalName')]),
    };
    const term: ProducerV1['contracts'][number] = {
      id: 'term:' + hashCanonical({ ...source, sourceAccountId, contractId, validFrom: '2026-09-01' }),
      sourceAccountId, sellerEntityId: source.sellerEntityId, contractId,
      validFrom: '2026-09-01', validToExclusive: null, fixedMonthlyFeeCents: 300000,
      currency: 'USD', cadence: 'monthly', anchorDay: 1,
      support: sortSupport([
        ...support(parties, 'sourceAccountId', 'sellerEntityId'), ...support(title, 'contractId'),
        ...support(fee, 'fixedMonthlyFeeCents', 'currency'), ...support(effective, 'validFrom', 'cadence', 'anchorDay'),
      ]),
    };
    return {
      file: { fileId, documentId, documentVersion: 1, kind: 'contract_pdf' as const, sha256 },
      upload: { metadata, path: filename }, bytes, identity, term,
      evidence: { fileId, originalSha256: sha256, text: lines.join(' ') },
    };
  }));

  const originals = peers.map(({ sourceAccountId, recordId, sequence }) => {
    const raw = {
      account: sourceAccountId, amount: '3000.00', due_date: '2026-09-30',
      effective_date: '2026-09-01', id: recordId, version: 1,
    };
    const event = eventA({
      kind: 'invoice', sourceAccountId, recordId, effectiveDate: raw.effective_date, fields: raw,
    }, sequence, cutover);
    return { event, path: 'api-a/' + hashCanonical(event.id) + '.json', raw };
  });
  const events = RawSourceEventSchema.array().parse(originals.map(({ event }) => event));
  const manifestFields = {
    companyId: source.companyId, sourceRef: source.sourceRef, id: manifestId, epoch: 1, asOf: cutover,
    schemaVersions: Object.fromEntries(companyA.contracts.map(({ resource, schemaVersion }) => [resource, schemaVersion])),
    semanticVersions: Object.fromEntries(peers.map(({ sourceAccountId }) => ['seller-a/' + sourceAccountId, 'sem-a-1'])),
    files: documents.map(({ file }) => file),
    streams: companyA.streams.map(({ streamId }) => {
      const members = events.filter(event => event.streamId === streamId);
      const resumeAfter = String(members.length);
      return {
        streamId, resumeAfter, snapshotId: 'member:' + manifestId + ':' + streamId,
        eventIds: members.map(event => event.id), snapshotHash: streamContentHash(source.sourceRef, streamId, resumeAfter, members),
      };
    }),
  };
  const manifest = BootstrapManifestSchema.parse({ ...manifestFields, hash: hashManifest(manifestFields) });
  const generatorPaths = [
    'package-lock.json', 'packages/sources/src/canonical-fixtures.ts',
    'packages/sources/src/company-a.ts', 'tests/fixtures/sync-selection.ts',
    'tests/fixtures/sync-selection-enrollment.ts',
    'tests/fixtures/sync-selection-reviewer.ts',
  ].toSorted();
  const buildHash = hashCanonical(await Promise.all(generatorPaths.map(async path => ({
    path, sha256: hashBytes(await readFile(join(repositoryRoot, path))),
  }))));
  const binding = {
    ...source, fixtureSetId, manifestId, manifestHash: manifest.hash, generator: { seed: 'sync-selection-peers-v1', buildHash },
  };
  const truth: Omit<ProtectedFixtureSet, 'hash'> = {
    ...binding, schemaVersion: 1, fixtureSetVersion: '1', purpose: 'construction', asOf: cutover,
    inputEvents: ordered(events.map(({ id, contentHash }) => ({ id, contentHash })), event => event.id),
    accounts: ordered(peers.map(({ sourceAccountId, recordId, eventId }) => ({
      sourceAccountId, balanceAnchorCents: 300000,
      records: [{
        kind: 'invoice' as const, recordId, sourceEventId: eventId, sourceRecordVersion: 1,
        amountCents: 300000, currency: 'USD' as const, effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
      }],
    })), account => account.sourceAccountId),
    evidence: ordered(documents.map(({ evidence }) => evidence), evidence => evidence.fileId),
  };
  const truthJson = canonicalJson({ ...truth, hash: hashCanonical(truth) });
  const producer: Omit<ProducerV1, 'hash'> = {
    ...binding, schemaVersion: 1, kind: 'evidence-facts', producerFixtureSetVersion: '1',
    producerTruthHash: decodeTruth(truthJson).hash,
    identities: ordered(documents.map(({ identity }) => identity), identity => identity.id),
    contracts: ordered(documents.map(({ term }) => term), term => term.id),
  };
  const producerJson = canonicalJson({ ...producer, hash: hashCanonical(producer) });
  decodeEvidenceProducer(producerJson);
  const uploads = strict({ metadata: UploadMetadataSchema, path: z.string() }).array()
    .parse(documents.map(({ upload }) => upload));
  const originalsIndex = strict({ eventId: IdSchema, path: z.string() }).array()
    .parse(originals.map(({ event, path }) => ({ eventId: event.id, path })));
  const inputFiles = new Map<string, Uint8Array | string>([
    ...documents.map(({ upload, bytes }): [string, Uint8Array] => [join(visibleRoot, upload.path), bytes]),
    ...originals.map(({ path, raw }): [string, string] => [join(visibleRoot, path), canonicalJson(raw)]),
    [join(visibleRoot, 'api-a.json'), canonicalJson(events)],
    [join(visibleRoot, 'api-originals-a.json'), canonicalJson(originalsIndex)],
    [join(visibleRoot, 'manifest-a.json'), canonicalJson(manifest)],
    [join(visibleRoot, 'uploads-a.json'), canonicalJson(uploads)],
    [join(truthRoot, 'expected-a.json'), truthJson],
    [join(truthRoot, 'evidence-a.json'), producerJson],
  ]);
  for (const directory of new Set([...inputFiles.keys()].map(dirname))) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const digests = new Map<string, string>();
  for (const [path, content] of inputFiles) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;
    await writeFile(path, bytes, writeOptions);
    digests.set(path, hashBytes(await readFile(path)));
  }
  return async () => {
    for (const [path, digest] of digests) {
      assert.equal(hashBytes(await readFile(path)), digest, 'Original or private expectation changed after publication');
    }
  };
}

export async function createSyncSelectionFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
  ];
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}> {
  const { db, roots, dependencies, candidates, bootstrapRoots, prove, openReviewer, close } =
    await createSelectionEnrollment();
  try {
    const assertInputsUnchanged = await authorOriginals(roots);
    const captured = await captureEvidenceFixture(dependencies, roots, 'a');
    const { input, source: definition } = captured;
    const { manifest, snapshot, events } = input;
    const producer = decodeEvidenceProducer(input.producerJson);

    async function register(peer: Peer) {
      const member = manifest.files.find(file => file.documentId === peer.documentId);
      const citation = input.citations.find(({ evidence }) => evidence.sourceId === member?.fileId &&
        evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
      assert(member && citation, 'Missing captured page-one agreement for ' + peer.label);
      const built = buildDemoCandidate({
        source: definition, capture: { companyId: definition.companyId, manifestId, contractFileId: member.fileId },
        manifest, snapshot, events, citation,
      });
      assert('candidate' in built, 'Candidate construction failed for ' + peer.label);
      const draft = built.candidate.request;
      const spec = { ...draft.spec, id: peer.specId };
      const profileInput = { ...draft.profiles[0]!, id: peer.profileId };
      const profile = { ...profileInput, hash: hashProfile(profileInput) };
      const compiled = compile(spec, [profile]);
      assert(compiled.ok && profile.bootstrap, 'Compilation failed for ' + peer.label);
      assert.deepEqual(profile.scope, scopeFor(peer));
      const artifact = compiled.value;
      await candidates.registerCandidate({ spec, profiles: [profile], artifact, manifest, snapshot });
      const selection = { artifactHash: artifact.hash, manifestId, selectedProfileHash: profile.hash };
      return { peer, selection, profile, citation: citation.evidence.id };
    }
    const registered = [await register(peers[0]), await register(peers[1])] as const;

    await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
    function provePeer({ peer, selection, profile, citation }: typeof registered[number]) {
      const identity = producer.identities.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      const term = producer.contracts.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      assert(identity && term && profile.bootstrap, 'Missing captured reviewed facts for ' + peer.label);
      return prove({
        selection, jobId: 'sync-selection-financial:' + peer.label,
        review: {
          fixtureSetId, fixtureSetVersion: peer.bootstrapVersion,
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citation],
            terms: profile.bootstrap.billingConfigurationIds.map(({ termId, id }) => ({
              factId: term.id, termId, configurationId: id, evidenceRefs: [citation],
            })),
          }],
        },
      });
    }
    const proofs = [await provePeer(registered[0]), await provePeer(registered[1])] as const;
    const reviewer = await openReviewer({ policyId: 'sync-selection-peer-policy-v1', proofs });

    async function assertImport(peer: Peer, citation: string, { stored }: SelectionSubject) {
      const scope = scopeFor(peer);
      const { approvedTarget: target, receipt } = stored;
      const identity = {
        sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: peer.recordId,
      };
      const recordId = targetRecordId(identity);
      const evidenceRefs = [citation];
      assert.deepEqual(target.records, {
        scope, version: 1, asOf: cutover,
        invoices: [{
          id: recordId, identity, scope, kind: 'invoice', sourceEventId: peer.eventId, sourceRecordVersion: 1,
          amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
        }],
        payments: [], credits: [], allocations: [], reversals: [],
        customers: [{ id: peer.buyerId, displayName: peer.legalName, evidenceRefs }],
        accounts: [{
          id: peer.accountId, scope, parentCustomerId: peer.buyerId, sourceRef: 'legacy-a',
          sourceAccountIds: [peer.sourceAccountId],
        }],
        billingConfigurations: [{
          id: 'configuration:demo-term-a', scope, contractTerm: {
            id: 'demo-term-a', contractId: peer.contractId, validFrom: '2026-09-01', validToExclusive: null,
            fixedMonthlyFeeCents: 300000, currency: 'USD', cadence: 'monthly', anchorDay: 1, evidenceRefs,
          },
        }],
      });
      assert.deepEqual(receipt.eventIds, [peer.eventId]);
      assert.deepEqual(receipt.targetRecordIds, [recordId]);
      assert.equal(receipt.beforeBalanceCents, 0);
      assert.equal(receipt.afterBalanceCents, 300000);
      await withTransaction(db, async client => {
        assert.deepEqual(await readFinancialOrigins(client, scope, target.records.invoices), [{
          kind: 'initial', recordId, importKey: peer.approvalKey, receipt,
        }]);
      });
    }

    const one = await reviewer.approve(proofs[0], peers[0].approvalKey);
    await assertImport(peers[0], registered[0].citation, one);
    await withTransaction(db, async client => {
      const scope = scopeFor(peers[1]);
      assert.equal(await readStoredActivation(client, scope), null, 'First approval also enrolled second subject');
      assert.equal(await readStoredTarget(client, scope), null, 'First approval also imported second subject');
    });
    const two = await reviewer.approve(proofs[1], peers[1].approvalKey);
    await assertImport(peers[1], registered[1].citation, two);
    await reviewer.stop();

    const runtimeCapture = createRuntimeCapture({ db, clock: dependencies.clock });
    for (const subject of [one, two]) {
      const bound = await runtimeCapture.openCommitted(subject.identity);
      assert.deepEqual(bound.lane, { schemaVersion: '1', sourceRef: source.sourceRef, manifestHash: manifest.hash });
      const progress = await bound.readProgress();
      assert.deepEqual(progress.streams.map(({ streamId, baselineCursor, captureCursor, capturedRecords, capturedPages }) =>
        ({ streamId, baselineCursor, captureCursor, capturedRecords, capturedPages })), [
        { streamId: 'a-finance', baselineCursor: '2', captureCursor: '2', capturedRecords: 0, capturedPages: 0 },
        { streamId: 'a-semantics', baselineCursor: '0', captureCursor: '0', capturedRecords: 0, capturedPages: 0 },
      ]);
    }
    const { rows } = await db.query('SELECT initial_activation_id FROM runtime_capture_lanes');
    assert.deepEqual(rows, [{ initial_activation_id: one.identity.activationId }]);
    await assertInputsUnchanged();
    return {
      db, close, subjects: [one, two],
      async capture(identity, page) {
        const bound = await runtimeCapture.openCommitted(identity);
        return bound.capturePage(page);
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      try {
        if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
          console.error('Same-feed fixture cleanup failed while preserving the original construction error');
        }
      } catch {
        console.error('Same-feed fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
