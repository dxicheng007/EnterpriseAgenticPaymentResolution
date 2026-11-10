# Bounded Sync Apply Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Root preserves the assigned single Sol writer and fresh Astra review protocol; this document grants no additional writer or path ownership.

**Goal:** Repair the unmounted PR39 writer so one authorized customer's complete bounded captured financial suffix commits its financial effects, original-receipt associations, outcomes, progress and activity atomically.

**Architecture:** Retain runtime005's nonempty receipt and economic-origin tables, and add the missing audit, origin linkage, event outcome and application-head representation in runtime006. The worker independently reads the committed grant and captured source history, recomputes the accepted classifier against the locked target, and commits on one runtime connection. Exact recovery reads existing history before source preflight; new all-replay bookkeeping is a separate active-epoch transaction without a monetary receipt.

**Tech Stack:** Node 24, strict TypeScript, PostgreSQL 18/`pg`, Zod, Vitest; existing compiler, finance, parent and storage helpers.

**Spec:** [Reviewed atomic-apply design](../../progress/2026-11-08/handoffs/platform-sync-atomic-apply-design.md), SHA-256 `4e07cae264aaae9bd4790240332061bc48d540de3eb99275ba1629dae45084ce`; [coverage acceptance](../../progress/2026-11-08/reviews/platform-sync-atomic-apply-coverage-review.md); [PR39 defects](../../progress/2026-11-08/reviews/platform-pr39-722aaf7-review.md). Normative: [F1/F3/F5/F7](2026-11-08-contract-freeze.md), [PRD §§11/16](../../../prdv2.md), repository/area AGENTS, [ownership](2026-11-08-shared-contracts.md) and [verification conventions](2026-11-08-verification-playbook.md). Read the design with this plan.

**Status/base:** Plan only, inspected at `15bb421945bcfd1366e63ef497929737a2995bab` on `codex/platform-sync-apply-repair`. Root subsequently integrated PR46 at `98c82ef` (Discovery-only changes; inspected apply/storage/contracts unchanged); execution starts there or its reviewed successor. No implementation or machine pass. Root checked 75 fetched origin refs and PR46: runtime001–005/control001–009 only, and published the `db/runtime/006_sync_apply_repair.sql` reservation at `91e587e`. Fresh plan review precedes source permission.

## Global Constraints

- “Preview performs zero parent writes.” “The product neither issues invoices nor moves money.” Original evidence, approved snapshots, activations and financial records remain immutable.
- “The runtime worker must have no model calls, SDK, or key.” No control DB access, provider, scheduler, HTTP ingress, source fetch inside transactions, CSV implementation, live proof or general skip/resolve authority.
- Delivery identity is `(sourceRef,eventId)`; economic identity is `(sourceRef,sellerEntityId,kind,recordId)`. Versions and aliases never create money. Canonical delivery equality includes `observedAt`.
- Preserve the accepted `classifyBatch`/`planBatch` implementation and compact 180-case/39-outcome fixture, including all protected build pins. The classifier dependency was accepted at `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6`; integrated PR40 preserves that boundary. Do not remap money or introduce another economic-equivalence comparator.
- Use checked integer cents and safe versions/cursors. Enforce both committed grant and compiler limits: at most 1,000 inputs and 5,000,000 cents per transaction. The narrow coverage bound is additionally 1,000 events across **all retained post-baseline history**, not just this suffix.
- Runtime001–005 bytes are immutable. Runtime005 SHA-256 is `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96`. All schema repairs are additive; no reset of existing databases or inferred historical progress.
- Exactly one committed API/semantic lane, exactly one financial API stream and one unchanged-at-baseline semantic stream, one selected scope, complete captured unapplied suffix, exactly one complete accepted dependency group. Unsupported coverage fails closed without outcomes, progress or automatic authority changes.
- New effects **and new all-replay acknowledgment/progress** require current active authority and exact epoch through commit. Exact committed operation recovery is read-only even after pause/revoke, target advancement or source outage.

## Review Focus

- Hash-valid caller events with no captured provenance must never become financial records — Task 2 `forged_uncaptured_input` and Task 3 `caller_plan_cannot_select_foreign_delivery`.
- A mixed receipt acknowledges replay events without replacing their initial/ongoing original receipt — Tasks 1/3 `mixed_original_receipts` and `origin_domain_exclusivity`.
- Selection must not hide an orphan, semantic change-then-return, incident or concurrently captured prefix — Task 2 coverage matrix and Task 4 capture barriers.
- Old epochs cannot write replay bookkeeping, and lost responses cannot append duplicate activity — Tasks 3/4 replay and authority barriers.
- An exception after any write must leave target, outcomes, frontier and activity counter together at their prior values — Task 4 rollback matrix.

