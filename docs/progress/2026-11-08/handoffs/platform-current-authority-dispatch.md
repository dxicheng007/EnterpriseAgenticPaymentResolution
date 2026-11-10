# Current-authority continuation checkpoint

User merged PR18 and requested continued implementation. Root pulled main at `f8973dd`, then pulled again at the user's status check and advanced to `b6c662a` through merged PR17 and PR15. Work continues in the existing isolated worktree on `codex/platform-current-authority`. The completed capture implementation is not being repeated; its [handoff](platform-continuation-dispatch.md) and reviews remain authoritative for that bounded phase.

## Next implementation gate

The accepted [current-authority design](platform-current-authority-design.md) and [retention correction review](../reviews/platform-current-authority-retention-review.md) govern the next internal pause/resume/revoke state and epoch fence. An exact implementation plan is being prepared before fresh independent review and GPT-6.1 Sol implementation. Root reserves `db/runtime/004_current_authority.sql` after confirming main ends at runtime003 and the active Discovery/Experience/provider branches have no competing runtime004. Existing migrations remain immutable. No authority code, routes, mounts or next financial writer is implemented at this checkpoint.

Shared contract exports and their protected build closures will be reserved precisely in the plan. The isolated PostgreSQL lease remains port55441 with `eapr_test_review_t2`/`eapr_review_t2`; no current database process is running tests. Preserved demo state, policy and source pins are untouched.

## Merged work and outstanding reviews

The merged Gate J source is still exact `7012a4d`, with the nine findings in its [independent review](../reviews/platform-discovery-gate-j-7012a4d-review.md) unresolved. Merge status is not Gate J acceptance. Default local composition still has no ModelClient; root has not configured a provider or made a live call.

The merged transport is exact `8f14539`. Its [independent review](../reviews/platform-live-transport-8f14539-review.md) requests five corrections: preserve tool transcripts, report unknown usage honestly, validate complete provider outcomes, require valid budget preflight and bound response parsing. These are separate Discovery-owned paths. Experience PR14 remains at `be39242`, with its [three recorded findings](../reviews/platform-experience-details-be39242-review.md) still open.

Root ran the newly merged baseline: `npm run typecheck` passed and `npm run test:unit` passed474 tests across72 files (7.12s). These machine results do not resolve the reviewed behavior gaps or establish live construction, Gate J, V4 or user acceptance. The authority task does not depend on using the unaccepted live transport or verification tools.

## Accepted implementation dispatch

The [exact implementation plan](../../../superpowers/plans/2026-11-09-current-authority.md), corrected SHA256 `2095e964456c87c9b9e7c768ee080b4e49dfe1cd6a50e7596ba05d771096bad1`, passed [independent plan review](../reviews/platform-current-authority-plan-review.md) and [fresh clarification review](../reviews/platform-current-authority-plan-clarification-review.md). Root releases the plan's exact new modules/contracts/tests, runtime004, the contracts barrel and both protected build inventories/mutation tests, plus only the two new authority tables in the parent-storage disposable reset. A single GPT-6.1 Sol implementer owns these paths and the exclusive55441 lease. Production ingress, UI and financial application remain excluded.

Root pulled again to `c1f3605`, which adds only Gate J edge tests, then ran the original and edge suites:10 tests across2 files passed in26.76s. This is partial machine evidence, not resolution of the source-review findings. Discovery's separate `50481ad` corrective source/test candidate is under read-only review; it has not been merged or adopted by this task.

## Subsequent owner review and design checkpoints

Discovery's `50481ad456ab9884b484508d0e1200701efa5379` correction received a [fresh scoped review](../reviews/platform-discovery-gate-j-50481ad-review.md): all nine earlier findings remain open, with an additional current-assessment validation gap during uncertain settlement. The subsequently fetched `0471c92` adds tests without changing that production implementation. Passing merged edge tests therefore does not establish Gate J acceptance.

Experience's `f935df39cd574c13c0660ab227ade532d7a0743e` received a [fresh scoped review](../reviews/platform-experience-f935df3-review.md): the three earlier findings remain open, and approval can become available without matching successfully loaded review details. This is source-review evidence, not browser acceptance.

The future [pure synchronization classification design](platform-sync-classification-design.md) passed its [correction review](../reviews/platform-sync-classification-design-fix-review.md) after the [initial review](../reviews/platform-sync-classification-design-review.md). Accepted SHA256: `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`. It preserves existing `planBatch` monetary behavior and uses compiler-owned additive output. This is design only; no classification or financial application implementation has been dispatched.

Main advanced to `6c7d4b4` through PR20 (CI workflow, installer and guidance only). Root fetched it while the authority implementer held the database lease; integration into this branch waits for the clean code checkpoint. No provider setup, live model call or branch-protection change was performed.

## Implementation candidate

Candidate `ad13e2fe87abeb03cfd1f2ab15eac19dc413ebaa` implements the internal current-authority service, durable head and immutable command audit. The [implementation report](platform-current-authority-implementation-report.md) records typecheck, 488 unit tests and 84 bounded integration tests passing, including 35 authority cases. Independent exact-candidate review is pending; authenticated product ingress and financial application remain excluded.

Main subsequently advanced to `89cf0bd` through PR11 (the approval UI branch). The separate review-details PR14 remains unmerged and retains the findings above. New PR21 adds request-investigation schemas; PR22 corrects malformed tool-argument error mapping. They are separate owner candidates and have not yet received integrator acceptance.
