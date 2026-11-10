# B: durable dependency examinations and one selected application unit

Proposed design, 2026-11-10. Read-only architecture work for the Platform coordinator. This document is not an implementation release, migration reservation, machine result, independent review or acceptance. Only this temporary file was written. No Git, database, tests, source edits, provider calls or agents were used.

Repository examined: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. P1 acceptance at `7e49e55`, P3 acceptance at `d8e2833`, and fixed peer-fixture acceptance at `cc78b73` are coordinator-supplied facts. The selection implementation is in progress; this design consumes its accepted design/plan, not its in-flight implementation or tests. Exact symbol reconciliation remains a prerequisite to a later plan.

## 1. Recommendation and scope

Implement a small, unmounted, caller-driven service that makes one durable examination or applies one complete selected group for one genuinely committed customer. Reuse Phase A's complete-source read, routing, pre-routing source-contract checks, classifier grouping and exact typed closure. Add an immutable examination journal, one recoverable coordination head per committed subject, and a separate selected-unit history supporting noncontiguous/multiple-stream membership. Keep the existing finite complete-corpus admission limits. Do not build a persistent financial dependency interpreter or a scheduler.

This is large enough to require several reviewed implementation steps. Its independently useful first step is durable examination/hold recording against the accepted selector, with no financial writer. Genuine same-feed dependency release and independent-customer application can subsequently be proved with the accepted fixed peer fixture. Full B remains incomplete until the Source/Discovery contract permits genuine API-only cross-stream and unaffected-feed approvals.

Alternatives considered:

1. Widen P1's contiguous unit/audit/head schema. Rejected: it changes historical meaning and makes strict historical receipt readers ambiguous.
2. Add a persistent dependency graph/index, incremental coverage, leases and a poll loop now. Deferred: it requires rebuild, invalidation and negative-lookup coverage rules and would unnecessarily duplicate the accepted bounded compiler pass.
3. Separate selected history and bounded journal, sharing accepted financial primitives and selector logic. Recommended. It costs additive history dispatch and a small compatibility guard, but preserves existing receipt meanings and makes the finite prototype boundary explicit.

No new financial kinds, semantic approval, enrollment, generated-account grants, discard/skip/resolve decisions, historical restatement, CSV, source transport, polling, provider configuration, HTTP/composition mounting, public ConnectionState or Experience paths are included. Existing current-semantics preflight is retained; no new external capability is introduced.

## 2. Normative basis and compatibility facts

The repository and applicable Apps/Packages/Compiler/Finance/Parent/Database/Tests guides govern this proposal. Authoritative behavior comes from PRD product thesis, local process boundaries, §§10–13, transaction rules and §19; freeze F1/F2/F3/F5; implementation-plan execution/verification conventions; shared file ownership; and the verification playbook. Relevant accepted design sources are:

- `docs/progress/2026-11-10/sync-coordination-scope-audit.md`, especially increments A/B and the distinction between routine operational choices and absent resolution authority.
- `docs/progress/2026-11-10/sync-selection-design.md` and `docs/superpowers/plans/2026-11-10-sync-selection.md` for complete cuts, exact routing, source-contract guards, bounds, earliest group and typed closure.
- `docs/progress/2026-11-08/handoffs/platform-sync-classification-design.md` for compiler-owned dispositions and prerequisites.
- `docs/progress/2026-11-08/handoffs/platform-sync-atomic-apply-design.md` §§5–8, including its explicit `capture_after_locked_cut` boundary.

Inspected stable implementation:

- `apps/worker/src/sync/apply.ts`, `apply-types.ts`, `apply-coverage.ts`: P1 recovery-before-preflight, current authority/target/global-identity checks, exact plan projection and atomic persistence.
- `packages/parent/src/sync-types.ts`, `sync-store.ts`: `ReceiptOrigin`, `UnitMember`, strict P1 unit history, original financial associations, receipts and snapshots.
- `apps/worker/src/sync/dependencies.ts`: `compareInbox`, `dependencyOrder`; its existing retry constants do not independently authorize a retry policy.
- `capture.ts`, `capture-store.ts`, `bootstrap.ts`: immutable complete capture, separate incident transactions and source-stream/global-delivery locks.
- Accepted `current-authority-store.ts` lock/initial-head behavior and `packages/storage/src/transaction.ts` three-attempt whole-transaction retry for 40001/40P01. The new caller-client authority reader is consumed from the selection plan; no in-flight test was treated as an accepted API.

P1's strict `CoverageCut`, `SyncUnitAudit`, `SyncEventOutcome`, application-head meanings, unit hashes and migration bytes remain historical. New data is not written to those shapes/tables. Existing financial receipt/origin/record representations remain shared.

## 3. Cut freshness is distinct from financial authority

