# Independent whole-branch atomic-sync-apply review

Base: `f4098053e119f456f8da987b25ebb73c48732276`.
Exact source candidate: `7e49e552026c59d5ef26a6f92c41ced87bb0341c`.
Checkout: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

**Specification verdict: PASS for the bounded, unmounted Platform atomic-sync-apply repair.**
**Code-quality verdict: APPROVED.**
**Ready to merge: YES for this reviewed scope, on the recorded local evidence.** This is a technical review verdict, not a claim that CI passed or that mounting/full-product acceptance is complete. The reported CI state remains `startup_failure` with zero jobs.

## Review basis

Reviewed the supplied complete range index and every changed production/schema section, all added and modified test/fixture sections, and the duplicate deletions by exact blob comparison to the retained candidate tests. The source package includes the entire non-documentation range, not a task-only subset. Review proceeded in bounded passes; no changed production file was reread as a second complete source copy. The full documentation package remained available; future authority/Discovery/selection documents were assessed for integration, dependency and status claims, with their own exact design/plan reviews retained rather than treating them as implemented source.

Read the applicable repository, app, package, parent, database and test guidance; normative financial/receipt/transaction and acceptance boundaries; accepted design/plan; execution ledger and its rulings; storage finding and scoped closure; coverage and writer reviews; race report/review; compact-page and fixture clarifications; and duplicate-cleanup evidence. Independently checked candidate blob hashes:

- Atomic design: `4e07cae264aaae9bd4790240332061bc48d540de3eb99275ba1629dae45084ce`.
- Consolidated accepted plan: `a45221d9567e1e8d0a5c617eb0ec82f280dd61fe378009837a4c13288ea3adfc`.
- Runtime006: `3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836`; runtime001–005 match their recorded fixed pins.

No source, test, database, index, HEAD or branch mutation; no test-suite rerun, provider call or delegated reviewer. Only this requested temporary report was written. Later root-authored reports/coordination updates are supplemental evidence, not additional source covered by the candidate verdict.

## Strengths

1. **Capture provenance is now an actual storage boundary.** `apps/worker/src/sync/apply-coverage.ts:63` roots one SQL snapshot in the committed source, independently bounds lanes/checkpoints/positions/inbox/deliveries/pages/history, and includes source-wide orphan, out-of-cut, incident and legacy-history guards. The raw canonical page is decoded and checked before compact projection. `apply-types.ts:33` proves contiguous full retained history, page/index correspondence, prefix outcomes and the entire remaining suffix. The lifetime 1,000-event restriction cannot be evaded by selecting a short suffix.

2. **Classification and authority remain separate.** `apply-coverage.ts:399` reuses the accepted compiler classifier, checks exactly one complete accepted group, exact input/event/operation/producer indexes, typed prerequisites, grant/compiler limits and plan correspondence. The factory obtains artifact/profile from the committed import; caller events, classification labels and current-looking DTOs confer no authority. No compiler, finance, protected fixture or new financial interpretation was added.

3. **The transaction is coherent across all effect domains.** `apps/worker/src/sync/apply.ts:117` follows scope → authority → target → complete identity set → application heads → activity ordering. W′ must equal W canonically and by digest, and the classifier runs again against the locked target. The complete identity set includes mapped economics, prerequisite identities/record IDs and full delivery keys. `packages/parent/src/sync-store.ts:702` validates global collisions and exact delivery/target/origin bindings before appending optional monetary state, unit, outcomes and progress on the caller's connection. Activity is last, followed by the synchronous active-epoch assertion. No source I/O or capture lock enters that transaction.

4. **Receipt semantics preserve original effects.** Mixed unit membership can acknowledge an initial or ongoing replay while its original record/receipt association stays unchanged. New receipt target IDs represent only new operations. All-replay units require active current authority for new acknowledgment, retain the target/version/snapshot, and return distinct originals without fabricating a monetary receipt. Runtime005 remains the monetary receipt store; the unchanged PR44 consumer therefore retains its receipt ordering and applied-batch meaning.

5. **Historical recovery validates more than self-consistent hashes.** `sync-store.ts:343` resolves flat prior-unit references against immutable rows, validates predecessor relationships, and uses scoped receipt/snapshot caches. `:406` checks prefix/current members, canonical outcome/delivery indexes and original receipts. This closes the earlier P1 finding, including independently rehashed outer-reference corruption and corruption of a referenced prior audit. Recovery uses saved immutable bindings, not current capture checkpoints or source access. `apply.ts:80` and the locked recheck recover an exact winner; neither unknown COMMIT outcomes nor stale epochs are silently converted into new success.

