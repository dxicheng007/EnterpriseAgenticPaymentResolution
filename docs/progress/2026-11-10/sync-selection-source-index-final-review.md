# Final whole-plan review: sync selection source-index prerequisite

## Scope and candidate

- Plan: `docs/superpowers/plans/2026-11-10-sync-selection-source-index.md`, verified SHA-256 `73bace4162032fec4f0b555480daf1a8c5b4b8b2f4ed33aba67a4f519dda3ab2`.
- Base: `faf9b70e9358693e9f16da423e71634a4dd93767`.
- Head: `96ce01a87c507b6bad0ac13d242a40f51ebf2c0d`.
- Reviewed both completed tasks together: fixture ownership/error handling and the runtime007 source/account index, with their two integration suites. Read the SDD progress rulings, task reports, independent task reviews, and execution logs.
- The supplied `review-faf9b70..96ce01a.diff` has the same paths, blob identities, additions and removals as the exact Git range; its packaging/context differs from default `git diff`. The checkout HEAD is later than the reviewed head, so source review used the specified commit. All four assigned source files currently equal their reviewed candidate bytes.
- Other changed documentation in the range is integration context, not an expansion of this verdict to the unfinished selector or fixture-design plans.

## Strengths

- **Ownership and failure semantics compose correctly.** `tests/fixtures/sync-apply.ts:111` guards the complete acquisition sequence, registers each acquired root/namespace/pool immediately, and closes in reverse order. A namespace is owned only after successful provisioning. Cleanup catches synchronous and asynchronous failures independently; it attempts later cleanup even after earlier failure. The deferred, memoized non-async `close()` returns the same completion to concurrent and later callers. Construction preserves the original thrown value unchanged when cleanup succeeds, and by identity in `cause` when cleanup fails; cleanup failures remain separate in `errors`.
- **The shared fixture remains compatible.** The exact diff changes resource lifetime and error handling only. Its signature, fields, runtime-only migration ceiling, latest default, control migration catalog, optional baseline path, financial producers, proof construction and authenticated review/worker import remain intact. The unchanged activation path still awaits real approval, worker activation and `verifyOriginals` before returning. Internal control/worker listeners retain their existing lexical ownership. No runtime model capability or product authority was added.
- **The migration is minimal and immutable.** `db/runtime/007_sync_selection_source_index.sql:1` contains precisely the ordinary nonunique btree on `(capture_source_ref, account_id)`. The range changes no prior migration, runner, grants, generated-column definition or financial data code. The existing runner discovers and hashes the SQL, uses migration-role credentials and commits DDL with its ledger identity. Runtime002's account uniqueness and runtime006's generated source key support the exact source-filtered, account-ordered query without extra keys. Verified runtime007 SHA-256: `82c9e8ade1d3d1f7265c7cc35d48c335f74c2b6321be0f7bc0d93caf5ab4dcc7`.
- **The tests exercise real dependency integration.** Lifecycle cases use actual acquisitions up to each fault boundary and actual A5 construction for both repeated-close outcomes. Their fallback retains exact ownership, restores interception and awaits already-started real pool closures before namespace removal. No successful financial construction is stubbed.
- **Upgrade and role evidence are appropriately specific.** `tests/integration/sync-selection-source-index.test.ts:163` obtains a genuine runtime006 import with its original activation/receipt, proves the prior index gap, snapshots all public non-ledger base tables through the owner, and checks nonempty financial/target/import state. After upgrade and repeat migration it requires unchanged row bytes and ledger prefix, exact index metadata/collations, original query results and absent-source emptiness. The fresh-schema case at line 219 checks the ordinary app identity and SQLSTATE `42501` for DDL inside a transaction that is rolled back.
- **Planner and privacy claims stay bounded.** The exact `LIMIT 9` query is parameterized. Planner settings are transaction-local; the assertions prove the named ordered path and absence of sorting, not production latency or default plan choice. Snapshot equality reports table names/counts and booleans rather than canonical financial/proof payloads. Transaction cleanup always attempts rollback and client release, and outer cleanup retains the primary error separately from cleanup failures.

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

None.

### Minor (Nice to Have)

None. No deferred minor issue from this plan remains.

