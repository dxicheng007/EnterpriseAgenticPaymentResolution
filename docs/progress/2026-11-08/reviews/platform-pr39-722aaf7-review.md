# PR39 read-only review at 722aaf7

Decision: **not adoption-ready**. Preserve the independently reviewed branch at `97cced3c8cab1f1957987109307547950b925695` until a separately bounded repair plan is reviewed. PR39 is currently unmounted, so these findings do not claim an exposed production write route. Its merge does not establish independent acceptance, and the exported writer is not yet a safe prerequisite for mounting.

## Exact subject and boundaries

- Merged main: `722aaf70c7f8833e954d33fc273f6a4f48b27f78`; first parent `f2569f660001207af7ba7bbe2e91ed6f81aa6b76`, second parent `12fdc4b61a21c7956fd18e3f61b66af87ba32c7a`.
- PR production: `cf94f248a5949482c88ae2b5800460632fd47a79`, based on `27a440335454639d2301c5baa5148d01f231146a`; test follow-up `12fdc4b61a21c7956fd18e3f61b66af87ba32c7a`.
- Reviewed PR diff is `722aaf7^1..722aaf7`. Merge base with preserved branch `97cced3` is `27a4403`. PR39 therefore uses main's earlier classifier, not the preserved branch's later reviewed classifier corrections.
- Reviewed new apply/store/SQL/export, changed capture/V5 tests, and four added `test 2.ts` files. Code evidence below uses immutable `722aaf7` line numbers, not the current working-tree files.
- Authority: frozen F1/F3/F5, PRD §§11/16, accepted capture/current-authority/classification contracts. The unaccepted atomic-apply design is **not** an implementation requirement for this review; no proposed frontier predicate or receipt API from it is imposed.

## Prioritized findings

### P1 — Select deliveries by the full source and event identity

`apps/worker/src/sync/apply.ts:68-74` reconstructs accepted deliveries with `new Map(events.map(event => [event.id,event]))`. F1 delivery identity is `(sourceRef,id)`, not `id`. A valid selected-source event and a foreign-source held event can share the same ID. `planBatch` correctly produces the selected source's financial plan and an `IDENTITY_SCOPE` hold for the foreign event, but this map selects the foreign event if it occurs last. `persistSyncBatch` then writes its delivery and outcome under the selected customer's new receipt while the financial record refers to the original source. Neither the canonical-event check nor the migration's delivery FK binds that outcome back to the actual operation's source.

An isolated pure probe of exact `722aaf7` confirmed one valid plan, `IDENTITY_SCOPE` hold, financial source `legacy-a`, and selected-to-persist event source `legacy-b`. This is an incorrect authoritative acknowledgment, not merely missing coverage. Bind the exact selected delivery using the full identity and reject ambiguous or unrelated selections; retain classification distinctions.

### P1 — Preserve original receipts for replay economics in a mixed batch

`packages/parent/src/sync-store.ts:99-122` treats every `plan.eventIds` member as newly applied: an existing delivery outcome aborts the entire transaction (`delivery already acknowledged`), and an unseen delivery always receives the **new** receipt. But the planner deliberately includes accepted replay events in a mixed new/replay plan while emitting operations only for new economics. A retransmission of an existing invoice under a new event/version plus a new payment/allocation therefore commits the retransmission against the new receipt, rather than the original invoice's receipt. A literal already-acknowledged delivery mixed with new work fails instead of deduplicating.

The exact-candidate pure probe confirmed the mixed plan contains `financial_replay`, `financial_new`, `financial_new`, with all three event IDs but only two operations. Frozen F5 explicitly requires a new delivery of existing economics to associate with the original receipt, while the mixed batch receipt still records all acknowledged IDs. No authoritative initial-or-ongoing economic receipt lookup is performed. Moreover, `db/runtime/005_sync_apply.sql:50-51` permits delivery associations only to `runtime_sync_receipts`, so this table cannot represent replay of an initial-import record using its original activation receipt. This needs an additive repair of receipt association representation and transactional classification consumption, not a zero-effect receipt.

All-replay `planBatch` returning no plan is **not itself a defect in applyBatch**: F5 assigns all-replay association to runCycle and expressly prohibits empty monetary application. That consumer remains absent; exact plan-hash retry coverage does not establish economic replay coverage.

### P1 — Establish the captured subject and governing semantic coverage before new writes

`apps/worker/src/sync/apply.ts:33,59-74` describes supplied events as captured inbox rows, but never loads or rechecks their committed lane, inbox membership, position/page binding or captured governing blockers. `packages/parent/src/sync-store.ts:108-118` explicitly creates a missing `runtime_deliveries` row from caller-supplied data. Thus a schema-valid, hash-valid constructed event can become money without ever passing the accepted capture boundary. Hashing and recomputing a plan establish consistency, not source provenance.

The only new positive test demonstrates this path: `tests/integration/v5-sync.test.ts:260-278` creates new invoices after the earlier capture test, fetches and filters them, and applies one without `capturePage`. There is also no current semantic observation input/read or complete captured semantic check. A selected financial subset that omits an already captured unscoped governing change is consequently admitted under the still-active epoch. The pure planner only guards the supplied set and cannot certify omitted source history. Current-authority locking does not supply semantic coverage.

