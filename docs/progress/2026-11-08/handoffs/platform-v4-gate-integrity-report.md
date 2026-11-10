# V4 and live gate integrity handoff

Implementation base `4392f9e244f17f545a064b4227b894a9367e30ce` includes PR33 and the V3 report correction. Source candidate `0e5bf9b93e3b8a3bbda15b8c7e2ab3091a3b4474` addresses both PR33 gate findings. [Independent PR33 review](../reviews/platform-pr33-31d8a4a-review.md)

On the base, `test:live` spawned Vitest with a fabricated key or with `--evidence` and propagated the successful missing-configuration assertion. The V4 runner used that assertion as its only live command. Its outcome accepted four passing prerequisite results and a Chromium version as a full V4 pass.

The public `test:live` command exits 1. A valid path with missing provider configuration emits `LIVE_CONFIGURATION_UNAVAILABLE`. A valid path with a nonempty key emits `LIVE_CONSTRUCTION_UNAVAILABLE`. `--evidence` follows the same paths. Invalid or missing paths emit a file or usage diagnostic. The CLI launches no test or provider process.

V4 still collects agent-tools, Discovery monitor and typecheck evidence with provider configuration removed from child environments. It records their aggregate in `prerequisiteResult` and retains normalized command and assertion details. The existing missing-configuration test remains in place and is excluded from V4 command results. The V4 packet always records `result: failed`, `live-construction-unavailable`, and pending independent review and joint acceptance. The V4 CLI exits 1 even when all prerequisites pass. The V3 parser and gate remain as in the base.

## Focused machine checks

All checks used Node `v24.22.2`. CLI regression subprocesses deleted `OPENAI_API_KEY`, `OPENAI_ORG_ID` and `OPENAI_PROJECT_ID` from the child environment and supplied a fabricated key only in the configured cases.

| Candidate | Command | Result | Local log |
| --- | --- | --- | --- |
| `4392f9e2` with regression tests | `npm run test:integration -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts` | Exit 1, 5 failed and 61 passed. Three public live invocations and the all-passed V4 outcome returned 0. The V4 CLI preflight lacked the unavailable diagnostic. | `/private/tmp/eapr-v4-gate-red.log` |
| `0e5bf9b9` | `npm run test:integration -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts` | Exit 0, 3 files and 72 tests passed. Covered eight public live argument and configuration cases, V4 all-pass and failure outcomes, and actual isolated V4 preflight packet writing. | `/private/tmp/eapr-v4-gate-green-0e5bf9b.log` |
| `0e5bf9b9` | `npm run typecheck` and `git diff HEAD^ HEAD --check` | Exit 0. | `/private/tmp/eapr-v4-gate-typecheck-0e5bf9b.log` |

These checks establish the exit and evidence behavior without a database lease, a browser run or provider calls. Genuine A/B construction, protected verification and holdout evidence remain pending. Independent review of this correction and joint acceptance are separate.
