# API and semantic durable capture implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for this bounded assignment. Steps use checkbox syntax. Do not dispatch other agents or implement later stages from the broader design.

**Goal:** Initialize API/semantic capture from genuine committed A5 authority and durably store complete source pages with replay/conflict protection and truthful capture-only progress.

**Architecture:** A source-neutral internal worker service resolves an immutable committed activation, binds a capture lane and accepts existing ChangePage values. PostgreSQL stores global source identity, lane inbox membership and complete pages atomically with capture checkpoints/activity. No source client, HTTP endpoint, scheduler, monetary application or connection-status changes are included.

**Tech Stack:** Existing Node 24, strict TypeScript, Zod, pg/PostgreSQL 18 and Vitest; no dependencies added.

**Spec:** [corrected P3 design](../../progress/2026-11-08/handoffs/platform-sync-design.md), [initial review](../../progress/2026-11-08/reviews/platform-sync-design-review.md), [correction review](../../progress/2026-11-08/reviews/platform-sync-design-fix-review.md), [frozen F1/F4/F7](2026-11-08-contract-freeze.md) and repository instructions. Planning source baseline `108578bdf10040a8404992cbff9102d30f7e8c85`; root-confirmed dispatch baseline `32df33fc3acd1ca8000ded5f66cbe6f6ad95d5fb` on `codex/platform-sync-capture` has an identical tree after main integration. The broader design's apply/control sections remain separate unapproved gates.

## Global constraints

- Runtime has no model calls, SDK, key, protected evaluator import or control database credential. Tests may use the real source service through their separate control pool; production service receives pages only.
- Zero changes to parent records, targets, snapshots, activation imports, initial receipts or economic/delivery outcomes. Adding immutable `runtime_deliveries` capture facts is allowed; it is not monetary application.
- Delivery uniqueness is global `(sourceRef,event.id)` including exact canonical content/observedAt; position uniqueness is global `(sourceRef,streamId,sequence)`. Neither contains lane, account alias or connector version.
- Lane key is `(sourceRef,manifestHash)`. Only a successfully decoded committed A5 import may establish it. Callers cannot supply source definitions, baseline, profile, grant or artifact.
- This phase rejects the **entire lane** if its artifact has any CSV transport or manifest has any `event_csv` file. Error `CAPTURE_TRANSPORT_UNSUPPORTED`, with no capture writes. Do not initialize only B's receipt/semantic subset or invent pending CSV coverage. CSV original-byte verification and batch-gap transport require the source-owner phase.
- API/semantic pages contain at most their pinned stream pageSize (1..1000). Validate complete contiguous envelopes and hashes, not financial interpretation. Unknown accounts and changed declared schema/semantic versions remain captured raw facts; no approved scope is fabricated.
- Existing migrations are immutable. `db/runtime/003_sync_capture.sql` is exclusively reserved by root for this bounded task after fetched main/Discovery/Experience catalog checks all ended at runtime002; implementation still waits independent plan review. No control SQL. Capture confers no financial authority. Acquire each complete position-key and delivery-key set once in deterministic compatible order before writes.
- Machine tests, independent exact-candidate review and joint acceptance remain separate. This phase cannot pass V5/V6 or establish both-source AI-off synchronization.

## Review focus

- Concurrent loser with changed accepted overlap must conflict, even when its cursor is stale and its event hash was recomputed.
- A harmless longer stale page must not insert its suffix or advance the cursor; refetch handles it once.
- An A5 bundle includes full source baseline evidence, while initial monetary delivery outcomes may cover only the selected account. Seed global baseline identities from the full checked bundle without claiming all were imported.
- Two lanes can race on the same global position using different event IDs. Serialize positions as well as delivery IDs; SQL uniqueness is a final guard, not a replacement for a safe conflict result.
- Empty-at-head pages must not permanently occupy an `after` key and reject later real source growth.

## Files and ownership

One independently reviewable task includes contracts/storage/service/tests because their only consumer is this bounded internal service. No second independently useful interface is required.

Create:

