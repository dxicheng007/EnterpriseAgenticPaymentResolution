# Task 4 PostgreSQL transaction proof and consumer compatibility

Candidate `7e49e552026c59d5ef26a6f92c41ced87bb0341c`. Git parent `6d174ae4d7983044d7b2a8ee7dd78fe42f1cde3e`. Authorized source base `a20054ae66a9d7d3fdff6d1bd1a386ef08a9c0c6`. Intervening commits were root-owned documentation.

The commit contains only `tests/fixtures/sync-apply.ts` and `tests/integration/sync-apply-races.test.ts`.

## What the cases prove

- Financial capture committed between W and W′ leaves every apply table unchanged. A separate preparation contains the whole connected suffix. Capture committed after W′ settles while apply still holds its locks. Only the W′ payment earns an outcome, receipt, and frontier advancement. The pending allocation and the two semantic deliveries remain captured. The semantic version returns to baseline, yet the next complete coverage read rejects the retained semantic history.
- When revoke or pause→resume wins before the apply locks, both new monetary apply and new all-replay bookkeeping fail the old epoch. When apply wins, `pg_blocking_pids` identifies the exact status backend waiting on the exact apply backend until COMMIT. The status transaction is then held before its own COMMIT so each committed image is independently visible. Later old-epoch apply fails and exact original receipt recovery succeeds.
- The duplicate contender passes its initial history lookup and its read-only preparation before waiting on the winner's scope lock. The wrapper receives a successful real pg COMMIT and discards that response before the winner service returns. The second caller recovers the one original receipt. A newly constructed pool and service also recover it after a separate target advance and revoke, with an observer that would fail on any source call.
- Owner-created AFTER triggers raise real P0001 after authority-head materialization, snapshot, target CAS, receipt, financial record, economic outcome, typed origin, unit, member outcome, application head initialization/progress, activity counter, and activity event. The all-replay matrix repeats each bookkeeping boundary. Every failed invocation leaves the complete durable image equal to the post-capture baseline. Healthy retries prove the full expected new and replay row deltas.
- PostgreSQL issues a real 40001 after a same-value committed update changes the activity row's MVCC version under the first test-only REPEATABLE READ snapshot. The second callback waits before its own scope acquisition while revoke commits, then reads the new authority and rolls back before target lock. A real hard advisory-lock cycle supplies 40P01 to the writer. PostgreSQL trigger errors independently prove at most three callbacks for 40001 and 40P01 and one for P0001. Each full callback reacquires scope, authority, target, coverage and identity locks.
- A foreign owner record retains its full bytes after worker rejection. The direct app-role origin race uses a genuine sync receipt. After temporarily freeing only that origin key and its dependent outcome in FK order, the ongoing origin claim wins and the concurrent initial claim fails 23505 on `runtime_financial_origins_pkey`. The exact dependent outcome is restored in finally and the complete original committed image is compared.
- Genuine A5 begins at 80,000 cents. The standalone 4,000-cent payment leaves 80,000. Its explicit 2,000-cent allocation reduces the balance to 78,000. Full payment and credit reversals restore their allocated balances at the respective effective instants, to 80,000 and 100,000, while preserving original records, origins, and historical snapshots. A 1,200-cent backdated invoice changes the latest September reconstruction to 81,200 and leaves the previous snapshot-hash read at 80,000. The earlier allocated and reversed snapshot-hash views remain exact.
- Genuine A5 with a coherent empty MAX_SAFE−1 parent baseline produces an approved MAX_SAFE version. The real writer rejects the next monetary apply with no durable change. An unsafe next cursor string and unsafe sequence input are rejected by the capture boundary. A valid low-baseline stream cannot reach MAX_SAFE within the pinned contiguous retained-history bound.
- The unchanged `createConnectionReads` returns the exact initial and sync receipt summaries, versions and balances. Later all-replay bookkeeping adds a unit and outcomes without a runtime005 receipt or increase in appliedBatches. Pending, quarantined and lag remain null. The read itself leaves the full database image unchanged.

## Machine evidence

The first standalone race-file run finished 13 passed and 7 failed (20 total). These exposed test setup/assertion defects. The status gate caught the read-only preflight COMMIT twice. PostgreSQL denied the owner setting the superuser-only deadlock_timeout parameter. Runtime006's FK blocked removal of an origin still referenced by an outcome. Reversal assertions initially used target IDs where the contract stores source record IDs. The fixture hash helper rejected the malformed sequence before capture. The receipt test expected streams before opening the lane. The real A5 version overflow test passed on the first run. No production fix or manufactured behavioral red was needed.

After correcting the harness, `npm run test:integration -- tests/integration/sync-apply-races.test.ts --reporter=verbose` passed 20/20, zero skips, in 370.62 seconds. The final cleanup placed both raw origin claims under the existing checkout/transaction wrapper and drained both before restoring the exact outcome in finally. The entire 20-test race file ran again as part of the final gate on those exact source bytes.

## Final gates on the exclusive disposable lease

Node 24.22.2 and PostgreSQL 18.6. Root-confirmed environment `EAPR_PG_PORT=55441`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, `EAPR_CONTROL_PORT=3241`, `EAPR_WORKER_PORT=3242`, `EAPR_WEB_PORT=5182`. Serial integration run.

- `npm run typecheck` exited 0.
- `npm run test:unit -- apps/worker/test packages/compiler/test packages/parent/test packages/finance/test` passed 90/90 across 11 files, zero skips, 0.942 seconds.
- `npm run test:integration -- tests/integration/sync-apply-storage.test.ts tests/integration/sync-apply-coverage.test.ts tests/integration/sync-apply.test.ts tests/integration/sync-apply-races.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts tests/integration/sync-capture.test.ts tests/integration/current-authority.test.ts tests/integration/v5-sync.test.ts tests/integration/v5-runtime-isolation.test.ts` passed 171/171 across all 10 files, zero skips, 971.03 seconds.
- `git diff --check`, the two-path staged check and `git diff HEAD^ HEAD --check` exited 0.
- `shasum -a 256 db/runtime/00[1-5]*.sql` exited 0. Direct comparisons to the authorized base matched all six runtime migration hashes.

| Runtime version | SHA-256 |
| --- | --- |
| 001 | `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3` |
| 002 | `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56` |
| 003 | `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c` |
| 004 | `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7` |
| 005 | `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96` |
| 006 | `3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836` |

Self-review confirmed no production change, including control catalog, compiler or compact fixture, evaluator or protected pins, activation-proof helper, route or connection reader. A production call-site search returned only the writer declaration. The combined command tested the final source bytes before the source-only commit. No provider setup, push, or merge occurred. An unrelated root-owned document remains outside the commit.

Final machine evidence is focused and partial. Independent exact-candidate and whole-branch review, full slice proof, live/provider proof, and joint user acceptance are separate. Both the source-writing permit and exclusive disposable DB lease are released to root. No background test runner remains.
