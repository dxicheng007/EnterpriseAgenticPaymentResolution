# C2 evidence checker — independent review

Reviewed candidate: `b03fced6023a31bd8e0b74e8dec7180286794d57`.
Base: `09104d49481d285e71d9162e674824045ae27427`.
Reviewer: fresh independent Astra agent `/root/astra_c2_evidence_verify`, separate from implementer and supervising lead.
Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`, detached at the candidate throughout. Final `git status --short` was empty. Product files and HEAD were not edited.

**Spec verdict: reviewed / pass for the bounded C2 scope.**
**Quality verdict: reviewed / pass; no actionable findings.**
**Verification verdict: focused checks passed; not a full slice gate.**
**Joint acceptance: pending.**

## Scope and reasoning

Reviewed the candidate diff and focused source against the source-owner frozen `evidence-v2-contract.md`, `evidence-v2-handoffs.md`, and the C2 section of `evidence-v2-stages.md`, together with repository/package/evaluator/test guidance and the financial/protected-verification conventions. The original combined diff tool output was truncated; focused source reads covered the checker, runner, observer integration, comparator, build binding, and changed tests. C1 provenance/storage implementation is an accepted dependency and is unchanged by this candidate.

The checker independently binds each profile to its exact source/company/seller/raw account, producer identity, demo buyer/account policy, parent-account lookup and applicable identity citations. Supplied terms match protected facts by the complete value/interval tuple rather than profile term ID; active terms cannot be omitted and references must cover required support fields. Same-name buyer identity is not used as a join.

Financial mappings are checked against the bounded A/B templates, including allocation/reversal references and the payment/credit enumeration. Currency citations must be applicable to the profile and actual event effective time. Invented money constants fail; unrepresented findings, bootstrap, unsupported reasoning, and ensure operations remain unavailable. V1 still has no evidence representation and returns unavailable with zero cases.

The evaluator's existing captured-baseline execution supplies the observed output. C2 does not call the production planner a second time. Its expected records come from protected financial truth through the independent reference model; expected lineage comes from the declared mapping rules and pinned events, not observed output. The check compares exact captured event membership/content, artifact/profile binding, empty prior target/version/asOf, complete independent financial records and plan event membership, then exact lineage including source paths, mappings, citations, operation indexes and derivation IDs. Rehashed output cannot pass solely because its balance is right. Missing execution remains unavailable, and an attempted failed execution fails the lineage assertion. New checker code is included in evaluatorBuildHash; private evidence stays outside subject inputs and product exports.

Four cases per supported profile represent the four executed identity, term, mapping and captured-lineage assertion groups. They are not claimed as four additional planner executions or as parent configuration execution. The real A/B integration asserts all thirteen report checks, four evidence cases, total counts 53/57, zero unexplained difference, and existing report validation. Unsupported coverage cannot make the report eligible.

## Reviewer-run checks

All commands ran with Node 24 and PostgreSQL 18 on PATH. Integration/probes used only the dedicated review lease: PG 55436, control 3401, worker 3402, web 5177, test prefix `eapr_test_review_t2`, demo namespace `eapr_review_t2`. Main PG 55432 was not touched. The review cluster and pre-existing pins were preserved; harnesses cleaned only their newly owned temporary fixtures, pins and test database pairs.

| Command / check | Result |
| --- | --- |
| `git rev-parse HEAD` before and after review | Exact candidate above |
| `git diff 09104d49481d285e71d9162e674824045ae27427 b03fced6023a31bd8e0b74e8dec7180286794d57 --check` | Exit 0 |
| `npm run test:integration -- tests/integration/evidence-v2-store.test.ts` | Exit 0; 1 test passed, 16.71 seconds |
| `npm run test:unit -- packages/evaluator/test/cases.test.ts packages/evaluator/test/control-imports.test.ts` | Exit 0; 13 tests passed across 2 files, 3.55 seconds |
| `npm run typecheck` | Exit 0 |
| `./node_modules/.bin/tsx /Users/devincheng/.codex/worktrees/acquisition-local-build/EnterpriseAgenticPaymentResolution/work/c2-evidence-review/probe.mts` from the review checkout | Exit 0; 18 independently authored assertions passed |
| Final `git status --short` in review checkout | Empty |

The independent probe generated fresh unique-seed A/B fixtures, captured actual source evidence using the accepted test-only capture helper, pinned and decoded v2 inputs in uniquely owned temporary directories, and ran one actual captured baseline for each company. It asserted exactly one baseline planner execution per company and reused that witness for all evidence probes. The positive evidence assertion passed for each company. With output plan hashes recomputed where appropriate, each of these reviewer-authored negative probes failed as required:

- Same captured event ID with a changed payment payload.
- Changed invoice record amount while retaining original lineage.
- Omitted financial operation and its corresponding lineage.
- Omitted plan event membership.
- Changed profile-hash derivation in account lineage.
- Changed profile source, company or seller with recomputed public profile/artifact hashes.

Only assertion summaries were printed. No credentials, private truth values or private fixture contents were emitted. The command above records the historical execution path. After execution, probe source was moved to the main checkout's ignored `.superpowers/sdd/2026-11-08-implementation-plan/briefs/c2-evidence-review/probe.mts` for retention; its now-empty owned `work/c2-evidence-review/` directory was removed. Other agents' work was preserved. It is not a product change.

## Builder evidence and limits

Separately, the implementer report claims exact-candidate typecheck, 48 evaluator unit tests and the real-capture integration test; it also records 121 full unit tests and 4 integration tests on the unchanged precommit tree. These wider runs were not duplicated or relabeled as reviewer-run checks. The reviewer independently reran the focused commands above and inspected the assertions for scope, identity, amendment terms, typed producer disagreement, wrong mapping, lineage, v1, unavailable representations and report binding.

This verdict does not establish composed B+C2 preparation/selection behavior, live construction, holdouts, activation readiness, parent configuration execution, persisted parent writes, or sync. The dedicated composed A/B verification smoke remains a later integration obligation. General production customer matching and unsupported reasoning are deliberately outside the accepted development-only mapping policy. No full repository suite, browser gate or joint user walkthrough was run in this review.