---

## Representation and compatibility decisions

PR39 has only `runtime_sync_receipts`, `runtime_sync_economic_outcomes` and `runtime_sync_delivery_outcomes`. The last table can point only to an ongoing receipt and contains no record link; it cannot express replay of an initial import. Do not stretch it into the new outcome representation. Keep its historical rows immutable and SELECT-readable, stop inserting into it, and revoke its application-role INSERT privilege additively. Validate any encountered old association against its real original economic origin; contradictions are storage errors, not permission to rewrite it.

Keep every new nonempty monetary receipt in **the existing** `runtime_sync_receipts`, with its existing `receipt`, `before_version`, `after_version`, `plan` and digest columns. Keep original ongoing economics in `runtime_sync_economic_outcomes`. Its scoped record relationship needs an additive composite FK, backed by an additive unique key on `parent_financial_records(account_id,company_id,seller_entity_id,record_id)`. Do not introduce a second monetary-receipt table. The exact canonical plan already contains ordered lineage: validate and retain it there, rather than creating a redundant lineage table.

Add four tables:

| Table | Required representation and constraints |
| --- | --- |
| `runtime_financial_origins` | One `record_id` PK, exact scope, nullable `(initial_import_key,initial_receipt_id)` and nullable `sync_receipt_id`; exactly one initial pair or ongoing ID. Scoped record FK and typed noncascading FKs to runtime002 import/runtime005 receipt. This is the common uniqueness authority across the two existing economic-origin domains. |
| `runtime_sync_units` | `unit_hash` PK; full scope/activation/bundle/manifest, epoch, financial stream, from/through cursors, target-before version/hash, target-after version/hash, nullable scoped `receipt_id`, and strict canonical audit plus digest. Unique `(activation_id,manifest_hash,stream_id,from_cursor)` prevents two terminal units starting at the same frontier. FK to exact committed import, lane, before/after snapshots and optional runtime005 receipt. `receipt_id IS NULL` means all-replay with unchanged target; otherwise after version is before+1. No empty suffix. |
| `runtime_sync_event_outcomes` | Global `(source_ref,event_id)` PK, exact scope/activation/lane/stream/sequence, `record_id`, first acknowledging `unit_hash`, disposition `new|replay|coalesced`. Scoped origin FK, scoped unit FK, exact inbox membership FK and source-position FK. Add the required unique keys to referenced tables in 006; do not change 003. Unique `(activation_id,manifest_hash,stream_id,sequence)`. Canonical payload/digest bind scalar indexes and original receipt reference. |
| `runtime_sync_application_heads` | One row per `(activation_id,source_ref,manifest_hash,stream_id)`, exact scope, immutable baseline, `applied_through`, nullable `last_unit_hash`. Scoped committed-import/lane/checkpoint FKs. Only progress pointers may update, with monotonic safe-integer checks and matching unit endpoint. Semantic head stays at baseline. No general resolved/skip states. |

The unit audit stores ordered distinct full delivery references and their record/origin associations. This is acknowledgment membership, separate from each delivery's first outcome and its economic origin. Nonempty units cross-check that list against `plan.eventIds`; the single-source precondition makes those IDs unambiguous. Reuse an existing exact delivery outcome without rebinding it; record any membership in the new unit audit. Do not manufacture a second outcome for a classifier `delivery_repeat`.

006 installs INSERT triggers on **both** existing economic-outcome tables to insert the common origin row. Its PK prevents concurrent initial/ongoing claims for one record, including direct app-role inserts; never use `ON CONFLICT DO NOTHING` to hide a second claim. Populate this common index only from existing concrete origin rows after checking scope, receipt, target-record membership and conflicts. Missing/ambiguous/mismatched historical origins fail migration validation rather than inventing ownership. Backfill creates no units, event outcomes or progress. Keep histories SELECT/INSERT-only with immutable UPDATE/DELETE triggers and no app TRUNCATE; origin trigger writes use the normal app privileges, not a security-definer bypass.

Existing PR39 receipts with no repaired unit audit remain retrievable when their canonical plan/receipt/grant bindings validate. They **do not** establish captured history or frontier: any new-work attempt for an account with such unmatched history fails `SYNC_STORAGE_INVALID`. This explicitly avoids guessing which uncaptured legacy events were safe. No automatic historical repair is assigned.