- `packages/contracts/src/sync-capture.ts`: strict capture DTOs and safe diagnostic vocabulary.
- `packages/contracts/test/sync-capture.test.ts`: structural/refinement tests.
- `apps/worker/src/sync/capture.ts`: public internal factory and bound service orchestration.
- `apps/worker/src/sync/capture-store.ts`: transaction-bound persistence, identity comparison and reads.
- `apps/worker/src/sync/bootstrap.ts`: committed A5 resolution and lane initialization.
- `apps/worker/src/sync/capture-errors.ts`: typed safe errors.
- `db/runtime/003_sync_capture.sql`: root-reserved for this phase.
- `tests/integration/sync-capture.test.ts`: isolated real PostgreSQL, A5 and source-service behavior.

Modify the integrator-reserved `packages/contracts/src/index.ts` to export new schemas/types. This extends the contracts barrel dependency closure: add `sync-capture.ts` to both explicit contract source lists in `packages/evaluator/src/financial-attestation-build.ts` and `packages/evaluator/src/bootstrap-runner.ts`. Extend `packages/evaluator/test/financial-attestation-build.test.ts` and `packages/evaluator/test/bootstrap-build.test.ts` to prove recursive closure coverage and that mutation of the new leaf changes the corresponding build identity; follow existing closure-test helpers. These narrowly reserved producer-maintenance edits change build binding only, not expected financial results or eligibility rules. The worker must not import either evaluator module. No package export-map change is needed. Existing contracts imports use the root package; worker modules import each other directly. No changes to parent, compiler, sources, storage/activity, server/dev composition or slice verification runners are authorized. Only the two named evaluator closure lists/tests above are in scope. Migration discovery uses existing `readMigrationCatalog`; no hard-coded catalog rewrite is needed. If an existing regression hardcodes runtime002, report its exact file/assertion to integrator for a narrow reservation instead of editing outside scope.

## Exact internal contracts

All below are strict Zod objects; use existing guarded schemas and reject unknown keys/prototype keys recursively. Cursor means existing decimal safe-integer CursorSchema. Define local checked positive/nonnegative integer schemas with `Number.isSafeInteger` refinements rather than assuming positivity alone implies safety. Hashes/IDs/instants/scope use existing contracts. All persisted arithmetic uses checked addition/subtraction; SQL BIGINT is parsed explicitly from text.

```ts
type CommittedCaptureIdentityV1 = {
  scope: Scope; activationId: Id; bundleHash: Hash;
};
type CaptureLaneV1 = {
  schemaVersion: '1'; sourceRef: Id; manifestHash: Hash;
};
type CaptureIncidentCodeV1 =
  'CAPTURE_IDENTITY_CONFLICT' | 'CAPTURE_PAGE_CONFLICT' | 'CAPTURE_GAP';
type CaptureIncidentSummaryV1 = {
  code: CaptureIncidentCodeV1; pageHash: Hash;
  sourceIds: Id[]; observedAt: IsoInstant;
};
type CaptureStreamProgressV1 = {
  streamId: Id; transport: 'api' | 'semantic';
  baselineCursor: Cursor; captureCursor: Cursor;
  capturedRecords: number; capturedPages: number;
  lastCapturedAt: IsoInstant | null;
  lastIncident: CaptureIncidentSummaryV1 | null;
};
type CaptureProgressV1 = {
  schemaVersion: '1'; lane: CaptureLaneV1;
  streams: CaptureStreamProgressV1[];
};
type CaptureResultV1 = {
  disposition: 'captured' | 'replayed' | 'empty' | 'refetch';
  captured: number; cursor: Cursor; replayed: boolean;
};
```

Export schemas/types with exactly those names plus `Schema` suffix for validators. Stream arrays are unique/sorted lexically by streamId (empty allowed only if the bound accepted artifact/manifest genuinely has no streams). `sourceIds` is a unique lexically sorted array, maximum 20; it contains event IDs only, deterministically first 20 conflicting IDs. `capturedRecords` and `capturedPages` are safe nonnegative integers, count only post-baseline lane memberships/nonempty accepted pages. Require captureCursor≥baselineCursor and capturedRecords=Number(captureCursor)-Number(baselineCursor). Require pages≤records; zero records iff zero pages iff lastCapturedAt is null. `lastIncident` is historical, not current blockage/lag. No application cursor, applied/pending/quarantine counts, CSV cursor, source high water, measured amount or model-call claim appears in this capture-only DTO. Those facts do not exist in this phase.

Result invariants: captured disposition has captured≥1/replayed=false; replayed disposition captured=0/replayed=true; empty/refetch have captured=0/replayed=false. cursor is the committed current cursor, not the response's proposed next cursor. Empty means valid empty page at current checkpoint only; it is not a claim that the source is caught up forever.

