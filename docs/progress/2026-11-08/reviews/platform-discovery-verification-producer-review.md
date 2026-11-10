# D4b Gate P exact-candidate independent review

Reviewed source candidate `4af12bd79e315a0701d896666cb119095dcfec9c` against base `7a90f1617b70171495dc90adc206cbe873fe09ee`.

Specification verdict: PASS for Gate P producer scope.

Code-quality verdict: PASS for Gate P producer scope.

No actionable blocking findings identified. This is an independent source/evidence review, not a new machine-test run, Gate J acceptance, tool-mounting permission, V4 acceptance, or user acceptance.

## Scope and method

Read the producer brief, full accepted adapter design and correction review, producer report, supplied candidate diff, relevant area guidance, and exact candidate source. Follow-up inspection was limited to named risks: financial registry completion/redaction and regression coverage, reviewer extraction equivalence, schema safety, existing composite foreign-key support, and build closure. The large supplied diff output truncated; exact-candidate file reads supplied the omitted contents. No source/git changes, database use, test reruns, subagents, or external comments. The only written artifact is this report.

The builder reports exact-source typecheck, 80 evaluator tests in 19 files, and 13 integration cases in 10 files. Those executions were not independently repeated. The inspected tests substantiate the reported behavior within the explicitly test-owned transaction harness.

## Specification assessment

- Immutable identity: `discovery-verification.ts:80` includes the full candidate, declared profile-set ordering, task scope and explicit snapshot-object hash. New admission checks authoritative registered spec equality and full canonical registration before preparation (`:221` onward). Historical reads compare both bytes and hash and reconstruct the candidate portion from the saved financial request (`:108` onward). Same-key existing work bypasses preparation, fixture selection and build reads.
- Atomic admission: callback at `discovery-verification.ts:231` rechecks mapping before `reservePreparedOn`, then inserts the immutable mapping on the supplied client. Registry primitive at `financial-attestation-registry.ts:128` owns no transaction or pool checkout. Budget/job/reservation/mapping effects depend on the owner's commit. Unique-conflict recovery performs a fresh gated lookup.
- Claim safety: queued-only conditional update at `discovery-verification.ts:143` yields explicit claimed/not-claimed. `recover` requires the gate's committed result before execution. Running, failed and completed observations never relaunch. Unknown admission/claim commit results throw safe owner-loss outcomes; no unconfirmed result reaches execution or failure. Only `execute` for a confirmed claimed result may fail the job after external validation/execution errors.
- Saved execution: the claim returns saved reservation bytes; execution re-parses and verifies canonical bytes, job and request digest, then revalidates the registered full subject before launching that saved request. Recovery does not prepare a new request or update pins/build.
- Safe reads: read-by-key returns the safe VerificationJob and an execution-uncertainty boolean, not binding/request/pin bytes. Failure paths use fixed error classes or fixed financial diagnostics. `get` intentionally retains the pre-existing trusted metadata reader contract; authorization of that reader and lifecycle interruption diagnostics remain consumer responsibilities, expressly documented rather than claimed here.
- Reviewer preservation: preparation and projection are extracted with equivalent logic; reviewer enqueue response, run/start path, error translation, get and drain remain intact. Legacy read compatibility remains in the unchanged regression test. No worker/provider path was changed.
- Migration: only control009 changed in the migration directories. SHA-256 independently checked as `5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0`. Control007 already supplies the tool-step composite uniqueness referenced by 009, so avoiding a redundant ALTER is correct. 009 has bounded generations/revisions and subject bytes, exact hash formats, primary/unique request-job identities, step/dispatch/assessment/reservation foreign keys, and SELECT/INSERT-only app grants.
- Build closure: new producer is included in financialBuildSources. Existing recursive import/export coverage test checks local dependencies, and expanded mutation test changes producer/jobs/registry independently. Changed source therefore invalidates the financial pin. Prior installed financial policies are not claimed current.

## Gate P evidence audit

The new integration case uses real migrated PostgreSQL app roles, with deliberate test-owned transactions. Its assertions cover:

1. Migration through 008 followed by 009 and exact ledger digest; absence of mapping table in runtime; unchanged runtime table contents across the test.
2. Pre-admission supplied-spec mismatch with zero probes and zero persisted effects.
3. Lost admission acknowledgement leaving one queued mapping/job/reservation/attempt, followed by a fresh producer executing the original saved input through the actual protected launcher. Launcher assertion compares canonical launch bytes to saved request bytes and observes running state.
4. Real completion with 13 nonempty passed checks, eligible coverage, report and attestation; forged report-only completion, wrong request hash, missing mandatory check and differing duplicate completion rejection; exact duplicate success.
5. Completed historical replay while new build/pin/candidate dependencies deliberately throw, with no additional probe or launch; historical mutations of spec/artifact/profile/scope/manifest/snapshot reject; run/account denial and alternate-account binding conflict; safe read projection excludes private fields.
6. App-role mapping UPDATE/DELETE denial and attestation DELETE denial; request hash foreign-key rejection; corrupted subject bytes/hash and saved request bytes/indexes reject. Existing financial registry regression also mutates canonical request bytes, reservation bytes/hash, snapshot and capture indexes and proves provenance read rejection.
7. Before-commit rollback barrier proves no visible or surviving admission effects; absent read follows rollback. Before-claim loss leaves original queued work intact. Post-claim-commit/before-launch and in-launch barriers prove the original job is running with one launch. Known-local execution and replacement uncertainty are distinct; failed replay consumes no new attempt and raw launch sentinel is absent.
8. Lost queued-to-running acknowledgement leaves running work; replacement read and replay never launch or fail it, and durable counts remain unchanged.
9. Separate post-confirmed-claim candidate failure marks only its admitted job failed without launching. Same-key contenders synchronize after lookup and admission and produce one running job/attempt/launch; the losing claimant does not fail the winner.
10. Different keys with attempts already two admit exactly one third attempt and leave no losing reservation; distinct persisted steps retain the reused provider-native ID without conflating requests.
11. Mapping primary-key/job uniqueness and missing reservation/step foreign keys reject with no surviving effects.

Existing financial-attestation registry regression supplies completion/fail row-lock races in both winner orders, atomic report/attestation rollback, sanitized private diagnostic sentinel, legacy historical reads without financial provenance, reviewer non-recovery, and durable attempt contention. Existing composition and listed A1/bootstrap regressions are the reported compatibility evidence. No claim is made that the producer test authenticates actual supervisor authority.

The report's RED/GREEN narrative and command durations are builder-reported execution history, not reproducible facts established by source review. The assertions themselves support the listed behavioral claims. End-to-end transcript/activity protection, current scoped verificationJobs, actual paused recovery, generation replacement, task/proposal/assessment history, sticky revocation, owner connection loss, and current settlement are explicitly Gate J obligations, not missing Gate P implementations.

## Required next boundary

Proceed only to separately assigned Discovery consumer integration. Gate J must implement the real owner transaction port, enforce current authority and admission preflight, distinguish rollback from unknown COMMIT, authenticate immutable historical association, and publish safe interruption observations. It must pass against the actual supervisor before mounting or advertising requestVerification/readVerification. This review does not relax that boundary.
