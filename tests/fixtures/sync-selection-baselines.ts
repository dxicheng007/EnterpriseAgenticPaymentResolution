import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { readStoredActivation } from '@eapr/parent/activation-store';
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
const nextCutover = '2026-10-02T00:00:00.000Z';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const source = { companyId: 'company-a', sourceRef: 'legacy-a', sellerEntityId: 'seller-a' } as const;
const peers = [
  {
    label: 'old', sourceAccountId: 'sync-base-old', accountId: 'company-a.seller-a.sync-base-old',
    buyerId: 'sync-base-buyer-old', legalName: 'Baseline Old', contractId: 'sync-base-contract-old',
    documentId: 'doc-sync-base-old', filename: 'contract-1.pdf', recordId: 'sync-base-invoice-old',
    eventId: 'evt:sync-base-invoice-old', sequence: 1, specId: 'sync-base-spec-old',
    profileId: 'sync-base-profile-old', approvalKey: 'sync-base-approve-old',
    bootstrapVersion: 'bootstrap-baselines-old-v1',
    manifestId: 'manifest-sync-baselines-old-v1', fixtureSetId: 'truth-sync-baselines-old-v1',
    asOf: cutover, epoch: 1, financeCursor: '2',
  },
  {
    label: 'new', sourceAccountId: 'sync-base-new', accountId: 'company-a.seller-a.sync-base-new',
    buyerId: 'sync-base-buyer-new', legalName: 'Baseline New', contractId: 'sync-base-contract-new',
    documentId: 'doc-sync-base-new', filename: 'contract-2.pdf', recordId: 'sync-base-invoice-new',
    eventId: 'evt:sync-base-invoice-new', sequence: 2, specId: 'sync-base-spec-new',
    profileId: 'sync-base-profile-new', approvalKey: 'sync-base-approve-new',
    bootstrapVersion: 'bootstrap-baselines-new-v1',
    manifestId: 'manifest-sync-baselines-new-v1', fixtureSetId: 'truth-sync-baselines-new-v1',
    asOf: nextCutover, epoch: 2, financeCursor: '3',
  },
] as const;
type Peer = typeof peers[number];
type Roots = { visibleRoot: string; truthRoot: string };
type Support = ProducerV1['identities'][number]['support'][number];

