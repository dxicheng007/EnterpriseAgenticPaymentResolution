# Sync selection source index — independent plan review

Reviewed plan: `docs/superpowers/plans/2026-11-10-sync-selection-source-index.md`

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`

Verified SHA-256: `0761d450da15a94280ed121f55c752f8bc3423b0d52ffc7f764e5af8cf780999`.

Spec verdict: **PASS**. Plan-quality verdict: **one narrow cleanup issue to resolve**. This is a source-only plan review, not migration execution, candidate approval, machine verification, or joint acceptance.

## Finding

**[P2] Reconcile the unconditional cleanup requirement with the unchanged fixture's setup-failure seam.** The plan at lines 20, 40, 43, 50 and 54–58 requires all created fixture roots to be cleaned in `finally`, forbids changes to `tests/fixtures/sync-apply.ts`, and relies on `createSyncApplyFixture(6)` plus `data.close()`. That helper creates its private temporary root at `tests/fixtures/sync-apply.ts:113`, then awaits `startNativeDb()` and `provisionTest()` at lines 114–115 before entering its `try` at line 124. If either rejects, no returned `data.close()` exists and the private root remains. Additionally its close routine at lines 119–122 skips root removal if pool shutdown or `dropTest` rejects. This is a pre-existing helper limitation, not an index defect, but the current two-file plan cannot deliver the stated unconditional cleanup guarantee through that interface.

Before release, have root reconcile that dependency explicitly: either arrange a separately owned fixture-lifecycle fix, or narrow the plan's cleanup claim and document root-owned recovery for setup/cleanup failures with exact resource evidence. Do not widen this implementer's paths or add broad temporary-directory deletion. The new fresh-schema test can and should implement its own full cleanup guard within its assigned file.

## Confirmed design and verification points

- The exact nonunique btree `(capture_source_ref, account_id)` matches the accepted source equality / ordered `LIMIT 9` scan. Runtime002 already makes `account_id` unique; runtime006 adds the stored capture keys but no source-leading import index. No extra key, INCLUDE, predicate, uniqueness or collation is needed.
- The fixture interface exists and genuinely runs authenticated reviewer preparation/approval and worker activation, with independent original-record verification. Its runtime-only ceiling retains the full control catalog. A populated runtime006-to-007 migration is therefore supported by the existing interface.
- Snapshots cover all public base-table row serializations except the separately asserted migration ledger, preserve canonical TEXT, and require nonempty imports/targets/original financial rows. They do not claim populated explicit authority commands or ongoing sync history.
- Metadata checks specify the table, method, validity/readiness, exact two key columns, no INCLUDE/expression/predicate, nonuniqueness and default collation. Application-role reads and rolled-back DDL rejection preserve migration/application ownership separation.
- Transaction-local planner controls plus the exact parameterized query test a compatible ordered index path. They do not make a default-planner or performance claim. The empty fresh-database test is separate from populated upgrade preservation.
- RED is structurally meaningful: runtime006 remains a valid discovered catalog, migration is a no-op while 007 is absent, and the first post-migration assertion checks the missing index before requiring version 7. No nonexistent-file import or catalog-version failure is needed.
- Existing migration discovery, readiness and inspected migration/storage regression assertions derive identities from the catalog. No existing metadata expectation change was identified. The plan prohibits hidden inventory, fixture, selector, runner or verifier edits and directs any newly discovered incompatibility back to root.
- Root's migration-slot reconfirmation, Task 4 review gate and exclusive SQL/service lease remain release prerequisites. The reported 76-origin-ref reservation check was supplied by root and was not independently repeated in this read-only review.

## Review activity and limits

Read repository/database/test guidance, relevant PRD/frozen contracts/verification conventions, the accepted Task 5 plan and preflight, runtime schema definitions, migration/native DB helpers, activation fixture, runtime pool factory, and relevant existing migration/storage/state-snapshot tests. Verified the plan file hash. No Git operations, database connections, migrations, test execution, service startup, source edits or subagent dispatch occurred. The only written file is this report.