The required guarantee is a complete trusted captured cut, not the latest source/capture state at monetary COMMIT. The accepted atomic-apply design explicitly permits capture after the locked cut; F5 also disclaims cross-database atomic current-semantics observation. B must not quietly strengthen either guarantee.

The new writer reconstructs a coherent bounded runtime snapshot in its own transaction and revalidates the selected grant, target, routes, guards, whole compiler group, typed prerequisites and original associations. Authority and selected target changes are fenced through commit. Global economic/delivery locks plus relational uniqueness prevent duplicate/conflicting effects. A proposal from Phase A is never accepted as authoritative input.

A later captured page or incident, another customer's enrollment, or another customer's status change can commit after this transaction's snapshot. Those facts are outside its cut. They cannot be acknowledged, cleared or reported inspected by this commit; the next attempt sees them. A later missing-seller/semantic conflict therefore does not retroactively invalidate an already selected older cut. Persist exact catalog membership and capture vectors, and label them as observed coverage, not source high water or commit-time freshness.

No cooperative source fence or capture/activation/status rewrite is needed for this stated contract. A future requirement that a newly captured source-wide blocker prevent every older in-flight cut from committing would require a separately reviewed shared fence, including incident persistence and new enrollment, and would change the accepted boundary. It is expressly not part of B.

Durable source/raw holds are observations of a particular complete cut. They are not a new mutable source-wide authorization switch. The writer always reruns authoritative guard logic over its complete captured history; it never treats a journal row's absence, age, or supersession as permission to apply.

## 4. Internal service and strict DTOs

Proposed names below are design-owned, not claims of existing exports. Use existing contract types and compiler `EventRef`, `ClassificationBinding`, `TypedPrerequisite`/classification metadata, parent `ReceiptOrigin`, `UnitMember`, and `syncEventRef`.

```ts
type CoordinateInput = {
  identity: CommittedAuthorityIdentityV1;
  expectedEpoch: number;
  asOf: IsoInstant;
  requestKey: Id;
};

createSyncCoordinator({ db, clock, observe }): {
  advance(input: CoordinateInput): Promise<CoordinateResultV1>;
  recover(input: {
    identity: CommittedAuthorityIdentityV1; requestKey: Id;
  }): Promise<CommittedCoordinationResultV1 | null>;
};

type CoordinateResultV1 =
  | { kind: 'applied'; examinationHash: Hash; unitHash: Hash;
      receipt: SyncReceipt; originalReceipts: SyncReceipt[]; recovered: boolean }
  | { kind: 'replay_acknowledged'; examinationHash: Hash; unitHash: Hash;
      originalReceipts: SyncReceipt[]; recovered: boolean }
  | { kind: 'held'; examinationHash: Hash; hold: SubjectHoldV1;
      capturedCutHash: Hash; recovered: boolean }
  | { kind: 'deferred'; hold: SubjectHoldV1; nextEligibleAt: IsoInstant | null }
  | { kind: 'incomplete'; reason: SelectionIncompleteReason;
      boundedFacts: CutSummary };
```

Reject extra keys. Caller may not choose source events, target, profile, limits, missing keys, selected members, plan, proof, group hash, hold disposition or an authority label. Derive sourceRef and exact artifact/profile/manifest from the committed import. `asOf` is the explicit financial evaluation instant; retry timing uses the injected trusted clock, never caller `asOf`.

`requestKey` identifies a command binding `{schemaVersion, identity, expectedEpoch, asOf, requestKey}`. A committed examination or application consumes the key; exact retry recovers that immutable result even if new input arrived. Different binding at the same key is an idempotency conflict. An incomplete/deferred/error response consumes no key and writes no journal/activity; the result explicitly reports that it is uncommitted. A new substantive examination after a prior held result requires a new key. Different keys cannot consume the same due examination twice.

```ts
type SubjectHoldV1 = {
  identity: CommittedAuthorityIdentityV1;
  seed: EventRef | null; // null for a source/mapping/authority blocker
  state: 'pending_dependency' | 'quarantined' | 'blocked';
  reason: SelectionBlocker['code'];
  compilerHolds: /* exact accepted holds, bounded */;
  causes: EventRef[];
  missing: TypedPrerequisite[]; // exact Scope/identity/target/relation preserved
  examinationCount: number;
  dependencyFingerprint: Hash | null;
  firstObservedAt: IsoInstant;
  lastExaminedAt: IsoInstant;
  nextEligibleAt: IsoInstant | null;
};

type ExaminationV1 = {
  schemaVersion: '1'; examinationHash: Hash;
  request: CoordinateInput; requestDigest: Hash;
  observedAt: IsoInstant;
  predecessorExaminationHash: Hash | null;
  capturedCut: StoredSelectionWitnessV1;
  result: /* held or selected-unit reference */;
};
```

Store raw unknown routes inside the source-cut observation with raw identity/EventRef and no invented Scope. A subject examination may reference those observations without assigning their financial ownership to that subject. Mapping/source blockers retain exact accepted diagnostic codes/paths, affected binding hashes, consumers and incident refs. Unknown amounts remain unknown; do not persist fabricated zero money or aggregate incompatible kinds.

