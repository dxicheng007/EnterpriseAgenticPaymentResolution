import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashCanonical, IdSchema, IsoInstantSchema, type Id, type IsoDate, type IsoInstant, type RawSourceEvent } from '@eapr/contracts';
import { eventB } from './company-b.js';
import { eventA, type RecordA } from './company-a.js';

export function fixtureContext(seed: Id, instant: IsoInstant) {
  const asOf = IsoInstantSchema.parse(instant);
  const date = new Date(asOf);
  const tag = hashCanonical(IdSchema.parse(seed)).slice(0, 12);
  function month(offset: number, last = false) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + Number(last),
      last ? 0 : 1)).toISOString().slice(0, 10);
  }
  return {tag, asOf, month};
}

export async function textPdf(lines: string[], asOf: IsoInstant, title: string) {
  const pdf = await PDFDocument.create({updateMetadata:false});
  pdf.setCreationDate(new Date(asOf));
  pdf.setModificationDate(new Date(asOf));
  pdf.setTitle(title);
  pdf.setProducer('EAPR deterministic fixture generator');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage();
  for (const [index,line] of lines.entries()) {
    page.drawText(line,{x:45,y:750-index*22,size:11,font});
  }
  return pdf.save();
}

export function fixtureAccounts(seed: Id, company: 'a' | 'b') {
  const tag = hashCanonical(seed).slice(0,12);
  return [1,2,3].map(index => ({
    accountId:'cust-' + company + '-' + tag + '-' + index,
    entityId:index === 1 ? 'buyer-shared-' + tag : 'entity-' + company + '-' + tag + '-' + index,
    displayName:index === 1 ? 'Shared Buyer ' + tag : 'Northstar Studio ' + tag,
    contractId:'contract-' + company + '-' + tag + '-' + index,
  }));
}

type FinancialFact =
  | {kind:'invoice'; amountCents:number; dueDate:IsoDate}
  | {kind:'payment'|'credit'; amountCents:number}
  | {kind:'allocation'; amountCents:number; fundingKind:'payment'|'credit'; fundingRecordId:Id; invoiceRecordId:Id};

export type ScenarioRecord = FinancialFact & {recordId:Id; sourceAccountId:Id; effectiveDate:IsoDate};

function decimalAmount(cents:number) {
  const digits = String(cents).padStart(3,'0');
  return digits.slice(0,-2) + '.' + digits.slice(-2);
}

function fieldsA(record:ScenarioRecord):RecordA['fields'] {
  const amount = decimalAmount(record.amountCents);
  switch (record.kind) {
    case 'invoice': return {amount,due_date:record.dueDate};
    case 'allocation': return {amount,funding_kind:record.fundingKind,
      funding_id:record.fundingRecordId,invoice_id:record.invoiceRecordId};
    default: return {amount};
  }
}

function fieldsB(record:ScenarioRecord):RecordA['fields'] {
  const amount_minor = record.amountCents;
  switch (record.kind) {
    case 'invoice': return {amount_minor,due_on:record.dueDate};
    case 'allocation': return {amount_minor,receipt_type:record.fundingKind,
      receipt_key:record.fundingRecordId,bill_key:record.invoiceRecordId};
    default: return {amount_minor};
  }
}