const scopeFor = ({ accountId }: Peer): Scope => ({ companyId: source.companyId, sellerEntityId: source.sellerEntityId, accountId });
const ordered = <T>(values: readonly T[], key: (item: T) => string) =>
  values.toSorted((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
const writeOptions = { flag: 'wx', mode: 0o600 } as const;

async function authorOriginals(roots: Roots) {
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
    return { event, path: 'api-a/' + hashCanonical(event.id) + '.json', bytes: canonicalJson(raw) };
  });
  const windowRaw = {
    account: 'sync-base-old', amount: '100.00', effective_date: '2026-10-01', id: 'sync-base-window-pay', version: 1,
  };
  const windowEvent = eventA({
    kind: 'payment', sourceAccountId: 'sync-base-old', recordId: 'sync-base-window-pay',
    effectiveDate: '2026-10-01', fields: windowRaw,
  }, 3, nextCutover);
  const generatorPaths = [
    'package-lock.json', 'packages/sources/src/canonical-fixtures.ts',
    'packages/sources/src/company-a.ts', 'tests/fixtures/sync-selection-baselines.ts',
    'tests/fixtures/sync-selection-enrollment.ts',
    'tests/fixtures/sync-selection-reviewer.ts',
  ].toSorted();
  const buildHash = hashCanonical(await Promise.all(generatorPaths.map(async path => ({
    path, sha256: hashBytes(await readFile(join(repositoryRoot, path))),
  }))));
  const inputFiles = new Map<string, Uint8Array | string>();
  for (const baseline of peers) {
    const { label, asOf, epoch, manifestId, fixtureSetId } = baseline;
    const visibleRoot = join(roots.visibleRoot, label);
    const truthRoot = join(roots.truthRoot, label);
    const members = label === 'old' ? originals : [...originals, {
      event: windowEvent, path: 'api-a/' + hashCanonical(windowEvent.id) + '.json', bytes: canonicalJson(windowRaw),
    }];
    const events = RawSourceEventSchema.array().parse(members.map(({ event }) => event));
    const manifestFields = {
      companyId: source.companyId, sourceRef: source.sourceRef, id: manifestId, epoch, asOf,
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
    const binding = {
      ...source, fixtureSetId, manifestId, manifestHash: manifest.hash, generator: { seed: 'sync-baselines-v1', buildHash },
    };
    const truth: Omit<ProtectedFixtureSet, 'hash'> = {
      ...binding, schemaVersion: 1, fixtureSetVersion: '1', purpose: 'construction', asOf,
      inputEvents: ordered(events.map(({ id, contentHash }) => ({ id, contentHash })), event => event.id),
      accounts: ordered(peers.map(({ sourceAccountId, recordId, eventId }) => {
        const records: ProtectedFixtureSet['accounts'][number]['records'] = [{
          kind: 'invoice', recordId, sourceEventId: eventId, sourceRecordVersion: 1,
          amountCents: 300000, currency: 'USD', effectiveAt: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30',
        }];
        if (label === 'new' && sourceAccountId === 'sync-base-old') {
          records.push({
            kind: 'payment', recordId: 'sync-base-window-pay', sourceEventId: 'evt:sync-base-window-pay',
            sourceRecordVersion: 1, amountCents: 10000, currency: 'USD', effectiveAt: '2026-10-01T00:00:00.000Z',
          });
        }
        return { sourceAccountId, balanceAnchorCents: 300000, records };
      }), account => account.sourceAccountId),
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
      .parse(members.map(({ event, path }) => ({ eventId: event.id, path })));
    const files: [string, Uint8Array | string][] = [
      ...documents.map(({ upload, bytes }): [string, Uint8Array] => [join(visibleRoot, upload.path), bytes]),
      ...members.map(({ path, bytes }): [string, string] => [join(visibleRoot, path), bytes]),
      [join(visibleRoot, 'api-a.json'), canonicalJson(events)],
      [join(visibleRoot, 'api-originals-a.json'), canonicalJson(originalsIndex)],
      [join(visibleRoot, 'manifest-a.json'), canonicalJson(manifest)],
      [join(visibleRoot, 'uploads-a.json'), canonicalJson(uploads)],
      [join(truthRoot, 'expected-a.json'), truthJson],
      [join(truthRoot, 'evidence-a.json'), producerJson],
    ];
    for (const [path, contents] of files) inputFiles.set(path, contents);
  }
  for (const directory of new Set([...inputFiles.keys()].map(dirname))) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  const digests = new Map<string, { hash: string; length: number }>();
  for (const [path, content] of inputFiles) {
    const bytes = typeof content === 'string' ? Buffer.from(content) : content;
    await writeFile(path, bytes, writeOptions);
    digests.set(path, { hash: hashBytes(bytes), length: bytes.length });
  }
  return async () => {
    for (const [path, digest] of digests) {
      const bytes = await readFile(path);
      assert.deepEqual({ hash: hashBytes(bytes), length: bytes.length }, digest, 'Authored input changed after publication');
    }
  };
}

async function assertImport(db: Pool, peer: Peer, citation: string, { stored }: SelectionSubject) {
  const scope = scopeFor(peer);
  const { approvedTarget: target, receipt } = stored;
  const identity = {
    sourceRef: 'legacy-a', sellerEntityId: 'seller-a', kind: 'invoice' as const, recordId: peer.recordId,
  };
  const recordId = targetRecordId(identity);
  const evidenceRefs = [citation];
  assert.deepEqual(target.records, {
    scope, version: 1, asOf: peer.asOf,
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


export async function createSyncSelectionBaselinesFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [SelectionSubject, SelectionSubject];
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}> {
  const { db, roots, dependencies, candidates, bootstrapRoots, prove, openReviewer, close } =
    await createSelectionEnrollment();
  try {
    const assertInputsUnchanged = await authorOriginals(roots);
    async function captureAndRegister(peer: Peer) {
      const { input, source: definition } = await captureEvidenceFixture(dependencies, {
        visibleRoot: join(roots.visibleRoot, peer.label), truthRoot: join(roots.truthRoot, peer.label),
      }, 'a');
      const { manifest, snapshot, events } = input;
      assert.equal(manifest.id, peer.manifestId);
      const member = manifest.files.find(file => file.documentId === peer.documentId);
      const citation = input.citations.find(({ evidence }) => evidence.sourceId === member?.fileId &&
        evidence.locator.kind === 'pdf' && evidence.locator.page === 1);
      assert(member && citation, 'Missing captured page-one agreement for ' + peer.label);
      const built = buildDemoCandidate({
        source: definition, capture: { companyId: definition.companyId, manifestId: manifest.id, contractFileId: member.fileId },
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
      const selection = { artifactHash: artifact.hash, manifestId: manifest.id, selectedProfileHash: profile.hash };
      await pinProtectedEvidenceFixture(input, pathToFileURL(bootstrapRoots.evidencePinRoot + '/'));
      return { peer, input, selection, profile, citationId: citation.evidence.id };
    }

    const [old, newer] = peers;
    const oldCapture = await captureAndRegister(old);
    const newCapture = await captureAndRegister(newer);
    assert.notEqual(oldCapture.input.manifest.hash, newCapture.input.manifest.hash);
    assert.equal(oldCapture.input.events.length, 2);
    assert.equal(newCapture.input.events.length, 3);
    for (const event of oldCapture.input.events) {
      const repeated = newCapture.input.events.find(item => item.id === event.id);
      assert(repeated && canonicalJson(repeated) === canonicalJson(event), 'Captured event prefix changed');
    }
    assert.equal(oldCapture.input.originals.length, 4);
    assert.equal(newCapture.input.originals.length, 5);
    for (const original of oldCapture.input.originals) {
      const repeated = newCapture.input.originals.find(item => item.sourceId === original.sourceId);
      assert(repeated && canonicalJson(repeated) === canonicalJson(original), 'Captured original prefix changed');
    }

    function proveBaseline({ peer, input, selection, profile, citationId }: typeof oldCapture) {
      const producer = decodeEvidenceProducer(input.producerJson);
      const identity = producer.identities.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      const term = producer.contracts.find(fact => fact.sourceAccountId === peer.sourceAccountId);
      assert(identity && term && profile.bootstrap, 'Missing captured reviewed facts for ' + peer.label);
      return prove({
        selection, jobId: 'sync-baselines-financial:' + peer.label + ':' + randomUUID(),
        review: {
          fixtureSetId: peer.fixtureSetId, fixtureSetVersion: peer.bootstrapVersion,
          subjects: [{
            profileHash: profile.hash, profileId: profile.id, scope: profile.scope, identityFactId: identity.id,
            customerId: identity.buyerId, customerEvidenceRefs: [citationId],
            terms: profile.bootstrap.billingConfigurationIds.map(({ termId, id }) => ({
              factId: term.id, termId, configurationId: id, evidenceRefs: [citationId],
            })),
          }],
        },
      });
    }

    const proofs = [await proveBaseline(oldCapture), await proveBaseline(newCapture)] as const;
    const reviewer = await openReviewer({ policyId: 'sync-baselines-policy-v1', proofs });
    const one = await reviewer.approve(proofs[0], old.approvalKey);
    await assertImport(db, old, oldCapture.citationId, one);
    await withTransaction(db, async client => {
      const scope = scopeFor(newer);
      assert.equal(await readStoredActivation(client, scope), null, 'First approval also enrolled second subject');
      assert.equal(await readStoredTarget(client, scope), null, 'First approval also imported second subject');
    });
    const two = await reviewer.approve(proofs[1], newer.approvalKey);
    await assertImport(db, newer, newCapture.citationId, two);
    await reviewer.stop();

    const runtimeCapture = createRuntimeCapture({ db, clock: dependencies.clock });
    for (const [subject, { peer, input: { manifest } }] of [[one, oldCapture], [two, newCapture]] as const) {
      const bound = await runtimeCapture.openCommitted(subject.identity);
      assert.deepEqual(bound.lane, { schemaVersion: '1', sourceRef: source.sourceRef, manifestHash: manifest.hash });
      const progress = await bound.readProgress();
      assert.deepEqual(progress.streams, [
        {
          streamId: 'a-finance', transport: 'api', baselineCursor: peer.financeCursor, captureCursor: peer.financeCursor,
          capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null,
        },
        {
          streamId: 'a-semantics', transport: 'semantic', baselineCursor: '0', captureCursor: '0',
          capturedRecords: 0, capturedPages: 0, lastCapturedAt: null, lastIncident: null,
        },
      ]);
    }
    const { rows } = await db.query('SELECT manifest_hash, initial_activation_id FROM runtime_capture_lanes ORDER BY manifest_hash');
    assert.deepEqual(rows, [one, two].map(({ identity, stored }) => ({
      manifest_hash: stored.bundle.manifest.hash, initial_activation_id: identity.activationId,
    })).sort((a, b) => a.manifest_hash.localeCompare(b.manifest_hash)));
    const { rows: [counts] } = await db.query(`SELECT
      (SELECT count(*)::int FROM runtime_deliveries) AS deliveries,
      (SELECT count(*)::int FROM runtime_source_positions) AS positions,
      (SELECT count(*)::int FROM runtime_capture_pages) AS pages,
      (SELECT count(*)::int FROM runtime_inbox) AS inbox`);
    assert.deepEqual(counts, { deliveries: 3, positions: 3, pages: 0, inbox: 0 });
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
      if (!(error instanceof Error) || !Reflect.defineProperty(error, 'cleanupError', { value: cleanupError })) {
        console.error('Distinct-baseline fixture cleanup failed while preserving the original construction error');
      }
    }
    throw error;
  }
}