**PR44 constraint:** `apps/worker/src/connections.ts` reads runtime005 receipts ordered by `after_version`, counts those rows as `appliedBatches`, and reports pending/quarantined/lag as `null`. Preserving that surface keeps receipt history/counts correct; all-replay units add no receipt/batch count. Do not rename columns, put zero-effect receipts there or equate target version with source progress. A later owner-scoped operations change may consume the new application heads; it is not part of this plan. Root separately handles PR44's missing protected `connection-state.ts` inventory entries and Experience's shared-lane visibility join; do not modify those consumers here.

## File and interface map

- Modify `apps/worker/src/sync/apply.ts`: sole transaction owner; remove caller-event authority and use the accepted classifier.
- Create `apps/worker/src/sync/apply-coverage.ts`: one-statement coverage read, bounded validation and immutable suffix preparation; no writes.
- Create `apps/worker/src/sync/apply-types.ts`: strict prepared-unit schemas composed from shared persisted coverage types, and safe errors; no public contracts export.
- Modify `packages/parent/src/sync-store.ts`: exact receipt recovery, original-origin validation, atomic persistence and progress.
- Create `packages/parent/src/sync-types.ts`: strict canonical stored-unit/outcome and shared persisted coverage schemas, exported through the **existing** `sync-store` subpath; no parent-to-worker import, new contracts-root export or protected manifest expansion.
- Create reserved `db/runtime/006_sync_apply_repair.sql` and focused tests below. Modify only the inherited apply test in `tests/integration/v5-sync.test.ts` and the migration pins/count assertions in `tests/integration/sync-capture.test.ts` needed by 006.
- Create `tests/fixtures/sync-apply.ts`, `tests/integration/sync-apply-storage.test.ts`, `tests/integration/sync-apply-coverage.test.ts`, `tests/integration/sync-apply.test.ts`, `tests/integration/sync-apply-races.test.ts`, and `apps/worker/test/sync-apply.test.ts`.
- No compiler/finance/contracts, activation/capture/authority implementation, composition, browser, provider or protected fixture changes. The four excluded `test 2.ts` copies are a separate root-assigned cleanup, not bundled here.

Internal types use existing `Scope`, `CommittedAuthorityIdentityV1`, `CaptureLaneV1`, `SemanticPreflight`, `MutationPlan`, `SyncReceipt`, `EventRef` and checked cursors:

```ts
type ReceiptOrigin =
  | { kind: 'initial'; recordId: string; importKey: string; receipt: SyncReceipt }
  | { kind: 'sync'; recordId: string; receipt: SyncReceipt };
type UnitMember = {
  event: EventRef; recordId: string; origin: ReceiptOrigin;
  disposition: 'new' | 'replay' | 'coalesced';
};
type ReplayResponse = {
  unitHash: string; replayed: boolean; receipts: SyncReceipt[];
  appliedThrough: { streamId: string; cursor: string }[];
};
```

`CoverageCut` contains `identity`, canonical committed `lane`/manifest/capture definitions; sorted checkpoint rows `{streamId,transport,baselineCursor,captureCursor,capturedPages,lastCapturedAt}`; sorted application heads `{streamId,baselineCursor,appliedThrough,lastUnitHash}` (or explicit absent state); sorted full post-baseline position/inbox/delivery/page rows; and guard booleans for extra lane, undeclared stream, nonselected post-baseline state, out-of-cut rows, incident and unmatched legacy history. Include historical outcome/origin/unit bindings through F and exact baseline binding. Bind prior units by immutable unit hash/digest and indexed endpoint/receipt references, never recursively embed their full audits into later cuts; validate their immutable contents separately by exact key. Arrays are bounded with overflow sentinels; a rejected cut never becomes a prepared subject. `coverageHash = hashCanonical(cut)` is checked in addition to full canonical equality.

Compact page bindings retain `{sourceRef, manifestHash, streamId, afterCursor, nextCursor, eventCount, digest, capturedAt}`. Before projecting them, the coverage SQL reader must fetch and strictly decode the actual stored canonical `ChangePage`, digest and indexes, require `complete: true`, and validate its ordered members against the independent inbox/delivery sets. Audit reads reconstruct that exact complete page from its scalar binding and ordered canonical deliveries, then verify the saved digest and membership. This retains full reconstructable page evidence without duplicate event bytes; reconstruction alone must never bypass validation of the originally stored canonical page.

