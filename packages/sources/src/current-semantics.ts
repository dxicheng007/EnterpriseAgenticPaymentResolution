import {
  BootstrapManifestSchema, CaptureStreamSchema, CursorSchema, IdSchema, RawSourceEventSchema,
  SemanticPreflightSchema, SemanticVersionMapSchema, SourceContractSchema, hashManifest,
  type BootstrapManifest, type Id, type ManifestStream, type SemanticPreflight,
} from '@eapr/contracts';
import type { Pool, PoolClient } from 'pg';
import type { Clock } from '@eapr/storage/control-db';
import { withTransaction } from '@eapr/storage/transaction';
import { validateManifestStreams } from './dossier.js';
import { SourceError } from './errors.js';
import { validateSourceEvent, type SourceDefinition } from './records.js';
import { lockSource } from './uploads.js';

type ManifestRow = {manifest_id:Id;company_id:Id;source_ref:Id;epoch:string;manifest:unknown};
type EventRow = {source_ref:Id;stream_id:Id;sequence:string;event_id:Id;content_hash:string;event:unknown};

function unavailable() {
  return new SourceError(503,'SOURCE_SEMANTICS_UNAVAILABLE','Current source semantics could not be verified');
}

function semanticStreams(manifest:BootstrapManifest, source:SourceDefinition) {
  validateManifestStreams(manifest,source);
  const streams = CaptureStreamSchema.array().parse(source.streams);
  const contracts = SourceContractSchema.array().parse(source.contracts);
  const resources = new Set(contracts.map(contract=>contract.resource));
  const assignments = streams.flatMap(stream=>stream.resources);
  if (new Set(streams.map(stream=>stream.streamId)).size !== streams.length ||
      new Set(contracts.map(contract=>JSON.stringify([contract.resource,contract.schemaVersion]))).size !== contracts.length ||
      assignments.length !== resources.size || new Set(assignments).size !== resources.size ||
      assignments.some(resource=>!resources.has(resource)) ||
      Object.keys(manifest.schemaVersions).length !== resources.size ||
      [...resources].some(resource=>!contracts.some(contract=>contract.resource === resource &&
        contract.schemaVersion === manifest.schemaVersions[resource]))) {
    throw unavailable();
  }
  const semanticResources = new Set(contracts.filter(contract=>contract.kind === 'semantic_change')
    .map(contract=>contract.resource));
  const semanticStreamIds = new Set(streams.filter(stream=>stream.resources.some(resource=>semanticResources.has(resource)))
    .map(stream=>stream.streamId));
  return manifest.streams.filter(stream=>semanticStreamIds.has(stream.streamId));
}

async function readStreamRevisions(client:PoolClient, source:SourceDefinition, member:ManifestStream) {
  const {streamId,resumeAfter,eventIds} = member;
  const watermark = Number(resumeAfter);
  if (watermark !== eventIds.length) throw unavailable();
  const seen = new Set(eventIds);
  const bounds = (await client.query<{sequence:string;watermark_id:Id|null}>(
    'SELECT (SELECT COALESCE(max(sequence),0) FROM source_events WHERE source_ref = $1 AND stream_id = $2) AS sequence, ' +
    '(SELECT event_id FROM source_events WHERE source_ref = $1 AND stream_id = $2 AND sequence = $3) AS watermark_id',
    [source.sourceRef,streamId,resumeAfter],
  )).rows[0]!;
  const end = Number(CursorSchema.parse(bounds.sequence));
  // Bind the publication boundary without reading or folding its historical payload.
  if (end < watermark || (watermark !== 0 && (bounds.watermark_id === null || !seen.has(bounds.watermark_id)))) {
    throw unavailable();
  }

  const rows = (await client.query<EventRow>(
    'SELECT source_ref,stream_id,sequence,event_id,content_hash,event FROM source_events ' +
    'WHERE source_ref = $1 AND stream_id = $2 AND sequence > $3 AND sequence <= $4 ORDER BY sequence',
    [source.sourceRef,streamId,resumeAfter,end],
  )).rows;
  if (rows.length !== end - watermark) throw unavailable();

  const revisions = new Map<Id,Id>();
  for (const [index,row] of rows.entries()) {
    const event = validateSourceEvent(source,RawSourceEventSchema.parse(row.event));
    if (row.source_ref !== source.sourceRef || row.stream_id !== streamId || row.stream_id !== event.streamId ||
        row.sequence !== String(event.sequence) || event.sequence !== watermark + index + 1 ||
        row.event_id !== event.id || row.content_hash !== event.contentHash || seen.has(event.id)) {
      throw unavailable();
    }
    seen.add(event.id);
    if (event.kind === 'semantic_change') {
      const {sellerEntityId,sourceAccountId} = event.rawIdentity;
      const key = sellerEntityId && sourceAccountId ? sellerEntityId + '/' + sourceAccountId : '*';
      revisions.set(key,event.semanticVersion);
    }
  }
  return revisions;
}

export async function readCurrentSemantics(
  {db,clock}: {db:Pool;clock:Clock},
  catalog: ReadonlyMap<Id,SourceDefinition>,
  sourceRef: Id,
): Promise<SemanticPreflight> {
  if (!IdSchema.safeParse(sourceRef).success) {
    throw new SourceError(400,'SOURCE_METADATA_INVALID','Source request is invalid');
  }
  const matches = [...catalog.values()].filter(entry=>entry.sourceRef === sourceRef);
  if (!matches.length) throw new SourceError(404,'SOURCE_NOT_FOUND','Registered source was not found');
  if (matches.length !== 1) throw unavailable();

  try {
    const source = structuredClone(matches[0]!);
    return await withTransaction(db,async client=>{
      await lockSource(client,sourceRef);
      const row = (await client.query<ManifestRow>(
        'SELECT manifest_id,company_id,source_ref,epoch,manifest FROM source_manifests ' +
        'WHERE source_ref = $1 ORDER BY epoch DESC LIMIT 1',
        [sourceRef],
      )).rows[0];
      if (!row) throw unavailable();
      const manifest = BootstrapManifestSchema.parse(row.manifest);
      if (manifest.id !== row.manifest_id || manifest.companyId !== row.company_id ||
          manifest.sourceRef !== row.source_ref || String(manifest.epoch) !== row.epoch ||
          hashManifest(manifest) !== manifest.hash) {
        throw unavailable();
      }

      const versions = SemanticVersionMapSchema.parse(manifest.semanticVersions);
      const revisions = new Map<Id,Id>();
      for (const member of semanticStreams(manifest,source)) {
        for (const [key,revision] of await readStreamRevisions(client,source,member)) {
          if (revisions.has(key) && revisions.get(key) !== revision) {
            throw new SourceError(503,'SOURCE_SEMANTICS_UNSUPPORTED_ORDER',
              'Independent source streams disagree on the current semantic revision');
          }
          revisions.set(key,revision);
        }
      }
      return SemanticPreflightSchema.parse({
        sourceRef,checkedAt:clock().toISOString(),versions:{...versions,...Object.fromEntries(revisions)},
      });
    });
  } catch (error) {
    if (error instanceof SourceError && error.code === 'SOURCE_SEMANTICS_UNSUPPORTED_ORDER') throw error;
    throw unavailable();
  }
}