Factory in `capture.ts`:

```ts
createRuntimeCapture({db, clock}: {db: Pool; clock: Clock}): {
  openCommitted(identity: CommittedCaptureIdentityV1): Promise<{
    lane: CaptureLaneV1;
    capturePage(page: ChangePage): Promise<CaptureResultV1>;
    readProgress(): Promise<CaptureProgressV1>;
  }>;
}
```

The returned closure binds verified persisted lane metadata. It is internal, not a public authorization capability or serializable grant. Every operation rechecks stored lane/stream bindings and digest on read. No method accepts a lane selector, caller-provided bundle or baseline. `openCommitted` reads `readStoredActivation(client, identity.scope)` from `@eapr/parent/activation-store` and requires exact activation.id and stored.bundleHash equality; absence is `CAPTURE_ACTIVATION_NOT_FOUND`. Existing `readStoredActivation` validates canonical stored history; malformed/corrupt history yields `CAPTURE_STORAGE_INVALID`, never a fallback to caller input.

Use `CaptureError` with `code` and `statusCode`, safe fixed message, no payload/SQL/paths. Codes: malformed DTO/page `CAPTURE_INPUT_INVALID`400; missing committed identity404; unsupported CSV422; lane stream-definition mismatch `CAPTURE_BINDING_CONFLICT`409; incomplete/noncontiguous/ahead-of-checkpoint `CAPTURE_GAP`409; changed delivery/position `CAPTURE_IDENTITY_CONFLICT`409; changed page at occupied boundary `CAPTURE_PAGE_CONFLICT`409; corruption503 `CAPTURE_STORAGE_INVALID`; DB/incident-write failure503 `CAPTURE_UNAVAILABLE`. No HTTP route is implemented.

## Reserved additive DDL contract

Use existing `parent_index_projection`, `encodeCanonical`/`decodeCanonical`, safe textual IDs/hashes, runtime001 activity and runtime002 delivery history. Canonical text preserves exact JSON encoding; no JSONB replacement of original bytes. For each canonical column persist lowercase SHA-256 digest; check JSON object/array shape and relevant scalar binding using the existing projection function. Repository decoders must verify digest/canonical equality and strict schemas, because SQL cannot authenticate a hash. All identifiers use root Id regex; counters BIGINT 0..9007199254740991; positive positions 1..9007199254740991.

| Table | Required columns, keys and checks |
| --- | --- |
| `runtime_capture_lanes` | `source_ref,manifest_hash` composite PK; `initial_activation_id` FK to runtime_activation_imports.activation_id; `manifest_canonical,manifest_digest,capture_canonical,capture_digest,initialized_at`. Immutable. Source/hash must match decoded manifest; exact capture array includes streamId/transport/resources/pageSize. Initial activation pointer is provenance, not exclusive ownership of shared lane. |
| `runtime_capture_checkpoints` | lane + `stream_id` PK/FK lane; `transport` api/semantic; `baseline_cursor,capture_cursor,captured_pages` safe BIGINT; `last_captured_at` nullable canonical instant text. capture≥baseline; pages≤capture-baseline; `(capture=baseline) = (pages=0) = (last_captured_at IS NULL)`. No revision needed: cursor CAS fences nonempty advancement. |
| `runtime_source_positions` | `(source_ref,stream_id,sequence)` PK; unique `(source_ref,event_id)` and unique `(source_ref,stream_id,sequence,event_id)`; FK `(source_ref,event_id)` to runtime_deliveries. Immutable. Decoded delivery must match all projected keys. |
| `runtime_capture_pages` | lane + stream + `after_cursor` PK; `next_cursor,event_count,canonical,digest,captured_at`; FK checkpoint; check event_count between1..1000 and next-after=event_count, next>after. Strict decoded complete ChangePage matches keys/range/count; repository additionally enforces pinned pageSize. Empty pages never inserted. |
| `runtime_inbox` | lane + stream + `sequence` PK; unique lane + event_id; `source_ref,event_id,after_cursor`; FK lane/stream/after to page; FK `(source_ref,stream_id,sequence,event_id)` to global position. Immutable. Repository enforces after<sequence≤page.next and exact page membership. Baseline events have global identities but no post-baseline inbox rows. |
| `runtime_capture_incidents` | lane + stream + `incident_hash` PK; FK checkpoint; `code,page_hash,source_ids_canonical,source_ids_digest,observed_at`; code fixed enum above, at most20 safe sorted unique IDs. incident_hash=hashCanonical({lane,streamId,code,pageHash,sourceIds}), excluding observation time. First identical incident retained; deduplicated retries do not grow history. No raw rejected page/document/body/message persisted. |

