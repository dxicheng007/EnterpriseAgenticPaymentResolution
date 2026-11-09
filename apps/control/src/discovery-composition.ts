import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import {
  BootstrapManifestSchema, EvidenceRefSchema, RawSourceEventSchema, SourceDossierSchema, SourceSnapshotSchema,
  hashCanonical, hashEvent, hashManifest, type Id, type RawSourceEvent,
} from '@eapr/contracts';
import type { EvidenceStore } from '@eapr/evidence';
import { createDiscoveryReadTools, readDiscoveryCapture, streamContentHash, type SourceDefinition, type UploadDependencies } from '@eapr/sources';
import {
  assertConstructionCapture, type CompileRegisterCandidate, type ConstructionCapture,
  type ReplayGetArtifact,
} from '../../../packages/discovery/src/compilation.js';
import type { ModelClient } from '../../../packages/discovery/src/model.js';
import { discoveryError } from '../../../packages/discovery/src/repository.js';
import { createDiscoveryService } from '../../../packages/discovery/src/service.js';
import type { CaptureFacts } from '../../../packages/discovery/src/tasks.js';
import { readDiscoveryCaptureContents } from '../../../packages/sources/src/discovery-reads.js';
import { aggregateHash, readSnapshot } from '../../../packages/sources/src/dossier.js';
import type { createLocalSessionService } from './local-session.js';
import { mountDiscovery } from './routes/discovery.js';
import { mountDiscoveryEvents } from './routes/events.js';

const equalIds = (left: readonly Id[], right: readonly Id[]) =>
  left.length === right.length && hashCanonical([...left].sort()) === hashCanonical([...right].sort());

