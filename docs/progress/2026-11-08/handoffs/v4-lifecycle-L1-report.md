# V4b L1 durable lifecycle candidate

Candidate `e75479045fda73708251874788a596854ed6b985` on `codex/discovery-lifecycle` at `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`. Base `e34a0f629a1fee90e738c317b2e243044f83a7a1`. Commit `feat: persist fenced discovery lifecycle`. Worktree clean at verification. Lifecycle architecture input SHA-256 `9ec9a626f70ba956be479ba08fbc6c7c568c9edc0f54c39d65a59c86be074ac0` and accepted orchestration proposal `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`.

## Machine checks · focused partial

Commands run in the assigned worktree with the following environment on each npm invocation.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2
export EAPR_PG_PORT=55435 EAPR_CONTROL_PORT=3301 EAPR_WORKER_PORT=3302 EAPR_WEB_PORT=5176
npm run typecheck
npm run test:unit -- packages/discovery/test
npm run test:integration -- tests/integration/v4-lifecycle.test.ts tests/integration/v4-activity-read.test.ts tests/integration/local-composition.test.ts
git diff --check e34a0f629a1fee90e738c317b2e243044f83a7a1 HEAD
```

All commands exited zero on exact HEAD. Unit 1/1. Integration 22/22 across lifecycle 16, unchanged activity reader 4 and unchanged local composition 2. Runtime schema table list and ordered row contents including migration/seed ledgers and activity are compared before and after each L1 test. No V4 machine gate, live construction, activation or financial verification claims. Independent exact-candidate review and joint acceptance remain pending.

### Red and green evidence

- Initial budget unit and start integration module-missing reds established the harness but do not count as behavioral reds.
- With the candidate start method present, moving the absent-model check ahead of the existing-key replay produced `MODEL_UNAVAILABLE` for the authorized exact replay. `npm run test:integration -- tests/integration/v4-lifecycle.test.ts -t 'returns the unique saved start'` failed at the replay. Restored replay-first ordering. The first shell used a zsh reserved status variable and left the fault mutation present through one combined run. Restored from the saved candidate and reran the full focused checks.
- With the supervisor present, removing the still-reserved timeout transition produced an unchanged persisted revision (2, expected 3) in `npm run test:integration -- tests/integration/v4-lifecycle.test.ts -t 'atomically interrupts a held call'`. Restored the transition and reran the focused checks.
- The full lifecycle run initially exposed duplicate result re-delivery lacking a test seam and malformed batches discarding independently known usage. Added test-only re-delivery through the existing acceptance path, and independently checked the dispatch/provider envelope and usage. The corresponding tests passed.
- A task grant broadened beyond persisted run authority initially reached the adapter after current policy expanded. Added the persisted run ceiling as a second claim check. The corresponding test passed.
- PostgreSQL barriers establish four held calls and an unreserved fifth, both timeout orderings, held run-lock pause ordering, application backend termination before reservation commit and after invocation, crash after commit before invocation, and pending output across owner replacement. The same application role terminates its own other disposable backend, keeping the ordinary pool usable without broader role grants. Test-controlled rollback after staged reservation activity proves attempt, run state and activity sequence remain unchanged.

## Implementation and handoff

- `createDiscoveryRepository` handles trusted internal start/state/actions. L2 must authorize the current HTTP request, provide the current configured source-policy resolver, and supply the exact immutable source read and in-transaction capture recheck. L1 tests inject a synthetic binding and authority. The optional capture recheck seam is for L1 internal test composition. L2 must supply it for new starts. The authorized exact replay returns the stored response and skips both capture operations.
- `acquireDiscoverySupervisor` keeps a dedicated PoolClient and discovery-only two-int session lock (1161908306, 4). The lock stays held across generation advance and reconciliation. Old claims reconcile in per-dispatch owner transactions so no recovery transaction acquires another run after taking the shared activity lock. A failed owner never writes late state via a normal pooled connection.
- Scheduler calls require current server policy and persisted narrowing. The in-process cap is four unsettled invocations across supervisor replacements. Explicit timeout uses the same persistent accounting transition as the timer. Timeout never settles the underlying model Promise or frees its permit. Known committed pending batches survive recovery and are refenced when consumed.
- Accepted tool-bearing output writes a `system.status` build summary in the same transaction, per root's mapping of proposal §5 transaction flow 2. Top-level run/task/role plus dispatch ID, status, task state, rounds and token counts are the only event contents. Done writes `task.completed`. Task failure writes `task.blocked` with the attempt encoded as allowlisted `count`, and exact tool rounds and diagnostic code. Timeout/recovery publish `discovery.interrupted` once for each reserved-to-interrupted dispatch. Succeeded task history is preserved and the run remains blocked at the absent construction/assessment dependency.
- `insertSpecialist` is the shared storage operation for a later validated delegation effect. It accepts only existing same-run dependencies for a new node, checks source subject against the saved grant, and narrows source-account children to their exact account. L2 must prove pinned capture membership, exact tool argument shape and coordinator authority before calling it inside the owner transaction. Source question input is bounded to 8 KiB as an internal resource limit. The L1 test-only seeding seam exercises storage capacity and dependency behavior. L1's closed unavailable/forbidden tool path proves exact failed result replay and pending work across replacement. Atomic child creation plus tool result, delegation/pause ordering, and delegation crash/replay remain L2 proof.
- Repair ceilings are storage proof only. The candidate adds no repair increment, proposal, finding, assessment, completion, provider, worker or HTTP composition. Migration allocation is control004; bootstrap remains control005. Workspace lockfile adds only the discovery workspace and symlink entries.

Review handoff is to the coordinating agent for fresh Astra review of this exact candidate before integration.
