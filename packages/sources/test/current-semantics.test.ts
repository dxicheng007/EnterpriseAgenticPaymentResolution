import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import { hashEvent, hashManifest, type RawSourceEvent } from '@eapr/contracts';
import { companyA, createSourceService, streamContentHash } from '../src/index.js';
import { eventA } from '../src/company-a.js';

const checkedAt = '2026-11-08T00:00:00.000Z';
const key = 'seller-a/same-account';

function semantic(sequence: number, revision: string, identity: Partial<RawSourceEvent['rawIdentity']> = {}) {
  const event = eventA({
    kind:'semantic_change', recordId:'semantic-' + sequence, sourceAccountId:'same-account',
    effectiveDate:'2026-11-08', semanticVersion:revision, fields:{revision:'payload-revision'},
  },sequence,checkedAt);
  const draft = {...event,rawIdentity:{...event.rawIdentity,...identity}};
  if (draft.rawIdentity.sellerEntityId === undefined) delete draft.rawIdentity.sellerEntityId;
  return {...draft,contentHash:hashEvent(draft)};
}

function observation(events: readonly RawSourceEvent[], versions: unknown = {[key]:'baseline'}, epoch = '10') {
  const manifest = {
    id:'latest',companyId:companyA.companyId,sourceRef:companyA.sourceRef,epoch:10,asOf:checkedAt,
    schemaVersions:Object.fromEntries(companyA.contracts.map(contract=>[contract.resource,contract.schemaVersion])),
    semanticVersions:versions,
    streams:companyA.streams.map(stream=>({
      streamId:stream.streamId,snapshotId:'latest:' + stream.streamId,resumeAfter:'0',eventIds:[],
      snapshotHash:streamContentHash(companyA.sourceRef,stream.streamId,'0',[]),
    })),
    files:[],
  };
  // Isolate the fold and validation from PostgreSQL. The integration suite uses real transactions.
  const db = {connect:async()=>({
    query:async(sql:string)=>{
      if (sql.includes('FROM source_manifests')) return {rows:[{
        manifest_id:manifest.id,company_id:manifest.companyId,source_ref:manifest.sourceRef,epoch,
        manifest:{...manifest,hash:Object.hasOwn(versions as object,'__proto__')
          ? '0'.repeat(64) : hashManifest(manifest as Parameters<typeof hashManifest>[0])},
      }]};
      if (sql.includes('max(sequence)')) return {rows:[{sequence:String(events.at(-1)?.sequence ?? 0)}]};
      if (sql.includes('FROM source_events')) return {rows:events.map(event=>({
        event,source_ref:event.sourceRef,stream_id:event.streamId,sequence:String(event.sequence),
        event_id:event.id,content_hash:event.contentHash,
      }))};
      return {rows:[]};
    },
    release(){},
  })} as unknown as Pool;
  return createSourceService({db,clock:()=>new Date(checkedAt),store:null!},
    new Map([[companyA.companyId,companyA]])).readCurrentSemantics(companyA.sourceRef);
}

it('folds envelope revisions by sequence, preserves sellers and governing entries', async ()=>{
  expect(await observation([
    semantic(1,'z-revision'),
    semantic(2,'other-seller',{sellerEntityId:'seller-other'}),
    semantic(3,'governing',{sellerEntityId:undefined}),
    semantic(4,'a-revision'),
  ],{[key]:'baseline','seller-a/unrelated':'untouched'})).toEqual({
    sourceRef:companyA.sourceRef,checkedAt,versions:{
      [key]:'a-revision','seller-a/unrelated':'untouched','seller-other/same-account':'other-seller','*':'governing',
    },
  });
});

it.each([{'bare-account':'revision'}, JSON.parse('{"__proto__":"revision"}'), {'constructor/account':'revision'}])(
  'rejects invalid baseline scope %j',
  async versions=>{await expect(observation([],versions)).rejects.toMatchObject({code:'SOURCE_SEMANTICS_UNAVAILABLE'});},
);

it('rejects unsafe row epochs and post-watermark gaps', async ()=>{
  await expect(observation([],{},'9007199254740993')).rejects.toMatchObject({code:'SOURCE_SEMANTICS_UNAVAILABLE'});
  await expect(observation([semantic(2,'revision')])).rejects.toMatchObject({code:'SOURCE_SEMANTICS_UNAVAILABLE'});
});