`StoredSelectionWitnessV1` is the accepted selector witness plus immutable reference inventory needed to reconstruct that historical cut, exact observed authority/target/capture/catalog facts, all complete guard results and the full/selected classifier bindings and closure metadata. It is not a second financial interpretation. Canonical values already immutable in storage are referenced by full key/digest; avoid embedding recursive copies of all preceding audit payloads. Persist the exact selected plan separately with its ordinary receipt as today.

Every hash has an explicit versioned preimage. Arrays declared as sets are sorted/deduplicated; members preserve compiler invocation order. Runtime timing/retry timing is recorded in the examination, not smuggled into the deterministic selection witness.

## 5. Earliest ordering and dependency examinations

For each subject use Phase A unchanged: remove only historically proven acknowledgments; classify the full bounded unfinished financial corpus plus applicable semantic history; select the earliest unfinished item by `(streamId, numeric sequence, eventId)`; retain its entire compiler group and every exact typed provider/group; validate the full closure; reclassify that closure plus semantic guards. Never slice plan/lineage or choose a convenient provider. Stream ordering is deterministic enumeration, not global event-time order.

An earlier held allocation may include its later captured invoice provider. That exception does not let an unrelated later payment pass the held allocation. Held/unmapped/wrong-kind/foreign-scope/conflicting providers do not release it. All representatives and capacity/reversal coupling remain in the accepted compiler group. Unallocated funding has no fabricated invoice prerequisite. Cross-stream candidate order is explanatory; persistence uses the compiler's exact operation order and lineage.

One active hold episode per subject is sufficient because only its earliest unfinished seed is actionable. Its stable key is the exact committed identity plus earliest seed delivery identity/content hash. Closure expansion does not reset the episode. Source/mapping/authority blocking observations are not dependency retry episodes.

Operational choices proposed for review:

- First complete examination of a genuinely missing typed prerequisite records `pending_dependency`, count 1.
- If still missing, a distinct due examination no earlier than 1 second later records count 2; one no earlier than a further 2 seconds records count 3 and `quarantined`. These are three total examinations, not three additional retries.
- Before the due time, return `deferred` without writes, unless the dependency-relevant fingerprint changed. The clock may delay work but never move a persisted deadline earlier on restart.
- An exact relevant change can trigger early revalidation. It still increments the same episode's count if unresolved; unrelated source traffic, changed request key, changed process, or changed `asOf` alone cannot reset/count a new examination.
- After quarantine, there is no timer retry. A changed dependency-relevant fingerprint permits one new complete revalidation for that new fingerprint. Still invalid/missing stays quarantined; an actually accepted complete group can be applied under all normal authority fences. This is deterministic prerequisite revalidation, not a permission to waive the original hold.
- No immediate retry loop for identity, mapping/schema, changed semantics, financial inconsistency, cycle, size limit or corrupted history. They retain their exact blocked/quarantined/incomplete classifications. A new complete cut may be examined when relevant evidence changes, but prior conflicting governing history remains present.

Compute the fingerprint from accepted compiler metadata for the stable seed's entire coupled group: member EventRefs/content hashes, final dispositions/holds, typed edges and all matching provider representatives, exact target prerequisite/origin bindings, plus relevant affecting guard/authority/target bindings. Exclude wall clock, caller key, `asOf` alone, and unrelated routes/groups. Do not derive it from guessed raw payload fields or bare missing IDs. A change to an earlier seed is an explicit new earliest observation, not silent deletion of the previous episode; the old journal remains immutable.

The accepted pure retry helpers may supply the count threshold only after their semantics are reconciled with this rule. Do not reuse `transportBackoff` as if this service performed transport. No fetch loop is introduced.

Transaction locks provide the claim. There is no long-lived lease, owner timer, background job or claim row to recover. Duplicate callers serialize on the existing subject scope lock, reread the head, and either recover the same request or observe that the due examination/fingerprint was consumed. Process death before commit consumes nothing. Process death after commit recovers the exact journal/result.

## 6. Additive storage requirements, no number reserved

Propose one additive runtime migration `NNN_sync_dependency_coordination.sql`, with `NNN` assigned only after root checks the integrated/in-flight catalog. No changes to runtime001–006 bytes or control DDL. Proposed tables may be named differently in the implementation plan, but responsibilities and constraints must remain explicit.

