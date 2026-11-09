# Guided preview terminology implementation plan

> For Sol: use `superpowers:executing-plans` for this single bounded task. No additional subagents. Start only after root accepts the `b1b5605` browser compatibility repair; root supplies the integrated base SHA. The user has requested this terminology work; no new approval question is needed.

**Goal:** Explain why source records are excluded from this customer's preview and what the displayed receivable means, without changing any financial or authority decision.

**Architecture:** Keep server responses and existing exact alias deduplication intact. Add a conservative presentation partition over existing consolidated holds and validated source coverage. Render the existing server balance with plain explanatory copy and the actual preview cutover date.

**Tech stack:** Existing strict TypeScript, React, Vitest and Playwright. No dependencies or schema changes.

**Spec:** `preview-terminology-task.md` in this directory; `docs/progress/2026-11-08/handoffs/guided-discovery-implementation.md`, global constraints and sections 3/4-C; repository financial/evidence invariants.

## Global constraints

- Original holds, severities, codes, event IDs, scopes, dependencies, diagnostics, unsupportedRows wire, financial outputs and hashes remain unchanged. New grouping is explanatory only, never an eligibility or approval decision.
- Coverage must remain bound to selected candidate/source/company/immutable snapshot. No classification from UNKNOWN_ACCOUNT alone, display names, fixture metadata, or protected truth.
- No new balance arithmetic, hardcoded demo money, inferred allocations, automatic profile construction, model activity, approval, activation, or backend behavior.
- Preserve event, operation and hold counts as separate dimensions. A source change is not a payment, invoice, or amount of money. Preserve the real empty-target and zero-write disclosures.
- This is terminology and its minimum supporting classification only. No broader layout, styling, routing, or polish project.

## Exact presentation copy

### Amount explanation

- Replace **Projected balance** with **Amount still owed after proposed import**. Render `formatUsdCents(diff.afterBalanceCents)` unchanged for that exact returned scope; preserve the accessible region `Balance diff for <accountId>`.
- Immediately below the amount: **“Unpaid invoice amount as of {asOf}, after applying payments and credits allocated to those invoices. Unallocated payments and credits do not reduce this amount.”** Pass `candidate.request.asOf` from PreviewPage, using the actual value. Do not substitute capture recording time, the current date, or a guessed cutover.
- In this explicitly empty development-target view, replace **Before · target v{beforeVersion}** with **Empty demo target before import**. Keep the actual `beforeBalanceCents` value and retain target version in inspectable details. Show: **“The demo target starts empty. Its starting balance does not describe the acquired customer's payment history or mean that nothing was owed.”** Do not apply this label to an arbitrary future nonempty target: pass the established empty-fixture context from the existing demo catalog/page into the presentation. A reusable component without that context uses **“Target balance before proposed import”** and does not claim an empty target.
- Show **“Preview only. No records have been imported.”** Keep the existing `Parent writes: 0` disclosure backed by the response. Do not imply the 11 operations have executed.
- Leave the existing **“proposed imports of existing records”**, record amounts, record JSON, field lineage, and allocation explanation reachable. Do not add the demo-specific $9,000 − $8,000 − $200 calculation to production copy.

### Records excluded from this preview

