# Sync selection Task 1 implementation

Released base `740d421e7b51e32046974f16ae8b6b2906b17c43`. Candidate `ea26da0e4d3357e8a07a995abcdb901546d4d507` on `codex/platform-sync-selection`.

The only source addition is `readAuthoritySnapshotInTransaction` in `apps/worker/src/sync/current-authority-store.ts`. It parses `CommittedAuthorityIdentityV1` and returns `resolveSnapshot(client, identity, undefined, false)`. The original pool reader and writer path are byte-identical to the released base after removing the additive export. The other owned path is `tests/integration/sync-selection.test.ts`. It adds imports and appends three authority cases. A byte comparison after removing those additions confirmed all four qualification cases and their setup are intact.

The new cases use the unchanged `createSyncApplyFixture()` and the real current-authority service. A caller starts a repeatable-read read-only transaction and pins its A5 snapshot by awaiting the first read. The awaited service commit advances the durable authority outside that transaction. The same reader sees the prior active or paused state, and a fresh transaction sees the exact paused epoch 2 or revoked epoch 3 state. The per-call wrapper restricts reader SQL to the relevant unlocked SELECTs, forbids connection or release calls on the client, and checks that the pool was not checked out. The caller verifies transaction settings and controls the commit/rollback and release. Runtime head, command, activity counter, and activity event rows were compared before and after the appropriate reader-only boundaries.

The missing-head test commits a real pause, then simulates loss of only that head via the disposable fixture's owner connection while retaining the genuine command. The caller reads under the normal app role and receives `AUTHORITY_STORAGE_INVALID` (503). Row snapshots prove the corrupt state and activity remain unchanged. The fixture closes and drops the isolated database after the case.

## Machine evidence

Node 24 and PostgreSQL 18 on PATH. `EAPR_PG_PORT=55441`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, `EAPR_CONTROL_PORT=3241`, `EAPR_WORKER_PORT=3242`, `EAPR_WEB_PORT=5182`.

| Check | Result | Raw log |
| --- | --- | --- |
| `npm run test:integration -- tests/integration/sync-selection.test.ts -t 'authority_'` against the compiling temporary initial-state reader | Exit 1. All 3 selected cases failed on behavior. Both paused observations returned active epoch 1, and the missing-head case resolved active instead of rejecting. Four qualification cases were deselected. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-1-red.log` |
| Same integration command against the delegate | Exit 0. All 3 selected cases passed, with four qualification cases deselected. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-1-green.log` |
| `npm run typecheck` | Exit 0. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-1-typecheck.log` |
| `git diff --check` for both owned paths | Exit 0. | |

Raw log SHA-256 values:

```text
30c773aef4c1cd2e0e52652ea3c9424b38fbfd89f674e59d1cbed1649c5b6f15  task-1-red.log
8b71b6e32abfa1afeac6cf8948945cdd2afbdf5149a913ab4ac4a6c35820e282  task-1-green.log
8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f  task-1-typecheck.log
```

Focused Task 1 evidence only. The source and SQL leases are released to root with the shared PostgreSQL cluster retained. Exact-candidate review remains pending.
