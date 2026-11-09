# S4b independent task review

- **Spec compliance: Approved.** Reviewed complete packaged diff `1dae28994cbcbc97f784489fc89a99eea0aa7f01..1e2bf3283db652173f843cfbe28664ae189067d4` once against the S4b brief and accepted proposal §6.
- **Task quality: Approved.** No Critical, Important, or Minor findings identified in this narrow change.

## Strengths and verified checks

- `packages/evaluator/src/evidence-support.ts:219`: the only production behavior change replaces blanket bootstrap presence rejection with schema validation. It retains the actual profile object, leaves unsupported mapping/finding and ensure-operation rejection in place, and neither calls bootstrap planning nor interprets bootstrap semantics.
- `tests/integration/bootstrap-financial-verification.test.ts:24`: the new test uses real candidate compilation, immutable registration, PostgreSQL jobs, protected launcher execution, and persisted reports for both captured companies. The assertions require the exact metadata-bearing registered subject, all mandatory checks passing, the expected 53/57 cases, fresh report identity, updated artifact/profile bindings, and zero unexplained cents.
- `tests/integration/bootstrap-financial-verification.test.ts:98`: old-report validation is attempted against the new registered subject using the old job ID, so rejection cannot be explained merely by substituting a new job ID. The test also checks the actual launcher build hash.
- `tests/integration/bootstrap-financial-verification.test.ts:104`: monetary term, citation, and finding mutations exercise the same bootstrap-bearing profiles; the B allocation mutation preserves baseline reconciliation while failing new-record and evidence checks. Per-company before/after hashes protect private v2 pin bytes. No fixture implementation, report schema, check enumeration, or bootstrap authority consumer changes appear in the diff.

## Named risk checks outside the diff

- **Risk: metadata could be stripped before financial execution or lineage comparison.** Checked the otherwise omitted `evidence-support.ts:175–207,234–264` function continuations, plus `evaluator-runner.ts:13–33`, `cases.ts:325–356,370–424`, and `subject-runner.ts:7–10`. The financial runner uses the supplied artifact/profiles, binds cases and captured baseline by their hashes, passes the profile to the real financial planner, and checks exact captured events, outcomes, financial operations, and lineage. This was a focused unchanged-call-path inspection, not a wider codebase review.
- **Risk: changed checker might retain the old evaluator fingerprint.** Checked `packages/evaluator/src/launcher.ts:6–18`: its existing build manifest includes `evidence-support.ts` and hashes file bytes. No manifest edit is necessary.
- **Risk: narrowing the presence guard could inadvertently weaken rejection or report binding.** Checked `tests/integration/evidence-v2-store.test.ts:260–306` and `packages/evaluator/src/verify.ts:23–44`: existing regressions explicitly cover malformed bootstrap metadata, unsupported mapping, constant money, findings, lineage mutations, and ensure operations; report validation binds exact artifact/profile/manifest/build/fixture and mandatory coverage.

## Evidence and limits

- Builder-reported machine evidence: intended assertion-level red on registered A (`evidence_support: unavailable` with twelve other checks passing); typecheck exit 0; seven evaluator unit files / 48 passed; four integration files / six passed, including actual A/B all-thirteen success and v2/store regressions. The report supplies no raw historical log paths; these are recorded as builder-reported results, not independently observed command executions. Root confirmed that distinction is appropriate and will perform combined validation after acceptance.
- Independent evidence here consists of the complete task diff and the focused named-risk code inspections above. No test reruns were warranted by an unresolved code doubt. No candidate files, index, HEAD, database, or branch state were changed.
- The diff changes only the financial guard and its integration regression. It establishes no bootstrap execution, readiness, activation, or later-slice authority. Cross-task enforcement of future bootstrap API/readiness gates is outside this diff and remains a separate acceptance obligation; no shortcut is introduced here.
- This is an exact-candidate task-scoped review, not whole-branch or joint user acceptance.
