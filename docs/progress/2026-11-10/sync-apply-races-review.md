# Spec compliance: PASS

Reviewed exact source candidate `7e49e552026c59d5ef26a6f92c41ced87bb0341c` against source base `a20054ae66a9d7d3fdff6d1bd1a386ef08a9c0c6` using `/private/tmp/eapr-sync-apply-task4-7e49e55.diff`. Actual Git parent is `6d174ae4d7983044d7b2a8ee7dd78fe42f1cde3e`; intervening root documentation is excluded. Both assigned paths have corresponding changes. No production implementation change is present.

## Strengths and requirement checks

- Coverage ordering is established by an observed preflight promise before W′ and by a completed SQL coverage query after target locking. The former rejects the old prepared unit without enlarging it; fresh preparation sees both events. The latter permits later financial and change-then-return semantic capture to finish before releasing apply, then checks only the original cut receives outcomes/frontier advancement and later preparation rejects the retained blocker (`tests/integration/sync-apply-races.test.ts:257`, `:278`).
- Status-first cases cover both revoke and pause/resume for monetary apply and new all-replay bookkeeping. Apply-first cases observe the actual blocking backend, hold the status transaction before its commit, inspect the independently committed apply image, and then require stale/new work to fail while the original receipt recovers (`tests/integration/sync-apply-races.test.ts:349`, `:366`, `:384`).
- Duplicate callers both enter preflight; the contender is observed waiting on the winner's scope lock. The lost-response wrapper awaits a successful real COMMIT before throwing, and a new pool/service recovers the exact receipt after target advancement and revoke without invoking the offline observer (`tests/integration/sync-apply-races.test.ts:443`).
- Rollback coverage includes financial rows, typed origins, snapshots, target CAS, receipt, unit, event outcomes, head initialization/progress, authority materialization, activity counter and activity insertion. Replay repeats the relevant bookkeeping boundaries. Each failure compares the complete selected durable image to the post-capture baseline; a subsequent healthy invocation validates the expected committed delta (`tests/integration/sync-apply-races.test.ts:31`, `:506`, `:518`, `:537`).
- Retry cases obtain real PostgreSQL 40001 through an MVCC conflict and real 40P01 through a mutually observed advisory-lock cycle. The serialization case commits revoke between callbacks and verifies the retry reads fresh authority before touching the target. Separate SQLSTATE injections establish three full callbacks for retryable errors and one for P0001, with fresh checkout identities and ordered lock/read assertions (`tests/integration/sync-apply-races.test.ts:567`, `:587`, `:634`, `:688`).
- Foreign ownership rejection preserves the whole image. Both competing origin claims run through app-role transactions; the loser must report 23505 specifically on the common financial-origin primary key. Cleanup releases the barrier, drains both operations and restores the exact dependent event outcome before comparing the original committed image (`tests/integration/sync-apply-races.test.ts:709`, `:731`).
- Financial assertions preserve genuine 80,000-cent A5 economics, standalone unallocated funding, allocation-only balance reduction, effective full payment/credit reversals, old records and original snapshot-hash reads. The backdated input changes only the latest reconstruction as expected (`tests/integration/sync-apply-races.test.ts:176`, `:796`).
- The fixture seeds a coherent empty high-version target before genuine activation rather than rewriting approval. The test verifies A5 actually produced MAX_SAFE, then checks atomic writer rejection. Unsafe cursor text and unsafe event sequence are tested at the reachable low-baseline capture boundary, consistent with the explicit ruling (`tests/fixtures/sync-apply.ts:134`; `tests/integration/sync-apply-races.test.ts:852`, `:866`).
- The existing connection reader is exercised directly across initial, nonempty and all-replay units. Exact receipt summaries, balances, versions, applied-batch counts and null pending/lag values are asserted, with complete-state read-only comparisons (`tests/integration/sync-apply-races.test.ts:884`).

## Quality verdict: APPROVED

The added 938-line race file has one focused responsibility and earns its size through nine mandated scenario families, including parameterized status cases. Shared checkout instrumentation, bounded barrier observation, durable-image comparison, committed-delta assertions and the fault matrix avoid copying transaction orchestration throughout the cases (`tests/integration/sync-apply-races.test.ts:44`, `:78`, `:91`, `:105`, `:138`, `:176`, `:518`). Ordering uses observed promises/locks; the timer is a failure deadline, not an ordering sleep. No generic production hooks, invented authority or expanded runtime scope were added.

## Findings

- Critical: none.
- Important: none.
- Minor: none requiring action.

## Focused unchanged-code checks

- Risk: the coverage hook might pause at a preflight or otherwise incorrect query. Checked `apps/worker/src/sync/apply.ts:117` and the `coverageSql` definition in `apps/worker/src/sync/apply-coverage.ts`: the write callback locks current authority and target before executing the matching statement; the test excludes read-only checkouts and pauses after that query returns.
- Risk: retry observations might merely reuse a token or fail to represent full transactions, and cleanup might leave blocked work indefinitely. Checked `packages/storage/src/transaction.ts:11`, `packages/parent/src/persistence.ts:7`, and `packages/storage/src/runtime-db.ts`: each retry checks out a client and reruns BEGIN/callback/COMMIT with rollback/release on failure; common scope/identity SQL matches the assertions. Standard clients have query deadlines, and the deliberate deadlock uses dedicated bounded pools.
- Risk: numeric-invalid capture inputs might fail only because of an unrelated stale event hash. Checked `apps/worker/src/sync/capture.ts`, `apps/worker/src/sync/capture-store.ts:18`, `:57`, `:299`, and `packages/contracts/src/common.ts:57`: cursor validation occurs in envelope parsing, and safe-integer sequence validation precedes event-hash validation. The rejection assertions address the intended numeric boundary.

## Evidence and limits

- Read the task brief, exact-candidate report, fixture clarification and supplied source diff. The initial combined tool output was truncated; subsequent bounded reads recovered the complete diff/report. No changed source file was read separately, and no Git, database or test commands were run.
- The exact-candidate report records successful typecheck, 90/90 focused unit tests, and 171/171 integrations across all ten selected files, including the final 20 race cases, with zero skips. It records clean diff checks and all six migration hash comparisons. These are reported partial machine results, not independently rerun results.
- Cannot independently verify from the two-path source diff: execution logs beyond the report, lease/process release, repository-wide migration/protected-pin inventory, or production mounting state. The supplied diff makes no changes to those assets; the controller retains their broader verification responsibility.
- This approval is task-scoped. It grants no source release, full V5/V6 proof, live/provider acceptance, or joint user acceptance; the planned broad final review remains separate.