`PreparedSyncUnit` contains `{identity,lane,streamId,expectedEpoch,expectedTargetVersion,beforeSnapshotHash,asOf,coverage,coverageHash,events,plan}`; events are the exact ordered immutable suffix, and `plan: MutationPlan|null` is null only for a nonempty accepted all-replay group. No caller-selected source events, classifier labels or semantic observations are accepted as authority. Its `unitHash` is `hashCanonical({identity,lane,streamId,expectedEpoch,expectedTargetVersion,beforeSnapshotHash,asOf,coverageHash,planHash:plan?.hash ?? null})`. Persist `coverage: CoverageCut`, `coverageHash`, the complete unit-hash preimage, trusted semantic observation, commit instant, before/after snapshot bindings and ordered `UnitMember[]` in `SyncUnitAudit`. Canonical event bytes occur once within coverage; the prepared `events` array is derived from its exact suffix and is not separately persisted. Nonempty plan/lineage remains in runtime005 and is referenced by plan hash/receipt. Define shared persisted coverage schemas in parent `sync-types.ts`; worker prepared schemas compose them without duplicating their definitions. Strict bounded refinements validate canonical/digest/index consistency, `hashCanonical(coverage) === coverageHash`, recomputed unit hash, and exact suffix/member/origin/plan-reference agreement. Historical recovery validates saved immutable bindings without comparing against today's capture or invoking the source. `ReplayResponse.receipts` deduplicates by typed origin and sorts by receipt ID; it does not collapse multiple originals into one receipt.

Public-to-this-module factory (still no route):

```ts
createSyncApplier({ db, clock, identity, observe }: {
  db: Pool; clock: () => Date; identity: CommittedAuthorityIdentityV1;
  observe: (sourceRef: string) => Promise<SemanticPreflight>;
}): {
  prepare(asOf: string): Promise<PreparedSyncUnit>;
  applyBatch(plan: MutationPlan, expectedEpoch: number): Promise<ReceiptResponse>;
  applyReplay(prepared: PreparedSyncUnit, expectedEpoch: number): Promise<ReplayResponse>;
}
```

Load artifact/profile from the exact committed bundle, not closure-supplied independent objects. `prepare` is read-only and returns no authority token. `applyBatch` first attempts exact recovery, otherwise internally prepares at `plan.asOf`, requires exact plan equality, obtains private current semantics, then commits that prepared selection. `applyReplay` first attempts exact unit recovery, otherwise independently validates the supplied prepared structure against authoritative reads and private current semantics. A forged prepared hash does not bypass any lookup. F=C yields `SYNC_NO_PENDING`, never a successful empty unit. Retrying uses the original plan/expected epoch or original prepared replay subject.

Errors add `SYNC_COVERAGE_UNSUPPORTED`, `SYNC_COVERAGE_CHANGED`, `SYNC_STORAGE_INVALID`, `SYNC_NO_PENDING`, `SYNC_SOURCE_UNAVAILABLE` to existing binding/target/plan errors; retain authority errors for inactive/stale grants. Malformed/corrupt persisted data is storage invalid; unsupported but internally consistent coverage is coverage unsupported; W≠W′ is coverage changed. Preserve SQLSTATE exceptions for the transaction retry wrapper. Safe error text contains no raw payload, SQL or credentials.

## Task 1: Add constrained storage and exact historical reads

**Files:** runtime006, parent `sync-types.ts`/`sync-store.ts`, `tests/integration/sync-apply-storage.test.ts`, `tests/fixtures/sync-apply.ts`; narrow capture migration-pin assertions.

**Interfaces:** `readSyncCommit(client: PoolClient, identity: CommittedAuthorityIdentityV1, plan: MutationPlan): Promise<ReceiptResponse|null>` validates full canonical plan/hash, full scope/activation/artifact/profile, persisted receipt/audit epoch consistency, receipt indexes, snapshots and ordered target IDs. The call's `expectedEpoch` fences new writes only: an exact saved plan returns its original receipt epoch without requiring equality with today's epoch or relabeling that receipt. `readSyncUnit(client: PoolClient,identity: CommittedAuthorityIdentityV1,unitHash: string): Promise<SyncUnitAudit|null>` validates canonical/digest/indexes. `readFinancialOrigins(client: PoolClient,scope: Scope,records: readonly FinancialRecord[]): Promise<ReceiptOrigin[]>` requires exactly one valid origin for every requested existing record and checks both existing domains against the common origin index. These are SELECT-only and never consult current operator setup or source availability. Keep `readSyncReceipt(client,scope,planHash)` as a safe validated read if any consumer remains; it must not be used as a hash-only recovery shortcut. `readLatestSyncVersion` remains a parent-version read only.

