import {
  IsoDateSchema, IsoInstantSchema, RawSourceEventSchema, canonicalJson, hashCanonical, hashEvent,
  type CaptureStream, type FieldContract, type Id, type JsonValue, type RawSourceEvent, type SourceContract,
} from '@eapr/contracts';
import { extractDocument, type EvidenceStore, type Extraction } from '@eapr/evidence';
import type { PoolClient } from 'pg';
import { SourceError } from './errors.js';

export type SourceDefinition = {
  companyId:Id;
  sourceRef:Id;
  sellerEntityId:Id;
  contracts:readonly SourceContract[];
  streams:readonly CaptureStream[];
};

function validField(value: JsonValue | undefined, field: FieldContract) {
  if (value === undefined) return !field.required;
  if (value === null) return field.nullable;
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= field.minimum && value <= field.maximum;
    case 'string':
      if (typeof value !== 'string' || (field.enum && !field.enum.includes(value))) return false;
      switch (field.format) {
        case 'iso-date': return IsoDateSchema.safeParse(value).success;
        case 'iso-instant': return IsoInstantSchema.safeParse(value).success;
        case 'decimal2': return /^-?[0-9]+\.[0-9]{2}$/.test(value);
        case 'text': return true;
      }
  }
}

export function validateSourceEvent(source:SourceDefinition,input:RawSourceEvent) {
  const result = RawSourceEventSchema.safeParse(input);
  if (!result.success) throw new SourceError(422,'SOURCE_CONTENT_INVALID','Source event is invalid');
  const event = result.data;
  const contract = source.contracts.find(candidate => candidate.resource === event.resource &&
    candidate.schemaVersion === event.schemaVersion);
  const stream = source.streams.find(candidate => candidate.streamId === event.streamId);
  if (event.sourceRef !== source.sourceRef || event.rawIdentity.companyId !== source.companyId ||
      !stream?.resources.includes(event.resource) || !contract || event.kind !== contract.kind ||
      event.payload[contract.recordIdField] !== event.recordId ||
      event.payload[contract.recordVersionField] !== event.recordVersion ||
      (contract.accountIdField !== null && event.payload[contract.accountIdField] !== event.rawIdentity.sourceAccountId) ||
      Object.keys(event.payload).some(field => !Object.hasOwn(contract.fields,field)) ||
      Object.entries(contract.fields).some(([key,field]) => !validField(event.payload[key],field))) {
    throw new SourceError(422,'SOURCE_CONTENT_INVALID','Source event does not match its registered resource contract');
  }
  if (hashEvent(event) !== event.contentHash) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','Source event content hash conflicts');
  }
  return event;
}

export type PreparedSourceRecord = {
  event:RawSourceEvent;
  original?:{id:Id;hash:string;byteLength:number;extraction:Extraction};
};

export async function prepareApiRecord(
  source:SourceDefinition, store:EvidenceStore, input:RawSourceEvent, bytes:Uint8Array,
): Promise<PreparedSourceRecord> {
  const event = validateSourceEvent(source,input);
  let extraction: Extraction;
  try {
    extraction = await extractDocument('api_json',bytes);
  } catch {
    throw new SourceError(422,'SOURCE_CONTENT_INVALID','API original is invalid');
  }
  if (extraction.document.kind !== 'json' || canonicalJson(extraction.document.value) !== canonicalJson(event.payload)) {
    throw new SourceError(409,'SOURCE_HASH_CONFLICT','API original does not match its source event');
  }
  const id = 'api:' + hashCanonical({companyId:source.companyId,sourceRef:source.sourceRef,eventId:event.id});
  try {
    return {event,original:{id,hash:await store.put(bytes),byteLength:bytes.byteLength,extraction}};
  } catch {
    throw new SourceError(503,'SOURCE_UNAVAILABLE','API original byte storage is unavailable');
  }
}

export async function insertSourceRecord(client:PoolClient,{event,original}:PreparedSourceRecord) {
  const existing = await client.query<{content_hash:string;api_original_hash:string|null}>(
    'SELECT content_hash,api_original_hash FROM source_events WHERE source_ref = $1 AND event_id = $2',
    [event.sourceRef,event.id],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].content_hash !== event.contentHash ||
        existing.rows[0].api_original_hash !== (original?.hash ?? null)) {
      throw new SourceError(409,'SOURCE_HASH_CONFLICT','Source event identity already has different content');
    }
    return false;
  }
  const highWater = await client.query<{sequence:string}>(
    'SELECT COALESCE(max(sequence),0) AS sequence FROM source_events WHERE source_ref = $1 AND stream_id = $2',
    [event.sourceRef,event.streamId],
  );
  if (Number(highWater.rows[0]?.sequence) + 1 !== event.sequence) {
    throw new SourceError(409,'SOURCE_GAP','Source event sequence is not contiguous');
  }
  await client.query(
    'INSERT INTO source_events (source_ref,stream_id,sequence,event_id,content_hash,event,' +
    'api_source_id,api_original_hash,api_byte_length,api_extraction) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [event.sourceRef,event.streamId,event.sequence,event.id,event.contentHash,JSON.stringify(event),
      original?.id ?? null, original?.hash ?? null,original?.byteLength ?? null,
      original ? JSON.stringify(original.extraction) : null],
  );
  return true;
}
