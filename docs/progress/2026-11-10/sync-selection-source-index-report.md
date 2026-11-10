# Task 2 runtime source enrollment index

- Released base `b8168c96dbfd15d235cb312ab953e41c227952ee`
- Candidate `96ce01a87c507b6bad0ac13d242a40f51ebf2c0d`
- Commit `perf: index source-scoped activation enrollment reads`
- Accepted plan SHA-256 `73bace4162032fec4f0b555480daf1a8c5b4b8b2f4ed33aba67a4f519dda3ab2`
- Accepted preflight SHA-256 `d210b576f10868e59011d60cf1b39aa360a26b732343b92e8924e1fe10e4bdaf`

The candidate adds only `db/runtime/007_sync_selection_source_index.sql` and `tests/integration/sync-selection-source-index.test.ts`. Runtime007 creates the ordinary nonunique btree on `(capture_source_ref, account_id)` via the existing migration transaction. The exact parent and paths were checked after commit, and `git diff --cached --check` and the committed range check passed. The concurrently authored catalog-fixture plan remained outside the commit.

## Focused machine checks

Node `v24.22.2` and PostgreSQL `18.6` were used. The assigned configuration was `EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`.

| Command | Result | Raw log |
| --- | --- | --- |
| `EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/sync-selection-source-index.test.ts -t 'source_index_upgrades'` with runtime007 absent | Exit 1 at the expected post-migration index metadata assertion, expected one matching row and received zero. Genuine runtime006 setup, original app read, negative pre-upgrade check and snapshots completed before the failure. One fresh case was intentionally excluded by the filter. | `/private/tmp/eapr-source-index-task2-red.QDuvMo` |
| `EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/sync-selection-source-index.test.ts` with runtime007 present | Exit 0, both tests passed with zero skips. | `/private/tmp/eapr-source-index-task2-green.8GbGVP` |
| `npm run typecheck` | Exit 0. | `/private/tmp/eapr-source-index-task2-typecheck.x4mvU6` |
| `EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/migration-prerequisites.test.ts tests/integration/parent-storage.test.ts` | Exit 0, 30 passed across two files with zero skips. | `/private/tmp/eapr-source-index-task2-regressions.5ZHPZa` |

The upgrade checks the genuine original import/receipt association and nonempty parent target and financial state, equal bytes across all 28 public non-ledger base tables, exact runtime001–007 ledger identities and preserved prefix, the original bounded result and empty absent-source result, and repeat migration stability. The fresh case checks the same index metadata and ledger, empty bounded read, exact app role identity and PostgreSQL `42501` for app-role index creation in a rolled-back transaction. Both cases observe a `Limit`, the named index with source equality in its `Index Cond`, and no `Sort` or `Incremental Sort` using the prescribed transaction-local settings. Snapshot enumeration uses the fixture owner to avoid privilege-filtered coverage. Comparisons expose table names and equality/counts only.

## Runtime migration identities

| Version | SHA-256 |
| --- | --- |
| 001 | `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3` |
| 002 | `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56` |
| 003 | `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c` |
| 004 | `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7` |
| 005 | `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96` |
| 006 | `3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836` |
| 007 | `82c9e8ade1d3d1f7265c7cc35d48c335f74c2b6321be0f7bc0d93caf5ab4dcc7` |

## Cleanup and review

- RED and GREEN both awaited the accepted fixture close for the owned `eapr_test_review_t2_apply*` namespace and its pools/root. The fresh GREEN case awaited both client rollbacks and releases, pool end, and drop of its successfully provisioned `eapr_test_review_t2_srcidx*` namespace. The regression cleanup hooks completed as part of their passing commands. No cleanup failure was reported. Namespace evidence comes from the awaited teardown paths, without a separate privileged catalog scan.
- A read-only follow-up confirmed the root-owned cluster still accepted connections on 55441, found no listeners on 3241, 3242 or 5182, and found no matching activation fixture or migration regression temporary roots. Raw log `/private/tmp/eapr-source-index-task2-cleanup.a6E1Uf`. The first attempt stopped after readiness because zsh reserves `status`; only the shell check was corrected and rerun. Raw log `/private/tmp/eapr-source-index-task2-cleanup.aAVqTt`.
- Self-review checked the exact SQL/query, catalog metadata and collations, row-byte privacy, genuine-upgrade and fresh paths, rollback and acquisition ownership, unchanged migrations, and committed path scope. No deviations from the brief were needed. Existing fixture activation uses its established temporary worker listener while regression services used the assigned ports. No provider calls, demo changes, cluster stop or push occurred.
- These are partial machine checks proving a compatible access path under test-local planner controls. Default planner choice, latency and full-slice acceptance remain outside these results. Independent exact-candidate review and joint user acceptance remain pending.