export async function recheckDiscoveryCapture(client: PoolClient, facts: CaptureFacts) {
  const { binding, evidenceIds, sourceAccounts } = facts;
  const { companyId, sourceRef, manifestId, snapshotId, manifestHash, snapshotHash } = binding;
  const { rows: [manifestRow] } = await client.query<{
    manifest_id: Id; company_id: Id; source_ref: Id; epoch: string; manifest: unknown;
  }>('SELECT manifest_id, company_id, source_ref, epoch, manifest FROM source_manifests WHERE manifest_id=$1', [manifestId]);
  const manifestResult = BootstrapManifestSchema.safeParse(manifestRow?.manifest);
  if (!manifestResult.success) throw discoveryError(409);
  const manifest = manifestResult.data;
  if (manifestRow.manifest_id !== manifestId || manifestRow.company_id !== companyId ||
      manifestRow.source_ref !== sourceRef || manifestRow.epoch !== String(manifest.epoch) ||
      manifest.id !== manifestId || manifest.companyId !== companyId || manifest.sourceRef !== sourceRef ||
      manifest.hash !== manifestHash || hashManifest(manifest) !== manifestHash) throw discoveryError(409);

  const { rows: [snapshotRow] } = await client.query<{
    snapshot_id: Id; manifest_id: Id; stream_id: Id | null; snapshot: unknown;
  }>('SELECT snapshot_id, manifest_id, stream_id, snapshot FROM source_snapshots WHERE snapshot_id=$1', [snapshotId]);
  const snapshotResult = SourceSnapshotSchema.safeParse(snapshotRow?.snapshot);
  if (!snapshotResult.success) throw discoveryError(409);
  const snapshot = snapshotResult.data;
  if (snapshotRow.snapshot_id !== snapshotId || snapshotRow.manifest_id !== manifestId || snapshotRow.stream_id !== null ||
      snapshot.id !== snapshotId || snapshot.manifestId !== manifestId || snapshot.sourceRef !== sourceRef ||
      snapshot.contentHash !== snapshotHash || !equalIds(snapshot.evidenceIds, evidenceIds) ||
      aggregateHash(manifest, snapshot.eventIds, snapshot.evidenceIds) !== snapshotHash) throw discoveryError(409);

  const { rows: [dossierRow] } = await client.query<{ manifest_id: Id; dossier: unknown }>(
    'SELECT manifest_id, dossier FROM source_dossiers WHERE manifest_id=$1 FOR SHARE', [manifestId]);
  const dossierResult = SourceDossierSchema.safeParse(dossierRow?.dossier);
  if (!dossierResult.success) throw discoveryError(409);
  const dossier = dossierResult.data;
  if (dossierRow.manifest_id !== manifestId || dossier.companyId !== companyId || dossier.manifestId !== manifestId ||
      !dossier.complete || dossier.missingMembers.length || dossier.diagnostics.some(diagnostic => diagnostic.severity === 'blocker') ||
      !equalIds(dossier.snapshotIds, [snapshotId]) || !equalIds(dossier.evidenceIds, evidenceIds)) throw discoveryError(409);

  const { rows: events } = await client.query<{
    source_ref: Id; stream_id: Id; sequence: string; event_id: Id; content_hash: string; event: unknown;
    api_source_id: Id | null; api_original_hash: string | null; api_byte_length: number | null; api_extraction: unknown;
  }>(`SELECT source_ref, stream_id, sequence, event_id, content_hash, event,
      api_source_id, api_original_hash, api_byte_length, api_extraction
    FROM source_events WHERE source_ref=$1 AND event_id=ANY($2) ORDER BY event_id`, [sourceRef, snapshot.eventIds]);
  if (!equalIds(events.map(event => event.event_id), snapshot.eventIds)) throw discoveryError(409);
  const streams = new Map(manifest.streams.map(stream => [stream.streamId, [] as RawSourceEvent[]]));
  const accountKeys = new Set<string>();
  const apiHashes = new Map<Id, string>();
  for (const row of events) {
    const parsed = RawSourceEventSchema.safeParse(row.event);
    if (!parsed.success) throw discoveryError(409);
    const event = parsed.data;
    if (row.source_ref !== sourceRef || event.sourceRef !== sourceRef || event.streamId !== row.stream_id ||
        !streams.has(row.stream_id) || event.id !== row.event_id || String(event.sequence) !== row.sequence ||
        event.rawIdentity.companyId !== companyId || row.content_hash !== event.contentHash ||
        hashEvent(event) !== row.content_hash) throw discoveryError(409);
    streams.get(event.streamId)!.push(event);
    const { sellerEntityId, sourceAccountId } = event.rawIdentity;
    if (sellerEntityId !== undefined && sourceAccountId !== undefined) {
      accountKeys.add(JSON.stringify([sellerEntityId, sourceAccountId]));
    }
    if (row.api_source_id && row.api_original_hash) apiHashes.set(row.api_source_id, row.api_original_hash);
  }
  for (const { streamId, resumeAfter, eventIds, snapshotHash: streamHash } of manifest.streams) {
    const members = streams.get(streamId)!.sort((left, right) => left.sequence - right.sequence);
    if (members.length !== Number(resumeAfter) || !equalIds(members.map(event => event.id), eventIds) ||
        members.some((event, index) => event.sequence !== index + 1) ||
        streamContentHash(sourceRef, streamId, resumeAfter, members) !== streamHash) throw discoveryError(409);
  }
  if (!equalIds([...accountKeys], sourceAccounts.map(account =>
    JSON.stringify([account.sellerEntityId, account.sourceAccountId])))) throw discoveryError(409);

  const { rows: citations } = await client.query<{
    evidence_id: Id; snapshot_id: Id; file_id: Id | null; api_source_id: Id | null; evidence: unknown;
  }>(`SELECT evidence_id, snapshot_id, file_id, api_source_id, evidence FROM source_evidence
    WHERE snapshot_id=$1 OR evidence_id=ANY($2) ORDER BY evidence_id`, [snapshotId, evidenceIds]);
  if (!equalIds(citations.map(citation => citation.evidence_id), evidenceIds)) throw discoveryError(409);
  const files = new Map(manifest.files.map(file => [file.fileId, file.sha256]));
  for (const row of citations) {
    const parsed = EvidenceRefSchema.safeParse(row.evidence);
    if (!parsed.success) throw discoveryError(409);
    const citation = parsed.data;
    if (row.snapshot_id !== snapshotId || citation.snapshotId !== snapshotId || citation.id !== row.evidence_id ||
        citation.id !== 'ev:' + hashCanonical({ snapshotId, sourceId: citation.sourceId, locator: citation.locator })) {
      throw discoveryError(409);
    }
    if (files.has(citation.sourceId)) {
      if (row.file_id !== citation.sourceId || row.api_source_id !== null ||
          files.get(citation.sourceId) !== citation.sha256) throw discoveryError(409);
    } else if (row.api_source_id !== citation.sourceId || row.file_id !== null ||
        apiHashes.get(citation.sourceId) !== citation.sha256) throw discoveryError(409);
  }
}

