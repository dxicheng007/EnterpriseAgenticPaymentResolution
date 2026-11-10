# Experience PR14 exact-candidate integration review

Candidate: `be39242ec4bae5996a12b3177da64a4d26e2fbd2`. Integration comparison: `aafe7ae`, restricted to the five web/client files in `/private/tmp/eapr-experience-details-review.diff`. Candidate files were read with `git show`; accepted local review-details contracts, producer, routes, preparation/recovery behavior and authoritative specifications were inspected as integration dependencies. The unrelated root capture work was not reviewed.

**Specification verdict: E1 incomplete / not accepted. Quality verdict: changes requested.** The new exact-package details read and financial summary are useful progress, but the original decision-context P1 and newer-head recovery P2 are not fully closed. One new details-read recovery defect is identified below. The earlier stale-code, stale-refresh and review-session corrections remain addressed by inspection; the separate ParentView renewed-session finding is now addressed by inspection too.

## Actionable findings

### [P1] Present inspectable evidence and readable stop conditions before enabling approval

Candidate `apps/web/src/features/connections/ReviewPage.tsx:35–38,54–55,65–83,207–210` (tight primary location: `75–83`).

The original absence of balances and limits is corrected: this candidate loads the immutable package details and gates approval on a matching details hash. However, it still reduces source evidence to comma-separated IDs, omits the plan's per-field lineage and approved identity lookup entries, and never opens a citation or original. The operation label contains only operation kind, record ID, optional amount and effective time; it cannot show the source-to-parent field/evidence relationship. The future authority section prints `identity-bound-scope`, `reviewed-semantic-version`, and validator identifiers without their human-readable hold/pause meanings. A reviewer can therefore approve without the specified citations/identity decisions or an understandable explanation of when automatic application stops.

This is a remaining implementation gap, not a request for unavailable backend data. PRD §14 and implementation plan T3.2 require source-to-parent preview, citations/identity decisions and readable limits/stop conditions. The accepted `platform-review-details-design.md` explicitly assigns Experience both the fixed rule explanations and composition of authenticated evidence reads, with exact citation ID/snapshot checks and visible availability errors. The accepted `ReviewDetailsV1` already supplies `profile.approvedLookups`, `proposedImport.lineage`, the pinned evidence snapshot/IDs and frozen rule vocabulary. Render those associations, provide exact-bound citation/original inspection, and translate the frozen vocabulary without inventing policy. Keep the decision experience incomplete until the required context is available. Existing React text rendering escapes the strings; this finding is about missing evidence inspection and decision meaning, not an observed injection vulnerability.

### [P2] Preserve unresolved approval recovery independently of the current package head

Candidate `apps/web/src/features/connections/ReviewPage.tsx:114–119,141–144,197–201` (tight primary location: `118–119`).

This residual finding from the `ea4cc88` review is unchanged. `loadSavedApproval()` restores only a request whose package ID/hash equal the latest package. After a pending or lost-response approval, another preparation can advance the head. Navigation/reload then reads that newer head, drops the old request from component state, and the next approval creates a new key and overwrites the sole account storage entry. Even before another click, the UI offers no explicit way to recover the original intent/receipt.

The accepted server deliberately checks `readIntentByKey()` and the complete existing request before reading or revalidating the head (`apps/control/src/activation-review.ts:20–36`), so recovery of the original request remains supported after a new head. Preserve unresolved requests by approved account/package identity and expose an explicit recovery action labeled with the original package, separately from approving the new package. Do not automatically resubmit or attach an old approval to new displayed details. Cover pending/lost reply → newer head → remount → explicit original-request retry → original receipt. This is a recovery defect, not a claim of duplicate financial application.

### [P2] Allow retrying a failed details read for an unchanged package

Candidate `apps/web/src/features/connections/ReviewPage.tsx:168–179,219–226` (tight primary location: `179`).