- Main heading: **“Records not included in this customer's preview”** for one supplied profile; **“Records not included in this preview”** for multiple profiles. Do not append a bare count to this heading.
- Intro: **“Some records belong to other documented source accounts. Others need investigation. These records remain held; this explanation does not clear their blockers.”** When there are no proven other-account holds, omit the first sentence rather than asserting other ownership.
- Selected-scope subsection: **“Issues affecting this customer”** (plural **“Issues affecting the selected customers”** when needed). Keep selected-scope holds open and their original severities prominent.
- Proven other-account subsection: **“Other accounts needing connectors”**. Explanation: **“These records belong to documented source accounts with no profile in this candidate. Each account needs separate connector construction, verification, and customer review. This does not mean its records or contract terms have been cleared.”** Show exact seller/account IDs and source names for each referenced group; retain buyer IDs and citations in the existing coverage cards.
- Remaining subsection: **“Records needing investigation”**. Explanation: **“These records could not be safely assigned to the other-account group. Inspect their original reasons and source evidence.”** For coverage absent/loading/failed/misbound, use **“Records not mapped by these profiles. Source-account ownership has not been established for this explanation.”** Retain source-coverage failure/retry and raw preview access.
- Preserve source-wide/additional diagnostics prominently as **“Preview-wide and additional issues”**, using the unchanged original diagnostic content and severity. A source-wide blocker remains visible even when every event has a documented account.
- Within each subsection, say **“{H} hold entries affecting {E} distinct source events”**. Compute E as the union of that subsection's hold event IDs, not the sum of per-hold lengths. A hold with no event IDs remains visible and counts as a hold. Do not claim subsection event counts are mutually exclusive or add them to operations to explain the capture total.
- Put implementation-only alias accounting under **“Technical hold details”**: preserve original hold-entry count, unsupported-row count, and exact matching-alias count, plus the existing inspectable original objects. Do not make the business-facing heading “Unsupported rows”. Do not remove or weaken raw reasons such as `Blocker · UNKNOWN_ACCOUNT`.
- In source coverage, retain complete captured/selected/outside totals and documented/unresolved distinction. Replace the terse count word **“semantic”** with **“source-change events”** and **“financial”** with **“financial events”**. Explain once: **“Source-change events describe changes such as contract amendments; they are not amounts of money.”** Keep related citations generic and amendments requiring separate terms review. Do not infer a document type from untyped relatedEvidenceRefs.

## Conservative partition — presentation only

Keep `previewIssues(result, profileScopes)` and its exact multiset alias deduplication as the source of consolidated original holds. Add one pure presentation helper in `preview-values.ts`, for example `partitionPreviewHolds(issues: ReturnType<typeof previewIssues>, coverage?: SourceCoverageSummary)`, returning original hold references in `selected`, `otherAccounts`, and `investigation` arrays. It must not mutate the input or create new authoritative holds.

1. Preserve `issues.selected` exactly: only an explicit hold scope equal to one of the supplied profile scopes qualifies for the selected-scope subsection. Match company, seller and account IDs exactly. Raw evidence membership never approves parent identity.
2. Start investigation with `issues.unresolved`. Never move scoped holds, IDENTITY_SCOPE, SEMANTIC_VERSION, or any non-UNKNOWN_ACCOUNT hold into other accounts, even if their event IDs happen to match documented outside accounts.
3. For each `issues.unmapped` hold, classify as other accounts only if **all** of these hold:
   - Bound, successfully validated coverage summary is available; the hold is unscoped, code is exactly `UNKNOWN_ACCOUNT`, and its distinct event-ID set is nonempty.
   - Every referenced event ID occurs in exactly one documented coverage account row and that row is supported by its identity citations. Membership comes from the existing exact company/source/seller/source-account join, never name matching or merely subtracting selected IDs.
   - Every matched account row has **zero** supplied matching profiles. Any included profile or competing profiles disqualifies the entire hold, including an undocumented event with a supplied profile.
   - No referenced ID is absent from coverage, undocumented, or ambiguously assigned. Do not classify based on the matching subset while ignoring other IDs.
   - No attached diagnostic has a code other than UNKNOWN_ACCOUNT or refers to event IDs outside this hold's member set. A broader diagnostic cannot be hidden behind an other-account explanation. Original diagnostic severities remain unchanged even for qualifying holds.
4. Every other unmapped hold goes to investigation. Examples: empty event set, coverage unavailable, one documented other event plus one unresolved/foreign/selected event, or a profile conflict. Show the single original hold once and retain all its member IDs. Optional existing group references may identify the known members, but must label the unassigned remainder explicitly; never clone the hold across subsections.
5. A hold spanning two documented accounts with zero supplied profiles may qualify, but is shown **once** with both account references. The account cards remain separate even when their names are identical. A documented source-change event may qualify for account membership; this does not clear its amendment or give it monetary meaning.
6. Keep `issues.additional` unchanged and independently visible. Keep the existing raw `unmappedHoldGroups` for references only where it is accurate; it is not sufficient to decide the all-members predicate because it currently reports intersections and can omit foreign members.

## Owned files and interfaces

