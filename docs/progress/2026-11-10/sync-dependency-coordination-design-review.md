# Independent architecture/specification review: dependency coordination B

Reviewed 2026-11-10, read-only, for the Platform coordinator.

Repository: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Candidate: `docs/progress/2026-11-10/sync-dependency-coordination-design.md`, SHA-256 `b7e4943db3623f7cddbdc9121ad46a6ecce5cd636d6a56c3a8488204504bac08` (verified from file bytes).

## Verdict

**PASS for the bounded architecture and specification direction.** No blocking financial-policy or architecture defect found. This is a design judgment, not approval of an implementation plan, a source release, execution qualification, a migration reservation, or full B acceptance. The concrete builder questions below must be answered in the later reviewed plan; they do not require user policy clarification or another architecture.

The candidate implements the accepted audit's B boundary: durable observations followed by one independently revalidated complete financial group, without adding transport, scheduling, resolution authority or enrollment (`sync-coordination-scope-audit.md:82–106`). It correctly preserves genuine cross-stream, unaffected-feed and distinct-baseline proof as mandatory upstream-blocked work (`candidate:284–290`). A journal-only subincrement and then same-feed writer proof are useful partial milestones; neither is a substitute for full B.

## Important builder questions to close

### Q1. Freeze an exhaustive command-result and head-transition table

The result union has applied, replay, held, deferred-with-required-hold and incomplete, but no representation for a complete cut with no selected-customer unfinished financial input and no selected blocker (`candidate:71–85`). The transaction section already requires no-work to roll back lazy initialization (`candidate:201`). The accepted selector can legitimately return complete coverage with no proposal and no blocker for that subject (`sync-selection-design.md:34–50,66–76`). Do not manufacture a hold or call this structural incompleteness.

The plan should specify a strict uncommitted no-work result, its captured-cut observation if any, and that it consumes no request key, head/activity mutation or examination. Also state what journal-only `advance` returns when the selector finds an eligible group but the writer has not shipped. The first milestone must not persist an `applied`/`selected-unit` result without a real selected unit. A narrow journal-only method/result or an explicit uncommitted eligible observation suffices.

In the same table, settle whether inactive authority and failed external semantic preflight yield a durable blocked observation or a fixed uncommitted refusal. The draft includes authority blockers in `SubjectHoldV1`, performs preflight before the transaction, and asserts active authority specifically for application (`candidate:88–101,193–201`). Both observation and refusal can preserve safety, but the builder must not infer a new active-authority requirement for historical recovery, silently skip promised hold observations, or journal an incomplete source read as a complete cut.

### Q2. Preserve episode state across intervening observations, and define fingerprint revisit behavior

The stable episode key and three-total-examination rule are appropriate (`candidate:125–140`). The proposed head stores the current earliest hold while the journal retains earlier observations (`candidate:148–149`). The plan must explicitly say how an earlier episode is restored when it becomes earliest again: for example S has count 2, a newly captured lexicographically earlier stream seed T becomes earliest, T is applied, and S becomes earliest again. S must recover count 2 and its persisted deadline/quarantine state, not start again at count 1. An intervening authority-blocked observation and later resume needs the same protection if such observations are journaled. Merely retaining the old rows is insufficient unless the transition reads them.

Freeze the exact episode identifier and fingerprint preimage, a bounded lookup of the episode's latest applicable examination, and the meaning of “one new complete revalidation for that new fingerprint” after quarantine (`candidate:133,136`). Specifically decide what happens on F1 → F2 → F1; do not let request keys, caller `asOf`, restart, unrelated cut traffic, or replacement of the current head manufacture a new retry allowance. The proposed unique `(episode,fingerprint,count)` transition is not by itself a uniqueness rule for an already consumed quarantined fingerprint; its enforcement depends on the locked state transition or an additional exact key. This is a routine deterministic state-machine decision already delegated to the owner (`scope-audit:75,100`), not a new financial exception.

This can remain a bounded journal query plus one current head. No new episode table, graph framework, scheduler or lease is required. Add restart/duplicate-call tests around the interrupted/revisited episode, in addition to the already proposed unchanged-evidence tests.

### Q3. Name the actual repeatable-read cut and specify the same-feed funding prelude

**Snapshot naming:** `candidate:197–212` correctly acknowledges that repeatable-read visibility may be established before an advisory-lock wait completes. The existing lock helper first executes a SELECT of hashed keys (`packages/parent/src/persistence.ts:7–12`), so the cut is not necessarily established by the later `readSelectionCut` call or after all selected locks have been acquired. Keep the candidate's explicit transaction-snapshot boundary (`candidate:42–48,281`), place the test barrier at that actual boundary, and describe capture that commits after it but before lock acquisition as outside this cut. Do not accidentally test or claim the stronger old P1 statement-snapshot timing “under account locks” (`platform-sync-atomic-apply-design.md:85–91`) merely by naming a later barrier “locked cut.” This does not require a cooperative source fence; if a later plan chooses a stronger after-lock freshness requirement, that is a separately specified implementation obligation.

