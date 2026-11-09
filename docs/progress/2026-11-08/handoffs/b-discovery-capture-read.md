# Source-owner prerequisite: read-only validated discovery capture

Architecture-only dispatch brief. Requires root/fresh independent approval before implementation; separate from lifecycle L1/L2. Authority: accepted V4 orchestration proposal §§2–3 and frozen discovery shapes; lifecycle independent review explicitly approved this prerequisite's direction. No product/financial policy, provider, grants or candidate construction is introduced.

## Owned paths and deliverable

Source owner owns new `packages/sources/src/discovery-reads.ts`, minimal reuse extraction/export in `packages/sources/src/dossier.ts` and public export in `packages/sources/src/index.ts`; `packages/sources/test/discovery-reads.test.ts` for pure normalization/error tests if useful, and `tests/integration/discovery-capture-read.test.ts` for real PostgreSQL/corruption proof. No migration, lifecycle implementation, contracts, composition, evaluator, compiler, UI, worker, seed or fixture-answer edits. Existing source tests may be run unchanged. No new source mutation entry point.

Publish exactly this server-side API from @eapr/sources (use existing types, not another wire contract):

```ts
import type { Pool } from 'pg';
import type { DiscoveryBinding, DiscoverySubject, Id } from '@eapr/contracts';
import type { EvidenceStore } from '@eapr/evidence';
import type { SourceDefinition } from './records.js';

export type ValidatedDiscoveryCapture = {
  readonly binding: DiscoveryBinding;
  readonly sourceAccounts: readonly Extract<DiscoverySubject, { kind: 'source_account' }>[];
  readonly evidenceIds: readonly Id[];
};

export function readDiscoveryCapture(
  dependencies: { db: Pool; store: Pick<EvidenceStore, 'get'> },
  catalog: ReadonlyMap<Id, SourceDefinition>,
  input: { companyId: Id; manifestId: Id },
): Promise<ValidatedDiscoveryCapture>;
```

`sourceAccounts` is the unique lexically ordered set of exact `(sellerEntityId,sourceAccountId)` tuples observed in validated captured raw-event identities, excluding records with no sourceAccountId. It is not a customer/parent map; document names cannot generate tuples. Validate every event's rawIdentity company/source/resource contract first. Distinct seller entities remain distinct even for equal sourceAccountId. `evidenceIds` is the complete unique lexically ordered aggregate citation membership, not a selected evidence subset. `binding` contains exactly companyId, sourceRef, manifestId, manifestHash, snapshotId and snapshotHash as defined by DiscoveryBindingSchema. Return detached schema-validated values; no pool/store/metadata object references or raw source body. Do not add `allowedAccountIds`, SourceReadGrant, reviewer data, proposed financial values, candidates, hashes of generated artifacts or eligibility flags.

Lifecycle adapts this function with a closure: `(companyId,manifestId) => readDiscoveryCapture({db,store},catalog,{companyId,manifestId})`. Lifecycle owns request authorization and its current server policy check before calling. The validator enforces source/capture consistency but is not authorization. No always-allow authorizer or grants can escape its boundary.

## Error boundary

Use the existing `SourceError(status,code,message,diagnostics)`; no Fastify import in source package. Input malformed →400 SOURCE_CONTENT_INVALID. Unknown catalog company →404 SOURCE_NOT_FOUND; selected absent manifest →404 MANIFEST_NOT_FOUND; absent aggregate snapshot →404 SNAPSHOT_NOT_FOUND. Incomplete capture/missing pinned member or citation →409 MANIFEST_MEMBER_MISSING; company/source/epoch/aggregate-vs-stream mismatch →409 SOURCE_EPOCH_CONFLICT; differing canonical hash/content/membership/citation →409 SOURCE_HASH_CONFLICT. Registered event content/locator validation may preserve existing422 SOURCE_CONTENT_INVALID/CITATION_INVALID. Unavailable DB/blob service →503 SOURCE_UNAVAILABLE with safe message. Preserve existing source inspector missing-blob/hash-conflict classification; do not silently turn a missing/corrupt blob into a complete capture. Zod failures parsing corrupt persisted rows become a safe source integrity error, not raw schema/SQL data in diagnostics. Diagnostic arrays use existing safe ID/code/field-path shapes, never paths/credentials/full documents.

L2 route adapter, outside this owner's paths, preserves these fields:

```ts
catch (error) {
  if (error instanceof SourceError) {
    throw Object.assign(error, { statusCode: error.status });
  }
  throw error;
}
```

This follows existing preview composition. Route error handler emits existing ApiError shape with request correlationId and safe message/diagnostics. No `statusCode` addition to SourceError itself is necessary. No request should reclassify missing configuration as source corruption: lifecycle only invokes this validator for new configured starts, not authorized idempotent replay.

## Validation algorithm and reuse boundary

