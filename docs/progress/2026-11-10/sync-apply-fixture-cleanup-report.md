# Task 1 fixture lifecycle report

- Base: `faf9b70e9358693e9f16da423e71634a4dd93767`
- Candidate: `7f291e47195e75fcf3d28dbc6a2b352f5731bfc5`
- Commit: `test: make sync apply fixture cleanup ownership explicit`
- Candidate paths: `tests/fixtures/sync-apply.ts` and `tests/integration/sync-apply-fixture-lifecycle.test.ts`
- Accepted plan SHA-256: `73bace4162032fec4f0b555480daf1a8c5b4b8b2f4ed33aba67a4f519dda3ab2`
- Preflight SHA-256: `87c744967cd197f797eb0ad31de1cec14aa8c09194827d4356acb1d5668417ab`

The fixture registers the root, namespace and three pools as each is acquired. One memoized close Promise awaits all registered actions in reverse order and retains each cleanup failure. Successful cleanup preserves original construction rejection identity. Compound failure preserves the original value in `cause` and individual cleanup errors in `errors`. Scope, fixture signature and return fields, baseline and runtime-ceiling behavior, financial source producers, original-record validation and reviewer activation path are preserved.

## Machine checks

The worktree used Homebrew Node `v24.22.2` and the existing PostgreSQL 18 cluster. Commands used `EAPR_PG_PORT=55441`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, `EAPR_CONTROL_PORT=3241`, `EAPR_WORKER_PORT=3242` and `EAPR_WEB_PORT=5182`. The native readiness command confirmed port 55441 was accepting connections before and after the checks.

| Check | Result | Raw log |
| --- | --- | --- |
| `npm run test:integration -- tests/integration/sync-apply-fixture-lifecycle.test.ts -t 'fixture_lifecycle_start_failure\|fixture_lifecycle_proof_failure_and_cleanup_failures'` against the original helper | Exit 1. Three expected behavior failures, five cases excluded by filter. The startup root still existed. Both real post-proof fault variants skipped drop/removal and emitted the pool-end sentinel in place of an AggregateError. No setup/import/fallback failure. | `/private/tmp/eapr-sync-apply-task1-red.MIeTXq` |
| `npm run test:integration -- tests/integration/sync-apply-fixture-lifecycle.test.ts` | Exit 0. Eight passed with zero skips in 70.86 seconds. | `/private/tmp/eapr-sync-apply-task1-green.g3a0na` |
| `npm run typecheck` | Exit 0. | `/private/tmp/eapr-sync-apply-task1-typecheck.bUvmBd` |
| `git diff --cached --check` and exact parent/path check | Exit 0. Candidate parent equals released base and candidate contains exactly the two Task 1 paths. | Commit metadata above |

## Cleanup evidence

- Real root allocation is observed separately from removal. Startup and provision faults retain original error identity and leave no owned directory. The provision fault runs no real provisioner and issues no drop.
- After the second pool factory throws, the first real pool ends and the exact namespace and root are removed. After a genuine migration completes and its wrapper throws, all three actual pools end before native namespace teardown and root removal.
- In both post-proof compound cases, all three actual pool ends and exact native teardown complete once despite injected post-success rejections. Root removal is attempted once and the fault leaves an actual directory as the test witness. Restored fallback removes the exact directory and verifies ENOENT. Error and frozen non-Error setup values retain identity as the cause, and all three cleanup errors retain their identities in action order.
- Both genuine runtime006 A5 cases exercise the existing independent original-record validation and observe one persisted import/receipt with the returned scope and identity, plus nonempty persisted target and original financial rows. Normal close and cleanup-error close each reuse a single Promise across concurrent and later calls and attempt teardown once. The injected close rejection follows successful real pool end, and other resources are released.
- During RED, fallback awaits each started raw pool end before dropping only its recorded namespace and removing only its recorded root. GREEN keeps the first raw pool end if an invalid repeated end is attempted and reports any fallback failure without silently replacing the primary failure. No fallback failure was observed.

These are focused partial machine checks. Exact-candidate independent review and joint acceptance are pending. Existing migrations ran only in disposable fixture databases. No migration files changed. No demo reset, repin, provider call, cluster stop, or push was performed. Concurrent catalog and variant planning documentation changes in the worktree were outside this commit.
