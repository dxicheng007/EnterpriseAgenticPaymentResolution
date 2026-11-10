# Sync selection source index — scoped plan-fix review, round 1

Reviewed worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Reviewed plan: `docs/superpowers/plans/2026-11-10-sync-selection-source-index.md`.

Verified revised SHA-256: `73bace4162032fec4f0b555480daf1a8c5b4b8b2f4ed33aba67a4f519dda3ab2`.

Verified that `.superpowers/sdd/2026-11-10-sync-selection-source-index/plan-fix1.diff` exactly reverses that plan to original SHA-256 `0761d450da15a94280ed121f55c752f8bc3423b0d52ffc7f764e5af8cf780999`. Verification reconstructed the original in memory; no Git command or repository write was used.

**Verdict: PASS for the scoped plan fix. Original P2: ADDRESSED. No new actionable finding in the fix.** This is a source-only plan review, not implementation verification, source/SQL release, candidate approval, or joint acceptance.

## Why the P2 is addressed

- The root ruling in `.superpowers/sdd/2026-11-10-sync-selection-source-index/progress.md` explicitly authorizes a separately reviewed fixture-lifecycle prerequisite in exactly `tests/fixtures/sync-apply.ts` and the new `tests/integration/sync-apply-fixture-lifecycle.test.ts`. Revised plan lines 45–54 and 99–109 implement that separation and require Task 1 acceptance before Task 2.
- Plan lines 84–86 move the guard before root creation and startup, register root removal immediately after acquisition, register namespace ownership only after provisioning resolves, and register each pool immediately after its constructor returns. Reverse-order cleanup awaits and catches each action independently, so one failure does not suppress later attempts. The fixture does not gain authority over a failed provision attempt or the shared native cluster.
- The non-async memoized `close()` preserves the same Promise for concurrent and later callers, including rejection, without rerunning actions. Successful cleanup preserves the exact original setup rejection. Compound failure preserves that original value by identity in `AggregateError.cause` and retains separate cleanup failures in `errors`, with fixed wrapper messages and no mutation of Error or non-Error values.
- Lines 20 and 72 accurately limit the guarantee to cleanup attempts and reported failures. They do not promise deletion during a filesystem/database outage. The injected root-removal failure deliberately leaves an observable root for exact-owner fallback recovery after restoring spies.

## Fix-quality assessment

The test matrix at lines 58–80 is meaningful for the existing defect: startup rejection exposes the pre-try root leak; provision rejection cannot authorize a namespace drop; partial pool acquisition tests immediate registration; migration and proof failures exercise real construction. Compound failure injects faults after real pool/drop completion and before root removal, asserts every cleanup attempt, and covers both Error and frozen non-Error setup failures. The plan requires assertion-level RED, ownership recorded outside assertion paths, restored spies, independently attempted fallback cleanup, and surfaced fallback failures.

The successful close and rejected close paths each use genuine A5 construction. They retain independent original-record verification, require actual import/receipt and nonempty financial/target state, and check shared Promise identity and once-only cleanup. No passing producer result, approval, activation, proof, or fixture-success stub is manufactured. The existing integration configuration disables file parallelism; the plan also prohibits concurrent tests using these global spies and supplies longer timeouts for genuine proof/A5 cases.

The fixture's public signature and returned fields remain intact. The change is confined to acquisition, private cleanup and construction-error handling; financial literals, source/proof producers, protected truth, evaluator behavior and the private activation service lifecycle remain outside scope. The existing selector inventory hashes fixture files at execution, so preserving its before/after check is compatible with the separately authorized fixture change.

Task 2 retains its two new files and the previously reviewed index/query, metadata, populated-upgrade, fresh-schema, app-role and compatible-access-path requirements. Its changed cleanup instructions consistently apply owned-resource registration, independent cleanup attempts, original-error preservation, and client release even if rollback fails. I did not reopen unrelated index design or selector behavior.

## Activity and remaining gates

Read the original finding, root ruling, exact fix diff, revised plan, relevant test guidance/configuration, current fixture acquisition and activation code, native provisioning/drop behavior, original-proof helper and selector inventory. Verified both plan hashes as above. No source/repository edits, Git operations, database connections, service startup, migrations, tests, or subagent dispatch occurred. The only written artifact is this report.

Root still owns plan acceptance and source/SQL release, the Task 4 exact-candidate gate, the runtime007 reservation and service lease. Implementation RED/GREEN evidence, typecheck, exact-candidate reviews for both separate tasks, and actual cleanup evidence remain required; this review does not replace them.
