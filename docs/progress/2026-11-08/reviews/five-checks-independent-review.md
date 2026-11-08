# Independent review: five evaluator checks

**PASS — specification and code quality. No actionable findings.**

Reviewed base `3483d6b284901bfb56153c510b97196371d5b386` to exact candidate `38660d7d8de296456d0897066f222de095254488` in the clean detached checkout `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`. Read root, packages, evaluator and tests guidance, the exact `c-next-five-checks.md` requirements, implementation handoff, and supplied diff. No repository modifications or commits.

The five checks exercise the supplied artifact and profiles. Expected records come from protected facts and independent recipes/reference calculations. The new reversal cases preserve original funding and allocations, verify balances of 80,000 before effect, 280,000 after payment reversal and 100,000 after credit reversal, replay without a second effect, reject unsupported reversal shapes and hold later reallocation. Dependency, raw-schema and semantic-version cases require exact holds and unchanged affected records. Source-specific schema fields are independent of candidate mappings.

Snapshot coverage validates the original bound capture and seven adversarial copies, then executes actual candidate planner inputs at each stream's own next cursor, including semantic streams. Independent post-state supplies financial replay expectations. Capture validations and planner runs are counted separately, and validation-only cases contribute no financial event kinds. The complete profile matrix is preflighted before execution; any inapplicable profile zeros the entire check. Required-case removal is rejected before launch. New executable capture code participates in the evaluator build hash. Existing immutable pin/report behavior and the unavailable evidence-support check remain intact. Scope excludes worker persistence, live continuation and activation; no runtime-worker changes or model dependencies were introduced.

Observed verification on Node 24.22.2:

- `npm run test:unit -- packages/evaluator/test/cases.test.ts`: 12/12 passed, including real subprocess reversal, dependency, schema drift, semantic drift, snapshot boundary, missing-case rejection and build hash checks.
- Observed A case totals: full reversal 8 planner; dependency 4 planner; schema drift 3 planner; semantic drift 3 planner; snapshot boundary 3 planner plus 8 capture validations. Snapshot event-kind coverage is payment only, as expected; semantic and capture validation actions add no monetary kinds.
- Independent scratch probe `work/five-checks-probe.mts`: supplied a valid snapshot and a two-profile matrix with an unsupported second profile. All five new checks returned unavailable/cases 0, with plannerExecutions 0 and captureValidationExecutions 0. This closes the specific test gap that the repository's existing matrix test omits the snapshot argument.
- `npm run typecheck`: passed.
- `git diff --check 3483d6b284901bfb56153c510b97196371d5b386 HEAD`: passed.

The first focused Vitest attempt hit the sandbox's cache-write restriction; a scoped approved escalation reran it successfully. The standalone tsx CLI probe hit its IPC restriction; invoking Node with tsx's loader completed without escalation. These were execution-environment restrictions, not candidate failures.

Limits: this independent pass did not repeat PostgreSQL/HTTP integration or the entire regression suite. The exact-candidate implementation handoff reports those separately. Generated A 80,000/B 0 and B's receipts/files/semantic cursor coverage were reviewed in the integration diff and implementation, not freshly observed against PostgreSQL here. No database was started, stopped or modified, and no fixture pins were touched. This is an independent review of the bounded five-check increment, not joint user acceptance or eligibility approval.