Use immutable triggers calling existing `reject_parent_history_mutation` on lanes/positions/pages/inbox/incidents; grant SELECT/INSERT only. Checkpoints permit SELECT/INSERT and UPDATE only capture_cursor,captured_pages,last_captured_at; immutable lane/stream/transport/baseline columns cannot be changed by app role. Existing runtime_deliveries grants are already sufficient. App roles get no DDL or cross-database access. Test direct UPDATE/DELETE denial and FK/key failures.

No extra table for baseline members: the pinned manifest plus full checked stored bundle supplies baseline membership, and global positions/deliveries preserve those identities. Reopening a lane compares exact canonical manifest and capture definitions; it must not compare initial activation ID for equality when another genuine committed activation shares that lane.

## Initialization and capture algorithm

### Initialization

`bootstrap.ts` exports `initializeCommittedCapture(client:PoolClient, identity:CommittedCaptureIdentityV1):Promise<CaptureLaneV1>` for an already-open runtime transaction. `capture-store.ts` keeps other SQL helpers internal; expose `captureBoundPage(db,clock,lane,page)` and `readBoundProgress(db,lane)` for the service. No nested transactions.

Resolve/decode genuine A5 import first. Reject CSV-bearing lanes before writes. Validate artifact hash/source binding, manifest hash and complete capture/manifest stream set equality; exact activation baseline vector must equal manifest streams, including zero cursors. Independently verify each stream baseline events from stored.bundle.bootstrapEvents: unique global delivery IDs, stream membership/resource assignment, sequences exactly1..resumeAfter, event hash, member event ID set, and existing `streamContentHash` canonical preimage using contracts hash helpers (do not import sources into production worker). Manifest has no invented event or omitted baseline member. This verifies envelope membership and prior committed binding; it does not repeat protected verification or claim original-file verification.

Lock `canonicalJson(['capture-lane',sourceRef,manifestHash])` through `lockParentKeys`. If lane already exists, compare decoded canonical manifest/capture definition, still check full baseline against global identity, and return without resetting checkpoint/history. For a new lane insert only after all checks succeed. Acquire all global stream keys `canonicalJson(['capture-source-stream',sourceRef,streamId])` in one `lockParentKeys` call, then `lockImportIdentities(client, [], fullBaselineEvents)` once. Reuse exactly its parent-delivery keys/order; never issue private ad hoc delivery locks.

Compare existing global deliveries and source positions across all baseline events. Insert missing canonical runtime_deliveries/positions only after all comparisons succeed. Preserve A5 originals; no financial outcomes created for unimported baseline events. Insert lane and every checkpoint at its own baseline cursor, zero pages, null lastCapturedAt. No source.captured event for baseline initialization (it is not new capture). Entire initialization is atomic. Existing-lane conflict returns safe error, does not change/checkpoint or invent incident page. New-lane conflict leaves no lane.

### Page validation and transaction