export function fixtureA(seed: Id, instant: IsoInstant) {
  const context = fixtureContext(seed,instant);
  const accounts = fixtureAccounts(seed,'a');
  const records: ScenarioRecord[] = [];
  const initialCents = [300000,170000 + parseInt(context.tag.slice(0,2),16)*100,
    230000 + parseInt(context.tag.slice(2,4),16)*100];
  const amendedCents = initialCents[1]! + 20000;
  for (const [index,account] of accounts.entries()) {
    for (const offset of [-3,-2,-1]) {
      const effectiveDate = context.month(offset);
      const suffix = account.accountId + '-' + effectiveDate;
      const add = (recordId:Id, fact:FinancialFact) =>
        records.push({...fact,recordId,sourceAccountId:account.accountId,effectiveDate});
      const invoiceId = 'inv-a:' + suffix;
      const paymentId = 'pay-a:' + suffix;
      const creditId = 'credit-a:' + suffix;
      const fee = index === 1 && offset === -1 ? amendedCents : initialCents[index]!;
      const partial = index === 0 && offset === -1;
      const payment = partial ? 200000 : fee;
      add(invoiceId,{kind:'invoice',amountCents:fee,dueDate:context.month(offset,true)});
      add(paymentId,{kind:'payment',amountCents:payment});
      add('alloc-payment-a:' + suffix,{kind:'allocation',amountCents:payment,
        fundingKind:'payment',fundingRecordId:paymentId,invoiceRecordId:invoiceId});
      if (partial) {
        add(creditId,{kind:'credit',amountCents:20000});
        add('alloc-credit-a:' + suffix,{kind:'allocation',amountCents:20000,
          fundingKind:'credit',fundingRecordId:creditId,invoiceRecordId:invoiceId});
      }
    }
  }
  return {
    accounts, ...context, records, initialRates:initialCents.map(decimalAmount),
    amendedRate:decimalAmount(amendedCents), amendmentEffective:context.month(-1),
    events:[...records.map((record,index) => eventA({
      ...record, fields:fieldsA(record),
      ...(record.sourceAccountId === accounts[1]!.accountId && record.effectiveDate === context.month(-1)
        ? {semanticVersion:'sem-a-2'} : {}),
    },index+1,context.asOf)),eventA({
      kind:'semantic_change',recordId:'semantic-a:' + accounts[1]!.accountId + ':2',
      sourceAccountId:accounts[1]!.accountId,effectiveDate:context.month(-1),
      semanticVersion:'sem-a-2',fields:{revision:'sem-a-2'},
    },1,context.asOf)],
  };
}

export function fixtureB(seed:Id,instant:IsoInstant) {
  const context = fixtureContext(seed,instant);
  const accounts = fixtureAccounts(seed,'b');
  const fees = [300000,180000 + parseInt(context.tag.slice(0,2),16)*100,
    220000 + parseInt(context.tag.slice(2,4),16)*100];
  const batches: ScenarioRecord[][] = [];
  const receiptRecords: ScenarioRecord[] = [];
  for (const offset of [-3,-2,-1]) {
    const batch:ScenarioRecord[] = [];
    for (const [index,account] of accounts.entries()) {
      const effectiveDate = context.month(offset);
      const suffix = account.accountId + '-' + effectiveDate;
      const invoice = 'inv-b:' + suffix;
      const receipt = 'pay-b:' + suffix;
      const common = {sourceAccountId:account.accountId,effectiveDate};
      batch.push({...common,kind:'invoice',recordId:invoice,amountCents:fees[index]!,
        dueDate:context.month(offset,true)});
      receiptRecords.push({...common,kind:'payment',recordId:receipt,amountCents:fees[index]!});
      batch.push({...common,kind:'allocation',recordId:'alloc-b:' + suffix,amountCents:fees[index]!,
        fundingKind:'payment',fundingRecordId:receipt,invoiceRecordId:invoice});
    }
    batches.push(batch);
  }
  receiptRecords.push({kind:'payment',recordId:'pay-b:unresolved-' + context.tag,
    sourceAccountId:'cust-b-unknown-' + context.tag,effectiveDate:context.month(-1),amountCents:30000});
  const records = [...batches.flat(),...receiptRecords];
  function render(record:ScenarioRecord,sequence:number):RawSourceEvent {
    return eventB({...record,fields:fieldsB(record)},sequence,context.asOf);
  }
  let fileSequence = 0;
  const files = batches.map(batch=>batch.map(record=>render(record,++fileSequence)));
  const receipts = receiptRecords.map((record,index)=>render(record,index+1));
  return {accounts,...context,fees,records,files,receipts,ambiguous:receipts.at(-1)!};
}
