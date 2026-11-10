# Independent exact-candidate review: PR 34

**Verdict: changes requested. Reuse the implementation after bounded repairs and completion of the approved verification deliverable; do not merge this PR merely to evaluate it.** The implementation has a sound single financial evaluation and useful tracing, but fails exact malformed-input compatibility and the approved source-blocker contract. Its two added tests do not establish the required compatibility, negative-path or protected-build evidence.

## Candidate and authority

- Repository inspected read-only: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.
- Exact candidate: `7084466f5128a2fe1cdf1a1548e568eec799e9ab` (`origin/feat/classify-batch` when inspected).
- Actual merge base with observed `origin/main` (`83c5c0a9191108e42edfaeaa02f1464a1bc71392`): `9680b052765400ade5032b077893e7d4e472e147`.
- Exact diff: `packages/compiler/src/plan-batch.ts` and `packages/compiler/test/plan-batch.test.ts`; 278 insertions, 38 deletions. No candidate branch/source or main worktree file was changed by this review.
- Accepted design SHA-256 rechecked: `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`. Read with original and correction reviews, approved `2026-11-09-sync-classification.md`, applicable repository/package/compiler guidance and frozen F1–F3/F5.
- Candidate line numbers below are from the immutable candidate, not current main.

## Prioritized findings

### 1. P2 — Preserve sparse-array occurrences and their existing holds

`packages/compiler/src/plan-batch.ts:303` changes the original `for...of` to `inputs.forEach`. JavaScript `forEach` skips holes. The existing four-argument public function accepts an array with a hole and emits a `SOURCE_SCHEMA` hold for the undefined occurrence. The candidate instead silently drops the occurrence and returns a successful empty classification.

Reproduction using the valid public artifact/profile/empty target A: `inputs = new Array(1)`. The merge-base planner returns `{plans:[], holds:[{code:'SOURCE_SCHEMA', ...}]}`. Both candidate wrappers produce `{plans:[], holds:[]}`, and classification has zero items for an input length of one. This violates exact legacy hold behavior and the exhaustive `0..length-1` contract. JSON transport cannot express a hole, but this is an explicitly in-process API whose malformed runtime behavior is required to remain compatible; sparse arrays are not excluded by the current input guard.

Fix: preserve the original iteration semantics while tracking the occurrence index, and test sparse input independently from explicit `undefined`/`null`. Do not hide it by introducing a new whole-batch rejection or changing the old outcome.

### 2. P2 — Derive source blockers from the actual guard and its aggregate code

`packages/compiler/src/plan-batch.ts:399–402` independently splits missing-seller and missing-account semantic causes into separate codes. The actual legacy guard at lines 391–395 uses one combined predicate and emits `SEMANTIC_VERSION` whenever any triggering event is semantic. Approved plan Step 6 expressly requires the same source and aggregate guard code, with all exact triggering original indexes.

Reproduction: a parsed, correctly hashed same-source/company semantic event with `sourceAccountId` present and `sellerEntityId` omitted triggers an actual `SEMANTIC_VERSION` hold, but metadata reports only `IDENTITY_SCOPE`. A mixed batch of missing-seller financial input, missing-account semantic input, an exact repeat of the first input and an ordinary event reports two differently coded blockers with indexes `[0,2]` and `[1]`; the approved result is one `SEMANTIC_VERSION` blocker with causes `[0,1,2]`. Ordinary input must stay excluded.

Fix: reuse the legacy guard predicate and already selected `code`, collecting all validated triggering occurrence indexes including repeats. This is metadata repair; retain the existing broad hold event set and its ordering.

### 3. P2 — Add the independent compatibility and negative-path verification deliverable

`packages/compiler/test/plan-batch.test.ts:241–271` adds only two tests. The compatibility assertion compares `classifyBatch(...).outcome` to `planBatch(...)`, which now call the same implementation. The sparse-array regression in finding 1 therefore passes that assertion. The second test's title mentions missing prerequisites, but it does not assert a typed missing prerequisite.

The candidate lacks the approved immutable pre-change corpus, deterministic permutation cases, exhaustive cross-reference checks, normalized repeats and bad-hash ordering tests, source/foreign-profile cases, typed same-ID collisions/held-provider cases, all stop reasons and final failure injection. It also lacks the explicitly required bootstrap planner-byte mutation assertion and direct inventory assertions in both build test files. These are planned acceptance evidence, not optional polish, and the independent negative probes found real defects that current candidate tests miss.

Fix: capture the approved compatibility outcomes from the preserved merge-base planner before adopting candidate source, and complete approved Steps 1–6 and 8–9 without changing frozen expectations. Include the two new reproductions above. The current production build inventories already include `plan-batch.ts`; this finding does **not** claim that the implementation is unpinned or that an inventory/source export change is required.

### 4. P2 — Share the prerequisite producer used by validation and metadata

