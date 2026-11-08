# C3 real verification browser — independent review

PASS. No actionable findings in the bounded test-only change.

Reviewed exact candidate `32d734410a33e78918374caede196616c71efb1f` against `3483d6b284901bfb56153c510b97196371d5b386`, in `/Users/devincheng/.codex/worktrees/acquisition-review-ui/EnterpriseAgenticPaymentResolution`. Read repository, tests and scripts AGENTS guidance, assigned brief and builder report. The supplied planworkspace diff path was absent; inspected the exact Git range once instead. Only `tests/e2e/support/local-review.ts` and `tests/e2e/v2-verification.spec.ts` changed. No product, index, branch or commit changes were made.

## Evidence

Independent commands with Node 24/PostgreSQL 18, PG/control/worker/web ports 55437/3501/3502/5178 and test prefix `eapr_test_review_t2`:

- `npm run test:e2e -- --trace off`: 4 passed, 15.3 seconds. All three prior names unchanged and passed; the new protected-verification test passed for both companies.
- `npm run typecheck`: passed.
- `git diff --check 3483d6b..32d7344`: passed.
- Candidate clean before and after verification. Lease ports were free beforehand. Stopped only this run's isolated native cluster afterward; did not touch main 5173/55432 or rewrite protected pins.

Fresh evidence directory: `/private/tmp/eapr-c3-independent-review/v2-verification-verifies-b-3a0bc-and-renders-bound-summaries/`.

Inspected both `verification-company-a.png` and `verification-company-b.png` visually and read `verification-browser-results.json`. Exactly those three files exist for the new test; screenshots contain the completed job/report identity, public manifest hash and check table, without credentials, filesystem details, protected facts or original source bytes. JSON is an allowlist of public identifiers/hashes, statuses, diagnostic codes and assertion booleans. No trace/video or raw request/response artifact was generated for this test.

| Company | Independent job | Passed | Failed | Unavailable | Coverage | Eligible |
| --- | --- | ---: | ---: | ---: | --- | --- |
| A | b7730d0d-3e59-4284-beb7-7d701aaff174 | 7 | 0 | 6 | incomplete | false |
| B | ba64c2d7-bf9b-4fbc-8c16-65ae98df06aa | 7 | 0 | 6 | incomplete | false |

## Review conclusions

- `tests/e2e/support/local-review.ts:40` uses actual generated captures; lines 43–49 prepare real protected pins and compose a real registry with current migration identities. Default verification remains false. Physical temp roots and private Vite deny rules are applied. Cleanup retains fixed pins.
- Traced composition through `apps/control/src/verification-composition.ts` to the protected launcher and `packages/evaluator/src/runner.ts` subprocess. No mocked responses, injected jobs, fake launcher or public truth fixture supplies browser proof.
- `tests/e2e/v2-verification.spec.ts:52` onward binds preview request/artifact/profiles and manifest to the selected candidate, verifies mutation envelope without printing credentials, then binds submitted verification and final summary to those exact inputs. Job polling checks returned IDs and terminal completion. Switching companies removes the old report and requires distinct job/report/artifact IDs.
- `tests/e2e/v2-verification.spec.ts:119` onward requires precisely all mandatory check IDs, rendered row counts/status/diagnostics, baseline pass and zero failed checks. Completeness and eligibility are computed dynamically; unavailable checks require API eligibility false and no eligible claim. Current 7/6 observations are not hardcoded test expectations.
- `tests/e2e/v2-verification.spec.ts:159` compares real runtime schema and ledger/activity snapshots. Parent writes are asserted zero for both previews; approval/activation/sync controls are absent.

## Limits

This is an independent PASS for the C3 browser checkpoint, not V2/F6 completion, eligibility, live provider behavior, protected evidence-support completion, persisted parent semantics, activation, or joint user acceptance. Six mandatory checks remain unavailable. The independent run exercised the current incomplete/ineligible outcome; the complete/eligible branch was inspected statically, not forced with a mock. The builder's red-phase run was reported, not independently repeated. Browser evidence proves the composed real path and rendered summary; it is not a new audit of evaluator financial correctness.
