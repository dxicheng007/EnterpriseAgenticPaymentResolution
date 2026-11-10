### Spec Compliance

- ✅ Spec compliant for Task 1, exact package `740d421e7b51e32046974f16ae8b6b2906b17c43..ea26da0e4d3357e8a07a995abcdb901546d4d507`. `apps/worker/src/sync/current-authority-store.ts:197` adds only identity parsing and `resolveSnapshot(client, identity, undefined, false)`; the existing pool reader is unchanged. The package contains only the two owned paths, with 148 added lines.
- ✅ `tests/integration/sync-selection.test.ts:501` runs every authority read through a guarded caller-owned client inside repeatable-read/read-only transactions. The wrapper rejects transaction commands, writes, explicit row/advisory locks and client lifecycle calls, and checks pool checkout during each read. The reader has no second connection or service dependency.
- ✅ `tests/integration/sync-selection.test.ts:544` verifies a fresh transaction sees the committed pause after repeated reads retain the initial snapshot; `:554` verifies paused authority remains visible across a committed revoke and a subsequent transaction sees revoked authority. `:586` rejects missing-head/real-command corruption as `AUTHORITY_STORAGE_INVALID` with unchanged authority/activity rows.
- ✅ The test diff only adds imports and appends authority tests after the existing qualification suite. The four qualification cases are preserved, and no protected fixture, expected input, approval producer or generator is changed.

### Strengths

- `apps/worker/src/sync/current-authority-store.ts:197` reuses the existing validator/resolver without duplicating financial or authority interpretation and without taking ownership of connection or transaction lifetime.
- `tests/integration/sync-selection.test.ts:544` and `:554` exercise real committed status changes with explicit awaited ordering; they do not rely on timing sleeps or mocked authority state.
- `tests/integration/sync-selection.test.ts:586` retains a genuine pause command while deliberately removing only its head in a disposable fixture, so the fail-closed assertion distinguishes corrupt history from legitimate initial active authority.

### Issues

- Critical: none.
- Important: none.
- Minor: none.

### Checks and Evidence

- Read the review diff once. Its resolver context begins mid-function; completed the cut-off resolver and its local dependency context with a focused read of `apps/worker/src/sync/current-authority-store.ts:1–195`. The `lock=false`, absent-key path uses the supplied client, never reaches head initialization, and rejects missing-head history before returning initial state (`:162–194`).
- Named risk—status responses might precede durable commit: checked `apps/worker/src/sync/current-authority.ts:211` and `packages/storage/src/transaction.ts:11`; the service awaits the transaction helper, which awaits `COMMIT` before returning.
- Named risk—fixture enrollment might bypass real approval: checked the existing activation path in `tests/fixtures/sync-apply.ts:39–108`; it uses reviewer prepare/activate (`:84–95`) and real worker activation/first-import storage (`:98–102`). No fixture changes were made by this candidate.
- Inspected raw `task-1-red.log`: all three selected tests fail behaviorally, on active epoch 1 versus paused epoch 2 and on resolving active instead of rejecting corruption. Inspected `task-1-green.log`: all three selected tests pass. Both explicitly select `authority_`; their four skipped cases are deselected qualification cases, not waived requirements.
- Inspected raw `task-1-typecheck.log`: `tsc --noEmit` completed without diagnostic output. Recorded GREEN/typecheck output contains no warnings. All three SHA-256 values match the implementation report.
- No tests rerun; no source, Git, database or network mutations performed. Validation is focused Task 1 evidence, not a whole-selector or whole-branch acceptance claim.

### Assessment

**Task quality: Approved.** The production change is the specified minimal delegation, and the appended integration tests cover caller snapshot ownership, inactive state preservation and corrupt-history rejection through genuine enrollment and status transitions. No blocking correctness, scope or maintainability issue was found.
