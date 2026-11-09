# S4a evidence-backed development candidate metadata

- Base `2a2f292fb58f12a3192ca8a0f2ce892631d0a93b`
- Candidate `7308e6cac9d0ae76e965e84edd558b901c3e1eee` on `codex/bootstrap-candidate-metadata`
- Commit `feat: bind demo bootstrap metadata to captured agreements`
- Assigned checkout `acquisition-evaluator/EnterpriseAgenticPaymentResolution`. Working tree was clean after commit. Fresh independent review and joint acceptance are pending.

The adapter copies the exact legal name from the captured designated page-one agreement into the version 2 profile and cites that agreement. It binds each existing term to a stable development configuration ID derived from the pinned term ID. Spec bytes and version 1 remain reusable because the registry stores the spec independently of profiles. The existing financial rules, customer and account IDs, scope, and designated-agreement parser remain in place.

## Machine evidence

Node 24.22.2 and PostgreSQL 18.6. Isolated lease PG 55435, control 3301, worker 3302, web 5176, with both test namespace prefixes set to `eapr_test_review_t2`.

- Behavioral red on base plus the new test. `npm run test:integration -- tests/integration/bootstrap-demo-candidates.test.ts` failed on the intended assertion because profile version 1 lacked bootstrap metadata.
- `npm run typecheck` passed.
- `npm run test:unit` passed 260 tests in 35 files. The first sandboxed attempt could not write the Vitest config cache in the assigned checkout. The scoped elevated rerun passed.
- `npm run test:integration -- tests/integration/bootstrap-demo-candidates.test.ts tests/integration/local-verification-startup.test.ts tests/integration/bootstrap-financial-verification.test.ts` passed five tests across three files. A/B generated visible capture metadata matched the exact agreement name and citation with generated protected fixtures absent. An actual captured alternate PDF citation was rejected. Startup verified its existing legacy pin behavior and private import boundary.
- The fresh A/B exact-subject integration registered the original version 1 financial-only profile and the generated version 2 profile without conflicts, compiled both, and independently issued fresh construction reports against version 2 evidence pins. The generated profiles passed all 13 mandatory financial checks with zero unexplained difference and 53 A and 57 B cases. Report binding rejected reuse of the old report, and monetary, citation, finding, and mapping negative controls retained expected behavior. Test-owned pin bytes were unchanged through execution.
- Initial full `npm run test:integration` at superseded `4b3ce930813449c5657a3efcebf908b88daf78ec` passed 113 of 116 tests. In `evidence-v2-store.test.ts`, the buyer mismatch mutation returned unavailable with zero cases instead of failed with three cases because it left the copied bootstrap customer ID inconsistent. The corrected test keeps both IDs consistent so the financial evidence mismatch is checked, and clears configuration bindings with the omitted-term mutation for the same reason. The independent synthetic multi-term amendment and same-name identity case explicitly uses a financial-only profile. Its original assertions remain intact.
- The initial full run also recorded two standalone `v2-verification.test.ts` failures. The route/scope/budget case exceeded its 20,000 ms test timeout. The F8 transposition case saw `running` instead of `completed` at its 24,000 ms poll deadline. The cause of those timing failures was not established.
- Corrected `npm run typecheck` and the focused integration rerun across both failed files plus all three initial focused files passed. The integration rerun passed nine tests in five files with the original time limits.
- `git diff --cached --check` passed before each commit.
- `npm run test:integration` on the corrected exact head passed all 116 tests in 21 files in 128.83 seconds. The rerun used the same lease and original time limits.

These checks cover development construction fixtures and exact financial eligibility. Bootstrap readiness remains unavailable. This adapter grants no reviewer approval, activation or parent writes. Browser and full slice gates were outside the focused checks.
