# Guided preview terminology implementation

- Branch `codex/preview-terminology`
- Worktree `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`
- Base `e34a0f629a1fee90e738c317b2e243044f83a7a1`
- Candidate `855f1b0fcfe23526d0638bf371b08f4fb5944876`, clean after commit
- Handoff `preview-terminology-handoff.md`

## Scope and decisions

- `PreviewPage.tsx` passes the pinned preview request's as-of instant and validated catalog target mode. `PreviewResult.tsx` labels and explains the existing server values. The starting balance and target version remain inspectable. Without explicit empty-fixture context the result uses the neutral target-balance label. The result states that it is a preview and keeps the response's parent-write count. Record JSON, amounts and lineage remain reachable.
- `preview-values.ts` keeps the original multiset alias consolidation and exact scope classification. A separate presentation partition retains original hold references and requires all distinct members of an unscoped UNKNOWN_ACCOUNT hold to be uniquely cited and outside supplied profiles. Mixed, uncovered, ambiguous, broader-diagnostic and conflicting cases remain in investigation. Account references for qualifying holds preserve every represented account. Selected holds and original additional diagnostics are separate. Technical hold details preserve the wire and alias counts. Source membership, distinct held events and proposed operations remain separate counts.
- With root's agreement, the two introductory sentences appear only when their corresponding groups exist. Company A's fully documented group therefore does not imply an investigation group. The held and blocker sentence remains whenever there are holds. Source-change events use explicit wording and retain the amendment caveat.
- Tracked changes cover the four authorized preview component/helper files, one readability rule in review CSS, two client display test files and the two browser specs with affected locators. The v1 verification browser spec had no affected locators and ran unchanged. Server, financial planning, authority, contracts, pins, runtime, helper and verifier gate files are outside the patch.

## Focused evidence

| Check | Result |
| --- | --- |
| Focused red display tests | 8 expected assertion failures for old wording, missing balance context and missing partition |
| `npm run test:unit -- packages/client/test` | 7 files, 33 tests passed |
| `npm run typecheck` | Passed |
| `npm run test:e2e -- tests/e2e/v2-preview.spec.ts tests/e2e/v2-verification.spec.ts tests/e2e/v2-evidence-verification.spec.ts` | All 3 real Chromium tests passed in 38.5 seconds |
| `git diff --cached --check` | Passed |

A showed 30 captured events, 11 selected and 19 outside, with 18 financial events and one source-change event. The two same-name cited accounts showed 10 and 9 events. Its preview showed 11 proposed imports and 19 hold entries affecting 19 distinct events under Other accounts needing connectors. Its server balance was $800.00. B showed 28, 9 and 19, with 18 other-account holds and one unresolved payment in investigation. Its server balance was $0.00. Both had zero parent writes. The browser checked citations and the amendment, exact as-of, raw reasons, stale-response rejection, fallback, and retry. The v2 protected browser results still show all 13 checks passed per company and retain schema version 1 and the six assertion flags. The run exercised the existing HTTP, SQL, pin and boundary assertions.

Browser scratch directory `/tmp/eapr-preview-terminology.4s4V5w/browser`. All ten exact PNG names were confirmed. The four A/B balance and hold screenshots were inspected. They show the new labels, empty-target explanation, distinct counts and original blocker text. The scratch directory contained no trace or video. Node 24, PostgreSQL 18, ports 55438/3601/3602/5179 and prefix `eapr_test_review_t2` were used. The isolated database stopped afterward.

This is partial machine evidence. Exact-candidate independent review, the combined V2 gate and joint user acceptance remain separate.
