# S1 implementation task: pure bootstrap planning

Read this first as the assigned requirements. Execute inline as Sol, no subagents. Root accepted S0 a49a8cf and integrated210bc98. Use the accepted proposal `v3-bootstrap-verification-proposal.md` SHA dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7 section2 as the exact algorithm/lineage/hold/equality authority, plus the executable bootstrap-verification freeze. Section3–6 are context only, not scope.

## S1 — pure bootstrap planner/projection (B)

Depends S0 freeze; can run concurrently with S2 and S4 after file assignments.

Allowed: new `packages/compiler/src/plan-bootstrap.ts`, new `packages/parent/src/bootstrap.ts`, `packages/compiler/package.json`, `packages/parent/package.json` for explicit exports only, new `packages/compiler/test/plan-bootstrap.test.ts`, new `packages/parent/test/bootstrap.test.ts`. Existing plan-batch.ts/state.ts APIs and implementation stay unchanged. Use type-only existing shapes; no control/runtime/migration work.

Implement four-argument pure API and copied full target projection from proposal §2. Validate metadata duplicates/scopes, canonical exact reuse versus conflict, selected/unresolved hold classification, no-plan/replay blockers, exact ensure order and leaf lineage, shifted suffix and full hash. Financial balance zero alone does not block. No plan minted from blocked financial subset. Preserve no-I/O/no-clock behavior and unchanged target.

Acceptance: public A three ensures/five financial operations/balance80000; B zero-balance/nonempty permitted; two configurations reverse term order; null and empty-array leaves; input-array permutations normalize only declared sets; exact reuse retains explicit ensures/original bytes; customer/account/config conflicts; selected hold coexisting with nonempty financial plan blocks; missing event IDs and source-wide holds block; unrelated routing exclusion remains visible without blocking selected scope; all financial regression tests unchanged.

Commands: `npm run typecheck`; `npm run test:unit -- packages/compiler/test packages/parent/test packages/finance/test`.


No protected oracle, metadata candidate builder, source reads, result registry, authority, activation or worker/database code. Validate and return copied target/plan without writes/model/clock. The planner cannot independently establish factual citation support; do not imply shape validation is evidence verification. Helpers and errors may be local routine implementation details within these exact existing APIs. Do not change existing planBatch/projectTarget behavior to make new tests pass.

Use actual assertion-level red after imports are minimally wired; missing import alone is not behavioral red. Keep public fixtures unchanged. Run the listed focused compiler/parent/finance unit files and typecheck; no Postgres required. Inspect owned diff and commit labeled under20words. Write `b-bootstrap-planner-report.md` in this ignored briefs directory, recording exact base/head, commands/results and limitations, then return for fresh independent Astra review. No merge/push.
