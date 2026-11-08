import { timingSafeEqual } from 'node:crypto';
import { canonicalJson, hashEvent, IdSchema, IsoDateSchema, IsoInstantSchema, SourceContractSchema,
  type Id, type RawSourceEvent, type UploadMetadata } from '@eapr/contracts';
import { publishActivity } from '@eapr/storage/activity';
import { withTransaction } from '@eapr/storage/transaction';
import { companyA, eventA, type RecordA } from './company-a.js';
import { companyB, eventB, encodeBatch } from './company-b.js';
import { SourceError } from './errors.js';
import { insertSourceRecord, prepareApiRecord, validateSourceEvent, type SourceDefinition } from './records.js';
import { lockSource, uploadSource, type UploadDependencies } from './uploads.js';

type ScenarioInput = {
  id:Id; accountId:Id; observedAt:string; effectiveDate:string; semanticVersion?:Id;
};

type FreshInvoice = ScenarioInput & {amount:string; dueDate:string};
type FreshPayment = ScenarioInput & {amount:string; invoiceId:Id};

function checkedInput(input:ScenarioInput) {
  return {
    ...input,id:IdSchema.parse(input.id),accountId:IdSchema.parse(input.accountId),
    observedAt:IsoInstantSchema.parse(input.observedAt),effectiveDate:IsoDateSchema.parse(input.effectiveDate),
  };
}

