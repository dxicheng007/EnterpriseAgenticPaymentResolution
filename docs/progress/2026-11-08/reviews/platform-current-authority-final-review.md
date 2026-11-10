# Final whole-branch review — current authority

**Ready to merge: Yes, for the bounded internal current-authority/status-fence scope.**

**Finding count: 0 critical, 0 important, 0 minor.** No current-task implementation defect or incompatible interaction with the integrated baseline was identified. This verdict does not establish product mounting, production reviewer authentication, monetary application, full synchronization, live construction, CI success, or joint acceptance.

## Exact review subject and method

- Base: `8afe1c92b3e8decbcc4663131f8ce74002e984f8`.
- Head: `acebe2bfa1aab9cb9dc145113d36a8d555efed13`.
- Immutable package: `.superpowers/sdd/2026-11-09-current-authority/review-8afe1c9..acebe2b.diff`, SHA-256 `1bf74307d1a09375cf1c77a2f67aa9035e0831b6db9c251da5efdcd8736f98e2`.
- Verified the package's `## Diff` section equals `git diff -U10` for the exact range. The package also contains its commit list/stat header, so its entire bytes intentionally differ from bare `git diff` output. Verified every changed checkout file equals its exact head Git blob before using those files for line-oriented inspection.
- Reviewed the complete implementation, DDL, contracts, focused tests and compatibility edits, accepted design and corrected plan, implementation report, task review, integrated checkpoint, and the added historical/design review records. Inspected narrow existing dependencies where the new code relies on their behavior. The 27-file branch adds the internal implementation and supporting design/review records; the production/test implementation remains the 14 assigned files.
- No source, Git state, database, external service or process was changed. No test suite was rerun. Only this requested report was written. No subagents were dispatched.

## Strengths

1. **Admission is explicit and bound to the actual stored subject.** `apps/worker/src/sync/current-authority.ts:25` documents the required trusted-composition boundary. Strict detached/frozen grants and input precede private lookup; the per-call WeakMap binding is deleted in an awaited `finally` (`:112`). Occupied keys resolve genuine persisted A5 scope/source before the service exposes replay or canonical conflict (`:82`, `:185`). New-session retries retain the original reviewer audit while still requiring current authorized reviewer identity. Final admission after awaited observation runs outside SQL locks (`:147`).

2. **Original activation and current authority remain separate durable facts.** `apps/worker/src/sync/current-authority-store.ts:69` derives the initial projection from the validated committed A5 import. Reads use one repeatable-read, read-only client (`:197`). A missing head with any account command history fails closed, including exact retry (`:179`); there is no epoch-1 reconstruction over retained history. `db/runtime/004_current_authority.sql:2` retains the head and gives commands scoped RESTRICT foreign keys and immutable history, with narrow application privileges (`:104`).

3. **Concurrency and recovery have meaningful implementation and test evidence.** The service acquires a fresh locked snapshot within each transaction callback (`apps/worker/src/sync/current-authority.ts:211`), and repository locks follow the existing account-scope advisory-lock order (`current-authority-store.ts:226`). Exact command lookup precedes stale/new transition checks. The integration tests exercise actual blocking, first materialization races, resume versus revoke, activity rollback, consistent reads, and an actual SQL40001 retry with an intervening committed revoke (`tests/integration/current-authority.test.ts:631`, `:689`, `:735`, `:788`, `:812`). The tests do not claim a financial writer race.

4. **The financial and semantic boundaries are narrow.** DTOs enforce safe positive epochs and legal result relationships (`packages/contracts/src/current-authority.ts:5`, `:22`); repository decode additionally binds audit, result, reviewer, immutable grant pins and resume semantics (`current-authority-store.ts:118`). Resume reuses unchanged selected-profile and semantic validation; pause/revoke/replay need neither live source availability nor current activation setup files. Production writes are restricted to authority head/log and sanitized runtime activity. Genuine A/B imports and before/after original financial-table comparisons support that separation (`tests/integration/current-authority.test.ts:63`, `:159`, `:170`).

5. **Compatibility maintenance matches the actual dependency change.** The new contracts barrel leaf is included in both protected evaluator source inventories and both mutation-test families; recursive graph coverage is retained. Parent-storage changes only its disposable privileged reset dependencies. Capture changes only the migration-ledger assertion, preserving the three historical hashes and recognizing additive runtime004. No activation, capture, parent, source, UI, HTTP, or runtime composition implementation is changed.

## Findings

### Critical — none

### Important — none

### Minor — none

There are no numbered actionable findings to resolve in this review. The historical other-owner findings recorded in the branch remain historical findings, not newly discovered defects in current authority and not silently closed by this verdict.

## Concrete checks and evidence

