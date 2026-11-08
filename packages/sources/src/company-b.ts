import { stringify } from 'csv-stringify/sync';
import {
  CaptureStreamSchema, IsoInstantSchema, JsonObjectSchema, RawSourceEventSchema, SourceContractSchema,
  VersionSchema, canonicalJson, hashEvent, type EventKind, type Id, type JsonObject, type RawSourceEvent,
} from '@eapr/contracts';
import type { ExtractedDocument } from '@eapr/evidence';
import { companyA, type RecordA } from './company-a.js';
import { SourceError } from './errors.js';
import { validateSourceEvent } from './records.js';

const replacements: Record<string,string> = {
  id:'transaction_key',version:'revision_no',account:'client_code',effective_date:'posted_on',
  amount:'amount_minor',due_date:'due_on',funding_kind:'receipt_type',funding_id:'receipt_key',
  invoice_id:'bill_key',reversed_kind:'void_type',reversed_id:'void_key',
};

export const companyB = {
  companyId:'company-b',sourceRef:'legacy-b',sellerEntityId:'seller-b',
  contracts:companyA.contracts.map(contract=>SourceContractSchema.parse({
    ...contract,resource:contract.resource.replace(/^a-/,'b-'),schemaVersion:'schema-b-1',
    fields:Object.fromEntries(Object.entries(contract.fields).map(([key,value]) => [
      replacements[key] ?? key,key === 'amount' ? {type:'integer',required:true,nullable:false,unit:'minor',
        minimum:1,maximum:5000000} : value,
    ])),
    recordIdField:'transaction_key',recordVersionField:'revision_no',accountIdField:'client_code',
  })),
  streams:[
    CaptureStreamSchema.parse({streamId:'b-files',transport:'csv',
      resources:['b-invoices','b-credits','b-allocations','b-reversals'],cursorStrategy:'positive-safe-integer',pageSize:100}),
    CaptureStreamSchema.parse({streamId:'b-receipts',transport:'api',
      resources:['b-payments'],cursorStrategy:'positive-safe-integer',pageSize:100}),
    CaptureStreamSchema.parse({streamId:'b-semantics',transport:'semantic',
      resources:['b-semantics'],cursorStrategy:'positive-safe-integer',pageSize:100}),
  ],
};

export function eventB(record:RecordA,sequence:number,observedAt:string): RawSourceEvent {
  const contract = companyB.contracts.find(contract=>contract.kind === record.kind)!;
  const stream = companyB.streams.find(stream=>stream.resources.includes(contract.resource))!;
  const event = {
    id:'evt:' + record.recordId,sourceRef:companyB.sourceRef,streamId:stream.streamId,sequence,resource:contract.resource,
    recordId:record.recordId,recordVersion:1,kind:record.kind,
    effectiveAt:record.effectiveDate + 'T00:00:00.000Z',observedAt,
    rawIdentity:{companyId:companyB.companyId,sellerEntityId:companyB.sellerEntityId,sourceAccountId:record.sourceAccountId},
    schemaVersion:record.schemaVersion ?? contract.schemaVersion,semanticVersion:record.semanticVersion ?? 'sem-b-1',
    payload:{...record.fields,transaction_key:record.recordId,revision_no:1,client_code:record.sourceAccountId,
      posted_on:record.effectiveDate},
  };
  return validateSourceEvent(companyB,RawSourceEventSchema.parse({...event,contentHash:hashEvent(event)}));
}

export const BATCH_HEADER = [
  'event_id','sequence','resource','kind','record_id','record_version','effective_at','observed_at',
  'account_id','schema_version','semantic_version','payload_json',
];

export function encodeBatch(events: readonly RawSourceEvent[]) {
  return Buffer.from(stringify([
    BATCH_HEADER,
    ...events.map(event=>[
      event.id,event.sequence,event.resource,event.kind,event.recordId,event.recordVersion,
      event.effectiveAt,event.observedAt,event.rawIdentity.sourceAccountId,event.schemaVersion,
      event.semanticVersion,canonicalJson(event.payload),
    ]),
  ],{record_delimiter:'\n'}));
}

function positiveInteger(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error('Invalid sequence');
  return VersionSchema.parse(Number(value));
}

export function decodeBatch(streamId:Id,document:ExtractedDocument) {
  if (document.kind !== 'csv' || streamId !== 'b-files' || document.rows.length === 0 ||
      canonicalJson(document.headers) !== canonicalJson(BATCH_HEADER)) {
    throw new SourceError(422,'SOURCE_CONTENT_INVALID','Batch envelope is invalid');
  }
  return document.rows.map(row => {
    try {
      const [id,sequence,resource,kind,recordId,recordVersion,effectiveAt,observedAt,account,
        schemaVersion,semanticVersion,json] = row as [Id,string,Id,EventKind,Id,string,string,string,Id,Id,Id,string];
      const payload:JsonObject = JsonObjectSchema.parse(JSON.parse(json));
      if (canonicalJson(payload) !== json) throw new Error('Noncanonical resource payload');
      const event = {
        id,sourceRef:companyB.sourceRef,streamId,sequence:positiveInteger(sequence),resource,recordId,
        recordVersion:positiveInteger(recordVersion),kind,effectiveAt:IsoInstantSchema.parse(effectiveAt),
        observedAt:IsoInstantSchema.parse(observedAt),rawIdentity:{companyId:companyB.companyId,
          sellerEntityId:companyB.sellerEntityId,sourceAccountId:account},schemaVersion,semanticVersion,payload,
      };
      return validateSourceEvent(companyB,RawSourceEventSchema.parse({...event,contentHash:hashEvent(event)}));
    } catch {
      throw new SourceError(422,'SOURCE_CONTENT_INVALID','Batch event does not match its resource contract');
    }
  });
}
