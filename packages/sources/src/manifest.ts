import {
  RawSourceEventSchema, type BootstrapManifest, type CaptureSnapshotResult, type ChangePage, type Cursor,
  type Id, type RawSourceEvent, type SemanticPreflight, type SourceSnapshot,
} from '@eapr/contracts';
import { captureBaseline, publishBaseline, readManifest, readSnapshot } from './dossier.js';
import { readCurrentSemantics } from './current-semantics.js';
import { fetchChanges } from './change-feed.js';
import { SourceError } from './errors.js';
import type { PreparedSourceRecord, SourceDefinition } from './records.js';
import type { UploadDependencies } from './uploads.js';

export function createSourceService(dependencies:UploadDependencies,catalog:ReadonlyMap<Id,SourceDefinition>) {
  const {db} = dependencies;
  function definition(sourceRef:Id) {
    const source = [...catalog.values()].find(entry=>entry.sourceRef === sourceRef);
    if (!source) throw new SourceError(404,'SOURCE_NOT_FOUND','Registered source was not found');
    return source;
  }
  return {
    readCurrentSemantics(sourceRef:Id):Promise<SemanticPreflight> {
      return readCurrentSemantics(dependencies,catalog,sourceRef);
    },
    getManifest(companyId:Id):Promise<BootstrapManifest> {
      return readManifest(db,companyId);
    },
    getSnapshot(snapshotId:Id):Promise<SourceSnapshot> {
      return readSnapshot(db,snapshotId);
    },
    captureSnapshot(manifestId:Id):Promise<CaptureSnapshotResult> {
      return captureBaseline(dependencies,manifestId);
    },
    fetchChanges(sourceRef:Id,streamId:Id,after:Cursor):Promise<ChangePage> {
      return fetchChanges(db,definition(sourceRef),streamId,after);
    },
    async getSnapshotRecords(snapshotId:Id):Promise<RawSourceEvent[]> {
      const snapshot = await readSnapshot(db,snapshotId);
      const rows = (await db.query<{event:RawSourceEvent}>(
        'SELECT event FROM source_events WHERE source_ref = $1 AND event_id = ANY($2) ORDER BY stream_id, sequence',
        [snapshot.sourceRef,snapshot.eventIds],
      )).rows;
      if (rows.length !== snapshot.eventIds.length) {
        throw new SourceError(409,'MANIFEST_MEMBER_MISSING','A snapshot event is missing');
      }
      return rows.map(row=>RawSourceEventSchema.parse(row.event));
    },
    getSourceCapabilities(sourceRef:Id) {
      return structuredClone(definition(sourceRef));
    },
  };
}

export function publishManifest(
  dependencies:UploadDependencies,catalog:ReadonlyMap<Id,SourceDefinition>,
  manifest:BootstrapManifest,prepared:readonly PreparedSourceRecord[],
) {
  const source = catalog.get(manifest.companyId);
  if (!source) throw new SourceError(404,'SOURCE_NOT_FOUND','Registered source was not found');
  return publishBaseline(dependencies,source,manifest,prepared);
}