6. **Additive schema protects the shared origin domain.** Runtime006 preserves runtime005 histories, retires legacy delivery INSERT, adds typed scoped FKs, and uses one financial-origin primary key plus normal-privilege triggers for initial/ongoing exclusivity. Backfill validates concrete existing ownership and creates no invented units/frontiers. History remains immutable and app roles lack UPDATE/DELETE/TRUNCATE; head updates are confined to progress and a matching next unit. Existing migration bytes remain unchanged.

7. **The tests exercise the promised behavior.** Genuine A5 plus accepted capture is used throughout. The financial progression, coalescence, mixed and multi-original replay, held groups, corrupted provenance, foreign economic ownership and checked numeric limits have concrete assertions. The race tests observe PostgreSQL blockers and query boundaries, inject failures across financial/bookkeeping/activity writes, discard a successful actual COMMIT response, obtain real 40001/40P01 failures, and verify fresh callbacks and intervening revoke. Full durable images include originals, origins, units, outcomes, heads, receipts, snapshots and activity. Later capture after W′ remains durable and outside that receipt, exactly matching the accepted cut boundary.

## Issues

- Critical: none.
- Important: none.
- Minor: none requiring action.

No source finding is parked or deferred by this verdict.

## Focused unchanged-code checks

- **Legacy upgrade risk:** runtime006 rejects receipts with no original financial records. Checked `packages/parent/src/activation-store.ts:134–136`: accepted A5 persistence already requires nonempty distinct financial effects. Consequently this does not reject a valid metadata-only legacy import; that import is not permitted by the existing writer.
- **Retry/token and lock-order risk:** checked `packages/storage/src/transaction.ts:11`, `packages/parent/src/persistence.ts:7` and `apps/worker/src/sync/current-authority-store.ts:226,330`. The wrapper rechecks out and reruns the complete callback for only 40001/40P01, at most three times; scope/identity locks use the existing stable keys. The new service acquires fresh authority and identity tokens inside every callback instead of relying on a retained token across transaction lifetimes.
- **Accidental mount risk:** a production-tree search for `createSyncApplier` returned only its declaration; no caller or retired `persistSyncBatch` remains in production. The range contains no composition, route, scheduler, source transport, control-database, model SDK or key integration.
- **Deleted-test coverage risk:** independently compared each deleted base blob with its retained candidate canonical `.test.ts` counterpart. All four are byte-identical and match the recorded SHA-256 values. The existing integration include pattern selects `**/*.test.ts`, not the deleted `*.test 2.ts` copies. No canonical test was removed.

## Evidence distinctions

The exact source-matched Task 4 report records successful typecheck, **90/90 focused units in 11 files** and **171/171 integrations in all ten selected files**, with zero skips. The latter includes the final twenty race cases and parent, activation, capture, current-authority and runtime-isolation regressions. Root's full unit result is **564 tests / 80 files at a20054a**; the subsequent candidate source changes are only the fixture and race test, both covered by the final focused gates. I inspected the source assertions and reports, not a fresh execution; these are recorded partial machine results.

This report supplies fresh whole-branch independent review for the stated source candidate. It does not convert the reported CI startup failure into a pass, replace repository merge controls, establish a full slice packet, or record joint user acceptance. The documentation preserves that separation. Future authority ingress, Discovery producer/configuration and selection plans have their own bounded document approvals and remain queued; no corresponding implementation appears in this source range. Their fixture/provider dependencies and subsequent source-review gates remain real.

## Declined to judge

- Mounted scheduler/HTTP admission, source fetching and steady-state operation: explicitly outside the accepted unmounted P1 increment; no such source is introduced.
- General dependency release, independent-customer frontier closure, semantic/unknown/foreign terminal resolution and skip authority: separate later contracts; the reviewed primitive rejects these inputs rather than claiming resolution.
- CSV/Company B recurring batches, multi-financial-stream selection and genuine multi-subject fixture feasibility: separately owned producer/evaluator prerequisites, not established by this API-only repair.
- Stronger exclusion of capture between W′ and COMMIT: the accepted design explicitly permits later capture to remain pending; imposing a shared commit-time capture fence would change the reviewed scope.
- Implementation correctness of future authority/Discovery/selection plans: those changes are documentation only here and retain separate exact design/plan review provenance; no future source release is granted.
- Full V5/V6/V7, live provider generation, two-company AI-off operation, production performance and joint acceptance: require their own executable evidence and user review; the bounded tests do not assert them.
- CI execution/service-account remediation: supplied state is startup_failure with zero jobs; no CI run or account/settings investigation was authorized for this review.

## Assessment

The final branch addresses the inherited writer's capture-provenance, original-receipt, atomic-progress and authority-fencing defects without broadening financial behavior or mounting unfinished operation. The implementation's size is justified by the independent capture witness, immutable-history validation and mandated transaction proof; flat bounded references and cached immutable reads avoid recursive history expansion. Preserve the explicit 1,000-retained-event/single-lane limits and partial-evidence labels when integrating. No corrective source work is requested before merging this bounded repair.
