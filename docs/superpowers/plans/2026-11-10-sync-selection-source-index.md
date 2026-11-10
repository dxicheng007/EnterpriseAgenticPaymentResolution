# Sync Selection Source Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supply the source-leading database index required by the accepted Task 5 bounded enrollment scan.

**Architecture:** First repair the existing activation fixture's resource ownership and failure cleanup without changing its signature, financial authoring, proof, activation or target behavior. Then add one ordinary btree index in runtime007 and prove it on a genuine populated runtime006 upgrade and a fresh isolated database, using the existing migration runner and repaired fixture.

**Tech Stack:** Node 24, strict TypeScript, PostgreSQL 18, `pg`, Vitest, existing native database harness.

**Spec:** `docs/superpowers/plans/2026-11-10-sync-selection.md`, Task 5; `.superpowers/sdd/2026-11-10-sync-selection/task-5-preflight.md`, “Index prerequisite” and committed-subject query. Root's plan-review ruling assigns the separate fixture-lifecycle prerequisite below to resolve the P2 setup/cleanup finding in `/private/tmp/eapr-sync-selection-source-index-plan-review.md`. Repository/database/test guidance and `docs/superpowers/plans/2026-11-08-verification-playbook.md` govern execution and evidence.

## Global Constraints

- “Add assigned schema changes as new versioned migrations. Do not edit applied SQL. Preserve recorded migration hashes.”
- “Implement only the assigned scope and paths. Avoid extra features or semantic broadening.”
- “The runtime worker must have no model calls, SDK, or key.”
- “Keep credentials and protected verification truth out of product tools, browser bundles, and evidence packets.”
- Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Root must reconfirm the reserved runtime007 slot immediately before implementation; do not race another writer or renumber an applied migration.
- Use root's exclusive lease: `EAPR_PG_PORT=55441`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, `EAPR_CONTROL_PORT=3241`, `EAPR_WORKER_PORT=3242`, `EAPR_WEB_PORT=5182`. No fallback, shared/demo reset or shared cluster stop. Attempt every acquired resource's cleanup even if another cleanup rejects; surface failures and retain exact ownership evidence for recovery. Filesystem/DB outages can prevent deletion: this is an attempt-and-report guarantee, not guaranteed deletion under outage.
- Root must accept this revised plan after scoped re-review before the Sol source lease. Root releases implementation/SQL only after the Task 4 exact-candidate gate and plan acceptance; Task 2 also waits for Task 1's accepted candidate. Until release this artifact is plan-only; the existing worktree `.local/pgdata` remains root-owned.
- This prerequisite creates an access path, not approval authority or a performance guarantee. Task 5 still owns its query implementation and behavioral limits.

## Review Focus

- Setup failures before a fixture is returned must attempt cleanup only for acquired resources; cleanup failures must not suppress later attempts or lose the original setup error (Task 1 lifecycle faults and compound-error checks).
- A populated runtime006 upgrade must retain import/receipt, target, authority and activity bytes unchanged (upgrade test).
- An index with reversed keys, a predicate, expression, extra INCLUDE column or uniqueness would not be the specified index (metadata test).
- Tiny fixtures may legitimately get a sequential scan under default planner settings; prove a compatible ordered path using transaction-local planner controls, without a production performance claim (plan test).
- A fresh schema and ordinary application role must support the same query; migration DDL ownership must remain separate (fresh-schema test).
- A missing migration must produce an index-availability assertion failure, not a missing file/import/catalog failure; runtime006 supplies a lasting negative control (RED sequence).

---

## Execution lease

After root releases the lease, export these settings once for all verification commands:

```bash
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2
export EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182
```

### Task 1: Make the existing sync-apply fixture own its cleanup throughout construction

**Files:**
- Modify: `tests/fixtures/sync-apply.ts` — only `createSyncApplyFixture` resource acquisition, private cleanup, and construction-error handling.
- Create: `tests/integration/sync-apply-fixture-lifecycle.test.ts` — targeted lifecycle fault checks plus genuine A5 close checks.

**Interfaces:**
- Preserve `createSyncApplyFixture(runtimeThrough?: number, baselineVersion?: number)` and all returned fields, including `close(): Promise<void>`. Preserve default latest migrations and the runtime-only version ceiling.
- Use the same existing root creation, native start/provision, runtime/control pool factories, migration and proof/activation sequence. No public hooks, dependency/options injection, generic cleanup framework, new exports, fixture-success stubs, financial data edits, or changes to native provisioning.
- Produce reliable owned-resource cleanup for Task 2, including before a fixture can be returned. The native provisioner retains responsibility for its own partial failures; the fixture owns a namespace only after `provisionTest(namespace)` resolves successfully.

