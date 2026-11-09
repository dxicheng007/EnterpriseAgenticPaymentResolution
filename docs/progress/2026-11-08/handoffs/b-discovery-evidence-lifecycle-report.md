# D2 discovery evidence lifecycle candidate

- Branch `codex/discovery-evidence-lifecycle` in `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`.
- Exact accepted D0/D1 base `d4f14bff7ba1bfb269cb166efd9c2828b691e4a2`.
- Exact D2 candidate `3fad7de41a38185601dd0a3a199e6537eb04e566`, one clean commit with the subject `feat: fence discovery evidence reads and recovery by supervisor ownership`.
- Semantic authority `b-discovery-evidence-tools.md`, SHA-256 `c9cd2d998bcf2c1f2eef0af02e2163f2953f1a1e9ab21fcdf567d1c6d69ad4c0`, and the D2 implementation handoff. The authority brief was verified and remains unchanged.

## Files

- `packages/discovery/src/read-tools.ts` adapts the accepted D1 port and validates results using their corresponding D0 schemas. Known source error dispositions use closed safe codes. An unexpected adapter failure yields a safe unavailable result without facts or raw exception text.
- `packages/discovery/src/roles.ts` advertises all four readers only when the actual reader is configured. Coordinator delegation, deferred tools and unknown-tool classification remain supported.
- `packages/discovery/src/supervisor.ts` performs whole-batch schema, source and delegation preflight before an effect. The exclusive owner handles ordered claim and settlement under run/task/dispatch/step and authority fences, with original access outside its transactions. Transcript reconstruction validates accepted call identity, terminal results and the existing envelope. Paused replacement revalidates capture outside the transaction and refences the abandoned step to pending with no execution or tool events. An observed revocation at settlement rolls back content and activity and marks interrupted with the sticky blocker. Capture conflict and result limit remain sticky.
- `packages/discovery/src/service.ts` schedules the first unresolved step and allows owner replacement during old external I/O. Scheduling distinguishes current running and eligible old interrupted steps. Existing reviewer, model budget and pause/resume boundaries remain in use.
- `apps/control/src/discovery-composition.ts` wires the actual D1 adapter while preserving the M1 events mount and default unconfigured model mode.
- `packages/discovery/test/read-tools.test.ts` asserts descriptor gating and all five roles.
- `tests/integration/v4-discovery-evidence-tools.test.ts` exercises the accepted real D1 adapter against migrated disposable databases, with injected scripted models and named deterministic barriers.
- `tests/integration/v4-lifecycle-http.test.ts` has three approved assertion narrowings. They require the delegated investigation ID before the exact comparison, require the delegated task ID before dispatch, and require investigation IDs for the two seller results before their inequality assertion. The existing behavioral expectations are preserved.

The run revision advances for changes to the visible in-flight projection. The task revision counts model acceptance and each terminal tool resolution, so an abandoned or replacement claim cannot masquerade as a resolved step or require an attempt reset. A paused recovery skips an already blocked run and preserves its diagnostics. It runs only capture validation before refencing. Normal full-batch preflight still runs before the first new effect after resume.

## Verification

Exact source tree verified with Node 24 and PostgreSQL 18 from the Homebrew opt paths. Assigned lease used `EAPR_PG_PORT=55438`, `EAPR_CONTROL_PORT=3601`, `EAPR_WORKER_PORT=3602`, `EAPR_WEB_PORT=5179`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, and `EAPR_DEMO_NAMESPACE=eapr_review_t2`. Tests provisioned and dropped their disposable namespaces. No server port or credentials were printed.

- `npm run typecheck` passed.
- `npm run test:unit` passed, 308 tests across 44 files. The new descriptor test first failed at the expected missing reader advertisement.
- `npm run test:integration -- tests/integration/v4-discovery-evidence-tools.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/v4-lifecycle.test.ts tests/integration/discovery-source-tools.test.ts tests/integration/discovery-capture-read.test.ts tests/integration/v4-activity-read.test.ts tests/integration/v4-discovery-events.test.ts tests/integration/local-composition.test.ts` passed, 83 tests across 8 files. The D2 file contributes 16 cases. The integrated tests exposed and resolved an early mismatch between the immediate and persisted code for a rejected delegation and a test query using the wrong activity column.
- `git diff --check d4f14bff7ba1bfb269cb166efd9c2828b691e4a2 3fad7de41a38185601dd0a3a199e6537eb04e566` passed.

The D2 integration cases cover fresh and recovered mixed batches, strict argument rejection before original access, pause and revocation after preparation, an idle advisory owner connection during blob access, pause while claimed, mid-read and pre-commit revocation, guarded SQL capture invalidation after D1 preparation, owner loss during a running read and while paused, preexisting blockers, PostgreSQL backend termination with automatic service replacement, rollback before result commit, replay across replacement with zero blob reads, paired transcripts across both composed sources, native-ID reuse across attempts, a real oversized citation, individually bounded results that exceed the combined transcript cap, safe activity/state summaries, the authenticated M1 cursor mount, and a runtime database fingerprint. The unchanged D1 adapter suite supplies source-specific citation, range, coverage, record paging and byte-bound proof.

This is focused machine evidence for D2 on its exact base. Independent exact-candidate review and integration remain with root. No browser run, full V4 machine gate, joint acceptance, live provider competence, findings, proposal construction, verification, activation or sync is established by these checks.

## Round 1 recovery correction

Candidate `a5209db46bc82b28f95bbe31b7ff550b958677a2` on `3fad7de41a38185601dd0a3a199e6537eb04e566`. The guarded replacement owner persists an abandoned read as interrupted with a null result and the task/run forbidden blocker when it observes revocation. Paused recovery preserves the paused state. The scheduler sends interrupted reads to the guarded owner so its preliminary authority filter cannot suppress the transition. Capture availability retains its own disposition.

Four real D1 barrier regressions exercise paused and runnable replacement with revocation before recovery and during external preparation. They verify stored task/run diagnostics, null result, zero in-flight reads, and that restored authority, another replacement and resume produce no new preparation, claim, tool result, or model call. Runnable regressions invoke the replacement supervisor directly. The existing polling integration case continues to exercise service replacement.

Commands used Node 24 and PostgreSQL 18 from Homebrew and the isolated lease:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH EAPR_PG_PORT=55438 EAPR_CONTROL_PORT=3601 EAPR_WORKER_PORT=3602 EAPR_WEB_PORT=5179 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2
npm run test:integration -- tests/integration/v4-discovery-evidence-tools.test.ts -t 'persists revoked authority'
npm run typecheck
npm run test:integration -- tests/integration/v4-discovery-evidence-tools.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/v4-lifecycle.test.ts tests/integration/discovery-source-tools.test.ts tests/integration/discovery-capture-read.test.ts tests/integration/v4-activity-read.test.ts tests/integration/v4-discovery-events.test.ts tests/integration/local-composition.test.ts
git diff --check 3fad7de41a38185601dd0a3a199e6537eb04e566 HEAD
git status --porcelain
```

The first command ran before the correction and exited 1 with `Tests  4 failed | 16 skipped (20)`, reproducing the missing run and task blocker. The final typecheck exited 0 after `tsc --noEmit`. The final integration command exited 0 with `Test Files  8 passed (8)` and `Tests  87 passed (87)`. Diff and status checks exited 0 with empty output. These are focused machine results. Exact-candidate independent review and joint acceptance remain pending.
