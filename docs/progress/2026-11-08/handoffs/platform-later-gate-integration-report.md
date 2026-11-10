# V7 gate and dependency input handoff

Integration base `1c6b9277073f92911e05ae77a2ed06557b702c10` includes merged PR35 and PR36 and the previously reviewed V3, V4 and classification work. Source candidate `8d2a773ae1b3c2e07d45476c82a933b9f8c6820a` addresses the V7 gate and pure dependency boundary findings. [Bounded owner-delta review](../reviews/platform-owner-pr35-pr36-pr37-review.md)

V7 records the two-company fixture browser and typecheck outcomes as prerequisites. The packet retains allowlisted command and assertion details with authenticated tracing disabled. Even with passing prerequisites, full V7 records `result: failed`, `live-holdout-rehearsal-unavailable`, pending independent review and joint acceptance, and exits 1. G0–G6 machine evidence, genuine live construction, an unseen holdout, and three live rehearsals remain required. The V7 verifier no longer runs the missing-configuration assertion as a live command. Both registered V4 and V7 public live paths already failed closed in the base. Added V7 CLI cases verify absent and fabricated keys with and without `--evidence` against that unchanged entry point.

`selectGroups` accepts safe integer limits from 1 through 1,000 and retains the 1,000-event default and whole-group selection. `dependencyOrder` requires each mapped item's input index to be a unique, nonnegative safe integer and each referenced provider to be present among the mapped inputs. Malformed limits and graphs throw `DependencyError` with code `DEPENDENCY_INPUT_INVALID`. Deterministic ordering and the existing cycle and oversized group errors are preserved. A real compiler fixture verifies that a held provider can supply ordering data while its group remains held with no plans. The helper does not grant application authority. The classifier and retry/backoff constants are unchanged.

## Focused machine checks

All checks used Node `v24.22.2`. Public live CLI subprocesses removed the named OpenAI configuration variables and used a fabricated key only in the configured cases.

| Candidate | Command | Result | Local log |
| --- | --- | --- | --- |
| `1c6b9277` with regression tests | `npm exec vitest run -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts apps/worker/test/sync-dependencies.test.ts` | Exit 1, 15 failed and 76 passed. The V7 aggregation returned zero, its isolated CLI preflight lacked the unavailable diagnostic, and 13 malformed dependency inputs were accepted or classified as oversized groups. The four added V7 live CLI cases already exited 1. | `/private/tmp/eapr-later-gate-red.log` |
| `8d2a773a` | `npm exec vitest run -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts apps/worker/test/sync-dependencies.test.ts` | Exit 0, 4 files and 97 tests passed. | `/private/tmp/eapr-later-gate-green-8d2a773.log` |
| `8d2a773a` | `npm run typecheck` and `git diff HEAD^ HEAD --check` | Exit 0. | `/private/tmp/eapr-later-gate-typecheck-8d2a773.log` |

These are focused checks without database, browser, or provider execution. They establish V7 exit and packet behavior at preflight and aggregation, and pure dependency helper behavior. Full V7, dependency persistence and scheduling, and joint acceptance require separate verification.
