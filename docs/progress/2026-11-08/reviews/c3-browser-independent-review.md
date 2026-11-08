# Independent C3 actual-browser review

Verdict: no blocking findings in the scoped, tests-only checkpoint. Acceptable as focused browser evidence for source capture and default-demo preview, subject to the explicit coverage boundaries below. This is independent review, not joint user acceptance or full V1/V2/F6 acceptance.

Reviewed detached candidate `f22a70fe8a56e72a29afb7793e1b42e1a746b9e0` against `0fdecc25bf350ff3a17a59fc5e8afb295f3ede4a` in `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`. The diff is exactly three added files (371 lines): `tests/e2e/support/local-review.ts`, `tests/e2e/v1-sources.spec.ts`, and `tests/e2e/v2-preview.spec.ts`. No product change, helper modification, commit or push was made during review. Git status was clean after reproduction. `git diff --check` passed.

Read repository/test instructions, C3 handoff and producer browser report, relevant F3/F4/F8 frozen rules, new tests/helper, actual local composition, existing harness/native database lifecycle, session client and evidence rendering. Product implementation had prior review; this review concentrated on the added tests and their actual evidence.

## Fresh execution

Node v24.22.2, PostgreSQL 18.6; actual Playwright Chromium. Executed with OPENAI_API_KEY unset:

```sh
env -u OPENAI_API_KEY PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH \
  EAPR_PG_PORT=55436 EAPR_CONTROL_PORT=3401 EAPR_WORKER_PORT=3402 EAPR_WEB_PORT=5177 \
  EAPR_TEST_PREFIX=eapr_test_review_t2 \
  EAPR_TRACE_DIR=/Users/devincheng/Documents/Codex/2026-11-07/we-re/work/c3-independent-browser-results \
  npm run test:e2e -- tests/e2e/v0-health.spec.ts tests/e2e/v1-sources.spec.ts tests/e2e/v2-preview.spec.ts
```

Result: **3 passed (5.9s), exit 0**, one worker. V0 readiness/degradation/recovery passed unchanged. V1 passed in 1.5s; V2 passed in 1.6s. This review did not rerun the broader unit/integration/typecheck suite; the producer's reported results are not represented as fresh independent results.

All four assigned ports were free before execution. Tests closed web/control/worker and dropped their randomized, prefix-guarded test databases; their temporary source/truth/original roots are removed in finally blocks. `npm run db:down` stopped this checkout's PG cluster after testing. A final lsof check showed no listeners on 55436/3401/3402/5177. Main-app port 58209 was not touched. Database credentials were not printed. C3 authenticated traces were disabled as authorized; only unchanged V0 emits trace.zip.

## What the tests establish

- **Actual services:** the C3 helper starts real isolated PostgreSQL/migrations, real worker and control HTTP, actual `loadDemo` source generation/capture, actual `createLocalComposition`, evidence store, Vite proxy, and product React UI. No Playwright route interception, request mocking, synthetic browser API response or backend authorization replacement is used. Test setup deliberately calls source capture server-side; it does not introduce a browser capture control.
- **Session:** actual automatic bootstrap returns 200; request uses actual leased Origin, JSON `{}`, local-UI header and no Authorization. Cookie is HttpOnly/SameSite Strict. Browser mutations include cookie and CSRF. No sign-in/password controls appear.
- **Upload lifecycle:** newer incomplete A manifest remains selected over the old complete capture. Browser PDF upload returns 201 then exact duplicate 200, both with empty evidenceIds; real source table counts show one file and no evidence growth. Conflicting bytes at the same version return 409 with unchanged counts. Refresh still shows incomplete/no citations. Explicit successful server-side capture then exposes the new PDF citation and complete dossier.
- **Originals and citations:** PDF has independent known excerpt and page 1; browser-rendered highlight matches response excerpt, snapshot/source IDs and original SHA. Exact scoped original href/page anchor is asserted; authenticated original responses are checked for status, media type, exact bytes and SHA for PDF, API JSON, email and CSV. CSV/email originals come from generated visible files; API JSON is compared to the content-addressed store. Company change clears the prior evidence panel. Cross-company manifest selection shows unavailable; forged bearer header returns 403; absent cookie returns 401.
- **Preview:** actual candidate catalog explicitly reports empty-fixture target and verificationAvailable=false. Both company/source shapes are exercised, actual request equals selected candidate request, A returns 80000 cents and visibly renders $800.00, B returns 0 and visibly renders $0.00 with unresolved payment held. Actual mapping lineage, decimal scale, record-relative amountCents field, source citation and original PDF link are displayed. Candidate change clears A result/citation.
- **Recovery and authority:** missing CSRF returns 403. Cookie deletion produces a real 401 and replacement bootstrap; response count is [401] before explicit retry and [401,200] afterward, with error/cleared result before retry. No automatic replay is observed. Verify is absent and actual unavailable state is visible. Approve/activate/sync buttons are absent.
- **Runtime preservation:** actual runtime schema list and complete rows of migration_ledger, seed_ledger, activity_counter and activity_events, including a pre-existing activity record, compare equal before/after previews. A response also declares parentWrites:0. This supports unchanged existing runtime state, not persisted parent financial tables (none are supplied here).

## Screenshot inspection and limitations

Inspected all seven freshly generated PNGs under `work/c3-independent-browser-results`: incomplete source, complete PDF source, A balance, A lineage, A citation, B balance, B hold. Desktop presentation is readable: clear incomplete/complete status and counts, missing-member explanation, distinct scope and original hash, highlighted PDF excerpt and usable original link, visible before/after money labels, and explicit UNKNOWN_ACCOUNT blocker. Lineage is long and technical but readable in the captured expanded detail; no obstructed control, overlap or clipping defect was observed in these images. Complete-source screenshot appropriately retains the earlier upload conflict alert independently of the subsequently completed dossier. Mobile/responsive and keyboard-only behavior were not evaluated.

Coverage is deliberately narrower than the original end-state handoff:

- The test removes cookies; it does **not** advance a clock to prove server TTL expiration. It does exercise the real missing-session 401 recovery/non-replay path. Non-replay is observed for preview, not independently for upload or verifier mutation.
- Locator labels for JSON/email/CSV are checked by kind/format and source response/schema agreement; only PDF has an independently constructed expected excerpt/page assertion. This is good browser rendering evidence, not an independent exhaustive locator-parser oracle.
- Scope negatives cover mismatched company/manifest and forged/missing authentication. They do not exhaust reviewer/tool account-capability permutations.
- B hold screenshot visibly says UNKNOWN_ACCOUNT; the automated assertion locates an unresolved event in unsupportedRows rather than asserting that exact diagnostic code.
- Default composition has no verifier route/registry mounted: no actual verification job polling, protected holdout report, wrong-mapping rejection in browser, or full F6 eligibility is tested. Unavailable is faithfully represented.
- Explicit empty target fixture, no persisted parent financial reads/writes or activation path, no live agent/model/discovery/sync/deployment claim. Tests and screenshots do not establish those later slices.

These limitations match the producer's bounded report and do not block this checkpoint. No additional product edits are requested.
