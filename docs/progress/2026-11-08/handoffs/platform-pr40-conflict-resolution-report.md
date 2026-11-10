# PR40 conflict resolution and V5/V6 verifier handoff

Structural merge `1d53329e70e41a616f7826a22956c4f5002082e2` joins first parent `7e65d5d6c4569c7a4d894e76b297af9932be9a97` and second parent `722aaf70c7f8833e954d33fc273f6a4f48b27f78`. The resolution combines the existing V3 normalizer and V4/V7 fail-closed outcomes with the incoming V5/V6 registries and runners. Only the three script conflicts were resolved. The PR39 worker and parent source, parent package export, migration 005, and incoming tests remain byte-identical to the second parent. The independent PR39 review records outstanding financial and authority findings separately. [PR39 review](../reviews/platform-pr39-722aaf7-review.md)

Gate repair `6b8619ca0d0f8488024f22d1b32ba349782d359f` records a separate `prerequisiteResult` and allowlisted cases. V5 emits `ai-off-sync-proof-unavailable`. V6 emits `application-recovery-proof-unavailable`. Both full results stay failed with exit 1 even when all prerequisites pass, and independent review and joint acceptance remain pending. Missing, skipped and failed prerequisite commands prevent a prerequisite pass. The original registries and private report normalization remain in place. The shared V5/V6 allowlist now matches the 19 actual worker dependency case names and all three merged V5 sync case names, including PR39's focused fixture apply/replay/fencing assertion. Full two-source AI-off synchronization and application recovery, concurrency, and containment remain unverified. [V5/V6 verifier review](../reviews/platform-v5-v6-gate-9866847-review.md)

## Focused machine checks

All commands used Node `v24.22.2`.

| Candidate | Command or probe | Result | Local log |
| --- | --- | --- | --- |
| `1d53329e` staged merge tree | `npm run typecheck`, `git diff --cached --check`, and the four-file focused command below | Exit 0, 97 focused tests passed. | `/private/tmp/eapr-pr40-merge-typecheck.log` and `/private/tmp/eapr-pr40-merge-focused.log` |
| `1d53329e` | `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts` | Exit 0, five protected build inventory tests passed. | `/private/tmp/eapr-pr40-merge-inventory.log` |
| `1d53329e` with regression tests | `npm run test:integration -- tests/integration/verify-slice-evidence.test.ts` | Exit 1, four targeted failures and 60 passes. Both all-pass prerequisite summaries produced full exit 0, and both isolated CLI preflights lacked the unavailable-proof diagnostic. | `/private/tmp/eapr-pr40-gate-red.log` |
| `6b8619ca` | `npm exec vitest run -- tests/integration/live-build-gate.test.ts tests/integration/verify-slice-evidence.test.ts tests/integration/verify-v2-evidence.test.ts apps/worker/test/sync-dependencies.test.ts` | Exit 0, four files and 101 tests passed. | `/private/tmp/eapr-pr40-gate-green-6b8619c.log` |
| `6b8619ca` | `npm run typecheck` and `git diff --check 1d53329..6b8619c` | Exit 0. | `/private/tmp/eapr-pr40-gate-typecheck-6b8619c.log` |
| Gate repair source before commit | Normalize the actual worker JSON report and compare V5 sync source titles with the exact shared registry | Exit 0, 19 worker cases normalized with no diagnostics, all three V5 sync titles matched. | `/private/tmp/eapr-pr40-allowlist-check.log` |

The focused runs used no database, browser, or provider. The all-pass gate checks use synthetic command summaries, and the real CLI checks use missing-file preflight fixtures. Full prerequisite gate execution and independent exact-candidate review belong to the coordinating agent. This handoff records no full V5/V6 proof or joint acceptance.