F1 requires source financial application to pause for unscoped governing changes; F4 requires durable capture and approved dependencies; the accepted classification contract explicitly leaves exact immutable inbox and runtime global checks to the writer. The repair may reject unsupported coverage narrowly, but must establish provenance and governing coverage transactionally before any new effect. This finding does not prescribe the draft atomic-apply design's particular cut/frontier algorithm.

### P2 — Commit application progress with the financial outcome

`packages/parent/src/sync-store.ts:59-125` appends the snapshot, moves the target, stores a receipt, and writes selected economic/delivery associations. It never persists a per-customer/per-stream contiguous applied-or-explicitly-resolved frontier or pending/quarantined gaps. Migration005 contains no such representation. `readLatestSyncVersion` at lines41-45 is a maximum **parent target version**, not a source application position.

PRD §§11/16 explicitly requires event outcomes and application progress to commit with target changes and receipts. The code can commit a later selected event while earlier captured work remains unresolved, without recording that gap in application state. Calling this only a low-level append helper would require a separately enforced caller contract that updates the actual progress in the same transaction; `createSyncApplier` currently owns and commits the whole transaction and exposes no such step. A bounded supported case can implement the existing requirement or fail closed; silently equating target versions with progress is not an option. This is an adoption blocker, not a demand to ship a general scheduler in this patch.

### P2 — Remove accidental test copies and obtain the missing behavioral evidence

The four added files `review-preparation.test 2.ts` (45 lines), `v3-activation.test 2.ts` (900), `v4-offline-live-stub.test 2.ts` (135), and `v4-verification-idempotency.test 2.ts` (555) are byte-identical to their ordinary-name counterparts at the candidate. They do not match `vitest.config.ts`'s `tests/integration/**/*.test.ts` glob. They add 1,635 lines of review noise and no execution coverage; broad TypeScript include still sees them.

The meaningful new apply test covers one invoice, exact same-plan retry, stale target, and a wrong expected epoch. It does not exercise an actual pause/revoke race, crash/rollback boundaries, economic replay/new-delivery associations, cross-source event IDs, durable captured membership, semantic coverage, retained historical snapshots, or transactionally consistent progress. Wrong epoch rejection is not evidence of revoke/apply serialization. The capture test's new migration hash is computed from the file being tested, so it verifies catalog application/reapplication but is not an independent fixed digest pin for new 005.

## What is correctly preserved

The new path uses one `withTransaction` connection; current authority uses the same account/head fence as pause/revoke, and new work checks active state/expected epoch before parent writes while retaining the lock until commit. The target row is locked and version checked, the pure plan is recomputed, checked arithmetic and balance validation are retained, and global economic record uniqueness plus identity locks prevent insertion of a second economic record. Historical parent snapshots are appended rather than overwritten. Exact committed plan replay returns the stored receipt before rejecting current inactive/stale authority; historical receipt retrieval is not a new financial effect and should not be misreported as an epoch bypass.

Only tests call `createSyncApplier`; no production mount was found. The parent package export adds an import surface, not HTTP authority. These positives do not repair the incorrect delivery associations or establish omitted captured/governing state.

## Migration history and repair boundary

Runtime001–004 are byte-identical between preserved branch `97cced3` and merged `722aaf7`. Newly merged **runtime005 is now catalog history and its bytes must not be rewritten**. Exact SHA256 is `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96`. Its three new tables have immutable update/delete triggers and SELECT/INSERT-only app grants. This review neither claims a live database migration was inspected nor reserves a future migration number. Any schema repair must be additive and separately assigned.

No new financial policy is needed to repair these findings: full delivery identity, original economic receipts, captured source provenance, governing drift rejection, and transactional progress are already specified. A genuinely new policy question would arise only if a general scheduler is proposed that grants someone authority to declare unknown/foreign/semantic work terminal or ignore unresolved source-wide coverage. Do not invent that permission to make a frontier advance. A narrowly supported fail-closed writer can be specified without resolving that broader policy.

## Verification performed

Read-only Git/source/spec inspection and byte comparisons. One isolated pure Node24 probe ran against a Git archive of **exact `722aaf7`**, with package links redirected to that archive. Probe directory: `/private/tmp/eapr-pr39-probe-0mvqxcst`; script `probe.ts`. It confirmed cross-source ID selection and mixed/all-replay classifier behavior as described above; exit 0. These are partial pure checks, not database proof or full machine verification. No database, browser, provider, merge, repository source/DDL edit, commit, or subagent was used. Existing working-tree modification to the draft atomic-apply design was left untouched.

A final read-only status check observed concurrent external workspace changes: PR39 files staged and unresolved conflicts in `scripts/AGENTS.md`, `scripts/verify-slice-evidence.ts`, and `scripts/verify-slice.ts`. None was produced or resolved by this review. The findings and line references remain pinned to `722aaf7`, independent of that in-progress workspace state.