- [ ] Write `origin_domain_exclusivity`, `typed_origin_fk_scope`, `history_privileges`, `legacy_receipt_read_without_progress` and `canonical_recovery_binding` tests. Use genuine A5 initialization from the existing proof helpers. Assert first-import and ongoing origin inserts converge on one unique record ownership; a second initial/ongoing claim fails even with competing connections. Wrong receipt/scope/record FK, canonical scalar mismatch and app UPDATE/DELETE/TRUNCATE fail. Valid legacy receipts recover exactly, but no heads/outcomes appear; mismatched legacy delivery origin fails closed. A plan with the same supplied hash but changed bytes and a foreign activation/scope fail recovery. Corrupt stored receipt/audit epoch mismatch fails, while an exact plan retry after epoch advancement returns the original epoch/bytes whether the call carries the old or current expected epoch.
- [ ] Run `npm run test:integration -- tests/integration/sync-apply-storage.test.ts`; expect failures for absent repaired schema/readers before implementation.
- [ ] Implement the four-table representation above, origin population/triggers, scoped keys/FKs/index checks and strict canonical readers. Validate all preexisting origin records before population; do not infer missing receipt ownership. Add fixed byte pins for runtime001–005 and a literal reviewed hash for new 006 once final, rather than computing the expected digest from the same file under test. Generic catalog consumers use `readMigrationCatalog()`; update only explicitly version-pinned capture assertions.
- [ ] Run the focused storage test plus `npm run test:integration -- tests/integration/parent-storage.test.ts tests/integration/sync-capture.test.ts` and `npm run typecheck`; all must pass with no skipped cases.
- [ ] Commit the cohesive storage/read change as `fix: add constrained synchronization outcome storage` after the assigned review gate. No historical SQL files or protected build inventories change.

## Task 2: Prove the authoritative bounded captured subject

**Files:** worker `apply-types.ts`/`apply-coverage.ts`; `tests/integration/sync-apply-coverage.test.ts`; shared fixture.

**Interfaces:** `readCoverageCut(client: PoolClient, identity: CommittedAuthorityIdentityV1): Promise<CoverageCut>` executes **one SQL statement** (CTEs/lateral aggregates acceptable). `prepareCapturedUnit(client: PoolClient, identity: CommittedAuthorityIdentityV1, asOf: string): Promise<PreparedSyncUnit>` uses the committed artifact/profile, validated target and that cut, and the accepted `classifyBatch`. Every input/ref/record/prerequisite in the returned metadata is checked for index correspondence. Neither function writes or acquires capture locks.

- [ ] Write the named coverage cases below against real capture. The positive fixture activates before injecting fresh source transactions, calls `openCommitted` and `capturePage`, and reads actual runtime rows. Source fetch alone is never sufficient. Tests assert rejected attempts leave all financial/outcome/head/activity tables byte-equivalent, while already captured rows remain durable.

| Test / input | Required assertion |
| --- | --- |
| `forged_uncaptured_input` | A schema/hash-valid event and matching plan with no inbox/page/position cannot prepare/apply; runtime_deliveries is never created by apply. |
| `full_source_history_cut` | One matching lane; exactly API S and semantic T; checkpoint baselines equal committed manifest; full history `(B[S],C[S]]` contiguous and <=1,000; entire suffix `(F[S],C[S]]` selected; T remains B. |
| `coverage_membership_corruption` (table-driven) | Missing/extra global position, inbox, delivery or page; orphan hidden by an inner join; changed observedAt/hash; wrong stream/manifest; page range/count/canonical mismatch; gap/overlap; checkpoint B/C mismatch; position/page beyond C all reject. Owner-role corruption is test-only. |
| `coverage_blocker_outside_selection` | Semantic change, unchanged semantic event, change then return, source-wide missing seller, unknown/foreign account, extra lane, undeclared stream or any incident reject even if current semantics reports approved equality. No automatic source pause or invented resolution occurs. |
| `coverage_bound_and_prefix` | 1,001 retained events rejects even for a one-event suffix; a sentinel row or absent prior successful outcome/origin rejects; missing application head with unit history rejects. Baseline rows are not counted as ongoing. |
| `complete_single_group` | Multiple groups, held replay member, semantic-only input, missing prerequisite and shortened suffix reject; accepted connected group permits new/replay/coalesced members only. |