1. Detach input via strict parse/canonical encoding; bind page source/stream to closure and saved capture definition. Reject unsafe sequence arithmetic, >pinned pageSize, duplicate IDs, bad hashes, resource outside stream, invalid raw identity/envelope or missing complete flag. Do not run financial mapping or reject known envelope merely because a financial schema/semantic revision differs; interpretation belongs later. Canonical valid but incomplete/noncontiguous pages produce CAPTURE_GAP incident; structurally malformed/unhashable input returns400 without retaining raw input.
2. `withTransaction` checks out one client. Lock bound checkpoint row `FOR UPDATE`; acquire global source-stream key using `lockParentKeys`, then `lockImportIdentities(client, [], page.events)` once. Capture acquires no account/target/authority locks. Global stream lock serializes distinct event IDs competing for a position across lanes; A5 does not use it but shares delivery locks. Initialization never locks an existing checkpoint after acquiring stream/delivery keys. Thus no reverse checkpoint/stream dependency is introduced.
3. Compare **all** existing delivery canonical bytes/hash and global position bindings before any stale return, including observedAt and changed-ID-at-same-position conflicts. Compare accepted page content when exact stored boundary/range matches. Conflicts roll back this transaction, then record incident separately as below; unique SQL violations are decoded/rechecked as conflicts, not swallowed as replay.
4. If page.after>current cursor: gap, no writes. If page.after<cursor: exact stored canonical page returns replayed with current cursor; otherwise matching overlap with different page boundaries returns refetch with current cursor, no suffix insertion. A page wholly before baseline still checks global identities then returns refetch (no stored post-baseline page exists). A stored boundary with same next but changed canonical page is conflict, including complete/envelope data, not ordinary growth. Empty stale response returns refetch, not replayed.
5. At current cursor: empty complete page returns empty with no checkpoint/page/activity mutation. Nonempty valid page inserts missing deliveries/positions, immutable complete page and inbox memberships; increments captured_pages once and cursor to next under `WHERE capture_cursor=after`; lastCapturedAt from one injected clock instant. Capture result count is page.events.length (new lane memberships), even when deliveries already exist globally from another lane. If CAS affects zero rows, rollback; no silent success.
6. Publish existing `publishActivity` last in the same transaction: `{stream:'runtime',phase:'run',type:'source.captured',at,payload:{sourceRef,manifestHash,captured:page.events.length}}`. No scope (page may include multiple/unknown accounts), streamId/custom fields that existing sanitizer would discard, document payload or raw source IDs. No activity on replay/refetch/empty; clients later refetch progress. No emitter or SSE route is added. Commit once; receipt/money/application state untouched.

`readBoundProgress` executes one SQL statement that selects checkpoint rows and lateral latest incident (ORDER BY observed_at DESC,incident_hash DESC), ordered by streamId. This supplies one PostgreSQL statement snapshot without changing global transaction helper isolation. Validate saved lane/stream/counter projection on decode. Reads are internal source-lane-wide data; no public account authorization claim. Corrupt digest/row is503, never partial progress.

### Safe incidents

Only initialized, source/stream-bound requests can write incidents. Compute pageHash from canonical rejected valid JSON; safe schema checks apply before persisting any IDs. For gap cases lacking valid event IDs use an empty array. Roll back page transaction first, then a separate `withTransaction` inserts immutable deduplicated incident and returns the typed original failure. It acquires no checkpoint row lock beyond FK validation and no source-stream/delivery lock; never moves cursor or emits source.captured. If incident persistence fails, return CAPTURE_UNAVAILABLE, retaining neither a success nor a false claim that the incident was saved. Repeated identical incident preserves original observedAt. This phase has no incident-resolution or clear command.

## Task 1: implement bounded durable capture

**Consumes:** exact committed A5 `readStoredActivation`, `lockParentKeys`, `lockImportIdentities`, canonical snapshot helpers, `withTransaction`, `publishActivity`, existing ChangePage schema/hash helpers. Test-only `fetchChanges` and `createScenarioAdmin` consume their actual source pool.

**Produces:** strict DTOs, reserved runtime003, internal bound capture service, real PostgreSQL capture evidence only.

