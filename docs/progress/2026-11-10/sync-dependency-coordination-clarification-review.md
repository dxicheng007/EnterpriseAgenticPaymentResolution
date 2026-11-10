# Scoped clarification review: dependency coordination B

Reviewed 2026-11-10 for the Platform coordinator. Read-only review of Q1–Q3 and regressions introduced by their clarification; this does not reopen or requalify the previously passed architecture.

Repository: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Candidate: `docs/progress/2026-11-10/sync-dependency-coordination-design.md`, SHA-256 `f8dfae74e41ca2ccd809171bd37ff1af132bf3ecac24048cb6d7e103a45c11eb`, verified from file bytes. Compared the supplied `/private/tmp/eapr-sync-dependency-coordination-clarification.diff` and the original review of candidate `b7e4943db3623f7cddbdc9121ad46a6ecce5cd636d6a56c3a8488204504bac08`.

## Verdict

**PASS for the scoped design clarification. Q1, Q2 and Q3 are addressed. No new blocking financial-policy, authority, or architecture breakage found in the clarification.** This is not acceptance of an implementation plan, source release, migration reservation, executed proof, live mount, or full B. No later implementation plan was supplied or reviewed.

## Q1 — Addressed

Candidate lines 75–135 give explicit uncommitted `no_work`, journal-only `eligible_observation`, incomplete/deferred and fixed inactive/stale-authority or unavailable/mismatched-preflight refusals. The ordered table distinguishes these from actual committed held observations and the later writer's genuine results. Raw unknown work may remain in the complete observation without inventing a selected-customer hold or claiming source completion. Journal eligibility neither clears the old hold nor records a placeholder selected unit.

Every `committed:false` result leaves request, examination, head and activity unchanged, including rolling back lazy initialization. The private rollback-result requirement at line 281 is necessary: the inspected `packages/storage/src/transaction.ts:11–36` commits a normal callback return. Exact recovery precedes current authority/preflight, and failed admission must attempt concurrent-winner recovery before refusal (lines 135, 273–296). Thus the chosen active/epoch requirement narrows new commands without making historical recovery depend on active authority or a live source.

The first service and its recovery type exclude applied/replay results; its schema admits only held observations (lines 104–111, 224–229). These decisions close the original durable-versus-uncommitted ambiguity.

## Q2 — Addressed

Candidate lines 182–216 define the stable exact-identity/full-EventRef episode preimage, complete bounded subject-journal lookup, ordinal/head/episode-predecessor validation, and selection of the latest examination for that exact episode independently of the current head. S(count 2, deadline D) survives intervening T and non-dependency observations; restoration does not write, reset count, or move D. Pause/resume changes admission epoch without changing episode identity. Validated real acknowledgments, not journal state, remove completed seeds.

The versioned evidence preimage explicitly normalizes compiler indexes to exact EventRefs and typed identities, retains all provider representatives and original bindings, and includes the relevant existing allocation/reversal reference component. It excludes request, clock, `asOf`, epoch, global target version and whole-cut/catalog churn. The stable finance helpers expose typed funding/invoice/reversal reference interpretation; no new balance evaluator is needed.

After quarantine, the membership test covers **all** earlier durable fingerprints for the episode, including the pending phase. A genuinely new F2 permits one further unresolved examination; F1 revisitation is deferred with no new count/key/activity. Counts remain monotone and quarantine has no timer retry. The design correctly relies on the locked, complete journal transition rather than claiming `(episode,fingerprint,count)` uniqueness alone solves revisits. Restart, intervening head, pending-fingerprint revisit, duplicates and missing/corrupt predecessor tests are expressly required (lines 348–349).

## Q3 — Addressed

Candidate lines 277–289 name the first snapshot-taking SELECT as the repeatable-read cut. The inspected `apps/worker/src/sync/current-authority-store.ts:233–242` calls `lockParentKeys` first; `packages/parent/src/persistence.ts:7–12` performs the hashed-key SELECT before the advisory-lock SELECT. The test at line 364 therefore puts the barrier after that first SELECT and before the actual advisory wait, observes the wait, and permits intervening capture to commit. It separately requires pre-snapshot inclusion and authority/target mutation conflicts. It does not mislabel a later adapter read as the cut or claim after-lock/commit-time freshness.