export function createScenarioAdmin(dependencies:UploadDependencies, env:{DEMO_OPERATOR_ENABLED?:string;DEMO_OPERATOR_TOKEN?:string}) {
  const enabled = env.DEMO_OPERATOR_ENABLED === 'true';
  if (enabled && !env.DEMO_OPERATOR_TOKEN) throw new Error('A separate demo operator token is required');
  const expectedToken = Buffer.from(env.DEMO_OPERATOR_TOKEN ?? '');
  function authorize(token:string) {
    const provided = Buffer.from(token);
    if (!enabled || !provided.length || provided.length !== expectedToken.length ||
        !timingSafeEqual(provided,expectedToken)) {
      throw new SourceError(403,'SOURCE_FORBIDDEN','Demo operator authorization is required');
    }
  }

  async function append(source:SourceDefinition, proposed:readonly RawSourceEvent[]) {
    const {db,store} = dependencies;
    const originals = await Promise.all(proposed.map(event=>
      prepareApiRecord(source,store,event,Buffer.from(canonicalJson(event.payload)))));
    return withTransaction(db,async client => {
      await lockSource(client,source.sourceRef);
      const events: RawSourceEvent[] = [];
      let inserted = 0;
      for (const item of originals) {
        const {event} = item;
        const current = (await client.query<{sequence:string}>(
          'SELECT sequence FROM source_events WHERE source_ref = $1 AND event_id = $2',[event.sourceRef,event.id],
        )).rows[0];
        const sequence = current ? Number(current.sequence) : 1 + Number((await client.query<{sequence:string}>(
          'SELECT COALESCE(max(sequence),0) AS sequence FROM source_events WHERE source_ref = $1 AND stream_id = $2',
          [event.sourceRef,event.streamId],
        )).rows[0]?.sequence);
        const sequenced = {...event,sequence};
        const checked = validateSourceEvent(source,{...sequenced,contentHash:hashEvent(sequenced)});
        if (await insertSourceRecord(client,{...item,event:checked})) inserted++;
        events.push(checked);
      }
      if (inserted) await publishActivity(client,{
        stream:'control',phase:'build',type:'source.captured',at:dependencies.clock().toISOString(),
        payload:{sourceRef:source.sourceRef,captured:inserted},
      });
      return events;
    });
  }

  function aRecord(input:ScenarioInput,kind:RecordA['kind'],recordId:Id,fields:RecordA['fields']) {
    return eventA({
      kind,recordId,sourceAccountId:input.accountId,effectiveDate:input.effectiveDate,fields,
      semanticVersion:input.semanticVersion,
    },1,input.observedAt);
  }

  function freshPaymentA(token:string,raw:FreshPayment) {
    authorize(token);
    const input = checkedInput(raw);
    const paymentId = 'pay-a:' + input.id;
    return append(companyA,[
      aRecord(input,'payment',paymentId,{amount:raw.amount}),
      aRecord(input,'allocation','alloc-a:' + input.id,{amount:raw.amount,funding_kind:'payment',
        funding_id:paymentId,invoice_id:IdSchema.parse(raw.invoiceId)}),
    ]);
  }

  return {
    freshInvoiceA(token:string,raw:FreshInvoice) {
      authorize(token);
      const input = checkedInput(raw);
      return append(companyA,[aRecord(input,'invoice','inv-a:' + input.id,{amount:raw.amount,due_date:raw.dueDate})]);
    },
    freshPaymentA,
    missingDependencyA: freshPaymentA,
    schemaRenameA(token:string,raw:FreshInvoice) {
      authorize(token);
      const input = checkedInput(raw);
      const previous = companyA.contracts.find(contract=>contract.kind === 'invoice')!;
      const {amount,...fields} = previous.fields;
      const renamed = SourceContractSchema.parse({...previous,schemaVersion:'schema-a-2',
        fields:{...fields,gross_amount:amount}});
      const source = {...companyA,contracts:[...companyA.contracts,renamed]};
      return append(source,[eventA({
        kind:'invoice',recordId:'inv-a:' + input.id,sourceAccountId:input.accountId,
        effectiveDate:input.effectiveDate,schemaVersion:renamed.schemaVersion,semanticVersion:input.semanticVersion,
        fields:{gross_amount:raw.amount,due_date:raw.dueDate},
      },1,input.observedAt)]);
    },
    async batchB(token:string,metadata:UploadMetadata,events:readonly RawSourceEvent[]) {
      authorize(token);
      if (metadata.companyId !== companyB.companyId || metadata.sourceRef !== companyB.sourceRef ||
          metadata.kind !== 'event_csv' || metadata.batch?.streamId !== 'b-files') {
        throw new SourceError(400,'SOURCE_METADATA_INVALID','Operator batch must target the B file stream');
      }
      const checked = events.map(event=>validateSourceEvent(companyB,event));
      if (checked.some(event=>event.rawIdentity.sellerEntityId !== companyB.sellerEntityId)) {
        throw new SourceError(422,'SOURCE_CONTENT_INVALID','B CSV requires the registered seller identity');
      }
      const upload = await uploadSource(dependencies,metadata,encodeBatch(checked));
      return {upload,events:checked};
    },
    semanticChangeA(token:string,raw:ScenarioInput & {revision:Id}) {
      authorize(token);
      const input = checkedInput(raw);
      const revision = IdSchema.parse(raw.revision);
      return append(companyA,[aRecord({...input,semanticVersion:revision},'semantic_change','semantic-a:' + input.id,{revision})]);
    },
    semanticChangeB(token:string,raw:ScenarioInput & {revision:Id}) {
      authorize(token);
      const input = checkedInput(raw);
      const revision = IdSchema.parse(raw.revision);
      return append(companyB,[eventB({
        kind:'semantic_change',recordId:'semantic-b:' + input.id,sourceAccountId:input.accountId,
        effectiveDate:input.effectiveDate,semanticVersion:revision,fields:{revision},
      },1,input.observedAt)]);
    },
    unknownAccountB(token:string,raw:ScenarioInput & {amountMinor:number}) {
      authorize(token);
      const input = checkedInput(raw);
      return append(companyB,[eventB({kind:'payment',recordId:'pay-b:' + input.id,sourceAccountId:input.accountId,
        effectiveDate:input.effectiveDate,semanticVersion:input.semanticVersion,
        fields:{amount_minor:raw.amountMinor}},1,input.observedAt)]);
    },
  };
}