**Funding prelude:** the accepted fixed peer fixture starts each subject with one 300,000-cent invoice and no payments, credits, allocations or reversals (`tests/fixtures/sync-selection.ts:448–454`; peer-fixture design `:103–106`). The proposed 700/500/900 same-feed case (`candidate:273`) is feasible with unchanged approved A mappings: `a-finance` includes actual invoice/payment/allocation resources (`packages/sources/src/company-a.ts:10–17,25–37`), and the fixture exposes accepted capture (`tests/fixtures/sync-selection.ts:515–518`). The plan should first capture/apply a 700-cent unallocated payment through the real generalized writer (or use an independently qualified prelude that genuinely admits P1), retain that actual sync receipt as R0, then capture the missing-invoice allocation and unrelated 200-cent payment. Do not pretend the fixture has an initial 700-cent payment or inject the record/origin directly. When I9 arrives, its balance is 400 cents and aggregate invoice-balance delta is +400 cents at the fixed applicable as-of; the original 300,000-cent invoice remains unchanged. This source inspection establishes feasibility, not an executed proof or live transport claim.

## Why the principal architecture is acceptable

### Complete cut, financial fences and concurrency

The writer accepts identity/epoch/as-of/key only and reconstructs the complete cut on its own transaction/client. It cannot accept a selector proposal as authority (`candidate:54–85,195–203`). Compiler-owned source guards, full-corpus grouping, exact typed closure and selected-group replanning are retained. Foreign or held providers never supply missing money; unrelated later same-customer input cannot overtake the held seed (`candidate:119–123`). This matches PRD `:327–335` and freeze F3 `:148–150`.

The distinction between a staleable captured/catalog observation and financial authorization is correct. A later source blocker, capture incident or new enrollment is outside the already established cut and must remain unacknowledged, not be silently cleared (`candidate:40–50`). P1 expressly disclaims a no-capture-between-cut-and-COMMIT fence and names `capture_after_locked_cut` (`atomic-apply design:89–91,133`); the scope audit repeats that limitation (`scope-audit:90`). No source-wide cooperative fence is justified merely by demanding that absence remain fresh at COMMIT.

Conversely, selected authority/epoch, target and coordination-head races cannot be treated as harmless source staleness. The candidate names the required real row-conflict/unique-conflict behavior, including an absent authority head and a foreign economic claim invisible to the repeatable-read snapshot (`candidate:207–214`). Global economic/delivery locks must be accompanied by actual relational uniqueness; stale absence after a lock wait cannot authorize a conflicting insert. A unique violation is not evidence of replay. Three whole-transaction retries only for 40001/40P01, full cut reconstruction, fixed expected epoch and completed timeout cleanup are consistent with the accepted transaction utility (`packages/storage/src/transaction.ts:11–36`). The later source review must inspect exact constraints and observed SQL behavior; this design review cannot establish them.

### Storage size and reuse

The five additive responsibilities are defensible, not five independent frameworks (`candidate:142–158`): a mutable subject head, immutable request/examination history, versioned noncontiguous unit audit, per-event outcomes, and cross-format acknowledgment uniqueness. Each has a distinct invariant. The bridge is needed to prevent separate P1/selected outcome tables from independently accepting an acknowledgment; it must not replace shared economic origins or bootstrap delivery checks. Backfill/trigger order and full subject/member binding remain exact plan obligations.

For the first journal-only release, implement only heads/examinations and bounded readers/transition logic. Defer selected units/outcomes/bridge and receipt-dispatch changes until the writer step needs them. This makes the useful first increment small without generalizing a repository abstraction. Preserve the candidate's reuse of accepted receipt/record append and financial validation helpers (`candidate:156`); do not duplicate projection, economic equality or financial validators merely to keep new filenames isolated.

### History, recovery and progress

Request binding and exact recovery precede current authority/preflight and consume no new work (`candidate:83–85,191–216`). Immutable receipts remain readable after pause/revoke/outage; new replay bookkeeping still requires active authority. All-replay creates no monetary receipt or target version. Mixed units retain each original effect receipt (`candidate:181–189`), as F5 requires (`contract-freeze:218–224`).

Separate selected formats preserve strict P1 meanings. The locked P1-to-selected transition guard is necessary because a prepare-only guard cannot prevent a concurrent false contiguous append. Format dispatch must fail closed on malformed selected history rather than fall back to legacy (`candidate:185–189`). This directly addresses the existing receipt dispatch seam (`packages/parent/src/sync-store.ts:500–513`).

The internal cut-scoped progress retains unknown raw routes without invented Scope or monetary zero, and does not call foreign routing or semantic observation financial application (`candidate:218–244`). A raw frontier stops at unresolved positions despite a later independent customer's success. This is consistent with F1 independence (`contract-freeze:41–43`) and PRD `:318–331,355`; it grants no skip/resolve authority.

Bounds cover complete source history, helper-reachable receipts/origins, selected history and examination references. Cap+1/incomplete cannot become a hold count or successful unit (`candidate:246–254`). The separate assembled-envelope cap is necessary; a full witness need not fit a single 1 MiB source-value slot. The plan must budget repeated historical references without recursive audit copying, fix exact envelope bytes, and prove reference-graph admission. The draft honestly retains its technical lifetime-corpus restriction.

## Review scope and limits

Read applicable repository/area guidance, PRD, F1/F3/F5 and verification conventions, accepted scope audit and selector design/plan, P1 atomic-apply design, and stable P1/parent/capture/source/accepted-peer-fixture seams needed for the findings. The in-flight selector implementation/tests were not used as accepted authority. P1 `7e49e55`, P3 `d8e2833` and peer fixture `cc78b73` acceptance are dispatch-supplied facts, not independently requalified here.

Commands were read-only file listing/search/reads and SHA-256 verification. No Git operations, source/repository edits, database connections, tests, migrations, provider calls or subagents. Only this `/private/tmp` report was created. Root still owns catalog/path reservations, subsequent exact plan/source reviews and exclusive PostgreSQL leases. Machine execution, independent review and joint acceptance remain separate.