The same-feed case at line 356 now begins from the real peer fixture's one 300,000-cent invoice and empty payments/credits/allocations/reversals (`tests/fixtures/sync-selection.ts:448–454`). It first captures and genuinely applies a 700-cent unallocated payment, retaining its actual sync receipt R0; a P1 alternative requires independent qualification of that exact cut. Company A's declared `a-finance` resources include the required payment/allocation/invoice resources (`packages/sources/src/company-a.ts:10–37`), and the peer exposes accepted capture (`tests/fixtures/sync-selection.ts:515–518`). The later 500-cent allocation and 900-cent invoice give I9 balance 400, aggregate invoice balance 300,400, delta +400 from the funded baseline, and funding remainder 200, with the unrelated 200-cent payment still unfinished. These are specified future observations, not executed proof.

## Scope and remaining plan obligations

No new financial kind, source-wide fence, skip/resolve authority, enrollment, writer mount, transport, scheduler or provider capability was introduced. Lines 15, 23, 52, 224–229 and 275 explicitly separate journal-only heads/examinations from the later selected writer. Migration numbers and source paths remain unreserved. Genuine cross-stream release, unaffected-feed application and distinct baselines remain mandatory upstream-blocked proofs (lines 366–374).

The next journal-only plan must concretely specify:

1. Accepted selector/authority adapter symbols and strict DTO mapping after their interface release; do not adopt in-flight Task 4 closure as acceptance. Keep the caller-owned transaction/client and CPU-only selection boundary.
2. Exact SQL columns, checks, unique keys, subject/episode predecessor FKs, immutable role privileges, guarded head updates and canonical/scalar binding validation; freeze the examination preimage and historical reference reader. Admit the complete capped journal before concluding fingerprint nonmembership.
3. Concrete canonical ordering and accepted metadata projection for each evidence field. In particular, prove unrelated passing raw/peer/same-subject traffic and target-version-only changes cannot manufacture a new dependency fingerprint; retain genuinely affecting shared-binding failures and source-wide causes. Use existing typed reference helpers and admitted target data, not a second financial/grouping interpreter.
4. A concrete encoded witness-envelope cap within aggregate bytes, bounded referenced-object accounting, cap+1 and missing/corrupt-chain behavior, and safe timeout/error/refusal schemas. State boundary behavior when an append would exhaust the admitted journal budget.
5. Actual rollback-result plumbing for every uncommitted path, exact recovery under refusal/outage, duplicate/absent-head and repeatable-read conflict handling, bounded whole-transaction retries and completed cancellation cleanup. Observe zero durable mutation on losing/failed attempts.
6. Focused real PostgreSQL proofs for the result table, due counts/deadlines, restart/response loss, competing callers, interrupted episodes and quarantine revisits, plus unchanged financial records/snapshots/receipts. Keep deliberately reversible fingerprint and S/T seam tests labeled as such; they are not genuine cross-stream financial execution.

The separate later writer plan still owns shared append-helper extraction, selected-history/outcome/acknowledgment SQL and bridge ordering, strict format dispatch, the locked P1 transition guard, original-receipt retention, exact global uniqueness conflicts, atomic rollback, the actual first-SELECT barrier and funded same-feed scenario. It must preserve the upstream full-B gates and independent expected-cents assertions.

## Review evidence and limits

Inspected the candidate, supplied diff, original review, accepted selector design/scope audit, freeze F3 and verification conventions, and the stable authority-lock, transaction, finance-reference, Company A and peer-fixture seams needed for Q1–Q3. No in-flight selector source/tests or Task 4 closure were treated as accepted evidence. Prior acceptance facts remain coordinator-supplied, not requalified here.

Commands were file reads/searches and SHA-256 verification. No Git operations, repository/source edits, database access, tests, migrations, provider calls or subagents. Only this temporary review report was written. Machine execution, exact-candidate review and joint acceptance remain separate.
