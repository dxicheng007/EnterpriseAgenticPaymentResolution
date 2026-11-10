# Task 3 independent review

Reviewed exact candidate `158ce0695a3ecd498cfac64fcf745ec3d261b2f4` against base `67247e806f749488c2e8b12698b81657e1e59974` in detached, clean checkout `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution`. Reviewer: fresh delegated agent `/root/demo_task3_review`; no implementation edits or subdelegation. Task 1 and Task 2 treated as accepted prerequisites.

## Verdicts

- Specification: pass for assigned Task 3 scope.
- Quality/security: pass; no actionable blocking findings in the ten changed paths.
- Verification: focused independent checks passed. Not a full integration, V5/V6, browser, live-construction, T5, T8 or joint-acceptance verdict.
- Joint acceptance: pending.

Read the canonical Task 3 brief/report, Global Constraints, mount design, process design delta, frozen T0 contract and relevant root/apps/scripts/tests guidance, PRD process/product/acceptance boundaries, contract/verification conventions. Reviewed all ten changed paths; outside reads were limited to schemas, accepted composition/auth setup and native cluster ownership necessary to assess concrete changed-code risks.

## Review observations

`scripts/dev.ts` shares its real role launcher and explicit environment construction with the process proof. Enabled operator credentials are validated as distinct from source/service/admission capabilities before launch. Web receives PATH and ports only; worker receives runtime DB and source/service capabilities, without control DB/evidence/protected setup. Typed worker paths expose only registry and policy. Default no-role startup remains the real provisioning path, but the test never invokes it.

`apps/control/src/composition.ts` optionally mounts the demo plugin against its existing source instance and dependencies. No duplicate source ownership, product tool capability, selector or financial behavior was introduced. Generic worker sync remains mounted separately and unchanged.

`scripts/demo-inject.ts` accepts only the fixed command, fixed loopback endpoints and empty bodies, with redirects rejected, five-second request deadlines, bounded decoded bytes and strict response validation. Success output contains only safe schema-validated identity/replay/cents. Failure messages distinguish uncertain source injection from uncertain worker commit without exposing response bodies or secrets. It prints worker-returned amounts rather than expected values.

`tests/fixtures/demo-company-a-process.ts` installs the global-fetch guard before importing the actual launcher. The remote-origin, userinfo, hostname and redirect-policy controls trip the same installed guard; measured intervals assert no new forbidden attempt and unchanged guard identity. The independent leaked-model-key check fails before readiness. The source inventory is candidate-specific; it is not a transitive dependency resolver or all-egress sandbox.

The actual mounted CLI test proves both fixed source events were absent from approved history, remain in the durable inbox after interruption before apply, and subsequently yield one unit/receipt, one payment/allocation and one parent version increment. Current balance is 50000, cutover and approved snapshot remain 80000, and a third worker recovers the original receipt without new source reads. This is bounded capture/reconstruction and receipt replay evidence, not arbitrary crash-boundary coverage.

Docs preserve frozen identities and money and label remaining scope honestly. No source fixes requested.

## Independent commands and results

Environment for focused tests: PATH prepended `/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin`; `EAPR_PG_PORT=55442`, `EAPR_TEST_PREFIX=eapr_test_review_t2`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, control/worker/web ports `3241/3242/5182`.

1. `npm run test:integration -- tests/integration/demo-company-a-transport.test.ts -t 'actual worker child|mounted Company A CLI|mounted worker source'` — exit 0; 3 passed, 3 filtered/skipped. Log `/tmp/company-a-task3-review-transport.log`.
2. `npm run test:integration -- tests/integration/demo-inject-cli.test.ts` — exit 0; 12 passed. Log `/tmp/company-a-task3-review-cli.log`.
3. `git diff --check 67247e806f749488c2e8b12698b81657e1e59974 158ce0695a3ecd498cfac64fcf745ec3d261b2f4` — exit 0; empty output. Log `/tmp/company-a-task3-review-diffcheck.log`.
4. `npm run db:down` with the same owned checkout/port configuration — exit 0. Log `/tmp/company-a-task3-review-cleanup.log`.
5. `lsof -nP -iTCP:55442 -iTCP:3241 -iTCP:3242 -iTCP:5182 -sTCP:LISTEN` — exit 1, empty output (no listeners). Log `/tmp/company-a-task3-review-listeners.log`.

The worktree stayed clean. No no-role supervisor/provisionDemo invocation, no original-demo changes, no access to shared integration cluster 55441, and no source edits. Review-owned 55442 is stopped; serial test lease released.

## Limits

Did not independently rerun typecheck, absent-demo composition, unchanged transport cases or fixture lifecycle regressions; implementer reported those focused results and their earlier test failures/repairs. Their evidence does not become an independent full-suite pass. No browser, full V5/V6, live model, Company B, scheduler, hostile-code or raw-socket containment claim. Setup stdout/stderr is intentionally private/drained by the test helper, so startup failures surface bounded generic diagnostics rather than retained child detail.
