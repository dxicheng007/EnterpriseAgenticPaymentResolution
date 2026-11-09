# B executable V2 verification gate

- Base `fbd6f0fe3ce6bf3fda9a128c7d6aebf4d1549970` on the assigned `codex/source-evidence` worktree. The base incorporates reviewed B+C2 and C3's actual version-2 browser checkpoint.
- Code and status candidate `dbd28dc0923551d06c7fe4ce684e280aacb349c3`. This report is committed separately to keep the tested candidate identity exact.
- Builder `/root/sol_v2_verifier` under coordinating agent `/root`. Independent review and joint G2 acceptance are pending.
- Node 24.22.2, npm 11.19.1, PostgreSQL 18.6 and Chromium 158.0.8127.18. The exclusive lease used PostgreSQL 55434, control 3201, worker 3202, web 5175 and test prefix `eapr_test_review_t1`. Main's 55432 lease stayed outside these runs.

## Changed paths

- `scripts/verify-slice.ts` dispatches explicit V2. Its V0 and V1 imports now occur inside their own execution paths so invalid V2 configuration reaches safe preflight.
- `scripts/verify-v2.ts` registers the exact 20 files and 94 assertion names, plus typecheck. It runs each file separately and records safe evidence and bounded lease, dependency, source, contract and migration metadata.
- `scripts/verify-v2-evidence.ts` validates stock JSON and execution guard reports, actual version-2 browser results and the ten exact PNGs. Its browser collector checks file origin and format. The runner removes scratch outputs and retains only allowlisted evidence.
- `scripts/verify-v2-vitest-reporter.ts` supplements stock JSON for V2 unit and integration commands. Vitest 5.1 stock JSON marks both a passing expected failure and a recovered retry as passed. The added `--reporter=./scripts/verify-v2-vitest-reporter.ts` uses `EAPR_V2_VITEST_GUARD_REPORT` solely for the run-owned private sidecar destination. The public Vitest reporter API supplies the exact assertion identity, status, expected-failure flag, attempt count, retries, repeats and flaky flag. The gate requires agreement with the stock report. The coordinating agent approved this addition after the reporter gap was reproduced.
- `tests/integration/verify-v2-evidence.test.ts` covers named case and command completeness, sidecar checks against real Vitest, strict browser records, screenshot validation, privacy and fail-closed preflight/execution. `tests/integration/verify-slice-evidence.test.ts` changes only the obsolete V2-unavailable regression.
- `scripts/AGENTS.md`, `tests/AGENTS.md`, and the implementation-plan and verification-playbook status text describe the executable gate and its scope.

## Machine checks

| Run | Observed result |
| --- | --- |
| Initial focused parser and CLI run | Exit 1, seven expected regressions failed with the old V2 dispatch or unimplemented collector. |
| Execution guard red fixture | Real Vitest exited 0 and reported ordinary, expected-failure and recovered retry cases as passed in stock JSON. The guard output was absent with the unimplemented reporter. |
| `npm run typecheck` | Exit 0. Typecheck also passed as the required final command in V2. |
| `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts` | Exit 0, 2 files and 40 tests on the exact code candidate. |
| `npm run test:unit` on the code candidate | Exit 0, 24 files and 166 tests. |
| Initial dirty `npm run verify:slice -- V2` before the execution guard | Exit 0, 21 commands and 94 named assertions. Packet `.evidence/dirty-8ae596a1f57a34d8e8c025bee029d9c04c4f0d33592bf085d7e838e437df353a/V2/2026-11-08T23-58-15-632Z-51290/`. |
| Guarded dirty `npm run verify:slice -- V2` | Exit 0, 21 commands, 94 named assertions and ten validated PNGs. Packet `.evidence/dirty-0b8549adb19dbf605fede7bc3774f8bdf61d33c1d760519d2792aab50553b003/V2/2026-11-09T00-02-15-749Z-56257/`. |
| Clean exact-candidate `npm run verify:slice -- V2` | Exit 0, 21 commands and 94 named assertions. Ten allowlisted PNGs and two terminal verification job observations retained. Packet `.evidence/dbd28dc0923551d06c7fe4ce684e280aacb349c3/V2/2026-11-09T00-04-36-709Z-59004/`. |
| Clean exact-candidate `npm run verify:slice -- V0` | Exit 0, 4 commands and 20 named assertions. One health trace retained. Packet `.evidence/dbd28dc0923551d06c7fe4ce684e280aacb349c3/V0/2026-11-09T00-06-40-051Z-62269/`. |
| Clean exact-candidate `npm run verify:slice -- V1` | Exit 0, 6 commands and 13 named assertions. Two allowlisted screenshots retained and authenticated traces disabled. Packet `.evidence/dbd28dc0923551d06c7fe4ce684e280aacb349c3/V1/2026-11-09T00-06-45-704Z-62733/`. |
| `git diff fbd6f0f..dbd28dc --check` and exact registry comparison | Exit 0. The appendix map matches 20 files and 94 literal names. |

During development, a typecheck exposed the Node type overload for the PNG decompressor's `info` result. The corrected type and bounded decompression path passed. A malformed test PNG was replaced with a valid minimal PNG, and the collector test now accepts multiple safe failure codes for one unsafe path. The real gate registry and browser dependency files were preserved throughout.

## Exact V2 packet

The exact packet recorded `clean: true`, the full candidate SHA and no diagnostics. I inspected all ten PNGs and independently matched their SHA-256 hashes to the manifest. The packet files are mode 0600. Its file inventory contains only the four JSON documents, review stub and allowlisted PNGs. The JSON has no raw child streams, private truth or fixture IDs, credentials, or private scratch paths. The V2 scratch directory was gone after the run. The V1 packet has two screenshots and no authenticated trace.

Both protected browser jobs completed with eligible version-2 reports. The A and B previews showed 80000 and 0 cents respectively with zero parent writes. Each report passed thirteen checks, including four evidence-support cases. The separate F8 wrong-mapping regression uses the same B artifact with the public 80000-cent F8 probe. The preview-only, expected-only v1 and actual-v2 browser evidence were collected separately. The two actual-v2 screenshots show only the Independent verification region and the trace records only observed completed jobs with public binding hashes.

This evidence covers captured synthetic development data and the explicitly empty target fixture. `retry_restart` exercises fresh planner subprocess replay. Persisted parent reads, parent configuration execution, runtime restart and writes, live discovery, final holdout, approval, activation, parent import and sync require separate evidence.
