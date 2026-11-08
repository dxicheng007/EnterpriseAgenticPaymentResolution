import { describe, expect, it } from 'vitest';
import type { ChangePage } from '@eapr/contracts';
import { extractDocument } from '@eapr/evidence';
import { validateChangePage } from '../src/change-feed.js';
import { BATCH_HEADER, decodeBatch, encodeBatch, eventB } from '../src/company-b.js';

const observedAt = '2026-10-01T00:00:00.000Z';
const raw = eventB({kind:'invoice',recordId:'bill-b',sourceAccountId:'cust-b-unknown',
  effectiveDate:'2026-09-01',fields:{amount_minor:300000,due_on:'2026-09-30'}},2,observedAt);
const page:ChangePage = {sourceRef:'legacy-b',streamId:'b-files',after:'1',next:'2',complete:true,events:[raw]};
const validate = (input:ChangePage) => validateChangePage(input,'legacy-b','b-files','1');

describe('source change contract', () => {
  it('accepts only a contiguous complete page and an unchanged empty cursor', () => {
    expect(validate(page)).toEqual(page);
    expect(validate({...page,next:'1',events:[]})).toMatchObject({next:'1',events:[]});
    expect(() => validate({...page,next:'1'})).toThrow('noncontiguous');
    expect(() => validate({...page,next:'0'})).toThrow('noncontiguous');
    expect(() => validate({...page,complete:false})).toThrow('noncontiguous');
    expect(() => validate({...page,after:'2',events:[]})).toThrow('noncontiguous');
    expect(() => validate({...page,events:[{...raw,contentHash:'0'.repeat(64)}]})).toThrow('conflicting');
    expect(() => validate({...page,next:'3',events:[raw,{...raw,sequence:3}]})).toThrow('conflicting');
  });

  it('preserves exact B transport columns and unknown raw account identity', async () => {
    const bytes = encodeBatch([raw]);
    expect(bytes.toString('utf8').split('\n')[0]).toBe(BATCH_HEADER.join(','));
    const {document} = await extractDocument('event_csv',bytes);
    expect(decodeBatch('b-files',document)).toEqual([raw]);
    expect(raw.rawIdentity.sourceAccountId).toBe('cust-b-unknown');
    expect(Object.hasOwn(raw,'scope')).toBe(false);
    expect(() => decodeBatch('b-receipts',document)).toThrow('envelope');
  });
});
