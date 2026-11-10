# Task 3 implementation report

Base `3849482aedb44cdc8c263003976a9a5561af46d0`. Candidate `9aeeb981e2d9ec0a6c54ed7008ee06652e631301` on `codex/platform-sync-selection`. Commit subject `feat: route captured work through committed profiles`.

## Scope

The commit changes only `apps/worker/src/sync/selection.ts` and `apps/worker/test/sync-selection.test.ts`. The existing Task 2 guard logic and tests are preserved. Added the planned internal cut and routing DTOs and the exact `routeSelectionCut` boundary.

The router joins the full detached corpus to each selected subject's approved artifact contracts, immutable approval baseline, own lane checkpoint and exact inbox membership before account filtering. Shared bindings preserve all applicable consumer pins. Distinct approved contract hashes remain independently checked. An unassignable applicable contract fails closed. Inactive authority still takes part in applicability and retains exact known routes. Routes preserve raw identity and the full delivery reference. An unselected bundled profile never grants an enrolled route.

The untouched compiler result is retained per subject for the full applicable corpus at the inspection instant. Explicit source guards carry exact indexed causes, the compiler's real stop reason and referenced holds. A source guard blocks the whole inspected source even when a different binding has a passing classification. The selector distinguishes these from foreign-profile ordinary holds, exact-subject semantic and inactive holds, raw unknowns, and mapping failures. Unknown source binding and empty enrollment are explicit incomplete reasons. A whole-classifier input overflow returns `limit`. Where a cut exposes multiple incomplete conditions, the single route result reports classifier limit first, unknown source binding next, and the guard reason otherwise, retaining the independent guard diagnostics.

Task 6 owns proof of canonical delivery uniqueness and complete relevant own-lane coverage, including the exact affected identity/lane/stream for cross-lane gaps before a cut is ready. Task 3 does not infer coverage from another lane or replace a subject's committed baseline. Task 4 owns unfinished financial classification, closure and proposal selection.

## Focused machine evidence

| Check | Result | Raw output |
| --- | --- | --- |
| RED `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'routing_'` | Exit 1. 13 behavioral assertion failures against the compilable scaffold, including no routes instead of five exact delivery routes and null instead of required incomplete reasons. 26 guard cases were deselected by the filter. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-3-red.log` |
| GREEN `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'routing_'` | Exit 0. 16 routing cases passed, including three additional checks for distinct contracts and an independent binding under mapping versus source-wide blockers. 26 guard cases were deselected by the filter. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-3-green.log` |
| `npm run test:unit -- apps/worker/test/sync-selection.test.ts` | Exit 0. 42 passed without skips. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-3-selector.log` |
| `npm run typecheck` | Exit 0. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-3-typecheck.log` |
| `git diff --check` for the reserved paths | Exit 0. | Confirmed before commit. |

## Self-review and handoff

Reviewed the scoped diff against the brief. Repeated lane memberships yield one route from the unique delivery inventory. Separate equal-economic event IDs stay distinct. The full source classification can retain foreign-account holds alongside an exact known peer route. The semantic test proves changed-then-return history still holds a subject and baseline evidence is excluded only from the subject for whom it is baseline. The independent-binding case asserts both a valid classifier result for that subject and propagation of a genuine source guard to all source identities. Tests use public synthetic input and do not establish enrollment. No database, provider, demo, genuine Task 9, whole-slice or joint acceptance checks were run. Genuine separate-feed, API cross-stream and fixture variant dependencies remain open.

The two source paths are released to root for fresh exact-candidate review. Concurrent documentation work was outside the commit.