## Checks and evidence

This review performed read-only source/history/hash inspection. It ran no tests, database operations or services, spawned no subagents, and made no repository or Git mutations. The only output written is this report. No concrete doubt justified repeating the already-passing checks.

Inspected raw evidence:

- `/private/tmp/eapr-sync-apply-task1-red.MIeTXq`: three intended behavioral failures: the startup root remained, later cleanup was skipped, and the setup/cleanup compound error was lost. Five cases were deliberately filtered out.
- `/private/tmp/eapr-sync-apply-task1-green.g3a0na`: eight lifecycle tests passed, with no skips or reported fallback failures.
- `/private/tmp/eapr-sync-apply-task1-typecheck.bUvmBd`: typecheck output has no diagnostics; the task report records exit 0.
- `/private/tmp/eapr-source-index-task2-red.QDuvMo`: failure is the post-migration missing-index metadata assertion after genuine runtime006 setup, not an import/catalog/file failure. The other case was deliberately filtered out.
- `/private/tmp/eapr-source-index-task2-green.8GbGVP`: both new integration tests passed, with no skips.
- `/private/tmp/eapr-source-index-task2-typecheck.x4mvU6`: typecheck output has no diagnostics; the task report records exit 0.
- `/private/tmp/eapr-source-index-task2-regressions.5ZHPZa`: all 30 migration/storage regression tests passed.
- `/private/tmp/eapr-source-index-task2-cleanup.aAVqTt` and `/private/tmp/eapr-source-index-task2-cleanup.a6E1Uf`: the initial shell-only reserved-variable failure is disclosed; the corrected check reports the root-owned cluster available, leased service ports unused and matching temporary roots absent. Namespace deletion evidence is the successful awaited cleanup paths, not an independently queried namespace inventory.

These are focused partial machine checks. The combined source review confirms Task 2 consumes the accepted Task 1 fixture without modifying it again or copying its construction cleanup mechanism. No unsupported full-slice or joint-acceptance claim is needed to accept this prerequisite.

## Recommendations

Record final independent review as accepted for this exact two-task prerequisite. Retain the separate selector and fixture qualification gates when scheduling their next work; do not use this result as a PR-wide merge decision or a performance benchmark.

## Declined to judge

- Selector implementation, rejection semantics, whole-catalog admission, byte budgets, canonical JavaScript ordering and snapshot coherence: owned by the unfinished selector plan; this prerequisite supplies its access path only.
- Nine-subject, Company B CSV, bundled-profile and distinct-manifest fixture implementation/qualification, including their outer/nested transport measurements: separate fixture plans; their documentation changes are contextual only.
- A new independent financial audit of the unchanged original-record validator, financial producers, proof engine or approval implementation: no changed behavior in those components; this plan preserves and exercises the accepted real construction path rather than redefining its financial oracle.
- Cleanup redesign for preexisting listener ownership inside `activate`, or native provisioning's own partial failures: explicitly retained owners outside the assigned fixture acquisition changes; no changed hunk broadens them.
- Default PostgreSQL plan choice, production index-build availability, large-volume latency or throughput: the accepted ordinary transactional migration and local path test do not claim production performance or online rollout qualification.
- Full product/live/AI-off synchronization, browser workflow, whole-slice acceptance and joint user acceptance: require their own evidence and walkthrough; these focused prerequisites do not establish them.
- Merge readiness of all PR52 changes: the review request is bounded to this exact two-task plan, not the whole PR.

## Assessment

**Final plan acceptance: Accepted.** Spec compliance and combined code quality are approved for `faf9b70e9358693e9f16da423e71634a4dd93767..96ce01a87c507b6bad0ac13d242a40f51ebf2c0d`, with no findings.

**Ready to merge?** Yes for the reviewed two-task prerequisite in isolation; whole PR52 merge readiness is not assessed.

**Reasoning:** The cleanup prerequisite preserves ownership and error provenance across real construction and teardown, and the additive migration supplies exactly the required ordered source access path without changing prior migrations, authority or record semantics. Real upgrade/fresh-schema/role/preservation checks and the inspected RED/GREEN evidence support completion of this plan, while later selector, fixture and joint-acceptance work remains separate.