- [ ] Run `npm run test:integration -- tests/integration/sync-apply-coverage.test.ts`; expect failure before the new reader exists.
- [ ] Implement a single statement rooted in the **source**, not matching inbox rows. Include bounded lane cardinality (limit 2), exact checkpoint set (limit 3), source-global undeclared/out-of-cut/incident EXISTS guards and independent position/inbox/page streams (limit 1,001 each). Read deliveries by complete `(source_ref,event_id)` keys, with complete canonical page members. Include application heads, prior outcomes and original receipt/audit bindings in that same cut. Reject overflow; never slice and call it complete. Validate full chains and set equality after decoding. Baseline may be loaded from the bounded immutable committed bundle; all mutable capture facts are observed together.
- [ ] Prepare W without locks; the eventual write transaction reads W′ after authority/target locks with this same function. Full canonical W/W′ equality, including heads and guard predicates, is mandatory; immutable exact-key reads afterward may validate but cannot extend the cut. Missing heads are represented explicitly and initialize from B only when there is no application history.
- [ ] Run the focused coverage/storage suites and typecheck; commit as `fix: bind sync preparation to complete captured history` after review.

## Task 3: Commit classification, original receipts and progress together

**Files:** worker `apply.ts`; parent `sync-store.ts`/`sync-types.ts`; `tests/integration/sync-apply.test.ts`; `apps/worker/test/sync-apply.test.ts`; replace the unsafe inherited writer call in `tests/integration/v5-sync.test.ts` with accepted capture and the repaired API.

**Interfaces:** `persistSyncUnit(client, input: SyncUnitCommit): Promise<ReceiptResponse|ReplayResponse>` stays within the caller's transaction. `SyncUnitCommit` contains validated audit, previous `StoredTarget`, next `TargetState` (same for replay), nullable exact plan/receipt, accepted `UnitMember[]`, complete identity-lock token and expected prior application vector. `readFinancialOrigins` supplies replay/prerequisite originals. This helper never inserts a runtime delivery, fetches a source, changes authority or starts/commits a transaction.

- [ ] Write `new_unit_atomic_state`, `mixed_original_receipts`, `ongoing_origin_replay`, `coalesced_and_repeat`, `all_replay_multiple_origins`, `caller_plan_cannot_select_foreign_delivery`, `active_epoch_bookkeeping` and `exact_lost_response_recovery`. Also write the negative matrix below. Assert concrete versions, cents, full IDs and canonical row bytes, not just result status.

For a minimal test-specific public fixture, initial receipt R0 owns invoice I=10,000 cents and unallocated payment P=4,000 cents; balance is 10,000. Capture replay E1 of P plus new explicit allocation E2 of 2,000 from P to I, as one connected group. R1 has `eventIds=[E1,E2]` in recomputed plan order, `targetRecordIds=[allocationId]`, before 10,000/after 8,000, and one new record. E1's outcome/origin resolves to R0; E2's resolves to R1. R0/P/approved snapshot remain byte-identical. In a separate fixture variant, add another delivery of E2's economics to the same captured suffix: it coalesces, acknowledges its ID with no second allocation and points to R1. Repeating the exact captured page changes no inbox cardinality; test classifier repeat handling with unit inputs without pretending capture creates a second position for one global delivery. A later replay-only connected group referencing originals R0 and R1 returns both originals, adds outcomes/progress but no target version, snapshot, receipt or lineage. Do not change canonical/protected fixtures to establish these expectations; reuse `issueActivationProofs` with isolated development input.

| Rejected condition | Assertion |
| --- | --- |
| Same event ID under foreign source; changed bytes or observedAt under an occupied full identity | No event selection by bare ID; correct event never replaced by foreign one; no acknowledgment or writes. |
| Wrong scope/artifact/profile/manifest/bundle, absent grant, stale epoch/target, unsupported ensure/update operation | Typed rejection; no financial/outcome/frontier/activity change. |
| Missing/ambiguous/corrupt origin, record canonical mismatch, other-account economic collision | No guessed receipt, no second economic record, no overwrite of immutable target facts. |
| Held group containing an economically equivalent item, invalid prerequisite indexes, wrong operation correspondence, exceeded count/amount limit | Reject whole group; no relabeling held as replay or splitting coupled work. |
| All replay at paused/revoked authority or old pre-resume epoch | No new acknowledgment/progress/activity; exact previously committed unit remains readable. |
| F=C or malformed empty plan | No zero-effect monetary receipt or empty successful cycle. |

