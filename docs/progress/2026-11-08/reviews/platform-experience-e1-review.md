# E1 exact-candidate integration review

Candidate `814584ec3ad77199afae9da4a56dd3bd8a990070`, base `d772e9f`, four-file supplied diff. Read-only source review against accepted A4/A5 control/worker seams at the integrator checkpoint. No source or Git mutations, checkout, tests, browser run, or database commands. This report is the only written artifact.

## Actionable findings

### [P1] Supply the required decision context before enabling approval

`apps/web/src/features/connections/ReviewPage.tsx:31` and `:113–127`.

The page explicitly says it does not show the amount still owed, allowed operations, or limits, yet enables the approval action from `ready` and blockers alone. E1's first checklist item and PRD §14 require evidence, amount still owed after proposed import, future allowed operations/limits/stop conditions, and artifact/profile version in the decision experience. A hash and an instruction to inspect another page do not present the bounded authority being granted; there is no exact-package-linked evidence/preview or future scope here. The post-commit receipt balance arrives too late for that decision. Compose accepted exact-bound read data into the review, or escalate the missing safe read contract to its owner and withhold the approval-ready experience until that specified context is available. Do not invent authority values. This is missing implementation, not merely missing browser evidence.

### [P2] Preserve the original approval request across navigation and account changes

`apps/web/src/features/connections/ReviewPage.tsx:67`, `:105–110`, `:160`.

The approval key exists only in the keyed AccountReview component's ref. Select another account, visit Parent as suggested by the UI, or reload after a pending/lost response and that key disappears. Returning reads only the saved review package and the next click creates a different key. A4/A5 recovery deliberately finds the committed intent by the original key before revalidation. With a new key after a worker commit, revalidation instead returns ALREADY_ACTIVE; when publication was pending it can create another intent rather than retry the original one. Server protections prevent duplicate financial application, but the promised same-approval/receipt recovery path is lost. Retain/recover the exact request and key through these ordinary transitions, scoped to the approved customer/package, and verify a pending or lost response followed by navigation and retry returns the original receipt. A saved approval must not be automatically resubmitted.

### [P2] Keep stale approval blocked until a successful replacement read

`apps/web/src/features/connections/ReviewPage.tsx:99–103`, `:113–125`.

Both prepare and reload clear `stale` before obtaining a replacement package. Reload keeps the old package, does not use `busy`, and `canApprove` ignores `loading`, so clicking Reload immediately re-enables approval of the known-stale package while its GET is pending. If either refresh fails, the stale package remains approvable indefinitely. Keep the stale gate and disable approval through refresh; clear it only after a successful reviewed replacement and do not leave the old package actionable on failure. Backend validation still protects mutations, but this breaks the required stale review/reload interaction.

### [P2] Recognize the actual transactional stale conflict code

`apps/web/src/features/connections/ReviewPage.tsx:55–57`.

`staleError` recognizes REVIEW_STALE, but the accepted repository's `savePreparation` and `commitIntent` use 409 STALE_REVIEW when a concurrent preparation changes the head between the initial read and transaction. That real stale race takes the generic error path, leaves approval enabled and offers no Reload saved package action. Handle both accepted stale codes and test the repository-race response, not only preflight REVIEW_STALE. This is separate from the premature clearing defect above.

### [P2] Consume renewed session grants in the new review page

`apps/web/src/features/connections/ReviewPage.tsx:135–143`; integration at `apps/web/src/App.tsx:66–68`.

ReviewPage reads the session once. On a 401 the shared client clears the cached session and App renews it, but App retains the mounted page and passes no renewed session. The account list and selected review therefore keep the prior grants after a control restart/catalog change; removed accounts remain listed and newly granted accounts cannot be selected without remounting. Pass the current App session or observe renewal, invalidate unauthorized selection and refresh applicable reads. Server authorization continues to protect scope; this is capability/recovery correctness. The earlier ParentView session-renewal P2 is **unchanged**: ParentView is not edited and App still mounts it without a session prop. The new page repeats the same defect.

## Positive integration checks

- Direct schema-module imports preserve the browser-safe pattern. Account IDs are validated and encoded; review packages and receipts reject a different account.
- ActivationRequest construction binds displayed package, artifact, profile and target-version values with a generated key. Shared requestLocal supplies same-origin credentials, no-store and CSRF. No automatic mutation retry or approve-all path appears.
- An in-flight ref prevents rapid double submissions within one mounted instance. Same-package retries within that instance preserve the key.
- Pending responses validate package/key and render separately from receipts; only a parsed receipt yields the applied state. Replay is visibly distinguished. The accepted server validates and records the authoritative receipt before returning it.
- Diagnostics use the existing safe API-error display; no protected verification truth, service credentials, model calls or parent-write client was introduced.

## Verdict and evidence boundary

**Specification: not accepted as E1 complete.** Required approval context is absent and actual parent-import browser acceptance is unavailable. Existing ParentView can inspect parent records/initial receipt separately, but this candidate supplies no actual imported-state proof.

**Quality: changes requested** for the bounded recovery, stale handling and session issues above. Focused tests in the diff exercise request bodies, schemas and static render strings; they do not mount the page or prove key lifetime, double-click behavior, refresh races, session renewal or integrated parent state.

No builder report, exact-candidate typecheck result or real browser evidence was supplied. Independently running tests against the integrator worktree would test different code and unrelated evaluator WIP, so none were run. E1 still needs its required real reviewer → control → worker → PostgreSQL browser proof: one customer imported/other inactive, double click and retry yielding one receipt, pending/lost-response recovery, stale reload, unsupported terms blocked, original parent records inspectable, and joint approval-clarity acceptance. These missing results are evidence gaps, not claims that an unrun suite failed. This review grants no full V3, live, financial or user acceptance.