| Table | Purpose and required constraints |
| --- | --- |
| `runtime_sync_coordination_heads` | One row per exact committed identity, FK to the exact import. Mutable last-examination pointer, current earliest hold/retry state, and selected-history head/ordinal. No deletion. Immutable identity/baseline/selected-history anchor. First successful selected commit anchors the exact validated P1 history/current target; hold-only observations need not switch application mode. Guard updates against the immediately preceding hash/ordinal. |
| `runtime_sync_examinations` | Immutable canonical examination/digest; unique `(activation_id, request_key)` with complete identity/request binding. Own predecessor FK and exact result refs. Unique episode/fingerprint/count transition prevents duplicate due examinations. Fixed state/reason enums, checked safe integers/instants and immutable app-role rows. Complete-cut references retain raw/source holds without financial outcomes. |
| `runtime_sync_selected_units` | Immutable versioned selected audit, globally unique unit hash and optional unique receipt ID. Exact import/lane FKs; ordered subject ordinal/predecessor; before/after snapshot FKs. Nonempty selected members may span declared API streams and need not be contiguous. Receipt-null iff accepted all-replay; otherwise target version increases exactly one. No P1 `fromCursor/throughCursor` reinterpretation. |
| `runtime_sync_selected_outcomes` | One immutable acknowledgment per full delivery identity; exact lane/stream/sequence/EventRef, committed identity, selected unit, record ID, original `ReceiptOrigin` and `new/replay/coalesced`. FK to immutable inbox/source positions, unit membership and shared financial origin. Canonical/index/digest bindings checked. No `ignored`, `resolved`, `foreign` or `semantic_applied` disposition. |
| `runtime_sync_acknowledgments` | Cross-format immutable uniqueness bridge keyed by `(source_ref,event_id)`, with exact subject and exactly one P1-unit or selected-unit FK. Backfill accepted P1 event outcomes and add insertion guards to both P1 and selected outcome tables, so separate tables cannot admit two acknowledgment owners. It is not the economic-origin table and does not replace bootstrap delivery associations. |

Implement bridge backfill/trigger details only after an exact catalog audit; fail migration on conflicting existing history. Claim creation and outcome insertion occur in one transaction; foreign-key/check failures roll everything back. Enforce canonical/hash/index checks, receipt scope/activation membership, event content hash, original receipt contents, and exact member inclusion as P1 already does. App role gets only required SELECT/INSERT and narrow head-column UPDATE; no app DELETE/history UPDATE, no DDL/control access.

Reuse `runtime_sync_receipts`, `runtime_sync_economic_outcomes`, `runtime_financial_origins`, immutable parent financial records/snapshots and target CAS. Extract the smallest shared internal receipt/record append and validation helper from accepted `sync-store.ts` if necessary; preserve P1 semantics and test it through both consumers. Do not copy its financial validator or independently reimplement balances/projection. A new selected writer cannot call `persistSyncUnit` with a fabricated P1 coverage cut.

Indexes must support exact subject/head/request lookup, source-rooted bounded history scans, exact delivery claims, unit predecessor/member reads and typed original identity lookup. No raw-payload JSON index is a financial dependency proof. No persisted dependency index is required at this bound: typed keys stay in the immutable examination/witness and provider discovery remains compiler-owned.

## 7. Selected audit and historical reader compatibility

```ts
type SelectedUnitAuditV1 = {
  schemaVersion: '1'; format: 'selected'; unitHash: Hash;
  identity: CommittedAuthorityIdentityV1; lane: CaptureLaneV1;
  ordinal: number; previousSelectedUnitHash: Hash | null;
  p1AnchorHash: Hash; // exact initial/P1 history binding, not rewritten P1 data
  expectedEpoch: number; asOf: IsoInstant;
  beforeTargetVersion: number; beforeSnapshotHash: Hash;
  afterTargetVersion: number; afterSnapshotHash: Hash;
  capturedCutHash: Hash; selectionWitnessHash: Hash;
  seed: EventRef; members: UnitMember[];
  orderedMembers: EventRef[]; dependencies: DependencyWitness[];
  planHash: Hash | null; receiptId: Id | null;
  semanticObservation: SemanticPreflight;
  examinationHash: Hash; committedAt: IsoInstant;
  progress: CapturedCutProgressV1;
};
```

Construct `unitHash = hashCanonical({schemaVersion:'1', format:'selected', identity, lane, ordinal, previousSelectedUnitHash, p1AnchorHash, expectedEpoch, beforeTargetVersion, beforeSnapshotHash, asOf, capturedCutHash, selectionWitnessHash, seed, memberEventRefs, orderedMembers, dependencies, planHash})`. `memberEventRefs` is the exact selected financial invocation order. This preimage excludes the examination hash, random receipt ID, origin receipt bodies, commit time and its own hash. The immutable selection witness binds the full selected dispositions and pre-existing origins. Compute this unit hash first, then the examination hash from its complete versioned request/observation/result (which can reference that unit hash), then the audit canonical/digest including both hashes and all final member origins. A failed transaction retains none of these facts. Readers reconstruct these exact preimages; never recursively strip arbitrary fields.