- [ ] Run `npm run test:integration -- tests/integration/sync-apply.test.ts` and `npm run test:unit -- apps/worker/test/sync-apply.test.ts`; expect meaningful failure against the inherited writer.
- [ ] Implement the factory/interface above. For new work, obtain trusted private semantic observation outside SQL locks and validate with existing `selectedProfile`/`validateSemantics`. No caller observation, invented TTL or current policy reinstall. Capture a commit instant outside the transaction callback; retain explicit `asOf` throughout planning/balance/hash. Check runtime/compiler versions and committed allowedKinds/limits.
- [ ] Implement the transaction in this exact order: parent-scope advisory lock and `lockCurrentAuthority`; exact-history recovery recheck; active epoch; existing target FOR UPDATE and validated version/snapshot; W′ equality; classifier recomputation against that locked target; complete identity lock set; origin/global record/canonical delivery validation; application heads; writes; activity counter. The complete identity set includes **all** new/replay/coalesced mapped economics, target IDs/prerequisites and deliveries using existing `lockImportIdentities` conventions, acquired once in its stable order. Never take capture lane/checkpoint/global-stream locks or acquire incremental identity subsets.
- [ ] Require one accepted group, no blockers/holds/unclassified items, exactly one nonempty plan for `applyBatch`, zero plans and no new/coalesced economics for `applyReplay`. Follow checked classifier indexes for repeats/coalescence; financial replay resolves the existing original record and initial/ongoing origin. Canonical plan and hash must equal the submitted plan, including lineage/event order. Validate parent snapshot versus relational records and origins under locks; unexplained divergence is storage failure.
- [ ] For nonempty apply, append only new financial records and their ongoing economic origins, snapshot/version+1, CAS target pointer and existing runtime005 receipt. Persist audit with complete acknowledgment membership, new delivery outcomes and both application heads, advancing only S exactly F→C; T remains B. For all replay omit financial/snapshot/receipt writes and persist the same audit/outcome/progress unit using original receipts. Insert or verify existing exact outcomes, never rebind them. Reject missing-head-with-history; never replace F with capture C without receipted outcomes for every crossed position.
- [ ] Publish `batch.applied` for a nonempty unit or `batch.replayed` for a new all-replay bookkeeping unit **last in the same transaction**, using existing `publishActivity`, scope and safe `{sourceRef,manifestHash,count,status}` plus `receiptId`/`planHash` only when present. Unit uniqueness deduplicates publication. Assert active authority again immediately before callback return/COMMIT; no external callbacks/I/O between final fence and commit.
- [ ] Exact recovery occurs before source preflight, active/target freshness checks, or preparation, then is rechecked under the authority fence for concurrent attempts. Validate full saved plan/committed identity binding and persisted epoch consistency, return byte-identical receipt with `replayed:true`; expected epoch is not a freshness condition on this historical read. Replay bookkeeping recovery requires matching complete prepared unit binding (including its original epoch) and returns saved original receipts/vector with `replayed:true`; the separate current-epoch argument cannot relabel that saved operation. No target/outcome/head/activity mutation or semantic call on either recovery. Unknown COMMIT outcome is not a success or ad hoc retry; subsequent caller retry uses this same durable lookup.
- [ ] Run focused apply/coverage/storage tests plus inherited V5 test and compiler/parent/finance unit regressions; commit as `fix: apply captured sync units with original receipt semantics` after review.

## Task 4: Prove PostgreSQL barriers, rollback and consumer compatibility

**Files:** `tests/integration/sync-apply-races.test.ts`, the shared fixture and existing focused apply tests only; implementation changes stay within previously assigned files if a test finds a defect.

**Interfaces:** Reuse the completed service API, genuine A5, capture and current-authority services. Test-only pool/client wrappers may pause on observed SQL boundaries; owner-role transaction-local failure triggers may inject SQLSTATE errors. No production failpoint option, arbitrary production callback or sleep-based ordering.

- [ ] Add the following barrier tests, with explicit promises/locks establishing each order and bounded test timeouts. Every row-state assertion includes origins, outcomes, units, heads, activity counter/events and historical snapshots.

