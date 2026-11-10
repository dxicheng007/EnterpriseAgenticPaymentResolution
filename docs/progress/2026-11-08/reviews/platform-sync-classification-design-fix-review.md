# Scoped classification design correction review

Candidate: `/private/tmp/eapr-sync-classification-design.md`, verified SHA-256 `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`.

Verdict: **both original findings resolved; no new breakage found in the correction diff.** This is a scoped design review, not implementation approval, execution verification, path reservation, or user acceptance.

## Finding 1 — Final plan failure output consistency: resolved

Candidate lines 58, 71, 149, and 156 consistently select whole-request `not_classified` with reason `plan_invalid` for a caught final `resultPlan` `FinanceError`. They preserve the exact legacy outcome, including no plans, earlier holds and the appended final hold; `holdIndexes` references that final hold. No items or group acceptance claims survive. The discriminated shape at lines 42–48 supports this choice without a partial-result state. The conflicting instruction to downgrade tentative financial items to classified `held` items has been removed.

Read-only comparison with `packages/compiler/src/plan-batch.ts:361–365` confirms that the stated legacy outcome matches the existing catch branch. The correction does not broaden it to uncaught errors or change financial behavior.

## Finding 2 — Parsed canonical repeat equality: resolved

Candidate lines 28, 60, and 69 consistently use the same parsed, hash-validated event representation as existing `parseEvents`, including accepted `IsoInstant` normalization. Original input indexes remain separate metadata; the planner's representative and operation choices remain unchanged. The document explicitly forbids a new raw-input equality guard and preserves the separate runtime capture contract.

Line 145 supplies both requested future compatibility cases: equivalent accepted timestamp spellings carrying the normalized-event hash deduplicate, while a genuinely different observation instant with recomputed hash under the same delivery remains a conflict. Read-only inspection of `packages/compiler/src/plan-batch.ts:223–254` and `packages/contracts/src/common.ts:45–54` confirms these statements match the existing parse/hash/deduplication and timestamp-normalization behavior.

## Output placement: accepted

Candidate lines 32, 154, and 156 place the compiler-owned in-process types and function on the existing `@eapr/compiler/plan-batch` subpath. `packages/compiler/package.json` already exposes that file. This needs no new package export mapping, shared contracts barrel leaf, or transport schema. Additive named exports and existing protected build-pin maintenance remain explicit; extracting a new private evaluator leaf retains closure-inventory and coverage obligations.

## New breakage within the correction diff

None found. The edits resolve the two findings and settle the previously recommended output boundary without adding financial policy, receipt authority, runtime behavior, or implementation scope. No broader review was performed.

Reviewed the before/after diff, original review, correction report, corrected document, and the narrow existing source/package references above. No repository files, authority work, code, database, tests, commits, or subagents were changed or used; only this requested review report was written.
