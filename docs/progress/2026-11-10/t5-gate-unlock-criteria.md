# T5 — V5 gate unlock criteria (Integrator)

**Status:** Documentation only. Full `verify:slice -- V5` remains failed with `ai-off-sync-proof-unavailable` by design (`syncGateOutcome`). This note records what must exist before the Integrator may remove that unavailable diagnostic. It is not acceptance, a path reservation, or permission to claim G5.

**Date:** 2026-11-10  
**Base:** main `49245de` (T1 PR56 merged). Parallel owner work: Platform T2 Company A mount (open PRs 57/58), Experience ops controls (open PR 59). Do not collide with those paths.

## Already true (do not redo)

- Prerequisite harnesses run and are recorded when present.
- Full V5/V6 machine results stay `failed` even when every listed prerequisite command passes (`ai-off-sync-proof-unavailable` / `application-recovery-proof-unavailable`).
- Fixture apply evidence exists via `tests/integration/v5-sync.test.ts` and PR56 mount proof; those are **partial**, not the frozen T0 operator chain.

## Required before removing `ai-off-sync-proof-unavailable`

All of the following must be present on the exact candidate, labeled fixture/AI-off (not live construction):

1. **Fresh conforming Company A input after activation** using the frozen demo-contract scenario (`local-demo-v1`, $300 payment → 80000→50000, cutover asOf still 80000), not only an unrelated $12 invoice fixture.
2. **Operator inject → durable capture → apply** without treating `FEATURE_NOT_IMPLEMENTED` harness stubs as success (T2 Tasks 2–3 once accepted).
3. **Public packet observations** (no secrets): scope, source/manifest/artifact/profile hashes, fixture mode, receipt id + `replayed`, event IDs/counts, integer before/after/current/cutover cents, parent versions, capture/application cursors, worker model-credentials-absent assertion.
4. **Named required cases** in `scripts/verify-slice.ts` must match real test titles exactly (title drift fails closed as missing prerequisites).
5. Optional stretch for full G5 later: both source modes; Connections UI observation remains Experience T4 and is not a substitute for monetary apply.

## Explicit non-unlockers

- Capture-only / authority-only / health-only prerequisites.
- `FEATURE_NOT_IMPLEMENTED` inject assertions in e2e AI-off.
- Literal `runtimeModelCalls: 0` in connection state without a worker trap on the apply path.
- Live Discovery construction (T9) or Gate J acceptance.

## Next Integrator action after T2 acceptance

1. Point required V5 cases at the accepted Company A mounted proof titles.
2. Retain `syncGateOutcome` fail-closed until those observations are packet-validated.
3. Only then consider replacing `ai-off-sync-proof-unavailable` with a real pass path under a separate exact-candidate review.
