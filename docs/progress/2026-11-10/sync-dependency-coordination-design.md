# B: durable dependency examinations and one selected application unit

Proposed design, 2026-11-10. Read-only architecture work for the Platform coordinator. This document is not an implementation release, migration reservation, machine result, independent review or acceptance. Only this temporary file was written. No Git, database, tests, source edits, provider calls or agents were used.

Repository examined: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. P1 acceptance at `7e49e55`, P3 acceptance at `d8e2833`, and fixed peer-fixture acceptance at `cc78b73` are coordinator-supplied facts. The selection implementation is in progress; this design consumes its accepted design/plan, not its in-flight implementation or tests. Exact symbol reconciliation remains a prerequisite to a later plan.

Clarification round 1 closes Q1–Q3 from `/private/tmp/eapr-sync-dependency-coordination-design-review.md`. That review passed the architecture direction and requested concrete builder decisions; it did not accept these new clarifications or authorize implementation. This round changes only this temporary design, not a plan or repository file.

## 1. Recommendation and scope

Implement a small, unmounted, caller-driven service that makes one durable examination or applies one complete selected group for one genuinely committed customer. Reuse Phase A's complete-source read, routing, pre-routing source-contract checks, classifier grouping and exact typed closure. Add an immutable examination journal, one recoverable coordination head per committed subject, and a separate selected-unit history supporting noncontiguous/multiple-stream membership. Keep the existing finite complete-corpus admission limits. Do not build a persistent financial dependency interpreter or a scheduler.

This is large enough to require several reviewed implementation steps. Its independently useful first step is durable examination/hold recording against the accepted selector, with no financial writer. Genuine same-feed dependency release and independent-customer application can subsequently be proved with the accepted fixed peer fixture. Full B remains incomplete until the Source/Discovery contract permits genuine API-only cross-stream and unaffected-feed approvals.

The journal-only milestone requires its own bounded implementation plan after the selector's exact interface is accepted. That plan owns only heads/examinations, their bounded readers/transitions and focused proofs. The selected writer requires a later separate plan and release; do not bundle selected units/outcomes/acknowledgment bridge, financial persistence, P1 compatibility or receipt dispatch into the first journal release. This document is the design clarification for those later planning decisions, not either plan.

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
  | { kind: 'deferred'; committed: false; hold: SubjectHoldV1;
      reason: 'not_due' | 'fingerprint_consumed' | 'unchanged_blocker';
      nextEligibleAt: IsoInstant | null; observedCut: CompleteCutObservationV1 }
  | { kind: 'no_work'; committed: false; observedCut: CompleteCutObservationV1 }
  | { kind: 'refused'; committed: false;
      reason: 'authority_inactive' | 'authority_stale'
        | 'semantic_preflight_unavailable' | 'semantic_preflight_mismatch' }
  | { kind: 'incomplete'; reason: SelectionIncompleteReason;
      committed: false; boundedFacts: CutSummary };

type CompleteCutObservationV1 = {
  sourceRef: Id; asOf: IsoInstant;
  coverage: Extract<SelectionInspectionV1['coverage'], {kind: 'complete_captured_cut'}>;
  routes: RouteObservation[]; blockers: SelectionBlocker[];
};

type JournalEligibleV1 = {
  kind: 'eligible_observation'; committed: false;
  identity: CommittedAuthorityIdentityV1; seed: EventRef; members: EventRef[];
  selectionWitnessHash: Hash; planHash: Hash | null;
  observedCut: CompleteCutObservationV1;
};
type JournalResultV1 = Exclude<CoordinateResultV1,
  {kind: 'applied' | 'replay_acknowledged'}> | JournalEligibleV1;

