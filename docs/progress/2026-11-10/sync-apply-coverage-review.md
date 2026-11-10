# Task 2 independent exact-candidate review

Candidate: `7161d6ebd31c124848d4fbff2642adb61fde51f1`.
Source base: `7af5d8ace77a087529c05bada4c8da48f7b4a0d2`.
Candidate parent: `33e3849e2f84e7ffc227717b675d09bd82207d4a` (intervening documentation only).

Specification verdict: **PASS for Task 2**.
Code-quality verdict: **PASS for Task 2**.
Actionable findings: **None**.

Reviewed all four candidate paths, the supplied diff and Task 2 brief/report, applicable repository guidance, and the referenced classifier, parent history/origin/snapshot readers, shared schemas, authority reader and capture schema. Confirmed HEAD equals the candidate and the four reviewed files have no working-tree changes against it.

- `apps/worker/src/sync/apply-coverage.ts:63`: one source-rooted SQL statement independently bounds lanes, checkpoints, positions, inbox, deliveries, pages and prior application history. Source-wide absence/out-of-cut/incident predicates prevent orphan rows from vanishing through matching inbox joins, including nonmatching-manifest checkpoints. Baseline membership is verified separately from the retained ongoing-event budget.
- `apps/worker/src/sync/apply-coverage.ts:209`: the actual stored page is strictly decoded with its original digest and compared to independently loaded canonical deliveries before compact projection. `apps/worker/src/sync/apply-types.ts:33` then verifies full contiguous history, independent set/index correspondence, page reconstruction, exact checkpoint boundaries, explicit absent heads and the complete unapplied suffix. The 1,000 bound covers retained prefix plus suffix.
- `apps/worker/src/sync/apply-coverage.ts:370`: immutable exact-key history reads validate the cut's flat prior unit, outcome and original receipt bindings without extending mutable capture selection. Preparation separately validates the committed import, current authority projection and exact target snapshot from pointers observed in the cut statement.
- `apps/worker/src/sync/apply-coverage.ts:399`: accepted `classifyBatch` remains the financial classifier. Preparation checks one complete accepted group, input/event/group/operation/producer indexes, replay records and original receipts, typed prerequisites, grant/compiler limits, plan lineage and exact suffix membership. No second economic-equivalence comparator is introduced.
- `tests/integration/sync-apply-coverage.test.ts:82`: fixtures activate before introducing new source transactions and persist through `openCommitted`/`capturePage`. Rejection assertions compare durable rows before/after; owner-only corruption is rolled back. Tests include real retained replay prefix, one-event overflow suffix, missing head/outcome/origin, mixed new/replay/coalesced membership, semantic/source-wide blockers and raw-page corruption.

Verification judgment: the report records behavioral red for the orphan-checkpoint assertion, followed by coverage 42/42, storage 11/11, focused units 67/67 and typecheck passing. The earlier 16 missing-module failures are setup evidence only. I performed read-only source/diff inspection and did not rerun these passed suites or access the database. No repository edits or Git mutations were performed.

This review approves the read-only preparation and coverage boundary only. Task 3 still owns application, W/W′ equality after locks, commit-time authority/target checks and recovery integration; Task 4 owns its assigned concurrency/rollback proof. No live/full-slice or joint user acceptance is implied.