Preserve `ReceiptOrigin` byte meanings: initial records retain their initial import receipt; records created by P1 or B retain their original ongoing receipt. A replay in a mixed unit points to its original effect receipt, not the new unit's receipt. A coalesced new representative points to the one new receipt. All-replay writes a selected unit/examination/outcomes only, with no empty monetary receipt, no parent snapshot/version change, and no second economic origin.

Strict selected readers verify audit/indices, exact import, immutable capture references, full member/outcome claims, compiler result/plan bindings, snapshots, receipt and original associations. Bound the entire referenced graph before canonical loads. Historical reads validate the stored cut's catalog/cursors and immutable references; they must not substitute today's catalog/target/capture heads and reject a valid older receipt simply because later data exists. Stored negative coverage is the writer's witnessed historical observation, not a claim that today's source remains unchanged.

Add explicit history dispatch at receipt consumers: P1 unit -> unchanged P1 decoder; selected unit -> selected decoder; existing legacy branch -> unchanged legacy validation. Require exactly one matching format, never fall through from malformed selected history to the legacy branch. Extend the selector's history adapter to combine validated P1 and selected acknowledgments and include exact selected provenance. Its pure selection rules remain unchanged.

Once a selected unit exists for a subject, P1 must still recover all its old exact results but refuse new writes with `SYNC_COVERAGE_UNSUPPORTED` (or a separately frozen equivalent) before new effects. Check the selected-history anchor under the same existing subject scope lock in P1's commit path; a prepare-time check alone is insufficient. B and P1 competing for the first selected transition serialize there. If P1 wins, B anchors its newly committed history after a fresh attempt; if B wins, P1 cannot append a false contiguous history. This is a narrow compatibility guard, not automatic activation/version switching.

## 8. Transaction and recovery sequence

Recover a consumed exact request first through a SELECT-only strict reader, before current authority, target, semantics or new-work admission. A valid historical result remains readable after pause/revoke, source outage, further capture, target advancement or a later hold. Conflicting request bindings fail closed. Recovery does not append activity, initialize heads, update retry counters or create acknowledgments.

For new work, validate the exact committed subject and perform the existing allowlisted `SemanticPreflight` outside the write transaction. Reuse P1's semantics validation and no cross-service atomicity claim. Then for each fresh whole-transaction attempt:

1. `BEGIN`, immediately set `REPEATABLE READ` before any data query. Apply 2-second statement/lock bounds and a 5-second transaction deadline, with cancellation/rollback/release completed before returning. The selected writer needs a coherent multi-query complete cut; do not call Phase A's pool-owning public inspector from inside it.
2. Acquire the existing parent-scope advisory lock via `lockCurrentAuthority`, then current authority row. Recheck exact request recovery after the lock. Assert exact active status and expected epoch for new application/replay bookkeeping. Use the same transaction-bound lock API and reacquire its token in every retry.
3. Lock selected target row and coordination head in a consistent subject order; verify historical chain and target anchor. A target unrelated to the validated initial/P1/selected history is a target conflict, never an overwritten/newly adopted baseline. Reread and validate current grant/target pins.
4. On this same client/snapshot call the accepted bounded `readSelectionCut` adapter, extended only for selected history. Its catalog/target/capture/origin scans and byte sentinels still run before decoding. Run the accepted pure inspection/selection core inside the transaction over the detached bounded facts. It must remain CPU-only. A source/mapping blocker or incomplete cut never becomes a successful plan.
5. For a held complete cut, derive the exact episode/fingerprint and due transition while holding the coordination head. If not due/new-relevant, return uncommitted `deferred` and roll back any lazy head initialization. Otherwise persist the immutable examination, guarded head and one safe activity event atomically. No financial/outcome/progress writes. Inactive-authority new application is refused; hold observations must not initialize or mutate financial authority beyond the existing lock API, and the implementation must roll back its lazy initialization on no-work/refused paths. Because existing `withTransaction` commits normal returns, use a private typed rollback-result signal caught outside that wrapper for incomplete/deferred/no-work results; do not simply return them from its callback after lazy writes.
6. For an eligible earliest group, obtain all selected mapped economic keys and all typed prerequisite keys plus delivery keys through existing `lockImportIdentities`. Validate global original ownership and exact delivery associations; strict absence/novelty does not come from classifier labels alone. Check both acknowledgment formats/bridge. Reclassify the exact selected group and semantic guards at the locked selected target/`asOf`; compare full group/plan/lineage with the just-reconstructed witness. Retain the original receipts for target prerequisites and replay members.
7. Project with existing parent/finance helpers, enforce checked amounts/limits, and construct the ordinary nonempty receipt if needed. Append shared records/origins/snapshot/receipt/plan, selected audit/outcomes/claims, immutable examination, coordination selected-history head and its cut-scoped progress in one transaction. Reconcile exact balances/target version. Publish activity last with the existing locked activity counter. Assert active epoch remains locked before COMMIT. No external I/O between cut, checks and COMMIT.

