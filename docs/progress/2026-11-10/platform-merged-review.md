# Merged Platform backend and PR60 source review

Date: 2026-11-10. Read-only independent review of `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`, clean `codex/platform-mvp-integration` at `12f6595afa7ffe42e669d1a8b72a7e1b0c8692d6`. Reviewed PR61 commit `c5fe35ac8f439527b25abc92631b44baedbe1d80` against its parent, and pending PR60 `c62658248ed63aaf244cd340dd756fb1c184d401` against base `49245de`. The four assigned PR61 backend/contracts/integration files have no subsequent diff from that PR61 commit to reviewed HEAD.

## Verdict

No production correctness or cross-account leakage finding in the assigned PR61 change. The committed source/manifest join fixes the first-activation ownership error without broadening lane selection. Null runtime-model-call reporting is correct. No backend rewrite is indicated. The incomplete adversarial regression described below is a bounded follow-up, not a blocker for the frozen single-customer demo.

PR60's one required-title correction and its regression are safe to reuse on current main. Do not import its new unlock note or the scripts guide link to it: that note incorrectly treats full V5/G5 prerequisites as optional. Full V5 and V6 must remain fail-closed. This verdict does not accept the four separate Experience-owned PR59 authority findings, browser behavior, full V5, or joint acceptance.

## Finding — P2: PR60 unlock documentation conflates the bounded fixture demo with full V5

Exact candidate location: `c626582:docs/progress/2026-11-10/t5-gate-unlock-criteria.md:14-22,31-35`; linked from `c626582:scripts/AGENTS.md:12`.

The note frames its Company-A-only list as requirements before removing `ai-off-sync-proof-unavailable`, calls both source modes optional at line 22, and suggests a full pass path once those Company A observations are validated. Full V5/G5 still requires fresh Company B file input as well as A and actual isolation evidence: `docs/superpowers/plans/2026-11-08-implementation-plan.md:326-339` and `docs/superpowers/plans/2026-11-08-verification-playbook.md:86-94`. The frozen demo deliberately narrows presentation without granting full V5 acceptance (`docs/demo/demo-contract.md:3-5`); current main already has the separate `demo-company-a-ai-off` selector and explicitly separates full V5 in `scripts/AGENTS.md`'s last paragraph.

Recommendation: transplant only `scripts/verify-slice.ts` and `tests/integration/verify-slice-evidence.test.ts` changes. Exclude both PR60 documentation changes. Do not alter `syncGateOutcome`, required observations, selector scope, or unavailable diagnostics. No broader gate implementation is needed.

## Nonblocking coverage follow-up — shared incidents and different manifests

Location: `tests/integration/sync-capture.test.ts:928-950`, especially lines 947-949.

The added case proves two committed accounts sharing a lane both see streams, and that account B retains its own activation ID. However, it creates no capture incident in `sharedDb`; the equality assertion compares two empty incident arrays. The separate `peer` database contains the different-manifest fixture, so the added connection reads cannot prove exclusion of a different manifest present in their database. This leaves two explicit regressions from the prior scoped review unfulfilled (`docs/progress/2026-11-10/experience-pr42-pr44-pr45-review.md:28`). It is not evidence of an actual leak: the SQL includes both exact source and exact manifest predicates.

When the SQL lease is available, use genuine committed fixtures to create a known safe lane incident, assert its actual expected fields through both approved accounts, and exercise different-manifest exclusion with both lanes in the queried database. Assert each account retains its own activation/receipt facts. Keep this within `tests/integration/sync-capture.test.ts` if practical; no worker, schema, migration, source service or UI rewrite is justified by this review. Coordinate the lease with Experience instead of starting services now.

## Grounded production conclusions