`packages/compiler/src/plan-batch.ts:176–188` adds `typedPrerequisites` beside the old `prerequisites` at lines 157–174. Validation/group connectivity call the old helper; output calls the new helper. The accepted design explicitly requires typed metadata to use the same prerequisite helper as group validation, and approved Step 7 requires enriching that helper while preserving funding-before-invoice order.

The two implementations currently agree for the tested supported allocation/reversal shapes. No present wrong-money result was reproduced from this duplication. It is nevertheless a direct architectural requirement gap: relation/kind/source/seller keys can drift from actual validation as either copy changes, which defeats the intended same-evaluation provenance guarantee.

Fix: enrich the existing helper with relation and identity, preserve its current targetId/sourceId values and ordering for validation, and sort only a separate metadata projection. No new financial interpreter or broad refactor is needed.

## Positive checks and quality assessment

- There is one private evaluator. The wrappers do not independently materialize or economically compare records. `economics` continues to exclude only original delivery/version fields.
- The original final plan/operation/event/lineage ordering is retained in inspected ordinary paths.
- Independent probes passed for both source baselines, normalized timestamp repeats, earliest input representatives, new/replay/coalesced distinctions and producer references, target-precedence/provider references excluding repeats, same raw IDs across kinds, foreign-account provider exclusion, independent malformed/hash occurrences, and 1,000/1,001 limits.
- An over-allocation connected group with replay-equivalent and coalesced candidates kept every member held. Candidate-provider presence remained distinct from financial acceptance.
- Test-only `computeBalance` fault injection with earlier malformed hold, an existing-record replay and an independent new invoice produced exactly the old earlier hold plus final `MONEY_RANGE` hold, `not_classified/plan_invalid`, and no tentative group/item claims. Ordinary errors propagated through all three functions. The candidate's wider `try` also encloses `finish`; no additional reproducible exception-behavior defect was found, so that is not raised as a separate finding.
- No runtime/model/provider/database/receipt/authority input or write surface was introduced. Target binding uses validated state and its explicit asOf. No second monetary interpreter or invented receipt was found.
- Existing bootstrap and financial build inventories contain `plan-batch.ts`; the existing recursive coverage tests pass. Existing stored build proofs necessarily change with planner bytes and must undergo their normal re-verification, not be edited to preserve eligibility.

## Executed verification (partial)

Isolated Git archive of the exact candidate: `/private/tmp/eapr-pr34-7084466-review-snapshot`. Package dependencies were linked read-only, with `@eapr` workspace links redirected into that archive. The unmodified merge-base planner was copied only into this snapshot as `packages/compiler/src/plan-batch-legacy-review.ts`. Independent probe tests also exist only in this snapshot. Those three reviewer additions were temporarily moved outside the snapshot for the exact candidate typecheck and compiler-suite check, then restored for reproducibility.

With `PATH=/opt/homebrew/opt/node@24/bin:$PATH`:

1. `npm run typecheck` on exact candidate source/tests: **PASS**.
2. `npm run test:unit -- packages/compiler/test`: **PASS**, 31 tests in 3 files.
3. `npm run test:unit -- packages/compiler/test/plan-batch.test.ts packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts`: **PASS**, 19 tests in 3 files.
4. `npm run test:unit -- packages/compiler/test/pr34-independent-review.test.ts packages/compiler/test/pr34-final-failure-review.test.ts`: **24 passed, 3 failed (27 total)**. The three failures are sparse-array compatibility and the two source-blocker reproductions above. Thirteen cases directly compare candidate legacy outcomes to the old planner. A first draft of one reviewer probe accidentally reused a changed delivery ID and correctly hit `delivery_conflict`; it was removed in favor of the valid independently identified over-allocation probe. It is not a product finding.
5. `git diff --check 9680b052765400ade5032b077893e7d4e472e147 7084466f5128a2fe1cdf1a1548e568eec799e9ab`: **PASS**.

No DB, browser, provider, GitHub write/message, merge, branch modification, protected truth refresh, or subagent was used. An initial Vitest startup failed because the dependency-link setup accidentally pointed `.vite-temp` outside the snapshot; replacing that snapshot symlink with a local temp directory resolved it. No approval escalation was requested.

## Reuse recommendation and limits

Reuse this candidate's same-evaluation tracing in the authorized implementation lane after preserving independent pre-change compatibility evidence. Repair the parse iteration, source-blocker projection and duplicate prerequisite producer; complete the already approved test/pin evidence rather than starting another full implementation. Keep the PR unmerged for evaluation and submit the repaired exact candidate for fresh independent review.

This report is neither implementation acceptance nor full unit/integration/e2e/slice verification. It does not establish live construction, activation, persisted receipt recovery, ongoing synchronization, or user acceptance. The broader approved corpus/permutations, mutation assertions and some high-risk cases remain missing from the candidate; limited positive probes do not substitute for them. All proposed fixes are routine implementation of already specified behavior; no newly unspecified financial policy was found.
