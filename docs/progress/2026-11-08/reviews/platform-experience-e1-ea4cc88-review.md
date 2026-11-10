# E1 correction review — ea4cc88

Candidate: `ea4cc88a6ec9f2e039689feea35b505e342ce649`, correction parent `6bb3645`. Scope: supplied `/private/tmp/eapr-experience-e1-ea4cc88.diff` and complete candidate files read with `git show ea4cc88:path`; comparison with the five findings in `docs/progress/2026-11-08/reviews/platform-experience-e1-review.md`. No checkout, source changes, tests, browser run, database commands, or developer/GitHub messages. This report is the only written artifact.

**Specification verdict: E1 remains incomplete / not accepted. Quality verdict: changes requested.** Three findings are addressed by source inspection, one is partially addressed, and the decision-context P1 is unchanged. No additional unrelated defect is raised.

## Disposition of the five original findings

| Original finding | Disposition | Exact candidate evidence |
| --- | --- | --- |
| P1: Required decision context before approval | **Not addressed** | `apps/web/src/features/connections/ReviewPage.tsx:11–32,139–155`. The unchanged view shows hashes and explicitly says amount still owed, operations and limits are absent. Approval still depends on package readiness/blockers, not on displaying the required exact-bound context. |
| P2: Preserve original approval across navigation/account changes | **Partially addressed; not fully closed** | `ReviewPage.tsx:60–74,86–89,129–136`. The complete request is saved before submission in sessionStorage, and an unchanged package restores it after remount/reload. Explicit retry reuses that request; effects do not automatically submit. However, restoration is conditional on the latest package ID/hash, leaving the recovery gap below. |
| P2: Keep known-stale approval blocked during failed/pending refresh | **Addressed by inspection** | `ReviewPage.tsx:86–104,124–126,139–154`. Only successful `accept()` clears stale; load failure retains it. Approval checks loading and busy, and refresh/prepare controls are disabled while running. The original premature-clear route is removed. |
| P2: Recognize transactional STALE_REVIEW | **Addressed by inspection** | `ReviewPage.tsx:55–57,118–120` now handles both `STALE_REVIEW` and `REVIEW_STALE` at 409. Candidate repository emits `STALE_REVIEW` at `apps/control/src/review-repository.ts:143–144`. |
| P2: New review page consumes renewed grants | **Addressed by inspection** | `apps/web/src/App.tsx:68` passes the current App session. `ReviewPage.tsx:163–180` derives account options/valid selection from it, and `:107–111` refreshes the selected account when session changes. Removed accounts unmount their review. |

“Addressed by inspection” is not a mounted-UI or browser-pass claim.

## Remaining actionable findings

### [P1] Complete the exact-package decision experience before enabling approval

Candidate `apps/web/src/features/connections/ReviewPage.tsx:31,139–155`.

This is the original finding, unchanged. PRD §14 and E1 require the saved financial preview/amount still owed, applicable evidence and decisions, readable future operations/limits/stop conditions, and artifact/profile version identity before the explicit decision. The candidate still enables approval with only hashes and a generic instruction to inspect other pages. The actual candidate client only calls the package GET, prepare and activate routes (`packages/client/src/review.ts:29–63`); it does not consume package details or compose exact-bound evidence.

The immutable decision-context backend exists in the integrator's local PR13 work but was not merged into this candidate's base. That producer dependency explains the missing consumption; it does not make this UI E1-complete, nor justify claiming that it already uses the local backend. Integrate the accepted safe producer and render its exact-bound data, or keep the approval-ready experience withheld until the required context is available. Do not invent financial values or authority. Review/receipt data after commit does not replace the pre-approval context.

### [P2] Keep unresolved saved requests recoverable independently of the latest package

Candidate `apps/web/src/features/connections/ReviewPage.tsx:65–66,86–88,131–132`.

The new persistence fixes ordinary same-package navigation, but `loadSavedApproval` returns no request whenever the current GET returns a different package. `accept()` then clears the in-memory saved request, and the next approval generates a new key and overwrites the sole account storage entry. A pending/lost-response intent followed by a new prepared head and navigation/refresh therefore still loses its explicit same-approval recovery path. This can occur when another reviewer/preparation advances the head while the old intent is pending. It is a residual limitation of the correction, not a duplicate-economic-effect claim.

The accepted candidate server intentionally resolves an existing exact request before reading/revalidating the current head (`apps/control/src/activation-review.ts:20–36`), and delivery resolves its scoped worker receipt first (`apps/control/src/activation-delivery.ts:29–33`). Restricting recovery to the latest displayed package prevents the UI from reaching that supported path. A new request instead enters revalidation and can return `ALREADY_ACTIVE` (`apps/control/src/review-preparation.ts:61–64`) after the old request committed.

Preserve unresolved requests by their approved account/package identity and offer an explicit recovery action labeled with that original package, independent of the new-candidate approval action. Do not attach the old approval to a new package, overwrite it merely because a newer head exists, or automatically resubmit. Add a mounted interaction test covering pending/lost response → newer head → remount/reload → explicit retry with original request/key → original receipt.

## Separate pre-existing ParentView finding

The original ParentView renewed-session P2 remains open and is not a new correction regression. `apps/web/src/App.tsx:67` still renders `<ParentView />` without the session, and candidate `apps/web/src/features/connections/ParentView.tsx:175–188` independently loads session only on its own attempt changes. Fixing ReviewPage does not close ParentView's stale-grant issue.

## Evidence limits

The correction changes only App.tsx and ReviewPage.tsx; it adds or changes no UI tests. Existing `packages/client/test/review.test.ts` checks client requests/responses and static component markup, not mounted AccountReview state, storage/navigation lifetime, stale refresh races or renewed-session behavior. No candidate typecheck, test result or browser result was independently produced in this review, and none is inferred from code inspection.

E1 still needs real reviewer → control → worker → PostgreSQL browser evidence for one imported/other inactive customer, double-click and retry with one receipt, pending/lost-response recovery, stale reload, unsupported terms blocked, original parent inspection, and joint approval-clarity acceptance. Missing evidence is not an assertion that an unrun suite failed. This report grants no V3, live construction, ongoing synchronization, financial or joint user acceptance.
