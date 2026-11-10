# Independent Task 1 review

- BASE: `f8605642bb391f2bb5c7ec348a03494f3fc20253`
- Exact reviewed candidate: `98bcc469d204785e34e2d0c44a3d164c43f5f718`
- Checkout: `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution` (detached; verified before/after; tracked status clean).
- Scope: the six paths in task-1-brief.md and actual base-to-candidate diff. No source edits or subagents.
- Spec: **pass**. Quality: **pass**. Verification: **pass for assigned Task 1 partial gate**. Status: **verified**. Joint acceptance: **pending**.
- Actionable findings: **none**.

## Review evidence

Read canonical brief/report, actual diff, root/apps/packages/tests guidance, implementation plan Global Constraints, binding design, independent design review, PR56 delta, frozen demo contract, and independent-review orchestration policy. Inspected accepted authority and P1 history readers only to validate concrete delegation and recovery risks.

Fixed orchestration preserves genuine committed A5 and registered profile/manifest binding. It does not manufacture approval, hashes, balances, plans or model access. Generic PR56 apply composition remains unchanged. Source I/O occurs outside transactions; complete pages are captured without filtering, both streams require an empty probe at the persisted cursor, and the 1000-event/32-request limits include terminal probes/refetches. P1 remains responsible for current authority, semantics, financial recomputation and atomic writes.

Recovery's scoped overlap locator includes either event in canonical receipt/plan/unit and association indexes, limits results to two, then requires one coherent association. Mandatory accepted receipt and unit readers validate history; fixed unit instant/lane/identity, exact new-event pair and full scenario facts are additionally checked. Partial, extra, conflicting and wrong-fact history cannot become replay success. Historical receipt recovery precedes new capture, preserving recovery after revoke without granting new-write authority.

Root's connector metadata resolution is technically sound: the approved compiled artifact exposes specHash rather than original display ID/version. Runtime binds the genuine approved artifact and registered profile/manifest; the fixture reads the registry entry for that actual artifact and asserts demo-connector-a v1. Adding a runtime registry port solely for display metadata is unnecessary. This review accepts the coordinator's explicit clarification, not an undocumented relaxation.

Optional seed changes retain the old defaults and thread the seed through generation and original-record checks without weakening proof setup. Tests cover genuine protected proof and explicit reviewer intent; no approval rows are manufactured.

## Independent commands and results

All test commands used Node 24 and PostgreSQL 18 first on PATH.

1. `npm run test:integration -- tests/integration/demo-company-a-sync.test.ts -t 'genuine fixed approval|history with conflicting'` initially exited **1**, before test behavior, because the review checkout's .local symlink produced a literal data_directory mismatch in the existing native cluster lease guard. This is a setup-only failure, not behavioral RED or a candidate defect. Log: `/tmp/company-a-task1-review-integration.log`.
2. `npm run test:unit -- apps/worker/test/demo-sync.test.ts` exited **0**, **5 passed**. Log: `/tmp/company-a-task1-review-unit.log`.
3. With coordinator authorization, verified and removed only the review checkout .local symlink and used a fresh checkout-owned cluster on **55442**. Repeated the exact integration command above: exit **0**, **2 passed / 10 intentionally unselected**. It independently exercises genuine approval/apply/reconstruction/revoke recovery plus highest-risk conflicting history rejection. Log: `/tmp/company-a-task1-review-integration-isolated.log`.
4. `git diff --check f8605642bb391f2bb5c7ec348a03494f3fc20253 98bcc469d204785e34e2d0c44a3d164c43f5f718` exited **0**. Six changed paths only; final `git status --porcelain` empty and HEAD unchanged.
5. Verified newly owned pgdata was not a symlink and postmaster port was 55442; `pg_ctl stop -m fast -w -t 20 -D /Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution/.local/pgdata` exited **0**. Log: `/tmp/company-a-task1-review-cluster-stop.log`.

Isolated rerun environment: `EAPR_PG_PORT=55442 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`. The original demo and shared integration cluster 55441 were not stopped or altered by review. Fixture-owned random resources were cleaned through fixture finally blocks. The review cluster is now stopped; SQL/service lease released.

Builder evidence inspected separately: retained typecheck exit 0, 12-case new integration pass, 10-case compatibility pass for lifecycle/default-seed generic mount, and reported full unit pass. These are builder results, not independent reruns. No full suite repeated.

## Proof limits

This verifies the assigned unmounted fixed development-fixture orchestration, not production/live construction, mounted operator/source transport, complete process restart, lost HTTP response recovery, supervisor credential isolation, browser behavior, full V5/V6, or user joint acceptance. Later tasks must establish those claims. The exact reviewed SHA and coordinator's connector metadata clarification bound this verdict.