- [ ] **Step 1 — Confirm reserved base/catalog and create meaningful failing tests.** Check HEAD, status and runtime catalog without disturbing other work. Root has reserved runtime003; confirm the contracts index and named evaluator closure-list/test ownership at dispatch. Add contracts tests for extra keys, unsafe counts/cursors, unsorted/duplicate streams/incident IDs, count/cursor inconsistency, impossible result combination and nullable timestamps. Add initial integration assertions that exercise service behavior after minimal importable scaffolding, not only missing-symbol failure. Do not start implementation before independent plan acceptance.
- [ ] **Step 2 — Implement strict schemas and additive catalog.** Implement the exact shapes/refinements above and grants/triggers/FKs. Maintain both evaluator contract-source lists and their recursive/mutation coverage as specified in Files and ownership, so neither build pin silently omits the new barrel-exported leaf. Run `npm run test:unit -- packages/contracts/test/sync-capture.test.ts`; expected all tests pass with unsafe/unknown input rejected. Add PostgreSQL catalog tests for every identity uniqueness/FK, immutable history and app-role checkpoint column restrictions; migration fresh/reapply retains original migration hashes. Schema validity does not prove service behavior.
- [ ] **Step 3 — Prove committed-only initialization, then implement bootstrap.** Build genuine A5 imports by reusing `tests/fixtures/activation-proof.ts` (`issueActivationProofs`, `verifyOriginals`) and real `createWorkerActivation` as demonstrated in `tests/integration/v3-activation.test.ts`; no fake insert of activation history. Assert exact missing/wrong selector404, invalid committed row503, real B CSV-bearing import422 with zero capture tables populated, real A stream baseline vectors and baseline positions exact. Assert repeated open preserves progress; second valid committed subject sharing a lane cannot reset it; differing baseline manifest uses its own vector. Initialization conflict has no partial lane/deliveries. Add narrowly scoped helper inside new test file, not broad existing-fixture refactor.
- [ ] **Step 4 — Prove page atomicity and replay, then implement store/service.** Fetch fresh A API and semantic pages using real source `fetchChanges` after separately authorized `createScenarioAdmin` input. Do not embed test expected records in worker. Tests `capture complete page`, `empty then growth`, `exact replay`, `overlapping globally existing deliveries`, `unknown account raw capture`, `declared semantic revision capture`, `bad hash`, `incomplete`, `noncontiguous`, `oversized pinned page`, `wrong source/stream/resource`, `changed observedAt`, `same position different ID`, `same ID changed position`, and `ahead gap` assert checkpoints/pages/inbox/incident/activity precisely. Runtime parent snapshots, financial records, metadata, targets, imports and all outcome/lineage tables remain byte-identical before/after.
- [ ] **Step 5 — Prove races/rollback/restart with barriers.** `winning page then conflicting stale loser` must retain winner cursor, no loser suffix and one safe incident. `harmless longer stale loser` returns refetch, inserts nothing, then real refetch captures suffix once. `cross-lane same-position different-ID race` yields one accepted binding and one typed conflict. `same delivery concurrent capture` yields one canonical global delivery, appropriate lane membership and one activity per new page. Use a separately checked-out test SQL transaction holding checkpoint/delivery locks and barriers/query observation, never sleeps as correctness. Force transactional failure after page inserts using a test-local PostgreSQL trigger that raises on activity insert; verify all page writes/cursor/activity rollback. Remove test trigger, retry once, recreate service/pool and assert persisted progress/exact replay. Do not add production failpoint or reset endpoints. Concurrent first initialization is also barrier tested.
- [ ] **Step 6 — Verify safe progress/incidents.** Assert exact DTO keys/order/counters, baseline excluded from captured counts, null timestamps before capture, sticky historical incident after later successful capture, deduplicated incident timestamp, bounded first20 IDs and no rejected payload/path/token in incident/activity. Force incident-write failure with test-local DB trigger: operation is503 and never claims a durable incident. Read after committed capture always pairs cursor with count/pages from one statement snapshot. Count activity payload keys exactly; sanitizer must preserve all intended fields.
- [ ] **Step 7 — Run bounded checks and review.** Use Node24/PostgreSQL18 PATH and lane-exclusive DB lease. Run `npm run typecheck`; `npm run test:unit -- packages/contracts/test/sync-capture.test.ts packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/bootstrap-build.test.ts`; `npm run test:integration -- tests/integration/sync-capture.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts`. Expected zero failed/skipped assigned cases. Review production import graph: no sources/evaluator/model/operator/control imports except existing Clock type import; only runtime DB pool in service. Report commands/counts/migration hash and limitations. Existing source semantics need no regression rerun unless source code unexpectedly changes (which is outside this scope).
- [ ] **Step 8 — Commit coherent candidate after focused checks.** Stage only reserved paths and use `feat: add committed API source capture`. Send exact base/candidate hashes, changed paths and machine results to fresh independent reviewer through integrator. No V5/V6 pass, broader P3 completion or joint acceptance claim.

## Narrowing versus the broader design

This first deliverable deliberately rejects CSV-bearing lanes rather than partially initializing a vector without proven batch originals. No batch tables/schema or fabricated high-water/gap catalog is created. Capture-only progress exposes only facts available from persisted pages/checkpoints/incidents; later broader ConnectionState requires a separate versioned contract. The source-neutral page service is not mounted and cannot fetch data by itself. Application/dependency classification, current authority/control, ongoing receipts, scheduler, source transport and final model-off new-input acceptance remain deferred. These are explicit scope reductions, not new financial rules or missing facts filled by a default.
