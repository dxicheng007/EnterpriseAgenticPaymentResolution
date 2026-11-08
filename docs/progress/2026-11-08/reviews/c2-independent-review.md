# Independent C2 checkpoint review

Candidate: `f24029690c88318f61d951187f1441957c9649e7`.
Accepted base: `5e6111ec0807e7dfd642ab01797fd7d861d16645` (supersedes the older handoff dependency).
Review checkout: `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`.
Reviewer session: `/root/astra_c2_verify`, independent of the producer and supervising root.
Contract hash supplied by the handoff/evidence: `863cdbc91c527b5e6d1f08e0ee7dedfd4483a0548249954ea732e196394d077a`.

## Verdict

Spec compliance: reviewed for the explicitly bounded C2 baseline checkpoint. Code quality: reviewed. No actionable defect found within that envelope. This is not full V2 acceptance. Full V2 machine status remains partial; joint user acceptance remains pending.

Reviewed the scoped diff, repository and area guidance, handoff, producer result packet, frozen F6, and verification playbook. The registry recompiles and checks artifact identity; pins canonical objects and capture associations using immutable files and insert-only application grants; rechecks bytes and semantic hashes on reads; rejects conflicting republish and ignores unregistered orphan files. Verification routes require injected trusted authorization, bind connector/artifact/profile/manifest, enforce source and account scope on submission and polling, and constrain task polling to the stored run. Task attempt reservations use an atomic PostgreSQL upsert with a maximum of three.

The actual subject imports the production planner and receives visible inputs only. Expected records come from strict private facts and the independent reference model. Actual financial inserts are collected separately for complete-record comparison, including nonmonetary mismatch. Report policy checks immutable subject/fixture/build identities and complete coverage before eligibility. Harness version is additionally pinned by the shared schema's literal `1`. Fixed evaluator reports correctly leave twelve mandatory checks unavailable and eligibility false. Failed subprocess/launcher jobs expose fixed diagnostics instead of arbitrary errors. The new code provides no issuance, payment movement, activation authority, runtime credential, or runtime write capability.

## Independently observed checks

Used Node 24 and PostgreSQL 18 on PATH, isolated review PG 55436, control 3401, worker 3402, web reserved 5177, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, and `EAPR_TEST_PREFIX=eapr_test_review_t2`.

- `npm run typecheck`: passed.
- `npm run test:unit -- packages/evaluator/test`: 32 tests passed in four files, including real planner wrong-mapping rejection, oracle regressions, strict transport, fixture integrity/isolation, and report policy.
- `npm run test:integration -- tests/integration/v2-verification.test.ts`: two tests passed using real isolated PostgreSQL and HTTP. Exercised concurrent immutable republish, tampered/orphan bytes, write-grant rejection, authenticated scope and run checks, forged request rejection, exactly three accepted reservations out of six concurrent attempts, safely persisted async failures, and a real fixed evaluator's immutable ineligible baseline report.
- Separate stdin-only negative probe: 12 assertions passed. Rejected artifact/manifest/build substitutions, harness version `2`, missing profile binding, duplicate checks, falsely eligible unavailable coverage, falsely eligible empty kind coverage, duplicate truth accounts, unknown truth-record fields, altered event content hash, and wrong-seller profile binding. These probes created no product/helper files.
- `git diff 5e6111ec0807e7dfd642ab01797fd7d861d16645 --check`: clean. `git status --short`: clean after verification.
- `npm run db:down`: review-owned native PostgreSQL stopped. Test harness closed its control and worker services.

## Limits preserved

No reviewed generated protected v1 truth was consumed; all exercised truth is explicitly public development fixture material. Normal reviewer/source composition, browser workflow, authoritative persisted parent storage, live provider execution, and final unseen holdout remain unproved. Filesystem permissions/capability-restricted tools remain a deployment trust assumption; subprocess separation itself is not an access boundary. The observed runtime check covers existing schema and activity, not future parent tables. No service activation or user approval is implied.

Unavailable mandatory checks remain: `new_record`, `duplicate_delivery`, `retry_restart`, `invalid_money`, `allocation_scope`, `full_reversal`, `dependency_order`, `schema_drift`, `semantic_drift`, `unknown_identity`, `snapshot_boundary`, `evidence_support`. None was promoted to passed. No product edits, helper additions, commits, or pushes were made.