Canonical lock order is existing parent-scope -> authority -> target -> coordination head -> complete global identities -> selected outcome/claim/head checks -> activity counter. Existing P1/capture/global identity ordering is retained. No source fence or second connection participates. A persisted hold releases all locks on commit; independent known customers can take their own turns while that hold remains unresolved.

Important repeatable-read races require named tests, not assumptions:

- A repeatable-read snapshot can precede completion of an advisory-lock wait. Updating/locking a target or existing authority row changed since that snapshot must abort/retry, never silently use stale state.
- `lockCurrentAuthority` lazily inserts an absent head. A concurrent first pause/resume/revoke can create that head after the snapshot. Its unique constraint must make the stale insert fail closed. Do not swallow the collision and synthesize epoch 1. The minimum implementation may report stale/unavailable and require a fresh attempt; a specialized retry requires proof of this exact constraint, not retrying arbitrary 23505.
- A foreign subject can commit a global economic/origin claim after this cut while B waits for an identity lock. Under repeatable read the old snapshot may not see it. Global financial/delivery uniqueness must abort B's stale new claim. Do not treat a uniqueness error as replay or success. Return a safe conflict; a fresh complete cut can classify the actual claim. This prevents effects without pretending every absence remained fresh.
- Coordinator/P1/duplicate-request head changes that occur after the snapshot must similarly abort/recover on a fresh attempt. Absent rows are protected by real uniqueness and exact binding checks, not an assumed row lock.

Use existing bounded retries for 40001/40P01 only, at most three attempts. Retry reconstructs the whole cut and recomputes the group; it cannot reuse a proposal/lock token. Expected epoch does not change on retry. Stale authority, semantic mismatch, malformed storage, business hold and arbitrary uniqueness errors are not generic SQL retries. Deadlines cancel and finish cleanup, never race-return while a query can still commit.

If cancellation/failure occurs before COMMIT, no request/examination/hold-counter/activity/outcome or money survives. If response is lost after COMMIT, the same request key returns the original immutable result. Use a final recovery lookup after known preflight/prepare failures as P1 does when a concurrent winner may have committed; never hide an uncertain COMMIT outcome by returning a freshly manufactured result.

## 9. Progress without resolution authority

Do not advance P1 application heads from selected units. Their contiguous single-stream meaning remains exact historical data.

`CapturedCutProgressV1` is an internal, cut-scoped derived observation stored with the selected audit/result, not a new public progress contract:

```ts
type CapturedCutProgressV1 = {
  schemaVersion: '1'; sourceRef: Id; capturedCutHash: Hash;
  streams: { lane: CaptureLaneV1; streamId: Id; baselineCursor: Cursor;
    capturedThrough: Cursor; financialAppliedThrough: Cursor }[];
  acknowledged: { event: EventRef; identity: CommittedAuthorityIdentityV1;
    unit: { format: 'p1' | 'selected'; hash: Hash }; origin: ReceiptOrigin }[];
  unfinished: { identity: CommittedAuthorityIdentityV1; events: EventRef[];
    earliest: EventRef | null }[];
  unresolvedRaw: RouteObservation[]; // only unresolved raw routes, without Scope
  blockers: SelectionBlocker[];
};
```

All arrays have the admitted cut's bounds and declared deterministic order. Compute it from complete captured membership plus validated outcomes in the same transaction. Subsequent reads can recompute against a newer complete cut; old observations remain immutable. Counts are derived from unique EventRefs within this cut, never summed across overlapping examination snapshots.

For each raw API stream, `financialAppliedThrough` can move only from that subject's original approved baseline through consecutive positions each backed by a valid financial outcome from its real owning committed subject and original receipt. An unresolved raw account, held selected event or any unacknowledged position stops it, even if later independent outcomes exist. Do not call a maximum applied sequence a contiguous frontier. Semantic streams retain their baseline in this financial frontier; unchanged semantic checks are separately observed, never financially applied. Foreign-customer routing alone is not an outcome; its actual valid financial outcome may be counted in a source cut after strict proof.

For a customer, expose internal `acknowledgedMembers` and `earliestUnacknowledgedOwn` rather than inventing a scoped raw cursor that silently skips other customers. A later prerequisite can be acknowledged out of raw order; its membership remains visible while the earlier raw gap remains. Capture cursors are unchanged by application. No source caught-up/zero-lag/full-reconciliation claim follows because no source high water is measured and unresolved raw/semantic coverage remains visible.

Example: captured API positions 11 = unknown known-seller account, 12 = enrolled B's valid 300-cent invoice. B can receive its real receipt/outcome at 12. Captured-through is 12; raw financial-applied-through stays 10; unresolved-raw count remains 1. Do not create an outcome at 11, assign it B's Scope, or report zero unresolved gaps. If A has a separate missing-invoice allocation, its dependency count/hold also remains unchanged by B's success.

