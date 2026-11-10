# Task 3 independent exact-candidate review

Candidate: `a20054ae66a9d7d3fdff6d1bd1a386ef08a9c0c6`.
Authorized source base: `ac42684ad8d1f733f4de874e6b45f288fac3c753`.
Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Spec verdict: **PASS for Task 3's assigned scope.**
Quality verdict: **PASS; no actionable findings.**

Reviewed the exact candidate diff, Task 3 brief/report and approved classifier/fixture clarifications, complete worker apply and parent sync-store sources, coverage/classification and persisted-unit schemas, identity/authority/transaction helpers, fixture and relevant positive/negative test source. HEAD was the exact candidate and the worktree was clean. This review made no repository edits, Git mutations, database calls or provider calls, and did not rerun already-passing suites.

## Findings

None.

## Basis

- `apps/worker/src/sync/apply.ts:117` owns the write transaction. Scope and authority precede exact-history recheck, active epoch, target FOR UPDATE/version/hash validation, W′ equality, classifier recomputation and one complete stable identity-lock acquisition (`:140–149`). The identity set contains new/replay/coalesced mapped economics and all checked prerequisites; delivery identities retain source reference. There are no capture-lane/checkpoint locks or incremental identity acquisitions. `packages/parent/src/sync-store.ts:743` validates global collisions and canonical delivery associations before application-head locks and writes.
- The approved export in `apps/worker/src/sync/apply-coverage.ts:399` reuses the accepted validator in preparation and locked recomputation without changing coverage SQL or classification rules. It checks one complete accepted group, plan correspondence and lineage/event ordering, compiler/runtime versions, committed allowed kinds/limits, coalescence producer indexes and prerequisite provider indexes. Caller events/artifact/profile are not an authority input.
- `packages/parent/src/sync-store.ts:549` checks the locked snapshot against complete relational financial membership and initial/ongoing origins. `:702` persists the audit, optional runtime005 monetary receipt and new economic records, exact delivery outcomes and both application heads in the caller transaction. Only the financial frontier advances; all-replay retains the same target and creates no monetary receipt. `apps/worker/src/sync/apply.ts:198` publishes safe activity last, then reasserts active authority synchronously before COMMIT.
- `apps/worker/src/sync/apply.ts:80`, `:120` and `:245` place exact recovery before preparation/preflight and repeat it under the authority fence. A winner can also be recovered after a preparation/preflight rejection. Monetary recovery validates the exact stored plan and original committed identity/epoch; replay recovery requires the complete original prepared binding, including its saved epoch. New replay bookkeeping checks both the current epoch argument and prepared epoch (`:260`). Neither historical path reclassifies, calls the source, changes heads or emits activity.
- SQLSTATEs remain intact until the standard transaction wrapper has applied its bounded 40001/40P01 retry policy, then database details are redacted. There is no catch/recovery or ad hoc retry around unknown write-COMMIT outcomes. Each retry reacquires locks inside a fresh callback.
- The fixture clarification is implemented using genuine A5 activation, unchanged original snapshots/receipts, and accepted runtime capture of complete canonical pages. Tests assert the concrete 80,000→78,000→77,000 cent progression; R0/R1/R2 origin associations; ordered full event/record IDs; canonical audit/outcome bytes; immutable originals; heads and activity. Coalescence and identical-page retry are exercised separately from the compiler's delivery-repeat branch. Negative tests cover foreign-source bare-ID collisions, changed observedAt, bindings and malformed plans, stale target/epoch, held groups, bounds, origin ambiguity/missing ownership, relational divergence and other-account economic collision. The existing coverage/storage checks add capture provenance, missing-head history, legacy recovery and persisted epoch consistency.
- The seven candidate paths fit the authorized scope. Compiler, finance, contracts, protected activation fixture and runtime001–006 have no diff from the authorized base. Runtime005 SHA-256 remains `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96`; Runtime006 remains `3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836`. No mounted apply path, scheduler, provider or model dependency was introduced.

## Evidence boundary

The implementer records typecheck success, 90/90 focused unit tests and 65/65 focused integrations, with no skips. I inspected the test assertions and source but did not independently execute these suites. Task 3's lost-response test discards a successful response and performs offline recovery after target advancement and revoke; it does not inject loss after COMMIT. Deterministic concurrent barriers, rollback injection, actual unknown-COMMIT fault evidence and connection-consumer compatibility remain the separately assigned Task 4 gates. This verdict does not claim those checks, full V5 acceptance or live readiness.
