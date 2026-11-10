# Task 1 current authority implementation

Status: Implemented and machine-verified in the assigned scope. Candidate ready for root-coordinated independent review.

- Branch: `codex/platform-current-authority`
- Dispatched base: `d6c2dd4e713d3bd56fb2f879e1cf90fdd8456ead`
- Candidate: `ad13e2fe87abeb03cfd1f2ab15eac19dc413ebaa` (`feat: add durable current authority fence`)
- Dispatched brief SHA-256: `5b47da76c74cd9586420c18a95c28a73cec964c7939a8ad96bc539b48012a07f`
- Node v24.22.2, PostgreSQL 18.6. Exclusive DB lease on port 55441 with prefix `eapr_test_review_t2`. Disposable fixture databases, serial integration suites. Lease released to root after the final run. Cluster and preserved demo untouched.
- Machine scope: focused authority and regression evidence. Independent review and joint acceptance are separate.

## Assigned paths

- `packages/contracts/src/current-authority.ts`, `packages/contracts/src/index.ts`, `packages/contracts/test/current-authority.test.ts`
- `apps/worker/src/sync/current-authority.ts`, `apps/worker/src/sync/current-authority-store.ts`, `apps/worker/src/sync/current-authority-errors.ts`
- `db/runtime/004_current_authority.sql`
- `packages/evaluator/src/financial-attestation-build.ts`, `packages/evaluator/src/bootstrap-runner.ts`, and their build-closure tests
- `tests/integration/current-authority.test.ts`
- `tests/integration/parent-storage.test.ts` two dependent tables in the privileged reset list
- `tests/integration/sync-capture.test.ts` migration ledger expectation only, separately released by root after the exact runtime003-only assertion was identified

## Verification and RED to GREEN

All commands used `PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH`. Integration also used `EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`.

- `npm run test:unit -- packages/contracts/test/current-authority.test.ts packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/bootstrap-build.test.ts`. Before implementing the DTO refinements and closure lists, 17 failed and 2 passed against importable permissive schema scaffolding. Assertions rejected accepted invalid DTOs and identified the new unpinned index leaf. After implementation, 19 passed in 3 files. Logs `/tmp/eapr-authority-unit-red.log` and `/tmp/eapr-authority-unit-green.log`.
- `npm run test:integration -- tests/integration/current-authority.test.ts`. First both genuine A5 imports succeeded in the fixture and 2 service assertions failed on empty scaffolding. After runtime004/repository/service implementation both passed. The expanded admission/resume matrix passed 21 in 1 file. Logs `/tmp/eapr-authority-integration-red.log`, `/tmp/eapr-authority-integration-green.log`, and `/tmp/eapr-authority-integration-expanded.log`.
- `npm run test:unit`. 488 passed in 73 files, zero failures or skips. Log `/tmp/eapr-authority-all-unit.log`.
- `npm run typecheck`. Passed.
- `npm run test:integration -- tests/integration/current-authority.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts tests/integration/sync-capture.test.ts --reporter=verbose`. 84 passed in 4 files, with 35 authority, 27 parent storage, 1 V3 activation, and 21 capture. Zero failures or skips. Log `/tmp/eapr-authority-candidate-integration.log`.
- Intermediate bounded runs each passed 83 of 84 cases. In both runs the new privilege test observed the intended rejection with a different SQLSTATE than it asserted. The reused runtime002 history trigger uses `55000`, and PostgreSQL 18 uses `23001` for referenced deletion under RESTRICT. The corrected test keeps the `23503` assertion for insertion with a wrong FK. No DDL changed after the first migrated pass. Logs `/tmp/eapr-authority-bounded-integration.log` and `/tmp/eapr-authority-bounded-integration-final.log`.
- Post-commit executing-plans `task-done` recorded focused units at 19/19 in the shared ledger. The bounded integration verification above used the exact staged candidate bytes before commit.
- `git diff --cached --check` passed. The staged path list contains only the 14 assigned files. Node 24 `registerHooks` checked the actual runtime import resolution from `apps/worker/src/sync/current-authority.ts` with tsx. It loaded 39 local runtime modules without evaluator, source/operator, Discovery, control-service, or model SDK dependencies.

## Runtime migration identities

| Migration | SHA-256 |
| --- | --- |
| 001 | `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3` |
| 002 | `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56` |
| 003 | `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c` |
| 004 | `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7` |

Runtime001–003 and the control catalog are byte-identical to the base. Runtime004 adds only the two authority tables and their constraints and triggers. The capture regression now checks the three historical hashes, runtime004's actual hash, and reapplication equality.

## Self-review

- Admission runs before command parsing or private DB lookup. Parsed grants and the command are detached and frozen. Occupied keys resolve the genuine persisted subject before incoming command/reviewer conflict, including a wrong scope within the same account. No association result returns without the actual source grant and verified audit. Fresh admission and observer execute outside runtime SQL. Each invocation's WeakMap entry is private and cleared in an awaited finally.
- A read uses one repeatable-read, read-only client for A5 and authority state. Account-wide history without a head fails closed on both snapshot and lock paths. Commands hold the existing parent-scope and head locks. The actual PostgreSQL 40001 fixture proves the next callback reacquires the lock, reads an intervening revoke, and fails stale. A failed activity insert rolls back the counter, head, and audit.
- Direct A5 reads and the existing ActivationStateV1 projection retain original activation and receipt bytes. The genuine A/B first imports verify source-derived originals. The authority suite compares all original parent/financial/import/delivery tables before and after. Source observation uses unchanged semantic helpers, including a real separate-account revision that does not invalidate the selected account.
- Runtime001–003, worker activation/capture modules, parent/finance/source behavior, HTTP and app composition have no edits. Protected build lists add only the contracts leaf and mutation tests retain recursive closure coverage.

## Limits and handoff

The test admission adapter recognizes test-owned opaque handles. Actual authenticated control ingress, browser session/origin/CSRF, and product mounting remain separate. After the final admission check the composition vouches for the short runtime transaction and bounded retry lifetime. A source observation records declared revisions and does not attest schema or document-feed completeness. The locked head is a future writer precondition. Its WeakMap validates identity and client while the caller holds a live transaction, and provides no automatic lock-lifetime check on a recycled client. No monetary apply race, full ConnectionState, V5/V6, Gate J/provider fix, independent review, or joint acceptance is claimed.