- `apps/worker/src/connections.ts:27-32` selects capture rows using the requested account's own committed import, matching `bundle.manifest.sourceRef` and `activation.manifestHash`. The import is unique per account (`db/runtime/002_parent_activation.sql:148`), so this cannot multiply rows through multiple imports. A legitimate committed activation binds `activation.manifestHash` to its bundle manifest (`packages/parent/src/activation-store.ts:128`). Capture checkpoints and incidents retain lane foreign keys (`db/runtime/003_sync_capture.sql:28,112-113`). The old `initial_activation_id` field is provenance, not exclusive membership (`docs/superpowers/plans/2026-11-09-sync-capture.md:109`), so removing its ownership filter is correct.
- Same-lane capture facts are intentionally shared, not another customer's monetary records. Account-specific target, import, authority and sync receipts remain filtered by `account_id` (`connections.ts:21-25`). Control still verifies reviewer account and source grants (`apps/control/src/parent-read-client.ts:23-28`) and returned scope (`:76-80`); worker still requires service authorization (`apps/worker/src/routes/connections.ts:9-11`). Exact manifest matching prevents accidental source-wide union of different approved baselines. I found no new cross-account monetary/proof disclosure path.
- The query remains in a `REPEATABLE READ READ ONLY` transaction (`connections.ts:19-33`). Returned fields remain bounded and exclude raw canonical bundles and protected proofs.
- `packages/contracts/src/connection-state.ts:39` now accepts only null, and `connections.ts:67` returns null. This honestly represents an unmeasured quantity; architecture forbidding model calls is not a measured zero. `tests/integration/sync-apply-races.test.ts:895` tracks that changed contract. There is no implied live isolation or full V5 proof.

## Protected financial/build identity consequences

`connection-state.ts` was already included in both protected source inventories before PR61: `packages/evaluator/src/financial-attestation-build.ts:11` and the shared bootstrap list in `packages/evaluator/src/bootstrap-runner.ts:62`. Therefore this contract-byte change changes the financial build hash and both bootstrap evaluator/subject build hashes. This is expected dependency closure, not a missing-inventory bug. Existing mutation coverage explicitly names this leaf (`packages/evaluator/test/financial-attestation-build.test.ts:58,70`; `packages/evaluator/test/bootstrap-build.test.ts:50`). No inventory repair or expected-result change is warranted.

Old build-bound proofs/pins must not be treated as matching this new candidate. Financial launch checks the current build before/after execution (`packages/evaluator/src/financial-attestation-launcher.ts:42,48`); bootstrap requires exact current pins (`packages/evaluator/src/bootstrap-runner.ts:115-119`). Any fresh verification/activation setup must use genuine newly issued exact-build proofs under normal operator policy. Preserve historical receipts and old evidence; do not overwrite protected truth or repin the preserved demo to conceal a mismatch. This review did not inspect or mutate any installed pins, policy, database, or saved proof state and does not claim that any particular live installation is currently mismatched.

## PR60 code assessment and safe repair scope

At its base, `scripts/verify-slice.ts:854` requires `applies a fresh invoice once, replays the receipt and fences stale input`, while the real test is `applies a captured invoice once, recovers its receipt and fences stale input` (`tests/integration/v5-sync.test.ts:253`). PR60 changes only that legacy title in the verifier and adds a source-title regression at `c626582:tests/integration/verify-slice-evidence.test.ts:292-308`. Its code does not change the gate result or invent apply evidence.

`syncGateOutcome` remains unconditional `result: failed`, `exitCode: 1`, including its unavailable diagnostic (`scripts/verify-slice-evidence.ts:224-237`). The existing V5/V6 all-prerequisites-passing regressions remain present (`tests/integration/verify-slice-evidence.test.ts:292-318` at reviewed HEAD). The correction also benefits V6's reuse of the V5 case list without weakening either result.

Recommended Sol task: apply exactly those two code/test file changes to current main, retain all full V5/V6 failure behavior, run the no-DB evidence-parser regression suite, and record exact candidate plus results. Existing PR60 note and scripts-guide link stay excluded. No UI/e2e ownership, SQL lease, evaluator change, model configuration, or service start is needed for this task.

## Verification performed and limits

Performed read-only Git identity/status/diff inspection, repository/area guidance and relevant frozen specs/prior source review, storage and producer/consumer source tracing. `git diff 49245de c626582 -- scripts/verify-slice.ts tests/integration/verify-slice-evidence.test.ts | git apply --check -` succeeded against reviewed HEAD. The worktree was clean at initial inspection. The final status check showed concurrent owner edits only in `scripts/verify-slice.ts` and `tests/integration/verify-slice-evidence.test.ts`; this review did not make them and its source verdict remains bound to committed HEAD/PR60 above.

No tests, SQL, database/service operations, network calls, source edits, subagents, browser/UI review or financial execution were performed. Only this `/tmp` report was written. Patch applicability is not a parser or database execution result. Machine checks, independent source review and joint acceptance remain separate.
