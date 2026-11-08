import {
  CaptureStreamSchema, IsoDateSchema, IsoInstantSchema, RawSourceEventSchema,
  SourceContractSchema, hashEvent, type EventKind, type FieldContract,
  type Id, type IsoDate, type IsoInstant, type JsonObject, type RawSourceEvent,
} from '@eapr/contracts';

const text = {type:'string', required:true, nullable:false, format:'text'} as const;
const date = {...text, format:'iso-date'} as const;
const amount = {...text, format:'decimal2'} as const;
const kinds = ['invoice','payment','credit','allocation','reversal','semantic_change'] as const;
const fundingType: FieldContract = {...text, enum:['payment','credit']};
const extensions: Record<EventKind, Record<string,FieldContract>> = {
  invoice:{amount,due_date:date},
  payment:{amount},
  credit:{amount},
  allocation:{amount,funding_kind:fundingType,funding_id:text,invoice_id:text},
  reversal:{reversed_kind:fundingType,reversed_id:text},
  semantic_change:{revision:text},
};

export const companyA = {
  companyId:'company-a',
  sourceRef:'legacy-a',
  sellerEntityId:'seller-a',
  contracts:kinds.map(kind => SourceContractSchema.parse({
    resource:'a-' + (kind === 'semantic_change' ? 'semantics' : kind + 's'),
    kind, schemaVersion:'schema-a-1',
    fields:{id:text, account:text, version:{type:'integer',required:true,nullable:false,unit:'count',
      minimum:1,maximum:Number.MAX_SAFE_INTEGER}, effective_date:date, ...extensions[kind]},
    additionalProperties:false, currency:'USD', timezone:'UTC', recordIdField:'id',
    recordVersionField:'version', accountIdField:'account', semantics:'append-only-events', moneyUpdates:'full-reversal-only',
  })),
  streams:[
    CaptureStreamSchema.parse({streamId:'a-finance',transport:'api',
      resources:['a-invoices','a-payments','a-credits','a-allocations','a-reversals'],cursorStrategy:'positive-safe-integer',pageSize:100}),
    CaptureStreamSchema.parse({streamId:'a-semantics',transport:'semantic',
      resources:['a-semantics'],cursorStrategy:'positive-safe-integer',pageSize:100}),
  ],
};

export type RecordA = {
  kind: EventKind; recordId: Id; sourceAccountId: Id; effectiveDate: IsoDate;
  fields: JsonObject; schemaVersion?: Id; semanticVersion?: Id;
};

export function eventA(record: RecordA, sequence: number, observedAt: IsoInstant): RawSourceEvent {
  const contract = companyA.contracts.find(contract => contract.kind === record.kind)!;
  const stream = companyA.streams.find(stream => stream.resources.includes(contract.resource))!;
  const effectiveDate = IsoDateSchema.parse(record.effectiveDate);
  const event = {
    id:'evt:' + record.recordId, sourceRef:companyA.sourceRef,
    streamId:stream.streamId, sequence, resource:contract.resource,
    recordId:record.recordId, recordVersion:1, kind:record.kind,
    effectiveAt:effectiveDate + 'T00:00:00.000Z',
    observedAt:IsoInstantSchema.parse(observedAt),
    rawIdentity:{companyId:companyA.companyId,sellerEntityId:companyA.sellerEntityId,sourceAccountId:record.sourceAccountId},
    schemaVersion:record.schemaVersion ?? contract.schemaVersion,
    semanticVersion:record.semanticVersion ?? 'sem-a-1',
    payload:{...record.fields,id:record.recordId,version:1,account:record.sourceAccountId,effective_date:effectiveDate},
  };
  return RawSourceEventSchema.parse({...event,contentHash:hashEvent(event)});
}