- `git diff --check 8afe1c9 acebe2b` passed. Working tree was clean before the requested report. Exact-head byte comparison passed for every changed path.
- Verified runtime migration SHA-256 values: 001 `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3`; 002 `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56`; 003 `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c`; 004 `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7`. The exact range contains no edits to runtime001–003 or control SQL.
- Inspected `packages/parent/src/activation-store.ts:80`, `:171`, `:193` and snapshot decoding: canonical bytes, domain hashes, scalar indexes, scoped original import, receipt/activation/plan/proof relationships and the approved snapshot are validated on the supplied client. The new read wrapper preserves SQL retry errors and translates known storage decode failures.
- Inspected `packages/storage/src/transaction.ts:11`: a supported 40001/40P01 retries the whole callback after rollback/release, bounded to three attempts. The new callback reacquires its scope/head and rereads current state on each attempt; it does not reuse an earlier locked token.
- Inspected unchanged `apps/worker/src/activation-validation.ts:72` and `:77`: exact selected hash, exact source, wildcard rejection, and approved-account revision checks are reused in preflight and locked commit. Unrelated account revisions remain allowed. No new TTL or semantic policy was invented.
- Inspected guarded strict objects, normalized instants and recursive freezing in `packages/contracts/src/common.ts` and `packages/storage/src/activation-files.ts:111`; these support command/grant detachment and canonical interval comparisons. Reviewed all 35 authority integration cases and contract tests, including corruption, role permissions, missing-head retention, replay audit, mutation barriers and numeric exhaustion.
- Searched app/package references to the service, schemas and fence helpers. The service remains unmounted: no production caller outside its own module is introduced. Its runtime imports do not invoke Discovery Gate J, Experience, or live transport. Existing production activation/semantic files are unchanged. The reported 39-module runtime-resolution check was not rerun; its numerical graph count remains implementer evidence.
- Inspected saved `/private/tmp/eapr-authority-candidate-integration.log`: **84 tests passed in 4 files** for the exact implementation candidate (35 authority, 27 parent storage, 1 activation, 21 capture, as identified in the report and test output). No new database run was performed.
- Inspected `/private/tmp/eapr-authority-integrated-checks.log`: typecheck completed, **499 unit tests in 74 files** passed, followed by **5 migration-prerequisite/local-composition tests in 2 files**. This is the recorded integration over main89cf0bd, not a claim that every repository integration/e2e suite ran.
- Inspected `/private/tmp/eapr-authority-owner-integration.log`: typecheck and **12 affected contracts/transport unit cases** passed after main8afe1c9. The upstream PR21 contract leaf remains outside the protected barrel/inventories; PR22 changes the independent live transport. Neither changes this service's authority dependency or provides its missing production adapter.
- The checkpoint records CI startup failure before any jobs, with GitHub's account-payment/spending-limit annotation. This review did not independently query GitHub or rerun CI. There is no CI pass claim and no code/test-failure inference from that startup event.

## Declined to judge

- **Production reviewer/session/origin/CSRF and authenticated control-channel admission:** the factory requires a trusted authorizer but provides no mounted adapter. Test-owned opaque handles prove the internal admission contract only.
- **Out-of-band session revocation after final admission during the short transaction and bounded retries:** the accepted plan explicitly assigns this request-lifetime assumption to trusted composition; the private token does not make control session state atomic with runtime SQL.
- **Fence-token use after transaction end or pooled-client reuse by a future caller:** `LockedCurrentAuthority` documents a live-transaction precondition. This service respects it; the same-client WeakMap is not an automatic PostgreSQL lock-lifetime detector.
- **Actual financial application, receipt associations for later synchronization, scheduling, capture frontiers, data holds, reenrollment and V5/V6:** no such consumer or writer is delivered. The fence test establishes only the lock/status/epoch prefix.
- **Complete source schema/document-feed coverage and source/runtime atomicity:** resume checks existing declared semantics only, as accepted. Future application must supply its own source/hold gates.
- **Gate J, Experience and live-provider correctness beyond interaction with this branch:** their exact-candidate reports remain tracked and unresolved. No authority code mounts or invokes those paths; this review neither fixes nor accepts them.
- **Future additive classification implementation:** the added corrected design/reviews describe a separately reviewed future compiler task and explicitly reserve no code or runtime behavior. This branch does not implement or machine-verify that proposal.
- **Full repository integration/e2e, live construction, browser acceptance, external CI recovery, and joint user acceptance:** neither commissioned nor established by the supplied bounded evidence. Existing passing suites were deliberately not repeated.

## Assessment

**Ready to merge: Yes, within the stated bounded scope.** The implementation satisfies the accepted current-authority plan with consistent admission, durable retention, exact replay, checked epochs, transactional status changes and safe retry behavior. The additional documentation preserves the separation between machine results, independent review and later acceptance; no unrelated owner defect is represented as closed.

The coordinator reported during this review that PR23 had already been externally merged. That does not change the pinned review subject or this technical verdict; merge state and exact review evidence remain separate.
