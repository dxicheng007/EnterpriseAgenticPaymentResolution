import { PDFDocument, StandardFonts } from 'pdf-lib';
import { hashCanonical, IdSchema, IsoInstantSchema, type Id, type IsoInstant } from '@eapr/contracts';
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

export function fixtureA(seed: Id, instant: IsoInstant) {
  const context = fixtureContext(seed,instant);
  const accounts = fixtureAccounts(seed,'a');
  const records: RecordA[] = [];
  const initialRates = ['3000.00', String(1700 + parseInt(context.tag.slice(0,2),16)) + '.00',
    String(2300 + parseInt(context.tag.slice(2,4),16)) + '.00'];
  const amendedRate = String(Number(initialRates[1]) + 200) + '.00';
  for (const [index,account] of accounts.entries()) {
    for (const offset of [-3,-2,-1]) {
      const effectiveDate = context.month(offset);
      const suffix = account.accountId + '-' + effectiveDate;
      const add = (kind:RecordA['kind'], recordId:string, fields:RecordA['fields']) =>
        records.push({kind,recordId,sourceAccountId:account.accountId,effectiveDate,fields});
      const invoiceId = 'inv-a:' + suffix;
      const paymentId = 'pay-a:' + suffix;
      const creditId = 'credit-a:' + suffix;
      const fee = index === 1 && offset === -1 ? amendedRate : initialRates[index]!;
      const partial = index === 0 && offset === -1;
      const payment = partial ? '2000.00' : fee;
      add('invoice',invoiceId,{amount:fee,due_date:context.month(offset,true)});
      add('payment',paymentId,{amount:payment});
      add('allocation','alloc-payment-a:' + suffix,{
        amount:payment,funding_kind:'payment',funding_id:paymentId,invoice_id:invoiceId,
      });
      if (partial) {
        add('credit',creditId,{amount:'200.00'});
        add('allocation','alloc-credit-a:' + suffix,{
          amount:'200.00',funding_kind:'credit',funding_id:creditId,invoice_id:invoiceId,
        });
      }
    }
  }
  return {
    accounts, ...context, initialRates, amendedRate, amendmentEffective:context.month(-1),
    events:[...records.map((record,index) => eventA({
      ...record,
      ...(record.sourceAccountId === accounts[1]!.accountId && record.effectiveDate === context.month(-1)
        ? {semanticVersion:'sem-a-2'} : {}),
    },index+1,context.asOf)),eventA({
      kind:'semantic_change',recordId:'semantic-a:' + accounts[1]!.accountId + ':2',
      sourceAccountId:accounts[1]!.accountId,effectiveDate:context.month(-1),
      semanticVersion:'sem-a-2',fields:{revision:'sem-a-2'},
    },1,context.asOf)],
  };
}
