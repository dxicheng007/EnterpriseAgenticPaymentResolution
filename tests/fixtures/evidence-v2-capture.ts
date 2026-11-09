import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Pool } from 'pg';
import {
  BootstrapManifestSchema, IdSchema, RawSourceEventSchema, UploadMetadataSchema, canonicalJson, hashBytes, strict,
  type EvidenceRef, type EvidenceResponse, type RawSourceEvent,
} from '@eapr/contracts';
import {
  companyA, companyB, createSourceService, prepareApiRecord, publishManifest, readDossier, readEvidence, readEvidenceBytes,
  readManifest, sourceFileId, storeSourceUpload, type SourceDefinition, type UploadDependencies,
} from '@eapr/sources';
import { decodeEvidenceProducer, type EvidenceFixtureInput, type Original } from '../../packages/evaluator/src/evidence-fixtures.js';

const catalog = new Map([companyA, companyB].map(source => [source.companyId, source]));
const uploadsSchema = strict({ metadata: UploadMetadataSchema, path: z.string() }).array();
const originalsSchema = strict({ eventId: IdSchema, path: z.string() }).array();

async function association(db: Pool, evidence: EvidenceRef, source: SourceDefinition): Promise<Original['binding']> {
  const { rows } = await db.query<{
    file_id: string | null; api_source_id: string | null; event_id: string | null; event: RawSourceEvent | null; evidence: EvidenceRef;
  }>(`
    SELECT e.file_id, e.api_source_id, s.event_id, s.event, e.evidence
    FROM source_evidence e
    LEFT JOIN source_files f ON e.file_id = f.file_id
    LEFT JOIN source_events s ON e.api_source_id = s.api_source_id
    WHERE e.evidence_id = $1 AND e.snapshot_id = $2
      AND COALESCE(f.company_id, s.event #>> '{rawIdentity,companyId}') = $3
      AND COALESCE(f.source_ref, s.source_ref) = $4
  `, [evidence.id, evidence.snapshotId, source.companyId, source.sourceRef]);
  const row = rows[0];
  if (rows.length !== 1 || canonicalJson(row.evidence) !== canonicalJson(evidence)) throw new Error('Invalid test evidence association');
  if (row.file_id === evidence.sourceId && row.api_source_id === null && row.event_id === null) {
    return { kind: 'document', fileId: row.file_id };
  }
  if (row.api_source_id === evidence.sourceId && row.file_id === null && row.event_id && row.event?.id === row.event_id &&
    row.event.rawIdentity.sellerEntityId === source.sellerEntityId) {
    return { kind: 'api-json', eventId: row.event_id };
  }
  throw new Error('Invalid test evidence association');
}

export async function captureEvidenceFixture(
  dependencies: UploadDependencies, roots: { visibleRoot: string; truthRoot: string }, company: 'a' | 'b',
  source: SourceDefinition = company === 'a' ? companyA : companyB,
) {
  const captureCatalog = source === catalog.get(source.companyId) ? catalog : new Map([[source.companyId, source]]);
  const { db, store } = dependencies;
  const visible = (path: string) => {
    if (!path.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..')) {
      throw new Error('Invalid generated test path');
    }
    return readFile(join(roots.visibleRoot, path));
  };
  const json = async (path: string): Promise<unknown> => JSON.parse((await visible(path)).toString('utf8'));
  const generated = BootstrapManifestSchema.parse(await json('manifest-' + company + '.json'));
  const uploads = uploadsSchema.parse(await json('uploads-' + company + '.json'));
  const sourcePaths = new Map(originalsSchema.parse(await json('api-originals-' + company + '.json'))
    .map(({ eventId, path }) => [eventId, path]));
  const api = RawSourceEventSchema.array().parse(await json('api-' + company + '.json'));
  const records = await Promise.all(api.map(async event =>
    prepareApiRecord(source, store, event, await visible(sourcePaths.get(event.id)!))));
  for (const { metadata, path } of uploads.sort((a, b) => (a.metadata.batch?.sequence ?? 0) - (b.metadata.batch?.sequence ?? 0))) {
    await storeSourceUpload(dependencies, metadata, await visible(path));
  }
  await publishManifest(dependencies, captureCatalog, generated, records);
  const service = createSourceService(dependencies, captureCatalog);
  const captured = await service.captureSnapshot(generated.id);
  if (!captured.ok) throw new Error('Expected complete real test capture');
  const [manifest, dossier, snapshot] = await Promise.all([
    readManifest(db, source.companyId, generated.id), readDossier(db, source.companyId, generated.id),
    service.getSnapshot(captured.snapshot.id),
  ]);
  if (!dossier.complete || !dossier.snapshotIds.includes(snapshot.id)) throw new Error('Incomplete test evidence dossier');
  const events = await service.getSnapshotRecords(snapshot.id);
  const authorize = async (binding: { companyId: string; sourceRef: string }) => {
    if (binding.companyId !== source.companyId || binding.sourceRef !== source.sourceRef) throw new Error('Test evidence scope violation');
  };
  const originals = new Map<string, Original>();
  const citations: EvidenceResponse[] = [];
  for (const id of snapshot.evidenceIds) {
    const [response, { bytes, mediaType }] = await Promise.all([
      readEvidence(db, id, authorize), readEvidenceBytes(db, store, id, authorize),
    ]);
    if (response.evidence.snapshotId !== snapshot.id) throw new Error('Test evidence snapshot mismatch');
    const { sourceId } = response.evidence;
    const binding = await association(db, response.evidence, source);
    const sha256 = hashBytes(bytes);
    if (mediaType !== response.mediaType || sha256 !== response.original.sha256) throw new Error('Test evidence byte mismatch');
    const original = { sourceId, companyId: source.companyId, sourceRef: source.sourceRef, sha256, bytesBase64: Buffer.from(bytes).toString('base64'), binding };
    if (originals.has(sourceId) && canonicalJson(originals.get(sourceId)) !== canonicalJson(original)) throw new Error('Test original mismatch');
    originals.set(sourceId, original);
    citations.push(response);
  }
  citations.sort((a, b) => a.evidence.id < b.evidence.id ? -1 : 1);
  const [producerTruthJson, producerJson] = await Promise.all([
    readFile(join(roots.truthRoot, 'expected-' + company + '.json'), 'utf8'),
    readFile(join(roots.truthRoot, 'evidence-' + company + '.json'), 'utf8'),
  ]);
  const producer = decodeEvidenceProducer(producerJson);
  const input: EvidenceFixtureInput = {
    producerTruthJson, producerJson, manifest, snapshot, events, originals: [...originals.values()], citations,
    resolvedSupport: [...producer.identities, ...producer.contracts].flatMap(fact => fact.support.map(support => {
      const response = citations.find(({ evidence, text }) => evidence.sourceId === support.fileId &&
        text.value.slice(text.startInclusive, text.endExclusive).includes(support.expectedLiteral));
      if (!response) throw new Error('Producer support is outside captured test evidence');
      return { ...support, factId: fact.id, evidenceId: response.evidence.id };
    })),
    demoBindings: producer.identities.map(identity => ({
      identityFactId: identity.id, policy: 'generated-demo-buyer-account-v1', parentCustomerId: identity.buyerId,
      accountId: [source.companyId, source.sellerEntityId, identity.sourceAccountId].join('.'),
    })),
  };
  const firstContract = uploads.find(upload => upload.path === (company === 'a' ? 'contract-1.pdf' : 'b-contract-1.pdf'));
  if (!firstContract) throw new Error('Missing generated demo contract');
  const contractFileId = sourceFileId(firstContract.metadata);
  return { input, source, contractFileId };
}
