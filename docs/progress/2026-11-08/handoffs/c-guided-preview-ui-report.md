# C guided source coverage implementation

- Branch `codex/guided-preview`
- Worktree `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`
- Base `77c57f559651af0bdf9697cf7a62d4e8ec0bc4d1`
- Candidate `d30d48d9c703ff343fff583c455ad18a3fd67ac4`, clean after commit
- Brief `docs/progress/2026-11-08/handoffs/guided-discovery-implementation.md`, global constraints and C sections 3 and 4

## Behavior

- The browser reads coverage for the selected candidate and immutable aggregate snapshot. It validates the strict shape, company and aggregate, and checks the candidate's source separately. The candidate and snapshot key resets displayed coverage, and selection cleanup aborts in-flight requests.
- The view distinguishes source-account observations, raw event membership, candidate profile membership, proposed imports, and hold entries. Account joining uses exact source, company, seller and source-account IDs. Competing profiles are labeled a conflict and raw events count once.
- Documented accounts remain separate and link to identity and related citations. Related references have no type on this wire. The citation itself identifies the original, and the account row explains that amendments require separate terms review. Snapshot and manifest hashes are inspectable as provenance.
- A's real capture showed 30 events, 11 selected and 19 outside, including 18 financial and one semantic event. The Northstar rows had distinct buyer/account IDs and 10 and 9 events. A preview returned an $800.00 projected balance, 11 proposed imports, 19 holds and zero parent writes. B showed 28 events, 9 selected and 19 outside, including 18 documented and one unresolved payment. Its selected projected balance was $0.00.
- Only unscoped UNKNOWN_ACCOUNT entries get documented group references by exact event-ID membership. Multi-group holds stay as one entry. Selected and other unresolved holds and source-wide diagnostics remain visible, with original scope, event IDs, dependency IDs and diagnostics. Matching unsupported-row aliases stay deduplicated by the existing logic.
- A failed or misbound coverage read keeps the preview available with neutral unmapped language and a retry. The UI keeps the development fixture and empty-target labels, shows the existing verification action only through its existing availability and artifact checks, and labels live construction pending.

## Partial machine evidence

Node 24 and PostgreSQL 18. The browser used isolated PG 55438, control 3601, worker 3602, web 5179 and prefix `eapr_test_review_t2`. The test system released its disposable resources and the native cluster was stopped afterward.

| Check | Result |
| --- | --- |
| RED focused client/display | Assertions exposed the missing client and zero placeholder counts, and raw-hold markup lacked source groups |
| RED real browser | The existing selected candidate page rendered and the test timed out awaiting the absent coverage GET |
| `npm run test:unit -- packages/client/test` | 7 files, 30 tests passed |
| `npm run typecheck` | Passed |
| `npm run test:e2e -- tests/e2e/v2-preview.spec.ts` | Existing exact test title, 1 passed against real local services and PostgreSQL |
| Visual inspection | Real A and B coverage at 1280px and B at 375px, with no horizontal overflow |
| `git diff --cached --check` | Passed |

The browser inspected both distinct Northstar identity citations and the actual amendment original excerpt, checked A/B balances and zero parent writes, and compared real runtime state before and after. Its two one-shot fault intercepts delayed an actual A coverage response until selection moved to B and changed the source binding in a separately fetched real B response. The test checked Chromium's abort, rejection of the misbound response, successful preview during fallback, and recovery through an untouched GET. Normal source, preview and evidence calls used the real services.

Local browser artifacts are in `/tmp/eapr-guided-ui.VSbcAt/browser/v2-preview-previews-both-c-990c7-eal-runtime-state-unchanged/`. The six original artifact filenames were preserved. Authenticated tracing was disabled. Local visual inspection used `/tmp/eapr-guided-ui.VSbcAt/visual-a.png`, `/tmp/eapr-guided-ui.VSbcAt/visual-b.png` and `/tmp/eapr-guided-ui.VSbcAt/visual-b-mobile.png`.

## Decisions and remaining review

- The projected balance is the server's value, and individual proposed-record amounts and field lineage remain inspectable. The UI omits a separate per-invoice calculation.
- Related citations are shown generically because the response supplies untyped IDs. The original excerpt supplies the document context.
- Focused verification covers the two synthetic captures and the specified client/display edge cases. It establishes partial machine evidence. Full slice results, exact-candidate independent Astra review and joint user acceptance are separate and pending.
