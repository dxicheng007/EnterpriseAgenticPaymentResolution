# D2 discovery evidence lifecycle independent review

## Exact candidate and verdict

- Reviewed candidate: `3fad7de41a38185601dd0a3a199e6537eb04e566`.
- Base: `d4f14bff7ba1bfb269cb166efd9c2828b691e4a2`.
- Candidate worktree: `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`.
- Independent reviewer: `/root/astra_discovery_evidence_lifecycle_verify`; builder and supervising root are separate agents.
- Spec compliance: **changes requested** for the observed-revocation recovery transition below.
- Code quality: **changes requested**, limited to that recovery defect and its missing regression. No other actionable defect identified in the reviewed D2 diff and named dependencies.
- Joint acceptance: pending. This review establishes no live provider, full V4, construction, financial, activation, or sync claim.

## Finding

### P1 — Persist observed revocation when recovering an abandoned claimed read

Location: `packages/discovery/src/supervisor.ts:444–465`, particularly the `permits(run, task)` predicate in `eligible` at lines 446–449. Related paths: `reconcile` at lines 180–195, `claimable` at lines 438–441, and the authority filter in `packages/discovery/src/service.ts`.

A replacement owner converts an old generation's running read to interrupted. If the run is paused and current authority is revoked, `refencePausedRead` exits because `eligible` requires authority. It never records `DISCOVERY_FORBIDDEN`. The same omission occurs if revocation is observed after the external recovery capture preparation: the second eligibility check returns without a blocker. A runnable recovered read is also skipped by the service's authority filter and by `claimable`, without recording the observed revocation.

Reproducible sequence from the implementation: claim a real read; pause; lose the owner before result settlement; revoke current authority; acquire a replacement owner while authority remains revoked. The persisted read becomes interrupted with null result, but run/task diagnostics remain empty. Restore policy and resume: resume returns queued because diagnostics are empty, and the replacement can preflight/reclaim the interrupted read in the same run. This violates accepted E2's sticky forbidden disposition for observed revocation of an abandoned claimed read. Current-owner `settleRead` correctly implements the interruption/blocker; replacement recovery needs the corresponding transition.

Required correction: under the replacement owner's guarded transaction, distinguish an abandoned claimed read with observed revoked authority from an ordinary never-claimed pending read. Persist interrupted/no-content plus sticky task/run `DISCOVERY_FORBIDDEN`, preserve paused status, and do not claim a read or emit a successful tool result. Restoring policy, owner replacement, and pause/resume must not clear or bypass that blocker; only a new authorized run can progress. Do not infer revocation from unavailable capture or require detection of unobserved policy history.

Required regression: barrier a real D1 read after claim, pause and lose ownership, revoke policy before replacement reconciliation (also exercise revocation during recovery preparation), then assert interrupted/null content, zero in-flight reads, paused status, sticky forbidden diagnostics and no new tool result. Restore authority and resume; it must remain blocked with no new preparation/claim/model call. Cover the equivalent runnable owner-loss recovery so the scheduler's early authorization filter cannot conceal the same transition.

Evidence classification: direct control-flow proof against the exact candidate, not a newly executed failing test. Existing owner-loss tests cover runnable, paused, and paused-with-preexisting-blocker recovery; revocation tests cover the current owner at settlement and commit. They do not combine replacement ownership with observed revocation.

## Reviewed behavior and quality

Read the eight-file D2 diff and the complete changed supervisor/service/read-tools/roles/composition code and new tests, plus the actual D1 adapter, D0 contracts, task/delegation and repository helpers, migration 004, and composition capture recheck. Reviewed repository, packages, discovery, apps and tests AGENTS; accepted E1/E2 and D2 handoffs; F1/F4/F7 and discovery-shapes obligations; PRD process boundaries; ownership and verification conventions.

- Whole unresolved batch inputs are parsed before original access. Real adapter preparation occurs outside owner transactions, and guarded capture/delegation semantic validation precedes any first claim or child effect. Recovered work repeats this path. Unknown/deferred tools retain explicit safe outcomes.
- Reads use the actual D1 adapter; composition preserves M1 events mounting. Default composition remains without a ModelClient or polling supervisor. No worker or financial surface changed.
- Run/task/returned-dispatch/latest-attempt/ordered-step checks, generation fences and saved/current grant ceilings protect claims. Explicit terminal-step accounting replaces pending-count arithmetic. Read claims change run projection revision without pretending to resolve a tool.
- The exclusive owner serial transaction queue is released during source preparation. There is no ordinary-pool settlement fallback. Stale callbacks fail closed. Per-task execution serialization and generation-aware service tracking allow replacement while old I/O remains outstanding.
- Current-owner settlement checks authority, saved ceilings and capture, persists bounded typed results/activity atomically, and rolls content/activity back on observed pre-commit revocation. Pause permits already-claimed settlement without enabling subsequent claims. Existing sticky diagnostics are not cleared.
- Exact terminal replay reauthorizes and returns persisted results without source I/O. Transcript reconstruction validates accepted call identity, arguments, ordinal pairing and terminal result shapes; the whole turn bound fails safely before a new model reservation.
- Activity stores safe summaries rather than queries/excerpts/arguments. Test barriers check transaction release, result rollback, owner loss, state counts and source/runtime boundaries. The three lifecycle HTTP changes are result-union guards and preserve the behavioral assertions.

## Root clarification applied

Root clarified during this review that the specific E2 classifications govern paused recovery: a confirmed capture mismatch is terminal failed with sticky conflict; observed authority revocation of an abandoned claimed read is interrupted with sticky forbidden, including when replacement recovery observes it. The earlier shorthand that a failed refence stays interrupted does not override those classifications. Unavailable/indeterminate capture cannot justify a successful refence and must not be relabeled as conflict. The candidate's paused recovery leaves unavailable preparation interrupted without claiming; confirmed conflict is failed and blocked. The reported defect is the omitted observed-authority-revocation transition, not a request to alter those capture dispositions.

## Verification and limits

Reviewer commands confirmed exact HEAD and a clean candidate worktree, inspected the supplied diff and named dependencies, and ran `git diff --check d4f14bff7ba1bfb269cb166efd9c2828b691e4a2 3fad7de41a38185601dd0a3a199e6537eb04e566` successfully. No candidate source, tests, index, branch or commits were changed.

Builder report records passing typecheck, 308 unit tests across 44 files and 83 focused PostgreSQL integration tests across eight files (16 D2 cases). Those are builder-reported machine results, not reviewer reruns. Per dispatch, broad suites were not duplicated; the finding is proved by the explicit return paths and the repository resume transition. The assigned PostgreSQL lease was not used. No browser, live model, full slice gate, joint acceptance, or financial verification was performed. Any repair requires a fresh exact-candidate independent review.