| Named test | Required ordered observation |
| --- | --- |
| `coverage_changed_before_locked_cut` | Prepare W, commit extra financial capture or semantic blocker, then release apply to W′: zero apply effects and changed/unsupported coverage. Fresh preparation sees full suffix, never a silently enlarged retry. |
| `capture_after_locked_cut` | Hold apply after W′; commit later capture; finish apply. Receipt/outcomes/frontier include W′ only. Later rows remain captured, and next attempt sees/rejects a new semantic blocker, including change-then-return. Capture completes without reverse-order deadlock. |
| `revoke_apply_both_winners` | Status wins: old-epoch new apply/bookkeeping cannot commit. Apply wins: revoke waits for commit, then subsequent apply fails while original receipt recovers. Repeat with pause→resume epoch change. |
| `duplicate_writers_and_restart` | Two callers of same prepared unit produce one financial effect, receipt/unit/outcome/frontier/activity change. After lost response, reconstruct the service and recover exactly, including after later target advance, source outage and revoke. |
| `rollback_every_write_boundary` | Inject failure after financial record/origin, snapshot, target CAS, receipt, unit audit, event outcome, progress, and activity insertion. Entire apply transaction/counter rolls back, while prior capture is unchanged. Repeat relevant boundaries for all-replay. |
| `retry_reacquires_authority` | Trigger real PostgreSQL 40001 and 40P01 paths, assert whole callback retries at most three times with fresh locks/reads. Revoke between attempts prevents stale commit. Other SQLSTATEs do not retry. Old token/pool-client reuse never substitutes for service-owned fresh lock acquisition. |
| `global_identity_collision` | A record owned by another account cannot be rebound; competing SQL origin claims serialize via the common unique key. The narrow coverage policy may reject foreign history before monetary locking; do not weaken it just to manufacture a two-account happy path. |
| `financial_and_snapshot_regression` | Unallocated payment leaves balance; explicit allocation reduces it; full payment/credit reversal preserves original rows and restores allocations at effective time. Backdated fresh input changes latest reconstruction while old snapshotHash reads remain exact. Version/cursor safe-integer exhaustion fails atomically. |
| `pr44_receipt_compatibility` | Call existing `createConnectionReads` on a fixture with initial+nonempty+all-replay units: initial and sync receipt IDs/versions/cents retained; appliedBatches counts only runtime005 rows; no invented pending/lag values. No route or connection reader edit. |

- [ ] Run `npm run test:integration -- tests/integration/sync-apply-races.test.ts`; any missing barrier/outcome assertion blocks completion. Resolve failures within the granted paths, retaining the specified financial expectations.
- [ ] Run final focused gates under a **reconfirmed root-owned isolated test lease**. Previous ports/prefix are historical and may not be reused without that check. Put Node24/PostgreSQL18 on PATH; set `EAPR_PG_PORT`, `EAPR_TEST_PREFIX`, `EAPR_CONTROL_PORT`, `EAPR_WORKER_PORT`, `EAPR_WEB_PORT` only to the granted values. No provider credentials or model setup.

```bash
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
npm run typecheck
npm run test:unit -- apps/worker/test packages/compiler/test packages/parent/test packages/finance/test
npm run test:integration -- tests/integration/sync-apply-storage.test.ts tests/integration/sync-apply-coverage.test.ts tests/integration/sync-apply.test.ts tests/integration/sync-apply-races.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts tests/integration/sync-capture.test.ts tests/integration/current-authority.test.ts tests/integration/v5-sync.test.ts tests/integration/v5-runtime-isolation.test.ts
git diff --check
shasum -a 256 db/runtime/00[1-5]*.sql
```

- [ ] Confirm every selected check passes without skips, historical migration hashes match the recorded catalog, control catalog/compiler compact fixture/protected pins are untouched, and no production call site/route mounts the writer. Record these as partial machine evidence; no full V5/V6/live or user acceptance claim. Commit `test: prove sync apply rollback and authority serialization` and send the exact candidate plus command results to root for fresh independent review.

## Handoff and deferred scope

Root reviews this plan before source dispatch, publishes runtime006/path reservation and confirms the DB lease. PR44 protected-inventory repair is a separate prerequisite to meaningful genuine-A5 tests; the shared-lane operations-read correction stays with its owner. The completed writer remains unmounted pending exact-candidate review and separately assigned integration.

No missing financial policy was found for this bounded suffix. General scheduling, held-dependency release, customer-independent frontier closure, semantic/foreign/unknown terminal resolution, CSV catch-up, broader connection state and live AI-off two-company proof remain outside this increment. Do not add a skip capability to make a negative coverage test pass. If implementation discovers an actual contradictory normative requirement, report its exact source and affected task to root while continuing independent specified work.
