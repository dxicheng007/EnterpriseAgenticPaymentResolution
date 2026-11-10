# Experience E0 PR8 exact-candidate review

Reviewed base `af7b083f404c4cc1ebe5cd14d5b691063997242c` to head `ad2a1d17806179c7f32d2806c066e7eb8198d656`. Read the supplied diff first, then candidate files using `git show`; did not check out, edit source, run tests, or use the active worktree's A4 implementation as candidate evidence.

## Actionable finding

**[P2] Refresh ParentView's session grants when the app renews the reviewer session** — `apps/web/src/features/connections/ParentView.tsx:180–188` (especially the effect dependency at line 188).

The new view reads `getLocalSession()` only on its initial mount or its own bootstrap-failure retry. On a parent/activation 401, `requestLocal` clears the cached session and App's expiration listener bootstraps a new session, but App keeps rendering the same ParentView instance and does not pass that refreshed session into it. Consequently this view keeps the old `allowedAccountIds` and selected inspection. This is observable after a control restart with a changed registered-account catalog: the header has a fresh session, while the parent selector still offers removed accounts and never offers newly granted accounts until navigation/remount. If the activation request was the one that failed, its error also remains latched because that effect depends only on accountId; applying selectors cannot recover it. Server authorization still protects the reads, so this is a UI capability/recovery defect, not an authorization bypass.

Use the current App session as a prop, or subscribe to session renewal and update/invalidate the local selection and reads on session identity changes. Clear accounts that are no longer authorized. A component/browser regression should expire the initial session, bootstrap a replacement with different account grants, and verify the options/selection and read recovery without navigating away. This is a concrete session-lifecycle issue within E0's requirement to preserve session-expiry behavior; it does not require approval/activation features.

## Specification and quality assessment

- Parent reads are GET-only, encode account IDs, validate and normalize both selectors independently, reject substituted explicit hashes/evaluation instants, and retain shared same-origin/no-store/error/cancellation handling.
- Activation reads accept no selectors. The browser-safe copied activation schema currently matches the candidate's canonical ActivationStateV1 schema, including null pairing and scope/identity/epoch/artifact checks. Duplication is a maintenance concern rather than a present schema acceptance defect; a shared browser-safe schema would avoid drift, subject to ownership approval.
- The UI displays version-zero/null-pair state as not imported, does not infer activation from balance, and displays evaluation time separately from stored record time/hash. Missing historical snapshots remain errors rather than latest-state fallbacks.
- Account changes remount the inspection and abort both outstanding reads; selector changes abort/restart only the parent read, as the browser specification intends.
- Record display is deliberately shallow: billing configurations show only IDs, allocations/reversals omit their target links, and legacy references omit source/version fields. Those are useful later inspection improvements, but the E0 wording does not precisely require a complete field inspector, so I do not classify them as blocking defects or invent product scope.

## Evidence gaps and completion boundary

- Author-reported typecheck and focused parent units passing are reports, not independently rerun evidence in this review.
- The actual inactive-read browser test has not been run. E0 explicitly requires `npm run test:e2e -- tests/e2e/v3-parent-read.spec.ts` after navigation mount; E0 cannot be marked done from this static review and rendering/client units alone.
- The planned browser test uses actual accepted control/worker composition, checks both inactive registered accounts, no-store GETs, distinct recorded/evaluation time, explicit asOf preservation, unavailable historical hash without fallback, and before/after runtime table equality. These are appropriate planned assertions, not observed results.
- The browser asOf reread asserts changed evaluation time plus unchanged records/hash/version but does not assert the reread balance in either response or DOM (`tests/e2e/v3-parent-read.spec.ts:77–85`). Add that assertion to strengthen the specified effective-time balance proof. Existing static rendering tests cannot establish that the mounted interaction updates the displayed balance.
- No browser session-renewal/grant-change scenario covers the actionable finding. Existing session-expiry units only establish the client's expiration notification.
- No CI or previous independent-review evidence was supplied. No database or test commands were run against the active shared worktree as instructed.

Recommendation: address the session-lifecycle defect and obtain exact-candidate inactive browser evidence before declaring E0 complete. This review is partial V3 evidence only; it grants no activation, imported-state, live, financial, or joint user acceptance.