// First release: no selected-writer capability or mode flag is injected.
createSyncDependencyJournal({ db, clock, observe }): {
  advance(input: CoordinateInput): Promise<JournalResultV1>;
  recover(input: {identity: CommittedAuthorityIdentityV1; requestKey: Id}):
    Promise<Extract<JournalResultV1, {kind: 'held'}> | null>;
};
```

Reject extra keys. Caller may not choose source events, target, profile, limits, missing keys, selected members, plan, proof, group hash, hold disposition or an authority label. Derive sourceRef and exact artifact/profile/manifest from the committed import. `asOf` is the explicit financial evaluation instant; retry timing uses the injected trusted clock, never caller `asOf`.

`requestKey` identifies a command binding `{schemaVersion, identity, expectedEpoch, asOf, requestKey}`. A committed examination or application consumes the key; exact retry recovers that immutable result even if new input arrived. Different binding at the same key is an idempotency conflict. Every result marked `committed:false`, and every error, consumes no key and writes no journal/activity/head. A new substantive examination after a prior held result requires a new key. Different keys cannot consume the same due examination twice. The journal-only implementation has no applied/replay result variant, selected-unit FK or placeholder successful unit.

The following ordered table is exhaustive for valid commands; invalid input, conflicting key binding and corrupted storage remain fixed safe errors. Recovery always precedes this new-work table and is unaffected by authority/preflight admission.

| Condition | Result | Durable transition |
| --- | --- | --- |
| Exact consumed request exists | Original committed `held`, or later writer result, with `recovered:true` | None; historical recovery needs no active authority or live preflight |
| Selected authority inactive, or supplied epoch differs | `refused:authority_inactive` / `refused:authority_stale` | None; roll back lazy initialization; retain every prior episode unchanged |
| External semantic preflight unavailable/malformed, or valid observation fails approved semantics | `refused:semantic_preflight_unavailable` / `refused:semantic_preflight_mismatch` | None; this is not a complete captured-cut observation or a dependency examination |
| Cut admission is incomplete | `incomplete` | None; no retry count, key consumption or inferred hold |
| Complete cut has no unfinished selected-customer financial input and no blocker affecting that customer | `no_work` with full bounded complete-cut observation | None; other customers/raw routes may still be unresolved; do not manufacture a hold or assert source completion |
| Complete cut has an eligible selected group, journal-only service | `eligible_observation` | None; no examination, retry consumption, head/activity change, receipt or progress; retain prior episodes until real outcomes exist |
| Complete cut has an eligible selected group, later writer | Revalidate and return real `applied` / `replay_acknowledged` | Only the actual atomic selected-unit transaction described below |
| Complete cut has a missing-dependency episode with an admissible due/new-fingerprint transition | `held` with `pending_dependency` or `quarantined` | Append one examination and advance the guarded head/activity once |
| Complete cut has the same episode before due, or a fingerprint already consumed after quarantine | `deferred:not_due` / `deferred:fingerprint_consumed` | None; return restored episode state and current cut observation |
| Complete cut has another affecting source/mapping/financial blocker and its exact blocker fingerprint is new | `held` with `blocked` or the existing financial quarantine classification | Append one non-dependency observation/head/activity; dependency episode counters/deadlines remain unchanged |
| Same non-dependency blocker fingerprint was already observed for this subject | `deferred:unchanged_blocker` | None; restore that observation from the bounded journal, even if the head currently points elsewhere |

For new work, read selected authority before external preflight for an early fixed refusal, and validate it again under the existing lock before any committed observation or financial write. This active/epoch admission is an explicit technical narrowing of this internal command, not a new financial permission or a requirement on historical reads. Inactive-authority and preflight failures are never journaled as complete cuts. If a concurrent winner committed this exact request while admission failed, perform P1-style exact recovery before returning the refusal.

```ts
type SubjectHoldV1 = {
  identity: CommittedAuthorityIdentityV1;
  seed: EventRef | null; // null for an affecting source/mapping blocker
  state: 'pending_dependency' | 'quarantined' | 'blocked';
  reason: SelectionBlocker['code'];
  compilerHolds: /* exact accepted holds, bounded */;
  causes: EventRef[];
  missing: TypedPrerequisite[]; // exact Scope/identity/target/relation preserved
  examinationCount: number;
  episodeId: Hash | null; // null for a non-dependency observation
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
  subjectOrdinal: number;
  episodeId: Hash | null;
  previousEpisodeExaminationHash: Hash | null;
  dependencyFingerprint: Hash | null;
  blockerFingerprint: Hash | null;
  dependencyCount: number; // 0 for a non-dependency observation
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

Only the current earliest unfinished seed is actionable, but several interrupted episodes can remain in the immutable journal. The current head is a pointer/cache of the last committed observation, not the sole source of episode state. Freeze `episodeId = hashCanonical({schemaVersion:'1', kind:'dependency_episode', identity, seed})`, where `identity` is the exact committed identity and `seed` is the full accepted `EventRef`. Epoch, clock, `asOf`, request key, target version and current closure membership are excluded. Closure expansion and pause/resume do not create a new episode. Source/mapping observations have `episodeId:null`; authority/preflight refusals write no observation.

Before every substantive transition, while holding the subject scope/head locks, read that subject's examination key/scalar inventory ordered by `subjectOrdinal` with `LIMIT 1001`. At most 1,000 examinations are admitted for the subject; overflow is `incomplete:limit`, not a partial episode history. Preflight canonical lengths and the shared byte/reference budget before decoding. Validate ordinal/predecessor continuity, exact head binding and episode-specific predecessor/count links. Select the highest-ordinal examination with the exact `episodeId`, irrespective of the head's current episode. This bounded complete journal also proves whether a candidate fingerprint was ever consumed. Index `(activation_id, subject_ordinal)` and `(activation_id, episode_id, subject_ordinal)`; no new episode table or graph framework is needed.

If S has count 2 and deadline D, a newly captured lexicographically earlier seed T may become actionable. T's observation/application does not alter S's rows. Once T has real outcomes and S is earliest again, the bounded lookup restores S's count 2, original first-observed time, last-examined time, fingerprint and deadline D. If D has elapsed, S is eligible for count 3, not a fresh count 1. If S was quarantined, it stays quarantined. An intervening source/mapping observation is skipped by this episode lookup; an intervening authority refusal changes no journal/head at all. Resume uses the same episode identity despite a new authority epoch. If the exact seed was already acknowledged by validated outcomes, selection must exclude it; do not reopen a completed episode by journal state alone.

Operational choices proposed for review:

- First complete examination of a genuinely missing typed prerequisite records `pending_dependency`, count 1.
- If still missing, a distinct due examination no earlier than 1 second later records count 2; one no earlier than a further 2 seconds records count 3 and `quarantined`. These are three total examinations, not three additional retries.
- Before the due time, return `deferred` without writes, unless the dependency-relevant fingerprint changed. The clock may delay work but never move a persisted deadline earlier on restart.
- An exact relevant change can trigger early revalidation. It still increments the same episode's count if unresolved; unrelated source traffic, changed request key, changed process, or changed `asOf` alone cannot reset/count a new examination.
- After quarantine, there is no timer retry. Only a fingerprint absent from **all earlier durable dependency examinations for this episode**, including its pending phase, permits one additional unresolved examination. Its count increases monotonically (4, 5, ...), state remains quarantined, and deadline stays null. The bounded journal read proves nonmembership under the same subject lock. Reappearance of any already consumed fingerprint returns `deferred:fingerprint_consumed`, even if a different fingerprint or seed intervened. Thus F1 -> F2 -> F1 after quarantine consumes F2 at most once and never consumes F1 again. It also cannot revisit a fingerprint first observed before quarantine. A newly accepted complete group can be reported as an uncommitted eligible observation by the journal or applied only by the real writer's full revalidation; a fingerprint never authorizes application.
- No immediate retry loop for identity, mapping/schema, changed semantics, financial inconsistency, cycle, size limit or corrupted history. They retain their exact blocked/quarantined/incomplete classifications. A new complete cut may be examined when relevant evidence changes, but prior conflicting governing history remains present.

Freeze this explicit dependency evidence preimage; it is an observation identity, not a new compiler:

```ts
dependencyFingerprint = hashCanonical({
  schemaVersion: '1', kind: 'dependency_evidence', episodeId,
  pins: { artifactHash, profileHash, manifestHash },
  members, prerequisites, targetContext, guardEvidence,
});
```

- `members` is the seed's entire compiler-owned coupled closure, ordered by `compareInbox`, each entry exactly `{event: EventRef, mappedKey: {scope, identity, targetRecordId} | null}`. Resolve compiler indexes to full EventRefs; never hash unrelated full-corpus indexes whose numbering can shift. Retain all same-key representatives. Do not include plan/operation indexes or `asOf`-dependent disposition text in this evidence fingerprint; the full original classification/holds remain in the examination witness.
- `prerequisites` contains each accepted typed edge as `{consumer: EventRef, relation, scope, identity, targetRecordId, presence}`. Normalize candidate provider indexes to a complete sorted array of exact provider EventRefs/mapped keys. A target presence carries that target's canonical record hash and exact original-receipt binding `{kind, recordId, importKey: Id|null, receiptId, receiptDigest}`. Missing presence stays `{kind:'missing'}`; it does not include a hash of unrelated mapped-index entries. The full complete-index no-match proof remains in the cut witness. Sort edges by canonical `[consumer, relation, scope, identity, targetRecordId]` and reject duplicates.
- `targetContext` contains sorted `{recordId, canonicalRecordHash, originBinding}` for the group's mapped target/prerequisite identities and their existing allocation/reversal reference component. Obtain those reference relationships through the accepted finance reference helpers/selector closure, including existing allocation edges, without a new balance/grouping evaluator. Traverse only the already admitted target and use the accepted typed reference fields. This conservatively includes the entire reference-connected component, not unrelated target records. An irrelevant payment T changing the target's overall version/hash alone therefore does not change S's fingerprint. The full current target/version/hash remains bound in the cut and required for real application.
- `guardEvidence` contains sorted applicable immutable semantic EventRefs and source-contract binding/check observations that affect this subject/group, plus source/mapping blocker cause refs and incident refs. Each contract observation uses the accepted binding and fixed result/diagnostic code/path, not raw error prose. Exclude other subjects' unrelated routes, capture heads, enrollment-catalog digest and unaffected bindings. Source-wide causes are relevant, so retain them. This is a projection of accepted observations; it does not reinterpret their blast radius.

Use the canonical ordering above, not recursive field stripping. Exclude authority status/epoch, clock, request key, `asOf`, overall target version/snapshot hash and whole-source cut hash from this dependency fingerprint. They remain explicit independent admission/financial checks in the full examination. Thus `asOf` or resume alone never consumes a new evidence-triggered retry; a timed examination still requires its existing due deadline. A changed meaningful immutable dependency/guard fact can change the fingerprint. Exact source/history consistency failures still fail before hashing.

For non-dependency observations, `blockerFingerprint = hashCanonical({schemaVersion:'1', kind:'coordination_blocker', identity, pins:{artifactHash,profileHash,manifestHash}, blockers, causes})`. `blockers` is the sorted accepted affecting blocker projection `{level, code, affectedBindingOrIdentity, compilerCodesAndPaths, typedKeys, incidentRefs}`; `causes` is the sorted complete causing EventRef set. Missing optional values are explicit nulls. Exclude arbitrary diagnostic prose, current head, unrelated routes, authority/clock/`asOf` and whole-cut hash. Its full original diagnostic witness is still stored. Before appending, check this fingerprint against the entire admitted subject journal; a previously seen observation is deferred, not rewritten. Such observations have dependency count 0 and cannot reset or consume S's dependency allowance.

The state transition, rather than a uniqueness key over `(episode,fingerprint,count)` alone, enforces consumed-fingerprint behavior. Store `subjectOrdinal`, `episodeId`, `previousEpisodeExaminationHash`, fingerprint and monotone episode count as independent indexed/bound scalars. Add unique `(activation_id, subject_ordinal)` and `(activation_id, episode_id, dependency_count)` for nonnull episodes; validate the complete bounded predecessor chain and membership rule before insert under the subject lock. The database need not contain a second mutable per-episode head. Restoring S does not itself write a row or reset the current head; only an actual due/new-evidence observation or real selected commit advances it.

The accepted pure retry helpers may supply the count threshold only after their semantics are reconciled with this rule. Do not reuse `transportBackoff` as if this service performed transport. No fetch loop is introduced.

Transaction locks provide the claim. There is no long-lived lease, owner timer, background job or claim row to recover. Duplicate callers serialize on the existing subject scope lock, reread the head, and either recover the same request or observe that the due examination/fingerprint was consumed. Process death before commit consumes nothing. Process death after commit recovers the exact journal/result.

## 6. Additive storage requirements, no number reserved

The first journal-only plan proposes an additive runtime migration `NNN_sync_dependency_journal.sql` for heads/examinations only. A later selected-writer plan proposes its own additive migration for selected history/claims and any necessary head extension, with its number independently assigned then. All numbers are placeholders pending root's integrated/in-flight catalog check. No changes to runtime001–006 bytes or control DDL. Proposed tables may be named differently in the implementation plan, but responsibilities and constraints must remain explicit.

| Table | Purpose and required constraints |
| --- | --- |
| `runtime_sync_coordination_heads` | First release: one row per exact committed identity, FK to the exact import, immutable identity/baseline, mutable last-examination pointer/subject ordinal and cached last-observed hold. No deletion. Guard updates against the immediately preceding hash/ordinal. The bounded journal, not this cache, restores interrupted episodes. Later writer release adds the selected-history head/ordinal/anchor; first successful selected commit anchors exact validated P1 history/current target. No unused selected-unit columns/FKs or mode switch in journal-only release. |
| `runtime_sync_examinations` | Immutable canonical examination/digest; unique `(activation_id, request_key)` with complete identity/request binding and unique subject ordinal. Own subject/episode predecessor FKs, episode ID, evidence/blocker fingerprint and count scalars bound to canonical content. Nonnull episodes have unique `(activation_id, episode_id, dependency_count)`. The complete bounded episode membership check under the subject lock prevents revisiting consumed quarantined fingerprints; the count key alone does not. First release admits held observations only; later migration adds exact selected-result bindings. Fixed enums, checked safe integers/instants and immutable app-role rows. Complete-cut references retain raw/source holds without financial outcomes. |
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

For new work, validate the exact committed subject and read selected authority for the early fixed refusals in §4, then perform the existing allowlisted `SemanticPreflight` outside the write transaction. Reuse P1's semantics validation and no cross-service atomicity claim. Early failures attempt exact recovery again before returning their uncommitted refusal. The first journal-only service follows steps 1–5, stopping at uncommitted `eligible_observation` when a complete eligible group exists. Only the separately released writer can enter steps 6–7. For each fresh whole-transaction attempt:

1. `BEGIN`, immediately set `REPEATABLE READ` before any data query. Apply 2-second statement/lock bounds and a 5-second transaction deadline, with cancellation/rollback/release completed before returning. This attempt's snapshot is established by its **first snapshot-taking SELECT**, not by the later `readSelectionCut` call. With the accepted `lockCurrentAuthority` -> `lockParentKeys` path, that first SELECT is the hashed advisory-key lookup (`SELECT DISTINCT hashtextextended(key, 0) ... FROM unnest(...)`); it precedes the actual `pg_advisory_xact_lock` SELECT and any lock wait. Do not perform an earlier SELECT in this transaction without treating that earlier statement as the cut boundary. The journal/writer needs a coherent multi-query complete cut; do not call Phase A's pool-owning public inspector from inside it.
2. Acquire the existing parent-scope advisory lock via `lockCurrentAuthority`, then current authority row. Recheck exact request recovery after the lock. Assert exact active status and expected epoch for all new command work under the explicit admission narrowing in §4, including journal observations. A refusal rolls back lazy initialization and leaves episode/head state untouched. Use the same transaction-bound lock API and reacquire its token in every retry. Acquiring these locks does not refresh the already-established repeatable-read snapshot; their conflict/uniqueness guarantees still fence mutable authority/target state.
3. Lock selected target row and coordination head in a consistent subject order; verify historical chain and target anchor. A target unrelated to the validated initial/P1/selected history is a target conflict, never an overwritten/newly adopted baseline. Reread and validate current grant/target pins.
4. On this same client/snapshot call the accepted bounded `readSelectionCut` adapter, extended only for selected history. Its catalog/target/capture/origin scans and byte sentinels still run before decoding. Run the accepted pure inspection/selection core inside the transaction over the detached bounded facts. It must remain CPU-only. A source/mapping blocker or incomplete cut never becomes a successful plan.
5. Apply the exhaustive result table in §4. No selected unfinished financial work/no affecting blocker returns `no_work`; journal-only eligibility returns `eligible_observation`. Neither writes or clears a prior hold. For a held complete cut, admit/read the complete bounded subject journal, restore its exact episode and consumed-fingerprint set, and derive the due/new-evidence transition while holding the coordination head. If not admissible, return uncommitted `deferred`; otherwise persist the immutable examination, guarded head and one safe activity event atomically. No financial/outcome/progress writes. Because existing `withTransaction` commits normal returns, use a private typed rollback-result signal caught outside that wrapper for **every** `committed:false` result (including eligible/no-work/refused), rolling back lazy initialization; do not return normally from its callback after lazy writes.
6. For an eligible earliest group, obtain all selected mapped economic keys and all typed prerequisite keys plus delivery keys through existing `lockImportIdentities`. Validate global original ownership and exact delivery associations; strict absence/novelty does not come from classifier labels alone. Check both acknowledgment formats/bridge. Reclassify the exact selected group and semantic guards at the locked selected target/`asOf`; compare full group/plan/lineage with the just-reconstructed witness. Retain the original receipts for target prerequisites and replay members.
7. Project with existing parent/finance helpers, enforce checked amounts/limits, and construct the ordinary nonempty receipt if needed. Append shared records/origins/snapshot/receipt/plan, selected audit/outcomes/claims, immutable examination, coordination selected-history head and its cut-scoped progress in one transaction. Reconcile exact balances/target version. Publish activity last with the existing locked activity counter. Assert active epoch remains locked before COMMIT. No external I/O between cut, checks and COMMIT.

Canonical lock order is existing parent-scope -> authority -> target -> coordination head -> complete global identities -> selected outcome/claim/head checks -> activity counter. Existing P1/capture/global identity ordering is retained. No source fence or second connection participates. A persisted hold releases all locks on commit; independent known customers can take their own turns while that hold remains unresolved.

Important repeatable-read races require named tests, not assumptions:

- The hashed-key SELECT establishes visibility before the advisory-lock call/wait. Capture or enrollment committed after that SELECT but before the scope lock is acquired is outside this attempt's cut. Updating/locking a target or existing authority row changed since that snapshot must abort/retry, never silently use stale state. A table-read barrier placed only at `readSelectionCut` would miss this required boundary.
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

Use the accepted single-subject and fixed peer fixtures through real producer proofs/reviewer activation/capture. Consume the released selector adapter on the journal transaction's own client. Add:

- `examination_result_table`: genuinely complete no-work cut returns uncommitted `no_work`; valid eligible captured invoice returns uncommitted `eligible_observation` from the journal, including the exact nonauthoritative witness/plan hash. Assert no key/head/examination/activity/financial writes in both paths, including rollback of lazy authority initialization. A complete cut with only unrelated raw unknown work must retain that route in its observation without inventing a selected hold. Inactive/stale authority and unavailable/mismatched preflight return the exact fixed uncommitted refusals; recovery of an earlier committed hold still succeeds under each condition and bypasses preflight.
- `examination_due_once`: a real captured allocation missing its typed invoice; first count 1, repeated requests before due cause no rows/activity, exact request recovery is immutable; due 1s/count2 and +2s/count3 quarantine; no timer retry thereafter.
- `examination_restart_and_claim`: recreate service/pool between counts; two barrier-controlled callers consume one transition; crash before commit consumes none; postcommit response loss returns exact examination. Assert all original finance/snapshots/receipts remain byte-equal.
- `examination_changed_evidence`: unrelated peer traffic/request/asOf changes do not reset the seed's count; matching typed provider changes the fingerprint; wrong-kind/foreign/unmapped/held provider never becomes accepted release. Changed-then-return semantic history remains blocked.
- `examination_episode_continuity`: pure transition tests use S(count2, deadline D) -> earlier T -> T genuinely acknowledged in the supplied history -> S, and require restoration of S/count2/D across recreated state, then count3 if due. Quarantined S must restore its consumed fingerprint set. Journal read/transition tests assert the bounded episode lookup ignores intervening non-dependency observations and fails on omitted predecessor/cap+1/corrupt bindings. Real same-feed integration covers pause/refused-command/resume while S is held, proving no journal mutation/reset and no authority-epoch-only fingerprint change. The genuine cross-stream S/T arrival/application case is coupled to the upstream fixture gate; pure or storage seam tests do not count as its financial proof.
- `examination_quarantine_revisit`: after F1 has been consumed and the episode quarantined, a new F2 may consume exactly one additional unresolved examination; returning to F1 is deferred with no key/activity/count change, even after restart, a different current-head episode, new `asOf`, resume or concurrent duplicate callers. Also test returning to a fingerprint recorded only during the pending phase. Use pure transition/strict journal tests for deliberately reversible fingerprint sequences; do not claim immutable real source history can arbitrarily rewind. Genuine provider-arrival integration separately proves accepted evidence changes.
- `examination_complete_cut_only`: cap+1, source-contract unexamined, corrupted origins and missing capture membership write no examination/activity/head. Raw unknown route has no fabricated Scope. Real isolated SQL constraints/privileges/rollback are exercised.

These can be accepted as a bounded durable-observation prerequisite even while cross-stream generation is blocked. They must not be called dependency release.

### Selected writer and same-feed proof

- `same_feed_release`: the accepted peer starts with exactly one 300,000-cent invoice and **no payment**, so first capture a 700-cent unallocated payment using the actual approved Company A `a-finance` payment resource and apply it through the real generalized writer. Retain its actual committed sync receipt as R0 and strict original association; the existing invoice balance remains 300,000 cents. An independently qualified P1 prelude is an alternative only if it genuinely admits that exact fixture/cut; do not fabricate the payment or R0. Next capture the earliest allocation for 500 cents funded by that payment but referencing missing invoice I9, followed by an unrelated 200-cent payment. Hold without consuming funding or applying the later payment. Later capture a 900-cent I9 through the actual approved invoice resource on the same stream. Reclassification must select the whole invoice+allocation group. At the fixed applicable `asOf`, I9 balance is 400 cents, original invoice remains 300,000 cents, aggregate invoice balance is 300,400 cents and delta from the funded/pre-hold target is +400 cents; payment origin remains R0 and its unallocated remainder is 200 cents. The unrelated later 200-cent payment stays unfinished until its next group. Capture, receipt, outcomes, integer cents and snapshot hashes are observed through real accepted services; no direct parent/origin insertion, synthetic approval, or unchanged fixture truth masquerading as a funded baseline.
- `same_feed_independent_raw_gap`: use both genuinely approved fixed peers. Hold A's earliest dependency; capture structurally valid known-seller unknown raw work and B's valid 300-cent invoice. B writes exactly one original receipt/outcome; A's hold/funding and the raw unknown entry persist. Raw financial frontier stops before the earliest unacknowledged gap. No fake approval or generated-account grant.
- `shared_mapping_guard`: real renamed/missing field on mapped and unknown raw accounts blocks every consumer of the failed exact shared binding before B's 300-cent write. Assert real compiler code/path. Structurally valid unknown raw is the positive independence control. Missing seller/unscoped governing changes block the source.
- `selected_exact_history`: mix initial and P1 origins, fresh new/coalesced/replay deliveries, all-replay group, restart, postcommit response loss, pause/revoke/source outage after commit. Recover exact original receipt IDs and canonical records; no empty receipt/snapshot, no second economic effect, no activity duplication.
- `p1_selected_transition`: exact P1 recovery after selected history; P1/B first-transition barriers in both orders; P1 cannot append new contiguous coverage after selected mode; selected reader does not fall back to legacy on corrupt selected audit/claims.
- `selected_finance_regression`: unallocated funding does not reduce invoice balance; coupled allocations/reversal stay whole; exact full reversal preserves originals; limits/cycles/bad provider indices stay held; backdated fresh input changes only the latest reconstruction and leaves the original approved snapshot readable. Use independent expected cents, not production projection as the oracle.
- `selected_atomic_rollback`: inject test-harness transaction failures after record/snapshot/receipt/origin/audit/outcome/claim/head/examination/activity writes. Assert all durable rows and activity counter equal before state. No production failpoints/sleeps.
- `selected_authority_and_identity_races`: real barriers for status-wins/apply-wins, initial absent-authority-head insertion race, pause/resume changed epoch, same group duplicate callers and foreign-scope economic collision after snapshot. Exact SQL failure/recovery behavior must be observed; no test merely checks an exception without proving zero writes.
- `selected_cut_boundary`: a test transaction first holds the existing subject scope advisory lock without changing authority/target. In the writer's transaction, intercept completion of the **first hashed-key SELECT**, after it has established the repeatable-read snapshot and before the `pg_advisory_xact_lock` SELECT is issued. Commit capture (including a source-blocking event) after this barrier, then let the advisory call actually wait, release the test lock, and complete the writer. The writer acknowledges only its earlier cut; the next call observes the new blocker. This proves capture after the snapshot but **before lock acquisition** stays outside the cut. Use deterministic client/query barriers and actual lock observation, not sleeps or a barrier mislabeled at `readSelectionCut`. Add new enrollment after that same snapshot boundary and prove it is not represented in the earlier catalog. Capture committed before the first snapshot-taking SELECT is included and blocks as specified. Separate authority/target mutation barriers must force abort/retry/refusal rather than treating those mutable-state races as harmless capture staleness. No after-lock freshness or latest-at-COMMIT claim.
- `selected_bounds_and_reader_graph`: each sentinel family, bytes before decoding, declared streams/lane memberships, origins in foreign scope, corrupt rehashed canonicals, timeout cleanup and safe error redaction. Legacy/P1/selected references cannot escape budgets or disappear behind a partial query.

### Mandatory full-B proof that remains upstream-blocked

- `genuine_cross_stream_release`: genuinely approved API-only multi-stream artifact, separate exact baseline vector (illustrative `a-ledger:10`, `a-invoices:20`, `a-semantics:2`), allocation at ledger11 missing invoice I9, unrelated payment at ledger12, later invoice at invoices21; 700/500/900 cents and I9 balance400. Require actual producer-backed approvals for that exact stream contract. These illustrative stream IDs cannot be added to the fixed Company A manifest ad hoc.
- `genuine_unaffected_feed`: a third genuinely approved subject consumes an independent unaffected API feed/resource; shared-mapping failure blocks its true consumers while that third subject actually commits under its own grant. Same-feed peers are insufficient.
- `genuine_distinct_baselines`: genuine independently reviewed manifests/vectors preserve each approval-window event and selected original receipts. If released fixture contracts do not admit it, retain an explicit blocked case.

Source/Discovery must freeze the stream/schema contract; protected evaluator admission must actually verify that source. Do not ignore Company B CSV, relabel semantic streams, mutate approved manifests, fabricate successful verification/approval rows, change protected expected money, or count skips/pure tests as these proofs. Cycles unrepresentable in the current DSL may be defensive metadata tests only, not mislabeled real source cases.

Planned focused suites: coordinator unit/integration; selection; accepted P1 storage/coverage/apply; current authority; capture; parent/compiler/finance; activation regression for compatibility and original receipts; migration/role checks. Root chooses exact filenames and leased ports. Typecheck and focused checks are partial; full V5/V6, live construction, AI-off transport and joint acceptance remain outside this increment.

## 12. Proposed ownership and decisions still needed

Candidate new paths: `apps/worker/src/sync/coordination-{types,store}.ts`, `coordination.ts`; `packages/parent/src/selected-sync-{types,store}.ts`; focused tests; additive runtime `NNN`. Narrow existing consumers: selector history adapter, P1 commit compatibility guard, parent receipt-format dispatch/shared append primitive, package subpath exports if required. No files are reserved by this document. Protected recursive build manifests must be checked if any shared export/source import graph changes; do not assume a new package export is isolated.

No new product/financial policy gap blocks this bounded design. Q1–Q3 now fix the command/result/head transition semantics, exact dependency episode/evidence identity and consumed-fingerprint rule, bounded restoration lookup, actual first-SELECT snapshot boundary and real funded scenario prelude. They require scoped review of these changed design sections, not a user financial-policy decision. Remaining journal-plan details are exact accepted selector symbol reconciliation, strict schema/SQL column/FK/check definitions for the frozen DTOs, canonical examination preimage and reference validation, concrete witness-envelope byte cap, timeout/refusal/error plumbing and observed duplicate-head/serialization behavior. They are implementation details under this design, not permission to weaken the transition table. The later writer plan separately owns shared helper extraction, selected-history SQL/bridge backfill and trigger order, receipt dispatch/P1 transition guard, and the full financial transaction proofs. No source/writer plan is included here.

The writer's coherent transaction-snapshot cut and selected mutable-state fences need direct implementation proof. If the owner requests clearing unknown identity, overriding changed semantics, successful resolution without a receipt, deleting a hold to advance a frontier, or latest-source-at-COMMIT behavior, stop that extension and raise the exact missing authority or technical contract.

Self-review: kept bounded compiler-owned discovery rather than a new financial interpreter; distinguished staleable cut freshness from current financial authority; retained all source/raw/semantic gaps; avoided fictitious foreign/semantic terminal outcomes; preserved original receipts and strict P1 formats; specified negative-lookup races, bridge uniqueness and historical-reader dispatch; kept quarantine revalidation finite per evidence state and prevented interrupted episodes/fingerprint revisits from renewing it; made no-work/eligibility/refusal uncommitted; located the snapshot barrier before the advisory-lock wait; supplied a real 700-cent funding prelude; separated immediately executable same-feed proof from genuine upstream-blocked cross-stream/unaffected-feed proof. This is a proposed design for fresh review, not a claim any of these proofs ran.