## 10. Bounds and honest limitations

Keep Phase A's accepted admission ceilings: 8 subjects, 8 lanes, 32 stream definitions, 1,000 distinct post-baseline deliveries, 1,000 rows per evidence family, 10,000 target records per subject, 1 MiB per source canonical value, 16 MiB aggregate decoded input, at most 8,000 source-contract observations; all helper-reachable history/origins/receipts are counted before loading. The approved/compiler invocation ceiling remains at most 1,000 inputs including semantic guards/repetitions/prerequisites and 5,000,000 cents per transaction, or any stricter approved limit. Never split a coupled group.

Extend the shared budget to selected units/outcomes/claims and referenced examinations. Charge unique immutable objects once; do not recursively copy predecessor audits. Bound current-head lookups independently and follow only the necessary exact reference graph. An examination log can grow beyond what this prototype admits; cap+1 then yields explicit incomplete history/limit, not pruning, lost holds or assumed acknowledgment. This design does not solve steady-state unbounded history or remove the selector's technical lifetime-corpus restriction.

A journal/audit envelope can exceed 1 MiB because it summarizes multiple bounded source objects. Freeze a separate maximum serialized witness/audit size no greater than the remaining 16 MiB aggregate budget, preflight its stored byte length, and account its references without double-counting. Do not accidentally require a 16 MiB assembled cut to fit a 1 MiB source-object slot or loosen source-object bounds globally. A concrete encoded fixture must demonstrate the chosen envelope cap before release.

Incomplete admission writes nothing and cannot consume a retry/quarantine examination. Failed schema guard's `unexamined` result remains incomplete and zero-proposal as Phase A specifies. Journal bounds, source errors and storage corruption remain distinguishable from financial rejection.

## 11. Concrete verification plan

Implementation occurs only after root reserves paths/migration and grants exclusive real PostgreSQL leases. Run no database or tests from this design task. Preserve meaningful behavioral red/green evidence, exact candidate review and joint acceptance separately.

### Independent first implementation: journal only

Use the accepted single-subject and fixed peer fixtures through real producer proofs/reviewer activation/capture. Consume the released selector on its own client. Add:

- `examination_due_once`: a real captured allocation missing its typed invoice; first count 1, repeated requests before due cause no rows/activity, exact request recovery is immutable; due 1s/count2 and +2s/count3 quarantine; no timer retry thereafter.
- `examination_restart_and_claim`: recreate service/pool between counts; two barrier-controlled callers consume one transition; crash before commit consumes none; postcommit response loss returns exact examination. Assert all original finance/snapshots/receipts remain byte-equal.
- `examination_changed_evidence`: unrelated peer traffic/request/asOf changes do not reset the seed's count; matching typed provider changes the fingerprint; wrong-kind/foreign/unmapped/held provider never becomes accepted release. Changed-then-return semantic history remains blocked.
- `examination_complete_cut_only`: cap+1, source-contract unexamined, corrupted origins and missing capture membership write no examination/activity/head. Raw unknown route has no fabricated Scope. Real isolated SQL constraints/privileges/rollback are exercised.

These can be accepted as a bounded durable-observation prerequisite even while cross-stream generation is blocked. They must not be called dependency release.

### Selected writer and same-feed proof

- `same_feed_release`: on a genuinely approved Company A account, capture an earliest allocation for 500 cents funded by an existing 700-cent payment with exact origin receipt R0; reference missing invoice I9; capture an unrelated later payment for 200 cents. Hold with no funds consumed. Later capture a 900-cent I9 using the actual approved invoice resource on that same financial stream. Reclassification must select the whole coupled invoice+allocation group; new invoice balance is 400 cents; payment origin is still R0. The unrelated payment remains unfinished until the next group. Keep all unrelated baseline balances unchanged and report both I9's balance and the independently derived aggregate delta.
- `same_feed_independent_raw_gap`: use both genuinely approved fixed peers. Hold A's earliest dependency; capture structurally valid known-seller unknown raw work and B's valid 300-cent invoice. B writes exactly one original receipt/outcome; A's hold/funding and the raw unknown entry persist. Raw financial frontier stops before the earliest unacknowledged gap. No fake approval or generated-account grant.
- `shared_mapping_guard`: real renamed/missing field on mapped and unknown raw accounts blocks every consumer of the failed exact shared binding before B's 300-cent write. Assert real compiler code/path. Structurally valid unknown raw is the positive independence control. Missing seller/unscoped governing changes block the source.
- `selected_exact_history`: mix initial and P1 origins, fresh new/coalesced/replay deliveries, all-replay group, restart, postcommit response loss, pause/revoke/source outage after commit. Recover exact original receipt IDs and canonical records; no empty receipt/snapshot, no second economic effect, no activity duplication.
- `p1_selected_transition`: exact P1 recovery after selected history; P1/B first-transition barriers in both orders; P1 cannot append new contiguous coverage after selected mode; selected reader does not fall back to legacy on corrupt selected audit/claims.
- `selected_finance_regression`: unallocated funding does not reduce invoice balance; coupled allocations/reversal stay whole; exact full reversal preserves originals; limits/cycles/bad provider indices stay held; backdated fresh input changes only the latest reconstruction and leaves the original approved snapshot readable. Use independent expected cents, not production projection as the oracle.
- `selected_atomic_rollback`: inject test-harness transaction failures after record/snapshot/receipt/origin/audit/outcome/claim/head/examination/activity writes. Assert all durable rows and activity counter equal before state. No production failpoints/sleeps.
- `selected_authority_and_identity_races`: real barriers for status-wins/apply-wins, initial absent-authority-head insertion race, pause/resume changed epoch, same group duplicate callers and foreign-scope economic collision after snapshot. Exact SQL failure/recovery behavior must be observed; no test merely checks an exception without proving zero writes.
- `selected_cut_boundary`: capture after the writer snapshot (including a source-blocking event) succeeds independently; writer acknowledges only its frozen cut, and next call observes the blocker. Add new enrollment after snapshot and prove it is not misrepresented as part of the earlier catalog. Capture before the new transaction's cut is included and blocks as specified. No latest-at-COMMIT claim.
- `selected_bounds_and_reader_graph`: each sentinel family, bytes before decoding, declared streams/lane memberships, origins in foreign scope, corrupt rehashed canonicals, timeout cleanup and safe error redaction. Legacy/P1/selected references cannot escape budgets or disappear behind a partial query.

