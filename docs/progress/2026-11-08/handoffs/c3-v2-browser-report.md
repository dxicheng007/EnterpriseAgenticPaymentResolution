# C3 actual v2 browser checkpoint

- Base `33364f0edd20fd82635aa09700b4dd240e212a86` on `codex/source-preview-ui`. The base includes the independently reviewed B assembly and C2 checker.
- Code candidate `1ac3248ff827918e7da776a5359d45f86a541592`. This report is committed separately so it can identify the tested code exactly.
- Changed paths are the two test helpers, the new Playwright spec, the five-case isolation spec, and this report.
- Dedicated lease used Node 24.22.2 and PostgreSQL 18.6 with PG 55437, control 3501, worker 3502, web 5178 and test prefix `eapr_test_review_t2`, set before imports. The main PG 55432 lease stayed outside this work.

## Observed results

Chromium submitted both exact candidate preview and verification requests through the local reviewer session. Both real jobs completed, their public summaries matched the rendered rows and persisted reports, and their reports used construction fixture version 2. Each job passed all thirteen mandatory checks with four `evidence_support` cases, complete coverage, zero unexplained difference and eligibility for review.

| Captured company | Preview cents | Parent writes | Checks passed | Total report cases |
| --- | ---: | ---: | ---: | ---: |
| A | 80000 | 0 | 13 | 53 |
| B | 0 | 0 | 13 | 57 |

The test compared every runtime public table and its rows around both previews and jobs. Control created the expected jobs and reports. Both browser runs exercised authenticated control and Vite file-read denials, inspected the completed DOM and served application modules for protected values, and checked for activation controls and requests. Private file probes explicitly request a file response to avoid Vite's HTML navigation fallback. They require HTTP 403 or 404 and check the denied body in memory. The v2 test server filters the known denial messages that include private paths and keeps other application diagnostics.

The opt-in helper copies actual generated truth and producer inputs with only fixture binding and hash changes. The real operator preparation assembles and publishes the v2 pair. The helper checks both returned bindings and file fingerprints before claiming ownership. The isolation tests exercise stale companions, an occupied second path, partial publication, inode replacement, same-inode byte and mode changes, symlink substitution and overlapping v2 runs. The default expected-only helper still exercises v1.

## Machine checks

| Command or check | Observed result |
| --- | --- |
| Initial `npm run test:integration -- tests/integration/c3-v2-pin-isolation.test.ts` | Exit 1. Four failed and one passed. The expected-only helper supplied two files, reached the callback for the v2 collision and rejected returned v2 bindings. |
| Initial corrected `npm run test:e2e -- tests/e2e/v2-evidence-verification.spec.ts --trace=off` | Exit 1 at the all-passed assertion after an actual v1 job completed. An earlier attempt exposed that the empty-fixture label appears after candidate selection. |
| `npm run typecheck` | Exit 0 on the code candidate. |
| `npm run test:unit` | Exit 0, 23 files and 163 tests on the code candidate. |
| `npm run test:integration -- tests/integration/c3-pin-isolation.test.ts tests/integration/c3-v2-pin-isolation.test.ts` | Exit 0, 2 files and 8 tests on the code candidate. |
| `npm run test:e2e -- tests/e2e/v2-preview.spec.ts tests/e2e/v2-verification.spec.ts tests/e2e/v2-evidence-verification.spec.ts --trace=off` | Exit 0, 3 Chromium tests on the code candidate. |
| Two sequential `npm run test:e2e -- tests/e2e/v2-evidence-verification.spec.ts --trace=off --retries=0` invocations with distinct output directories | Exit 0 and one passing test per invocation on the final code. Each repeated run preserved the two historical pins and the absence of a preexisting demo and operator selection root. The browser helper also verified generated input and visible original inventories before cleanup in each run. |
| `git diff 33364f0..1ac3248 --check` | Exit 0. |

An initial browser boundary check rejected Vite's SPA fallback response. The file request content negotiation correction preserved the 403/404 requirement. A separate first repetition completed Chromium and the inventory comparison, then the scratch artifact inspection failed because it passed `basename` directly to `Array.map`. Both repetitions were rerun with the corrected inspection.

The ignored local evidence directory `.evidence/c3-v2-browser-icoFSZ/` retains the two allowlisted screenshots and strict `v2-browser-results.json` for each successful repetition. Both A/B screenshots in each run were visually inspected. Each contains only the Independent verification region. The result files were checked for exact keys, expected balances, distinct jobs, passed checks and safe diagnostics. The repeat runner deleted its scratch output.

## Acceptance scope

These focused results cover actual captured development candidates and an empty target fixture. `retry_restart` exercises fresh planner subprocess replay. Persisted parent reads, runtime restart and writes, parent configuration execution, live discovery, approval, activation, synchronization and final holdout require separate evidence. The V2 gate, fresh exact-candidate independent review and joint G2 acceptance remain pending.