- [ ] **Step 1: Add lifecycle tests with real acquisitions and narrow test-only fault spies.**

Use Vitest pass-through module spies around `mkdtemp`/`rm`, native start/provision/drop, pool factories/`end`, migrations and `issueActivationProofs` as needed. Preserve actual implementations for every non-failing operation. For Node filesystem exports, a Vitest factory mock that spreads `importOriginal` and wraps only the observed functions is acceptable; no production hooks. Record only the exact root returned by actual `mkdtemp`, each successfully returned namespace and pool, and closure completion. Never record credential-bearing pool options/URLs, raw canonical data or proof contents. Restore spies before fallback cleanup; attempt remaining exact-owned closures, namespace drop and root removal independently in test `finally`, and surface fallback failures. Never scan/delete all temporary roots, drop an unowned namespace, stop the cluster or clean a failed provision attempt from this wrapper.

Add these cases (fault-only cases stop before financial success; success cases use unchanged real A5 construction):

| Test | Injection and required assertions |
| --- | --- |
| `fixture_lifecycle_start_failure` | Actual root acquired, `startNativeDb` rejects a sentinel. Construction rejects the same sentinel by identity, root removal succeeds, provisioning/drop/pool creation never runs. Assert root `ENOENT`. |
| `fixture_lifecycle_provision_failure` | Actual root/start; provisioning spy rejects before calling real provisioning. Same original rejection, root removed, no pool created and no namespace drop attempted. Never simulate a successful native provision followed by a wrapper rejection: that would invent unobservable ownership. |
| `fixture_lifecycle_partial_pool_failure` | Real provisioning and first runtime pool; second factory throws before acquiring its pool. First pool ends, exact owned namespace is dropped, root removed, same original rejection. This pins registration immediately after each acquisition rather than after all factories. |
| `fixture_lifecycle_migration_failure` | All three real pools acquired; real migration completes and its pass-through spy then throws. All pools end, exact namespace drop and root removal run; reject same original. No proof/activation success is manufactured. |
| `fixture_lifecycle_proof_failure_and_cleanup_failures` | Real migrations and real `issueActivationProofs` complete, then its spy throws the setup sentinel. Inject independent cleanup rejections for one pool end and namespace drop after each real cleanup has completed, and for root removal before calling real `rm`. Every pool, drop and root action is attempted once despite earlier rejections; root remains as the deliberate removal-fault witness and fallback removes it after restoring spies. Require the compound error contract below and original identity as `cause`. Parameterize original as an Error and a frozen non-Error value; never mutate it. This tests actual proof construction without pretending activation succeeded. |
| `fixture_lifecycle_genuine_A5_close_twice` | Real `createSyncApplyFixture(6)`, unchanged independent original-record validation, and one original import/receipt matching returned identity. Observe nonempty targets and original financial rows. Two concurrent `close()` calls return the same Promise and resolve; a later call returns the same completion. All three pools, owned namespace and exact root are cleaned once. No new financial expectations are authored. |
| `fixture_lifecycle_normal_close_failure_is_shared` | Separate genuine fixture; inject one pool `end` rejection after actual end succeeds. Two concurrent and a later `close()` return the same rejected Promise/AggregateError. All remaining pool/drop/root actions still complete once; error has the one cleanup sentinel in `errors`. This extra genuine construction is needed to test the public close failure path without introducing a test hook or fake fixture success. |

Give real proof/A5 cases `120_000` ms timeouts; do not run tests concurrently against global spies. On unexpected successful construction in a rejection test, retain and close the returned fixture before asserting failure. Keep observed roots/pools/ownership outside the assertion path so RED failures cannot strand known resources. Assert actual post-cleanup root absence and closure success where cleanup succeeds; injected removal failure must be reported and recovered, not falsely asserted as deletion.

- [ ] **Step 2: Run behavioral RED for the existing late guard and skipped cleanup.**

```bash
npm run test:integration -- tests/integration/sync-apply-fixture-lifecycle.test.ts -t 'fixture_lifecycle_start_failure|fixture_lifecycle_proof_failure_and_cleanup_failures'
```

