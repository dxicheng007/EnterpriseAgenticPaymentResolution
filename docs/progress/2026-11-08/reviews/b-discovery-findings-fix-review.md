# Independent C1 fix-round-1 review

Candidate: `aff21214ded3a59c1295bb1dc130079410106440`; fix base: `84a5b0b6064ebce845a91905d0c8588690c3e9d8`. Verified candidate HEAD and clean status in `acquisition-verification-startup/EnterpriseAgenticPaymentResolution`. Reviewed the four-file fix diff, original P1, appended builder report, C1 handoff, surrounding dispatcher/locking/insertion paths, result schemas, investigation constraints, and focused regression tests. No source edits or commits were made.

## Verdict

Original P1: **ADDRESSED**. No new blocking defect identified in this fix's scope.

The dispatcher now validates delegation inputs and projects every remaining delegation before any successful publication, read claim/result, or child insertion. Projection runs on the owner connection after `loadStep` locks the run and before the effect branches. Ordinal ordering is retained. Both fresh execution and recovered pending batches enter this path; later steps project only remaining requests against already persisted counts.

`projectedDelegationLimit` seeds the map from persisted investigations, keys it by the exact JSON-encoded seller/account pair, and increments the projected specialist count for every requested child. A distinct new account consumes one investigation slot; repeated requests for that account share the slot while each consumes a specialist slot. Existing accounts consume no additional investigation slot. Source scope uses the existing null/null investigation. Database constraints preserve paired nullability, unique subjects, and bounded integer counts. Existing per-step insertion guards remain unchanged.

Capacity failure fails the remaining batch before successful effects. Delegations retain `SPECIALIST_LIMIT` or `INVESTIGATION_LIMIT`; implemented finding/read tools receive schema-compatible `DISCOVERY_CONFLICT`. The specific capacity diagnostic remains durable. The HTTP expectation correction reflects whole-batch rejection: seeded children remain, no new children or tool-success activity appear, coordinator failure blocks its dependents, and pause/resume retain both capacity and dependency diagnostics. No capacity or authority guard was weakened.

## Independent focused verification

Used Node 24/PostgreSQL 18 and the assigned lease: `EAPR_PG_PORT=55438`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, control/worker/web ports `3601/3602/5179`.

- `npm run test:integration -- tests/integration/v4-discovery-findings.test.ts -t 'mixed batch rejects|two delegations for the same new account'`: **5 passed, 22 unselected**. Covers exhausted and collectively overflowing specialist/account limits across fresh/recovered mixed finding/read/delegation batches, plus repeated requests sharing the final account slot.
- `npm run test:integration -- tests/integration/v4-lifecycle-http.test.ts -t 'rejects the entire delegation batch at both persisted capacity boundaries|keeps same raw accounts under different sellers distinct'`: **2 passed, 11 unselected**. Covers zero added effects at both boundaries, dependent blocking and pause/resume, and distinct exact seller/account identities.
- Exact fix diff `--check`: exit 0. Candidate worktree remained clean.

The first test launch was stopped before tests by sandbox denial of Vite's temporary config write in the candidate worktree. The authorized escalated rerun succeeded; this was not a test failure or automatic-review rejection.

## Review limits

This is a scoped exact-candidate fix review with seven independently executed PostgreSQL tests, not a rerun of the full C1 review or broad suites. Builder-reported four red regressions on the parent, 80 focused PostgreSQL cases, typecheck, and four focused unit tests were inspected as reported evidence, not independently repeated. Existing-account specialist behavior and failure schema compatibility were also inspected statically; no additional custom probes were added. Original C1 review observations outside P1 remain historical evidence for the preceding candidate. This verdict does not establish C2/C3 runtime behavior, genuine provider execution, financial readiness, activation/synchronization, or joint user acceptance.