### Mandatory full-B proof that remains upstream-blocked

- `genuine_cross_stream_release`: genuinely approved API-only multi-stream artifact, separate exact baseline vector (illustrative `a-ledger:10`, `a-invoices:20`, `a-semantics:2`), allocation at ledger11 missing invoice I9, unrelated payment at ledger12, later invoice at invoices21; 700/500/900 cents and I9 balance400. Require actual producer-backed approvals for that exact stream contract. These illustrative stream IDs cannot be added to the fixed Company A manifest ad hoc.
- `genuine_unaffected_feed`: a third genuinely approved subject consumes an independent unaffected API feed/resource; shared-mapping failure blocks its true consumers while that third subject actually commits under its own grant. Same-feed peers are insufficient.
- `genuine_distinct_baselines`: genuine independently reviewed manifests/vectors preserve each approval-window event and selected original receipts. If released fixture contracts do not admit it, retain an explicit blocked case.

Source/Discovery must freeze the stream/schema contract; protected evaluator admission must actually verify that source. Do not ignore Company B CSV, relabel semantic streams, mutate approved manifests, fabricate successful verification/approval rows, change protected expected money, or count skips/pure tests as these proofs. Cycles unrepresentable in the current DSL may be defensive metadata tests only, not mislabeled real source cases.

Planned focused suites: coordinator unit/integration; selection; accepted P1 storage/coverage/apply; current authority; capture; parent/compiler/finance; activation regression for compatibility and original receipts; migration/role checks. Root chooses exact filenames and leased ports. Typecheck and focused checks are partial; full V5/V6, live construction, AI-off transport and joint acceptance remain outside this increment.

## 12. Proposed ownership and decisions still needed

Candidate new paths: `apps/worker/src/sync/coordination-{types,store}.ts`, `coordination.ts`; `packages/parent/src/selected-sync-{types,store}.ts`; focused tests; additive runtime `NNN`. Narrow existing consumers: selector history adapter, P1 commit compatibility guard, parent receipt-format dispatch/shared append primitive, package subpath exports if required. No files are reserved by this document. Protected recursive build manifests must be checked if any shared export/source import graph changes; do not assume a new package export is isolated.

No new product/financial policy gap blocks this bounded design. Routine implementation review must freeze: exact selected/examination hash preimages, strict SQL DTOs, shared helper extraction, bridge backfill/trigger order, audit-envelope byte cap, safe incomplete/error result schema, and exact repeatable-read conflict handling. The writer's fresh coherent cut and selected mutable-state fences need direct implementation proof. If the owner requests clearing unknown identity, overriding changed semantics, successful resolution without a receipt, deleting a hold to advance a frontier, or latest-source-at-COMMIT behavior, stop that extension and raise the exact missing authority or technical contract.

Self-review: kept bounded compiler-owned discovery rather than a new financial interpreter; distinguished staleable cut freshness from current financial authority; retained all source/raw/semantic gaps; avoided fictitious foreign/semantic terminal outcomes; preserved original receipts and strict P1 formats; specified negative-lookup races, bridge uniqueness and historical-reader dispatch; kept quarantine revalidation finite per evidence state; separated immediately executable same-feed proof from genuine upstream-blocked cross-stream/unaffected-feed proof. This is a proposed design for fresh review, not a claim any of these proofs ran.