Expected: the existing helper leaves the actual acquired root after startup failure, and its early-aborting cleanup omits later cleanup/loses the setup failure under compound failure. Record the lifecycle assertions, not import/mock/setup errors. Test fallback must remove observed leftovers even in RED.

- [ ] **Step 3: Move ownership and cleanup around the whole existing construction sequence.**

Inside `createSyncApplyFixture`, define a small private cleanup action list and one memoized completion before acquisition. Enter the guarded `try` before root creation/native startup. Immediately after `mkdtemp` resolves, register removal of that exact root; immediately after successful provision, register dropping only that namespace; immediately after each pool constructor returns, register its `end`. Run cleanup actions in reverse acquisition order, awaiting/catching every action independently so synchronous throws and promise rejections both join the failure list. This closes all pools before attempting database removal and still attempts root removal if any earlier action fails. Native cluster startup creates no fixture-owned cluster cleanup action.

Use a non-async `close(): Promise<void>` returning one memoized Promise so overlapping/repeated callers share the exact completion, including rejection; actions never rerun. If any cleanup actions fail, reject with `new AggregateError(cleanupFailures, 'Sync apply fixture cleanup failed')`; normal explicit close surfaces it. In the construction catch, await this same close: if cleanup succeeds, `throw original` unchanged; if cleanup rejects, throw `new AggregateError(cleanupError.errors, 'Sync apply fixture construction and cleanup failed', { cause: original })`. The original value remains by identity in `cause`, separate cleanup errors remain in `errors`, and fixed wrapper messages contain no resources/secrets. Do not mutate original thrown values, replace their cause, silently swallow cleanup failures, or retry failed actions through repeated close. Exact residual-resource recovery belongs to the test/root owner after restoration.

Keep proof generation, private `activate` lifecycle, reviewer authorization, source/operator construction, optional baseline target writes and the returned object semantics unchanged. Existing listeners within `activate` retain their existing lexical ownership; do not broaden this task into service lifecycle redesign.

- [ ] **Step 4: Verify the focused lifecycle suite and typecheck.**

```bash
npm run test:integration -- tests/integration/sync-apply-fixture-lifecycle.test.ts
npm run typecheck
```

Expected: all lifecycle cases pass without skips, including genuine A5 success, compound errors and both repeated-close outcomes; fallback reports no unresolved owned resources. These focused tests already include genuine financial/proof/activation behavior, so do not run the full sync suite or alter unrelated tests. Record checks as partial.

- [ ] **Step 5: Commit the two Task 1 paths and request exact-candidate review through root.**

Commit `test: make sync apply fixture cleanup ownership explicit`. Report original/cleanup failure handling, meaningful RED/GREEN, and safe cleanup evidence. Root accepts this prerequisite before releasing Task 2; do not combine it into the index commit or copy a compensating fixture wrapper into the index suite.

### Task 2: Add and verify the runtime source enrollment index

**Files:**
- Create: `db/runtime/007_sync_selection_source_index.sql` — index only.
- Create: `tests/integration/sync-selection-source-index.test.ts` — upgrade, fresh install, metadata and app-role query proof.

No existing files are assigned to Task 2. Consume the accepted Task 1 fixture; do not edit it again or copy its cleanup wrapper into this suite. Do not edit runtime001–006, concurrently owned selector files/tests, migration runner, protected inventory, or unit tests.

**Interfaces:**
- Consume `createSyncApplyFixture(runtimeThrough?: number, baselineVersion?: number)` from `tests/fixtures/sync-apply.ts`; `createSyncApplyFixture(6)` produces a genuine authenticated reviewer approval and A5 worker import on runtime006, with `{db, owner, pair, close, stored, identity}`. Its default is latest runtime migrations. Use no reconstructed imports or fabricated approvals.
- Consume `readMigrationCatalog()`, `migrationIdentities(migrations)`, and `migrate(pair, ['runtime'], catalog)` from `scripts/migrate.ts`. Filter only `catalog.runtime` to `version <= 7` for this task, preserving the complete control catalog. Never use a global `throughVersion: 6` to set up the activation fixture's control database.
- Consume `startNativeDb`, `provisionTest(namespace)`, `dropTest(namespace)` from `scripts/native-db.ts`; `testNamespace('srcidx')` from `tests/fixtures/harness.ts`; and `createRuntimeDb({connectionString})` from `@eapr/storage/runtime-db` for the fresh empty-schema case.
- Produce index `runtime_activation_imports_source_account_idx`. No TypeScript public API.