1. Parse input IDs; resolve registered SourceDefinition from the supplied catalog by exact company. Read exact `readManifest(db,companyId,manifestId)`, never latest. Validate stored row/JSON IDs and company/source consistency, `hashManifest`, and registered stream membership using current source inspection rules.
2. Read the already persisted aggregate for the selected manifest: SQL aggregate row must have `stream_id IS NULL`, snapshotId `snapshot:` + manifestId, exact manifestId/sourceRef, and matching dossier identity. Require dossier complete with no missing-member/blocker diagnostics, aggregate in dossier snapshotIds; do not accept the flag as proof. The validator never calls captureBaseline, publishBaseline, captureSnapshot, uploads or store.put.
3. Reuse current `inspectBaseline` in dossier.ts, `documentCitations`, `aggregateHash`, `streamContentHash`, `validateSourceEvent` and `citeEvidence` as appropriate. Minimal extraction may narrow inspector dependencies to `{db,store}` because it does not use clock. Export shared helpers only to internal modules where possible; public index needs only readDiscoveryCapture and its result type. Existing captureBaseline continues to use identical logic and its original write boundary. Do not add a parallel hand-written capture hash or source coverage parser.
4. Inspector presently validates file version/batch metadata/extraction hashes, source bytes with store.get, pinned stream membership/hashes and event sequence. Extend the read validator around that reuse to validate the aggregate and stored citation rows, not merely recompute what a new capture would contain. Exact sorted aggregate eventIds must equal inspected eventIds; aggregate evidenceIds and dossier evidenceIds must equal freshly recomputed complete citation IDs. Their canonical aggregate hash must equal stored snapshot.contentHash. Extra/missing/duplicate IDs fail; do not repair or truncate. Newer legitimate events beyond the pinned manifest watermark do not invalidate or enter the selected capture.
5. Read every stored citation in that exact aggregate. Validate relational snapshot_id and file_id/api_source_id association as well as parsed EvidenceRef; compare its complete canonical citation to recomputation (ID/snapshot/source/locator/excerpt/hash). Wrong-source/other-manifest references fail even when original byte hash coincides. Check original blob availability/hash and stored byte length; use existing store.get verification. Validate API original extraction/event association and registered event contract; do not trust a syntactically valid changed JSON payload merely because its stored hash field was changed. Missing original metadata that prevents recomputing required citation membership is a blocker. Never synthesize absent source_evidence rows.
6. Derive sourceAccounts only from the fully validated pinned raw events, then return binding/sourceAccounts/evidenceIds. This is a captured-membership fact, not proof of semantic financial correctness, evidence support, document account coverage or authority.

All database operations are reads; no advisory locks, counter updates, notifications or activity publication. Blob reads occur outside any held database transaction/row lock. Immutable manifest/snapshot/event/file/evidence rows are SELECT/INSERT-only for current application role (002_sources.sql); dossier alone is mutable. Recheck exact bound immutable identities/hash/membership and dossier consistency after external reads before return, and lifecycle rechecks pinned identity at creation. Concurrent dossier changes cannot create valid aggregate proof. A later manifest publication must not change the selected result. This does not claim atomic protection against privileged operator corruption after validation or physical blob loss after return; future reads still validate and fail closed. Do not solve that limitation by retaining DB locks over external I/O.

## Required tests and acceptance evidence

Use real migrated isolated PostgreSQL with app credentials for the validator. Privileged corruption setup is test-only, never a product capability. Construct/capture normal public source input with existing source helpers, then take the before baseline. Do not import demo-candidates/buildDemoCandidate or any expected connector/profile. Compare all source rows, control activity counter/events and existing lifecycle rows if installed before/after each validator invocation; compare runtime schema/ledgers/activity unchanged. A query recorder can additionally reject non-SELECT SQL, but it does not substitute for persisted-state assertions. Observe store.get only, never put. No production test hooks required.

- Both acquired-company complete captures succeed with exact binding hashes, independently expected raw tuple set and complete citation set. Distinct seller/account pairs remain separate; no parent IDs/grants/candidate outputs. Repeat returns equal data and no writes.
- Select an older capture after newer manifest publication: binding, tuple/citation sets remain pinned; no latest fallback or recapture. Stream-only snapshot cannot pass as complete aggregate.
- Missing/false/inconsistent dossier, missing aggregate, missing stream/event/file/citation/original blob fail as specified, zero writes. A forged dossier.complete=true does not make missing members pass.
- Privileged corruptions: manifest hash, stream watermark or membership/hash, event payload or row-vs-JSON identity, aggregate hash/eventIds/evidenceIds, citation locator/excerpt/hash/id/source/association, extraction hash, original byte length/hash. Individually restore baseline between cases; each fails with expected safe code and does not alter the corrupted baseline by repairing it.
- Mixed company/manifest and cross-epoch citation tests include equal original-byte hashes so hash coincidence cannot mask binding failure. Duplicate/extraneous IDs and a validly hashed wrong registered resource event fail.
- Barrier while store.get waits: publish a later epoch or change dossier completion metadata; resume. Later epoch never enters the old result; invalid selected dossier fails. No DB transaction/row lock was retained during the barrier and no capture/activity writes occur. Tests use barriers, not sleep ordering.
- Unavailable store/DB produces safe503; malformed inputs safe400. Error adapter unit test can be written in later L2 owner scope; this prerequisite tests SourceError.status/code/diagnostics and excludes filesystem/SQL/private payloads in messages.

Run `npm run typecheck`, focused source unit tests where added, and `npm run test:integration -- tests/integration/discovery-capture-read.test.ts`; regression `tests/integration/v1-manifests.test.ts` and `tests/integration/v1-evidence.test.ts` because shared inspection may be extracted. Label these partial, not live construction, full V4 or joint acceptance. One coherent commit suggested: `feat: validate pinned discovery captures without writes`. Fresh exact-candidate review follows; source owner reports API signature, files, checks and commit to root before lifecycle L2 consumes it. Lifecycle L1 does not wait for this prerequisite.