If the details GET has a transient network/503 failure, `detailsError` remains set and approval correctly stays disabled. There is no retry-details action. The visible Prepare action calls `accept()` again, but the details effect depends on `reviewPackage?.hash`, not a retry counter or package object. The accepted repository intentionally returns the same package when its preparation fingerprint is unchanged (`apps/control/src/review-repository.ts:129`), so a successful Prepare after the dependency recovers does not issue another details request. Reload, where available because of an earlier stale failure, has the same limitation if it returns the same hash. The user remains blocked on the old error until they discover a navigation/remount workaround.

Add an explicit read-only retry for the selected immutable account/hash (or another intentional retry trigger), retain exact-binding and abort safeguards, and verify failure → service recovery → retry success without changing the package or requiring a new approval. This is new to the details integration.

## Disposition of earlier findings

| Earlier finding | Candidate disposition |
| --- | --- |
| Required decision context | Partially addressed: exact-bound before/after balances, proposed operations summary, terms, version identity and numeric limits now appear; inspectable field evidence/identity decisions and readable stop conditions remain missing as above. |
| Original approval survives navigation and newer head | Same-package sessionStorage recovery remains; newer-head residual remains unchanged as above. |
| Keep known-stale package blocked during pending/failed refresh | Addressed by inspection: `accept()` alone clears stale; `canApprove` checks loading/busy/stale (`141–159,209–210`). Failed refresh does not itself clear stale. |
| Recognize transactional `STALE_REVIEW` | Addressed by inspection: both stale codes remain recognized (`108–110`). |
| Review consumes renewed grants | Addressed by inspection: App passes its session, allowed-account selection derives from it, and review/details effects refresh on renewal (`App.tsx:68`; `ReviewPage.tsx:162–179,236–253`). |
| Separate ParentView session renewal | Addressed by inspection: App passes session (`App.tsx:67`); ParentView derives current account options and rejects unauthorized selection (`ParentView.tsx:175–193`); both selected-account reads depend on session (`114–138`). |

“Addressed by inspection” does not assert a mounted UI test or browser pass.

## Positive integration observations

- `packages/client/src/review.ts:40–49` calls the accepted authenticated immutable account/package-hash route, parses the browser-safe strict details schema and rejects mismatching account/package ID/hash. The schema also checks the returned projection's internal scope/hash/version/evidence bindings. No latest-details fallback or protected companion exposure is introduced.
- Details effects abort obsolete responses; the render and approval gate require the selected package hash (`ReviewPage.tsx:168–179,207–210`). A failed or absent initial details read does not enable approval.
- The saved prepared balance uses `baseline.balanceCents` and `proposedImport.expectedBalanceCents` at the plan's evaluation time, labeled as proposed rather than a worker receipt. No client-side financial recomputation is added.
- Approval remains explicit per customer, sends existing bound request fields, preserves the key for same-package retries, and has an in-flight guard. Pending and parsed worker receipt states remain distinct; no effect automatically submits an approval.
- The changed UI renders data as React text, imports schema leaves directly and adds no arbitrary URL/HTML rendering, model calls, worker credentials or parent-write client.

## Verification and evidence boundary

Read-only commands inspected the supplied diff, exact candidate files, both prior E1 review reports, repository/area instructions, PRD and frozen contracts, accepted review-details design/report, and current accepted backend seams. Only this temporary report was written. No checkout, source/Git mutation, tests, database commands, browser interaction, subagent dispatch, or developer/GitHub messages were performed.

The candidate's `packages/client/test/review.test.ts` adds static details rendering and exact-route/response checks (`126–143`). These do not mount AccountReview, exercise the approval gate, inspect a real citation, test details retry, newer-head storage recovery, stale refresh races or renewed grants. The empty operations/terms/lookups fixture also cannot demonstrate field-evidence or identity decision rendering. No test failure or passing result is inferred from this source inspection; no exact-candidate execution packet was produced here.

E1 still requires real reviewer → control → worker → PostgreSQL browser evidence for one imported/other inactive customer, double-click/retry producing one receipt, pending/lost-response recovery, stale reload, unsupported terms blocked, and original parent-record inspection. Joint approval-clarity acceptance remains pending. This report grants no full V3, live construction, ongoing synchronization, financial or joint user acceptance.