- [ ] **Step 1: Write the focused integration tests before adding runtime007.**

Keep local helpers inside the new test file. Give the genuine fixture test an explicit `120_000` ms timeout. Use separate test-scoped resources and `try/finally`, not a suite fixture whose setup failure can strand a database.

`source_index_upgrades_genuine_runtime006_without_changing_rows`:

1. Call `createSyncApplyFixture(6)`. Assert ledger identities match runtime001–006 and the source/account returned by the query below match `stored.bundle.manifest.sourceRef` and `identity.scope.accountId`. Require exactly one import and its original `receipt_id`/`activation_id`; the fixture already verifies independently expected original financial records.
2. Read index metadata through the app pool. Require the proposed index to be absent and no existing valid btree to have `(capture_source_ref, account_id)` as its leading keys. This explicitly demonstrates the pre-migration gap while the application query still succeeds.
3. Preserve deterministic byte snapshots of all runtime public base tables except `migration_ledger` (fixed database-owned table names from `information_schema.tables`, ordered rows serialized as `row_to_json(t)::text`; keep TEXT canonical values unchanged inside that serialization). This includes imports and embedded receipt, parent scopes/snapshots/targets/metadata/financial records, original and sync outcomes/receipts/lineage/origins, authority heads/commands, capture state and activity. Assert nonempty import, target and original financial state so preservation is not vacuous; empty authority tables are valid implicit initial authority, not a claim of explicit commands. Keep snapshots in memory and report only equality/counts, never raw rows or proof contents.
4. `await migrate(data.pair, ['runtime'], through007Catalog)` using the ordinary discovered catalog. Immediately require the exact metadata assertion below, then require runtime001–007 ledger identities (including catalog version 7), prior ledger prefix unchanged, and identical saved table bytes. Putting metadata before the version-7 assertion makes absence of the new SQL fail for index behavior during RED.
5. Execute the exact parameterized query as the app role for the real source and an absent source; require the same original row and `[]`, respectively. Prove the compatible plan as described below. Repeat migration and require unchanged ledger/index definition/data. Always `await data.close()` in `finally`.

`source_index_fresh_schema_supports_app_reads_without_ddl_authority`:

1. Start native DB under the inherited lease, provision `testNamespace('srcidx')`, migrate runtime001–007 with the same catalog, and open the ordinary runtime app pool. No fixture data is needed for this separate fresh-schema check.
2. Require the same exact index metadata, correct migration identities, empty results for the exact bounded query, and compatible plan. Verify `current_user` equals `pair.runtime.appRole` without logging credentials. Assert `CREATE INDEX source_index_app_forbidden ON runtime_activation_imports (capture_source_ref)` through that app connection rejects with SQLSTATE `42501`; perform in a transaction that is always rolled back, so even an unexpected success cannot leave DDL behind.
3. The fresh-schema test owns its direct resources: enter a guard before startup/provisioning, register the namespace only after successful provision and each pool/client immediately upon acquisition, then attempt all cleanup in order (connections before namespace) independently in `finally`. Preserve an assertion/setup error separately from cleanup failures using the same error contract as Task 1; do not create a reusable framework. A provision rejection is not permission to drop its namespace. Never stop/delete the root-owned cluster.

**Exact migration and query contracts**

```sql
CREATE INDEX runtime_activation_imports_source_account_idx
  ON runtime_activation_imports USING btree (capture_source_ref, account_id);
```

```sql
SELECT account_id, company_id, seller_entity_id, idempotency_key,
       activation_id, receipt_id, bundle_hash, plan_hash,
       recorded_snapshot_hash, planner_snapshot_hash, approved_snapshot_hash,
       target_version, capture_source_ref, capture_manifest_hash
FROM runtime_activation_imports
WHERE capture_source_ref = $1
ORDER BY account_id
LIMIT 9
```

Existing runtime002 `UNIQUE (account_id)` already removes ties. No additional UNIQUE, INCLUDE, expression, predicate, explicit collation or tie-break column. Use database-default collation consistently in query and index; final detached JavaScript canonical sorting is outside this task.

