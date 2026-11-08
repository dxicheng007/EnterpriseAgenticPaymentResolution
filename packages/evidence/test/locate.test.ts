import { describe, expect, it } from 'vitest';
import { locate } from '../src/locate.js';

describe('exact source locators', () => {
  it('uses page-local UTF-16 offsets', () => {
    expect(locate({kind:'pdf', pages:['other', 'A😀B']}, {kind:'pdf',page:2,start:1,end:3}))
      .toEqual({value:'A😀B', startInclusive:1, endExclusive:3, excerpt:'😀'});
    expect(() => locate({kind:'pdf', pages:['A😀B']}, {kind:'pdf',page:1,start:2,end:3}))
      .toThrow('CITATION_INVALID');
    expect(() => locate({kind:'pdf', pages:['A😀B']}, {kind:'pdf',page:2,start:0,end:1}))
      .toThrow('CITATION_INVALID');
  });

  it('resolves escaped JSON keys and canonicalizes non-string values', () => {
    expect(locate({kind:'json', value:{'a/b~':{z:2,a:1}}}, {kind:'json', pointer:'/a~1b~0'}).excerpt)
      .toBe('{"a":1,"z":2}');
    expect(() => locate({kind:'json', value:{}}, {kind:'json',pointer:'/constructor'}))
      .toThrow('CITATION_INVALID');
  });

  it('indexes decoded CSV records and checks email message identity', () => {
    expect(locate({kind:'csv', headers:['name'], rows:[['a\nb'],['c']]}, {kind:'csv',row:2,column:'name'}).excerpt)
      .toBe('c');
    expect(locate({kind:'email', messageId:'m',body:'USD 3000.00'}, {kind:'email',messageId:'m',start:4,end:11}).excerpt)
      .toBe('3000.00');
    expect(() => locate({kind:'email', messageId:'m',body:'USD'}, {kind:'email',messageId:'other',start:0,end:3}))
      .toThrow('CITATION_INVALID');
  });
});

describe('immutable original bytes', () => {
  it('rejects traversal and symlinked content', async () => {
    const {mkdtemp, rm, symlink, writeFile} = await import('node:fs/promises');
    const {tmpdir} = await import('node:os');
    const {join} = await import('node:path');
    const {hashBytes} = await import('@eapr/contracts');
    const {createEvidenceStore} = await import('../src/store.js');
    const root = await mkdtemp(join(tmpdir(), 'eapr-original-'));
    const outside = await mkdtemp(join(tmpdir(), 'eapr-outside-'));
    try {
      const store = await createEvidenceStore(root);
      const bytes = Buffer.from('the original');
      const hash = hashBytes(bytes);
      await writeFile(join(outside, 'content'), bytes);
      await symlink(join(outside, 'content'), join(root, hash));
      await expect(store.get(hash)).rejects.toThrow();
      await expect(store.get('../content')).rejects.toThrow();
      const safeBytes = Buffer.from('safe');
      const stored = await Promise.all([store.put(safeBytes), store.put(safeBytes)]);
      expect(stored).toEqual([hashBytes(safeBytes), hashBytes(safeBytes)]);
      expect(await store.get(stored[0])).toEqual(safeBytes);
    } finally {
      await Promise.all([rm(root,{recursive:true,force:true}), rm(outside,{recursive:true,force:true})]);
    }
  });
});

describe('original extraction', () => {
  it('rejects duplicate CSV headers and accepts multiline records', async () => {
    const {extractDocument} = await import('../src/extract.js');
    const bytes = Buffer.from('name,note\r\nA,"line1\r\nline2"\r\nB,last\r\n');
    const {document} = await extractDocument('event_csv', bytes);
    expect(locate(document, {kind:'csv',row:2,column:'note'}).excerpt).toBe('last');
    await expect(extractDocument('event_csv', Buffer.from('name,name\nA,B\n')))
      .rejects.toThrow('SOURCE_CONTENT_INVALID');
    await expect(extractDocument('event_csv', Buffer.from('name,note\nA,"broken\n')))
      .rejects.toThrow('SOURCE_CONTENT_INVALID');
  });

  it('extracts actual PDF text and rejects image-only or malformed input', async () => {
    const {PDFDocument} = await import('pdf-lib');
    const {extractDocument} = await import('../src/extract.js');
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('USD 3000.00');
    const {document} = await extractDocument('contract_pdf', await pdf.save());
    expect(locate(document, {kind:'pdf',page:1,start:0,end:11}).excerpt).toBe('USD 3000.00');
    const empty = await PDFDocument.create();
    empty.addPage();
    await expect(extractDocument('contract_pdf', await empty.save())).rejects.toThrow('SOURCE_CONTENT_INVALID');
    await expect(extractDocument('contract_pdf', Buffer.from('not PDF'))).rejects.toThrow('SOURCE_CONTENT_INVALID');
  });
});

it('searches only authorized excerpts and requires full coverage for original scope', async () => {
  const {permitsEvidence,searchEvidence} = await import('../src/search.js');
  const capability = {companyId:'company-a',sourceRef:'legacy-a',sourceWide:false,
    accounts:[{sellerEntityId:'seller-a',sourceAccountId:'one'}]};
  const first = {companyId:'company-a',sellerEntityId:'seller-a',sourceAccountId:'one'};
  const second = {...first,sourceAccountId:'two'};
  const coverage = {companyId:'company-a',sourceRef:'legacy-a',identities:[first]};
  expect(permitsEvidence(capability,{...coverage,identities:[first,second]})).toBe(false);
  expect(permitsEvidence(capability,{...coverage,identities:[]})).toBe(false);
  const common = {snapshotId:'snap',sourceId:'source',sha256:'a'.repeat(64),
    locator:{kind:'json',pointer:'/amount'} as const};
  expect(searchEvidence([
    {evidence:{...common,id:'allowed',excerpt:'USD 200.00'},excerptCoverage:coverage},
    {evidence:{...common,id:'forbidden',excerpt:'USD 990.00'},excerptCoverage:{...coverage,identities:[second]}},
  ],capability,'USD',10)).toEqual([{id:'allowed',excerpt:'USD 200.00'}]);
  expect(() => searchEvidence([],capability,'x'.repeat(257),10)).toThrow();
  expect(() => searchEvidence([],capability,'x',51)).toThrow();
});
