# Task 1 review — authority ingress transports

## Spec compliance

**Verdict: compliant for Task 1.** Reviewed exact package `review-41aa6c4..8eba700.diff`, base `41aa6c4443fb1b2e0b447303c4bc4deec59d02db` to candidate `8eba70028d7b9c47ccc54cc6fe1bd8cf9b2e2544`, against the Task 1 brief and accepted ingress design. All eleven reserved paths have the requested changes. This is a task gate, not a final branch or mounted-ingress review.

- `packages/contracts/src/authority-ingress.ts:5` defines strict positive-safe-epoch operation bodies and disjoint read-null/command-body descriptors; `:13` defines the separate 64-lowercase-hex ticket; `:14`–`:21` defines strict reviewer/grants/check/response DTOs. The new leaf imports no Node or credential code.
- `apps/control/src/authority-worker-client.ts:66` and `apps/worker/src/authority-admission-client.ts:63` reject noncanonical/nonloopback/non-HTTP origins and invalid bearer configuration. Requests use fixed paths, separate admission/bearer headers where applicable, and `redirect: 'error'`.
- `apps/control/src/authority-worker-client.ts:99` binds reads to account; `:108` binds command results to account/action/idempotencyKey/beforeEpoch after the unchanged authority response refinements validate result/state identity and transition consistency. `apps/worker/src/authority-admission-client.ts:87` binds callback results to the parsed request hash. Neither transport retries commands or reads receipts.
- `apps/control/src/authority-worker-client.ts:26` and `apps/worker/src/authority-admission-client.ts:23` validate strict error envelopes, use an own-key typed vocabulary allowlist, and derive canonical status/message from the existing AuthorityError factory. Wrong status/code pairs, unknown shapes, non-200 success shapes, malformed transport and decoding failures become UNAVAILABLE; upstream text and correlation identifiers are not copied.
- `apps/control/src/authority-worker-client.ts:35` and `apps/worker/src/authority-admission-client.ts:32` limit decoded response bytes to 256 KiB, use fatal UTF-8, reject absent bodies, cancel overflow/aborted readers, avoid awaiting arbitrary cancellation cleanup, and reject output after abort. The control request combines caller cancellation with 8 seconds (`:77`); callback uses 2 seconds (`:76`).
- `packages/contracts/src/index.ts:23`, `packages/evaluator/src/bootstrap-runner.ts:61`, and `packages/evaluator/src/financial-attestation-build.ts:10` add the leaf export and both protected inventories. `packages/evaluator/test/bootstrap-build.test.ts:49` and `packages/evaluator/test/financial-attestation-build.test.ts:57` add genuine source-byte mutation cases. The bootstrap loop asserts both subject/evaluator pins change; financial asserts its build pin changes. Existing recursive closure and missing-file checks remain.
- The exact diff contains no service/store/error, activation/capture/apply, migration, route/mount, evaluator-expectation, dependency or financial-effect changes.

## Strengths

- Request binding occurs against parsed detached input, and command-response validation combines transport binding with existing domain refinements (`apps/control/src/authority-worker-client.ts:108`).
- Controlled streaming tests exercise a never-finishing cancellation cleanup, rather than treating an aborted fetch flag alone as proof of cancellation (`apps/control/test/authority-worker-client.test.ts:124`; `apps/worker/test/authority-admission-client.test.ts:97`). Fatal UTF-8 fixtures would otherwise remain recognizable error envelopes, making their failure assertions meaningful.
- Closure maintenance changes source manifests and mutation coverage together without touching evaluator expectations (`packages/evaluator/test/bootstrap-build.test.ts:49`; `packages/evaluator/test/financial-attestation-build.test.ts:57`).

## Issues

### Important — plan-mandated duplication (quality policy)

`apps/control/src/authority-worker-client.ts:26`–`:62` and `apps/worker/src/authority-admission-client.ts:23`–`:59` duplicate the complete error-envelope validator and bounded-stream decoder verbatim. These are security-sensitive status/cancellation/byte-limit rules; future fixes must be repeated without drift. The requested task-reviewer rubric explicitly grades verbatim logic-block duplication as Important, including when plan-mandated. Task 1 also requires helpers local to these narrow clients, prohibits a reusable transport framework, and reserves no shared helper file; therefore this is a plan/quality-policy conflict, not a functional spec failure. Proposed smallest correction: extract only the existing allowlist, responseError and readJson into one private authority-transport module used by these two clients, preserving the request construction, deadlines and response bindings in their respective clients. This is a narrow helper, not a reusable framework. Root must reconcile and explicitly release that additional path against the approved plan before any implementation fix. Do not resolve it by changing the accepted service/error leaf or retrofitting unrelated clients.

No Critical or other Important functional issue found. No Minor findings.

## Dependencies inspected and reasons

- `packages/contracts/src/common.ts:6`–`:43`, `packages/contracts/src/review.ts:47`, and `packages/contracts/src/activity.ts:30`: concrete risk that imported strict/ID/hash/reviewer/error schemas would permit extra or prototype keys. Existing guarded strict schemas reject them. The initial targeted ApiError lookup in runtime.ts had no match; the subsequent exact-definition search located activity.ts.
- `packages/contracts/src/current-authority.ts:22`–`:38`: concrete risk that relying on the existing response schema would miss result/state identity or transition inconsistency; the required refinements are present.
- `apps/worker/src/sync/current-authority-errors.ts:1`–`:28`: concrete risk of incorrect allowlist/status/message reconstruction; the new allowlists cover the existing vocabulary, and both clients use the unchanged factory.
- `packages/evaluator/test/bootstrap-build.test.ts:80`–`:136` and `packages/evaluator/test/financial-attestation-build.test.ts:13`–`:83`: concrete closure risk because diff hunks list mutation entries but cut off their executing assertions and recursive/missing-file tests. These focused context reads confirmed real pin assertions and retained closure checks. No other changed source file was separately reread.
- Read applicable root/apps/packages/evaluator AGENTS, the task brief/report, accepted ingress design, and the task-reviewer prompt. The diff was reviewed once; output-truncated portions were retrieved in bounded segments.

## Verification limits

- No tests rerun: the assigned report records 18 focused tests, 7 protected-build tests, 606 full offline unit tests, typecheck and diff-check passing. The new test code supports the stated behaviors; the report contains result counts and exits, not raw execution logs. Those machine outcomes are implementer-reported evidence, not independently reproduced here. No noisy test output was provided.
- No source, Git, DB, provider, or demo mutation; only this report was written. No agents dispatched.
- Descriptor retention/freezing at ingress, ticket lifecycle, real session reauthorization, private route authentication, no-store responses, request-size middleware, committed A5 lookup, SQL boundaries, full worker-derived identity binding and browser behavior belong to later tasks and cannot be established by these standalone clients/DTOs. The candidate must not be treated as mounted or financially accepted.

## Assessment

**Task quality: Needs fixes (Important plan-mandated duplication).** The functional implementation meets the assigned strict transport and protected-closure requirements. The duplicated security-sensitive decoder/error logic triggers the reviewer rubric’s Important threshold despite following the plan’s local-helper constraint. No authorization, financial or transport correctness defect was found.
