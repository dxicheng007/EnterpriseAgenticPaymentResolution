# Experience correction review — f935df3

Candidate: `f935df39cd574c13c0660ab227ade532d7a0743e`, compared with `be39242ec4bae5996a12b3177da64a4d26e2fbd2`. Scope: supplied `/private/tmp/eapr-experience-f935df3-correction.diff` (ReviewPage and two client test files), exact candidate context, and narrow accepted integration dependencies. Prior findings: `docs/progress/2026-11-08/reviews/platform-experience-details-be39242-review.md`.

**Specification verdict: FAIL / E1 incomplete. Quality verdict: changes requested.** None of the three assigned findings is closed. A new approval-gating regression makes the decision-context gap worse. Helper extraction and additional static/unit assertions do not implement the requested corrections.

## New regression

### [P1] Restore the exact-details prerequisite for approving a package

Primary candidate location: `apps/web/src/features/connections/ReviewPage.tsx:263`. Supporting locations: `166–175`, `222–233`, `270–281`.

The previous predicate required `detailsFor !== undefined`; the new `canApproveReview()` has no details input and the call drops that prerequisite. After a ready package loads, `loading` becomes false while its details GET remains pending; the approval button is enabled. The same occurs after a details network/503/validation failure. Thus an explicit click can submit the financial/standing-authority decision without even the before/after balance and scope context supplied by the previous candidate. The displayed failure guidance at lines 272–273 falsely says approval stays unavailable. A new head likewise permits approval before its matching details arrive.

Restore an exact selected-package details prerequisite (and keep the required evidence/identity/stop-condition completeness from the prior P1). Test the mounted decision path with a delayed, failed, mismatched and then successful details read; helper booleans alone cannot establish this behavior. This is a new regression, not a backend authorization-bypass or duplicate-money claim.

## Disposition of the three prior findings

### 1. [P1] Inspectable field/identity evidence and readable stop conditions: OPEN, worsened by the regression above

Candidate locations: `apps/web/src/features/connections/ReviewPage.tsx:35–38,54–55,65–83`; tight primary location `75–83`.

`ReviewDetailsView` is unchanged. It renders operation summaries and comma-separated evidence IDs, but no per-field plan lineage, approved identity lookup decisions, or exact-bound citation/original inspection. Frozen safety-rule and validator identifiers remain unexplained. No new evidence client composition appears in this correction. Consequently a reviewer still cannot inspect the source-to-parent field/identity basis or understand the hold/pause conditions from this view.

PRD §14, implementation-plan T3.2, and the accepted immutable-details design require these presentations. The design expressly provides the fixed wording and assigns Experience composition of existing authenticated evidence reads with exact snapshot/citation binding and visible availability errors. This is specified work using available backend data, not a request to invent policy. Complete those presentations and preserve the prerequisite before a new approval is enabled.

### 2. [P2] Preserve original unresolved request after a newer head: OPEN, unchanged

Primary candidate location: `apps/web/src/features/connections/ReviewPage.tsx:134–135`. Supporting locations: `123`, `145`, `195–198`, `251–256`, `275–281`.

Storage still has one entry per account, and `loadSavedApproval()` still returns the stored request only when its package ID/hash match the current head. Pending/lost reply → newer preparation → remount therefore discards the original request from component state. The next approval mints another key and overwrites the account entry. There is no separately labeled original-package recovery action. `nextApprovalRequest()` only preserves an already supplied request; it cannot recover the request that this loader filtered out.

The accepted server supports the missing recovery: exact candidate `apps/control/src/activation-review.ts:20–36` resolves an existing key and validates the complete original request before consulting the current head. Keep unresolved original requests independently of current head selection, expose explicit original-request recovery, and never attach that old request to approval of newly displayed details. Cover the pending/lost response → newer head → remount → explicit original retry → original receipt sequence. This remains a recovery defect; no duplicate economic effect is asserted.

### 3. [P2] Retry failed details for an unchanged package: OPEN, unchanged mechanism

Primary candidate location: `apps/web/src/features/connections/ReviewPage.tsx:233`. Supporting locations: `222–232`, `246–249`, `272–281`.

The details effect still depends only on account, package hash and session. A failed GET sets `detailsError`; there is no read-only retry action or retry trigger. Prepare can return the same hash, as exact candidate `apps/control/src/review-repository.ts:129` deliberately returns the saved review when the fingerprint is unchanged. Prepare/Reload therefore cannot retry this details read for unchanged inputs. Navigation/remount remains the workaround. The new ability to approve without details does not correct this defect; it replaces the previous disabled-button symptom with the P1 regression above.

Add an intentional read-only retry for the immutable selected account/hash, retaining response binding and abort safeguards. Verify service failure → recovery → retry success without package replacement or any new approval.

## Exact binding, storage and session inspection

- The client details reader is unchanged and still validates selected account, package ID and hash (`packages/client/src/review.ts:40–49`). The effect abort check and matching-hash display remain (`ReviewPage.tsx:222–233,261`). Those checks no longer constrain the approval button.
- Storage now has an injectable adapter and safely handles unavailable/throwing sessionStorage (`117–154`). Normal same-package requests retain their original key; storage helpers do not submit requests. This is useful testability, not the requested newer-head recovery. `nextApprovalRequest` relies on its caller supplying a matching request; the production caller continues to use the current loader. No additional newly introduced storage-binding defect was established.
- Both stale spellings and policy/attestation mismatch codes remain recognized (`108–112`). Loading, busy, stale, blocker and applied-outcome gates remain (`174–175`); only successful `accept()` clears stale (`195–198`). The in-flight guard remains (`235–243`). No new stale-refresh defect was established.
- The renewed-grant selection helper preserves the prior behavior (`179–180,289–306`). Review and details effects depend on session (`220,233`). Unchanged App passes renewed session to Review and Parent (`apps/web/src/App.tsx:67–68`); Parent selects only current grants and refreshes both reads on session changes (`ParentView.tsx:114–138,175–193`). No new session-selection regression was established. This is source inspection, not a mounted renewal result.

## Test quality and evidence boundary

The new review tests exercise pure helpers and independently server-rendered page instances (`packages/client/test/review.test.ts:135–211`). The gate test at line 173 specifically expects approval eligibility without any details argument. Storage tests cover the same package and explicitly expect changed ID/hash to be discarded (`145–161`); they do not cover independent original-request recovery. The purported failed-refresh scenario supplies booleans to the helper rather than exercising a failed refresh. The renewed-session test starts with the default empty selection in each server render; it does not mount an account, change grants, or test cancellation. Parent's new test likewise renders separate empty-selection page instances (`packages/client/test/parent.test.ts:208–223`).

The correction also removes the previous details rendering and exact-route/response-binding test cases. These removed tests were limited, but their removal supplies no evidence for the three corrections. No new mounted AccountReview test, real evidence inspection, details retry, or newer-head recovery flow was found in the changed files.

Read-only review; only this temporary report was written. No checkout, source/Git edits, test execution, database commands, browser interaction, subagent dispatch, or external messages. Root's unrelated authority WIP was not reviewed. Exact product files were read with `git show`; repository guidance, the prior review and accepted design/specification documents were consulted as review context. No passing or failing test execution is inferred. No E1/V3, live construction, financial, ongoing-sync, browser or joint user acceptance is granted.
