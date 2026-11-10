# Bounded API and semantic capture implementation

Ready for independent review of commit `efce3de8e83b6003e2eac8185b26820c2ef3351a` on `codex/platform-sync-capture`.

- Dispatch base `44bed0c0dc91d0361bf399a6463ace7eeca05afd`
- Candidate `efce3de8e83b6003e2eac8185b26820c2ef3351a`
- Commit subject `feat: add committed API source capture`
- PostgreSQL lease `55441` released after the isolated test databases were dropped by the suite.

## Changes

- `apps/worker/src/sync/{bootstrap,capture,capture-errors,capture-store}.ts` implements the internal bound service. It resolves the exact immutable committed A5 import, verifies the complete baseline independently of which deliveries the first import applied, and seeds global delivery and position identities with lane-specific checkpoints. A CSV-bearing artifact or manifest rejects the entire lane before writes.
- `db/runtime/003_sync_capture.sql` adds lanes, checkpoints, positions, complete pages, inbox membership and safe incidents. Existing history is immutable. The app role can update only the three mutable checkpoint columns. The SQL incident constraint enforces safe, strictly ordered IDs within the bound.
- `packages/contracts/src/{sync-capture,index}.ts` and `packages/contracts/test/sync-capture.test.ts` define and exercise the strict capture-only DTOs. The two evaluator build manifests and their existing recursive and source-byte mutation tests now cover the new leaf.
- `tests/integration/sync-capture.test.ts` exercises durable capture with real PostgreSQL, the real A/B proof fixture, explicit reviewer approvals, and actual worker commits. It uses an additional isolated public synthetic A fixture with two separate $3,000 agreements and matching originals for same-lane and cross-lane proof. The second manifest begins at a distinct semantic cursor. All activations remain A5 epoch 1. The alternate subjects use the same evaluator eligibility rules and installed policy path.
- `tests/integration/parent-storage.test.ts` adds the six new FK-dependent tables only to the preexisting disposable reset. The integrator explicitly reserved that edit after the combined run showed PostgreSQL rejecting the old TRUNCATE list.

## Machine evidence

Node 24 and PostgreSQL 18 were on PATH. The integration commands ran serially under the assigned `EAPR_PG_PORT=55441`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, and control/worker/web port assignments 3241/3242/5182.

| Command | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 on the final source and tests. |
| `npm run test:unit -- packages/contracts/test/sync-capture.test.ts packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/bootstrap-build.test.ts` | 25 passed in 3 files, zero skipped. |
| `npm run test:integration -- tests/integration/sync-capture.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts` | Capture 21 passed and V3 activation 1 passed. Parent-storage 1 passed and 26 stopped at the same disposable TRUNCATE reset. Runner total 23 passed and 26 failed. |
| `npm run test:integration -- tests/integration/sync-capture.test.ts tests/integration/parent-storage.test.ts` | 48 passed in 2 files, zero skipped. This includes the complete capture PK/unique/FK catalog assertions and the corrected parent-storage reset. |
| `git diff --cached --check` | Exit 0 before commit. |

The new contract tests rejected the permissive scaffold and the evaluator mutation tests detected the unpinned leaf. The initial PostgreSQL tests detected the missing additive migration and missing committed-only service. The expanded regressions showed that the earlier draft accepted unsorted incident IDs in SQL and returned refetch on a stale response with a corrupt stored delivery digest. Both regressions passed after correction.

### Runtime migration SHA-256

| Migration | SHA-256 |
| --- | --- |
| `001_base.sql` | `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3` |
| `002_parent_activation.sql` | `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56` |
| `003_sync_capture.sql` | `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c` |

The fresh/reapply test compares the actual ledger and verifies the original runtime hashes. The candidate changes no control migration.

## Self-review

- Initialization acquires the lane key, all stream keys together, and the full baseline delivery keys using the A5 lock helper. It does not lock existing checkpoints. Page capture locks the checkpoint, the global stream key, then the complete page delivery set through the same parent helper. Tests observe PostgreSQL blocking for concurrent first initialization, a shared delivery key, the cross-lane position race, and stale losers.
- All identity comparisons happen before stale return. Canonical equality includes observedAt. A harmless longer stale page inserts no suffix. An empty current page occupies no boundary. Replay and refetch return the committed checkpoint. A uniqueness failure rolls back and rechecks locked state before returning a conflict or unavailable.
- Nonempty page, global identity facts, lane inbox, checkpoint CAS, and sanitized activity share a transaction. Real trigger failure tests prove rollback and restart recovery. Incidents commit in a separate transaction, deduplicate, and store only hashes, bounded IDs and a timestamp. A real incident trigger failure produces unavailable. Progress uses one statement snapshot and verifies stored bindings and canonical digests.
- The capture production imports contain no source, evaluator, model, operator or control-pool dependency. The sole control module reference is the erased `Clock` type. Runtime code uses the caller-provided runtime pool, existing parent readers and storage primitives. Integration snapshots cover the immutable parent, activation and outcome tables before and after capture.

## Remaining scope

The service is internal and unmounted. CSV transport, source polling, application, current authority, user interface and connection state remain separate work. This machine evidence is limited to the focused checks above. Independent review of the exact candidate and joint acceptance remain separate, and this deliverable establishes no V5/V6 or both-source synchronization pass.