async function readConstructionCapture(
  dependencies: { db: Pool; store: Pick<EvidenceStore, 'get'> },
  catalog: ReadonlyMap<Id, SourceDefinition>,
  selection: { companyId: Id; manifestId: Id },
): Promise<ConstructionCapture> {
  const contents = await readDiscoveryCaptureContents(dependencies, catalog, selection);
  const snapshot = await readSnapshot(dependencies.db, contents.facts.binding.snapshotId);
  const capture = {
    facts: contents.facts,
    manifest: contents.manifest,
    snapshot,
    events: contents.events,
  };
  assertConstructionCapture(capture);
  return capture;
}

export function composeDiscovery(options: {
  catalog: ReadonlyMap<Id, SourceDefinition>;
  store: Pick<EvidenceStore, 'get'>;
  reviewer: { reviewerId: Id; allowedSourceRefs: Id[]; allowedAccountIds: Id[] };
  authorizeReviewer: ReturnType<typeof createLocalSessionService>['authorizeReviewer'];
  modelClient?: ModelClient;
  registerCandidate?: CompileRegisterCandidate;
  getArtifact?: ReplayGetArtifact;
}): FastifyPluginAsync<Omit<UploadDependencies, 'store'>> {
  const { catalog, store, reviewer, authorizeReviewer, modelClient, registerCandidate, getArtifact } = options;
  return async (app, { db, clock }) => {
    const service = await createDiscoveryService({
      db, clock, modelClient,
      sourceRefForCompany: companyId => catalog.get(companyId)?.sourceRef,
      readCapture: selection => readDiscoveryCapture({ db, store }, catalog, selection),
      recheckCapture: recheckDiscoveryCapture,
      readTools: createDiscoveryReadTools({ db, store }, catalog),
      ...(registerCandidate || getArtifact ? {
        ...(registerCandidate ? { registerCandidate } : {}),
        ...(getArtifact ? { getArtifact } : {}),
        constructionCapture: selection => readConstructionCapture({ db, store }, catalog, selection),
      } : {}),
      resolveAuthority(reviewerId, { companyId, sourceRef }) {
        if (reviewerId !== reviewer.reviewerId || catalog.get(companyId)?.sourceRef !== sourceRef ||
            !reviewer.allowedSourceRefs.includes(sourceRef)) return;
        return {
          allowedAccountIds: [...reviewer.allowedAccountIds],
          sourceRead: { companyId, sourceRef, sourceWide: true, accounts: [] },
        };
      },
    });
    const authorize = async (request: FastifyRequest, access: { mutation: boolean }) => {
      const caller = await authorizeReviewer(request, access);
      return { reviewerId: caller.reviewer.reviewerId, allowedSourceRefs: caller.allowedSourceRefs };
    };
    await app.register(mountDiscovery(service, authorize));
    await app.register(mountDiscoveryEvents({ db, authorizeReviewer: authorize, readState: service.readState }));
  };
}
