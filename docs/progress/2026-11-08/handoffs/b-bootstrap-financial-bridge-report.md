# S4b · Same-subject financial eligibility bridge

| Field | Value |
| --- | --- |
| Builder | /root/sol_bootstrap_financial_bridge |
| Branch | codex/bootstrap-financial-bridge |
| Base | `1dae28994cbcbc97f784489fc89a99eea0aa7f01` |
| Candidate | `1e2bf3283db652173f843cfbe28664ae189067d4` |
| Inputs | S4b brief, accepted bootstrap proposal §6, executable bootstrap result freeze, F3 and F6 |
| Machine evidence | Focused checks passed |
| Independent review | Pending fresh Astra |
| Joint acceptance | Pending |

The financial evidence guard admits structurally valid bootstrap-bearing profiles and retains the original input through artifact, profile, capture and captured-run binding. Invalid bootstrap shape remains unavailable. The existing thirteen financial obligations apply, including identity, terms, mapping, money and financial lineage. Existing configuration operations remain unavailable. The launcher manifest already covers the changed checker. The evaluator build hash changes from `2f3f985b639e237bf4e141c7016ec349b897a09dad4b03aec140b101c7d67f39` to `f1fc692ef9410e9cc059802f30862f609c20d0a60d772a429ebc9deee30ab661`. The fixture format, contents and pin policy are unchanged.

The new test derives metadata from visible agreement citations and the existing candidate's term IDs. It compiles and immutably registers the plain and metadata-bearing profiles, resolves both exact subjects, and runs actual PostgreSQL-backed jobs with the protected subprocess launcher. Both A and B receive fresh eligible reports with all thirteen checks passed and zero unexplained cents. A runs 53 cases and B runs 57. The test rejects reusing the old plain-profile report for the new profile and artifact and verifies the same v2 pin bytes after each company. Real persisted reports reject a one-cent fee change, unsupported term evidence, a finding and a wrong allocation funding mapping. The finding leaves evidence support unavailable. The B mapping preserves the captured baseline and fails both new-record and evidence support checks. The existing evidence store regression also exercises unsupported mapping, constant money, malformed bootstrap metadata, configuration operations and original v1/v2 pin integrity.

## Focused verification

Node 24, PostgreSQL 18, PG 55435, control 3301, worker 3302, web 5176. Both test prefix variables were `eapr_test_review_t2`.

| Command | Result |
| --- | --- |
| `npm run test:integration -- tests/integration/bootstrap-financial-verification.test.ts` before production edit | 1 failed at the intended assertion. The registered A job completed with twelve passes and `evidence_support: unavailable` instead of `passed`. |
| `npm run typecheck` | Exit 0 |
| `npm run test:unit -- packages/evaluator/test` | 7 files, 48 passed |
| `npm run test:integration -- tests/integration/bootstrap-financial-verification.test.ts tests/integration/v2-verification.test.ts tests/integration/evidence-verification-setup.test.ts tests/integration/evidence-v2-store.test.ts` | 4 files, 6 passed |
| `git diff --cached --check` | Exit 0 before commit. Candidate worktree clean after commit. |

These checks cover captured synthetic A/B financial subjects. Financial verification produces only the existing financial report and does not establish bootstrap execution or readiness. The separate bootstrap result, trusted combined readiness and activation remain outside this bridge. Full slice evidence, exact-candidate independent review and joint acceptance remain separate.