**Metadata assertions:** Join `pg_class`, `pg_namespace`, `pg_index`, `pg_am` and attributes for the exact public table/index. Require one matching row, `amname = 'btree'`, `indisvalid = true`, `indisready = true`, `indisunique = false`, `indisprimary = false`, `indnkeyatts = 2`, `indnatts = 2`, null `indpred` and `indexprs`, and ordered key names exactly `['capture_source_ref', 'account_id']`. Check both key collations equal their corresponding table attribute collations. Assert `pg_get_indexdef` describes those keys without an override. Do not depend on OIDs, cost estimates or generated constraint names.

**Compatible plan proof:** Acquire one app `PoolClient`; `BEGIN READ ONLY`, then `SET LOCAL enable_seqscan = off` and `SET LOCAL enable_bitmapscan = off`; run parameterized `EXPLAIN (FORMAT JSON)` of the exact SELECT. Walk JSON `Plan`/`Plans`; require a `Limit`, the named index via `Index Scan` or `Index Only Scan`, source equality in `Index Cond`, and no `Sort`/`Incremental Sort`. Attempt `ROLLBACK` and always release in a nested `finally` even if rollback fails. These settings are test-local; never change the query, migration, database defaults or product planner configuration to force a benchmark outcome. If PG18 selects a different path despite these controls, report the actual plan to root before changing test scope. Default-plan choice and elapsed time are not acceptance criteria.

- [ ] **Step 2: Run behavioral RED with runtime007 absent.**

```bash
EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/sync-selection-source-index.test.ts -t 'source_index_upgrades'
```

Expected: the genuine runtime006 setup, original read and pre-migration absence checks pass; after a no-op latest-available migration, the expected one index metadata row is absent. Record that exact assertion failure. `readMigrationCatalog` still reads a valid contiguous 001–006 catalog; do not import/read the nonexistent 007 file directly or fail a version precheck first. A fixture error, missing symbol/file, or migration-catalog error is not behavioral RED. The permanent pre-upgrade absence assertion remains the meaningful negative control after GREEN; do not drop indexes or bypass immutable row triggers.

- [ ] **Step 3: Reconfirm the runtime007 reservation, then add only the exact CREATE INDEX migration above.**

Use the runner's normal per-migration transaction. No `CONCURRENTLY` (the runner wraps SQL in a transaction), `IF NOT EXISTS`, table rewrite, generated-column change, grant, or data modification. All earlier migration bytes remain untouched.

- [ ] **Step 4: Verify the migration and existing migration/storage regressions.**

```bash
EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/sync-selection-source-index.test.ts
npm run typecheck
EAPR_PG_PORT=55441 npm run test:integration -- tests/integration/migration-prerequisites.test.ts tests/integration/parent-storage.test.ts
```

Expected: both new tests, typecheck, and existing migration/storage tests pass without skips; namespaces are cleaned. `migration-prerequisites.test.ts` launches services on the root-leased ports above. If those ports are unavailable, report that regression as pending rather than borrow another owner's ports.

Catalog implications were inspected: SQL is discovered and checksum-pinned automatically; readiness and existing ledger assertions derive identities from the catalog. No new unit-test hardcoded list or protected-inventory entry needs changing. Task 1's separately authorized fixture edit is covered by the selector's runtime before/after inventory, which derives hashes at execution rather than pinning the old source hash; retain that check unchanged. Task 2's two new files do not enter the protected inventory. Do not edit a verifier registry or claim a full slice pass for focused prerequisites. Report any actual incompatible inventory discovered during execution to root before widening paths.

- [ ] **Step 5: Commit the two files as one reviewable candidate and hand off exact evidence.**

After the checks, stage only the assigned paths and commit `perf: index source-scoped activation enrollment reads`. Root arranges independent exact-candidate review under the existing workflow. Record RED/GREEN commands and outcomes, candidate SHA, runtime001–007 identities, lease/namespace cleanup, and the distinction between compatible access path and measured performance. Retain no credentials or canonical financial/proof contents in the evidence. Joint acceptance remains separate.

## Scope and remaining dependencies

The index and narrow lifecycle requirements are fully specified; no product or financial clarification is needed. Root still owns revised-plan acceptance, exact-candidate gates, final migration-slot and SQL/service-port scheduling. Four paths are assigned across two separately reviewed tasks; no other paths are released. Nine genuine subjects, CSV B, selector rejection semantics and canonical byte admission remain Task 5/fixture-owner dependencies; these prerequisites do not certify them. This plan is source-inspected only: no database, tests, migrations or Git operations have been executed by its author.