- Modify `apps/web/src/features/preview/PreviewResult.tsx`: exact copy, explanatory partitions, original details, server amount and date/context props.
- Modify `apps/web/src/features/preview/PreviewPage.tsx`: pass actual request `asOf`, profile count and established empty-target context; no new fetch or lifecycle.
- Modify `apps/web/src/features/preview/preview-values.ts`: pure conservative presentation partition. Keep alias keys and financial formatter unchanged.
- Modify `apps/web/src/features/preview/SourceCoverage.tsx`: the narrow event-count copy above. `source-coverage-values.ts` only if minimally necessary to expose existing membership; no changed join semantics.
- Optional `apps/web/src/features/sources/review.css` only for minimal details/readability required by this copy; no redesign.
- Modify `packages/client/test/source-coverage-display.test.ts` and existing preview display tests as needed for new presentation. Client HTTP/schema behavior is unchanged.
- Check all three browser dependencies: `tests/e2e/v2-preview.spec.ts`, `tests/e2e/v2-verification.spec.ts`, `tests/e2e/v2-evidence-verification.spec.ts`. Change affected text/locators only; preserve their real HTTP/SQL/pin assertions and C3 result payload.

## One implementation task and acceptance checks

- [ ] On root's accepted integrated base, write focused failing display/helper tests for the partition and exact copy. Cases: all members documented and outside; same-name different accounts; multi-account hold displayed once; mixed outside/unresolved; outside/selected; foreign or missing ID; empty membership; competing profiles; coverage absent; scoped selected blocker; non-UNKNOWN_ACCOUNT and additional source-wide blockers; attached broader diagnostic; unmatched unsupported-row alias; event overlap across holds. Assert exact original hold identity/content and severities are retained and every consolidated hold appears exactly once.
- [ ] Assert returned 80000 and a changed nonbaseline balance display through the existing formatter, actual supplied as-of is shown, and empty-target language does not appear without empty-target context. No new client financial calculation. Assert source-change wording does not count it as a payment or monetary amount.
- [ ] Run those focused tests, observe assertion-level failure, then implement the minimal owned-path change.
- [ ] Baseline browser A: preserve 30 = 11 selected + 19 outside, two separate documented other accounts with 10/9 events, 18 financial + 1 source-change outside events, 11 proposed imports, 19 original holds, server $800.00 and zero writes. These are assertions, not component constants. B: preserve 28 = 9 + 19, 18 documented other-account events and one unresolved payment; the latter must appear under investigation, never other accounts. Preserve citation/amendment inspection and fallback/retry/late-response tests.
- [ ] Run `npm run test:unit -- packages/client/test` and `npm run typecheck`; run `npm run test:e2e -- tests/e2e/v2-preview.spec.ts tests/e2e/v2-verification.spec.ts tests/e2e/v2-evidence-verification.spec.ts` on root-assigned isolated resources. Use Node 24/PostgreSQL 18, authenticated tracing/video off, safe screenshots only. Inspect A/B screenshots for understandable labels and visible original blockers. Do not touch the normal app process.
- [ ] Preserve these literal test titles: `previews both captured schemas and leaves real runtime state unchanged`; `verifies both captured companies through the real protected evaluator and renders bound summaries`; `verifies both captured companies with v2 evidence and all thirteen checks without parent writes`.
- [ ] Preserve all ten artifact names: `preview-company-a-balance.png`, `preview-company-a-scope.png`, `preview-company-a-lineage.png`, `preview-company-a-citation.png`, `preview-company-b-balance.png`, `preview-company-b-hold.png`, `verification-company-a.png`, `verification-company-b.png`, `verification-v2-company-a.png`, `verification-v2-company-b.png`. Preserve C3 result shape and all existing actual HTTP, SQL, pin and zero-write checks; do not replace them with mocked results.
- [ ] Commit one coherent change, e.g. `feat: clarify preview exclusions and remaining receivable`. Report exact base/candidate, changed paths, focused results, screenshots, and bounded limitations to root for independent review. No full V2/V4 or joint acceptance claim from these partial checks.

## Handoff limits

This plan changes terminology and conservative UI grouping only. Root's prior arithmetic explanation is context, not a request for a second calculator. Compatibility repair acceptance and joint user acceptance remain separate and pending. No product source, test, commit, service, or subagent was changed/started while preparing this handoff.
