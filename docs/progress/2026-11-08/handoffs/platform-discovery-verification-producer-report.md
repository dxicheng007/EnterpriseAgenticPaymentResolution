# D4b Discovery verification producer handoff

Branch `codex/platform-discovery-verification`, worktree `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Implementation base `7a90f1617b70171495dc90adc206cbe873fe09ee`. Producer candidate `4af12bd79e315a0701d896666cb119095dcfec9c`. The report commit records evidence for that producer tree.

The [accepted design](platform-discovery-verification-adapter-design.md) specifies Gate P producer behavior and the separate Gate J against the actual Discovery supervisor. The focused results below are machine evidence for the producer candidate. Exact-candidate independent review and the later Gate J remain pending. Gate J owns current supervisor authority, fencing, settlement and publication. V4, live provider and user acceptance are separate.

## Trusted server port

`@eapr/evaluator/discovery-verification` exports:

- `createDiscoveryVerification(options: DiscoveryVerificationOptions)` requires the existing attested service dependencies, an explicit `gate: DiscoveryVerificationOwnerGate` and `resolveTaskId(input: Omit<RequestIdentity, 'taskId'>): Promise<string>`. Resolve the original persisted tool-step association outside the callbacks. The resolver does not confer authority. Every gate operation reauthenticates that association on its owner connection.
- `enqueueDiscoveryVerification({ requestKey, candidate, task: { runId, accountId } }): Promise<VerificationJob>` on the returned service. The request key is the persisted server tool-step ID. The caller preflights new tool work before invoking the producer. After an authorized absent historical lookup, preparation occurs outside the owner transaction and `admit` rechecks current preflight, authority and subject before the SQL callback and commit.
- `readByRequestKey(input: DiscoveryVerificationInput): Promise<{ kind: 'absent' } | { kind: 'existing'; job: VerificationJob; executionUncertain: boolean }>` authenticates through historical lookup and performs no recovery or external preparation. The uncertainty flag compares the running observation with confirmed ownership in this producer instance. Consumer lifecycle projection owns the fixed interruption diagnostic and its history.
- `get(jobId)` returns the existing safe `{ job, sourceRefs, accountIds, taskRunId }` metadata. Trusted consumers must enforce the exact run/request association and current source/account authority before returning this observation. `drain(): Promise<void>` waits for currently tracked in-process claims.
- `discoveryVerificationSubject(candidate, task)` returns canonical `{ subjectBytes, subjectHash }`. The versioned preimage includes the full registration, sorted profile set, task scope and exact snapshot-object digest. Artifact bytes include the registered spec hash. Initial preparation explicitly compares the supplied and registered specs and then the entire canonical registration.
- `RequestIdentity`, `PersistedBinding`, `GateOutcome<T>`, `HistoricalLookup`, `AdmissionResult`, `ClaimResult`, `DiscoveryVerificationOwnerGate`, `DiscoveryVerificationInput`, `DiscoveryVerificationOptions` and `DiscoveryVerificationFailure` are the internal server types and safe failure class. Committed, denied and owner-lost outcomes remain distinct. Owner loss surfaces `DISCOVERY_OWNER_LOST` with `commit: 'not_committed' | 'unknown'`. The next call starts with fresh authorized lookup. Request/capture/binding or budget conflicts use fixed `DISCOVERY_CONFLICT` 409, and unclassified preparation/storage failures use fixed unavailable 503.

The gate invokes its callback once on the actual caller-owned transaction. Lookup reads and validates original mapping, task, job and saved financial bytes before returning the safe job. Admission rechecks the exact mapping before incrementing the durable max-three budget and inserting the queued job, reservation and binding. The gate owns its same-transaction step claim/reference. The primary-key backstop rolls back a racing losing reservation. Recovery validates the original binding and claims only queued state. Only a positively acknowledged claim starts post-commit canonical request and registered candidate validation and launches the saved request. Losing and unconfirmed callers never launch or fail the job. The winning claimant can fail after its own validation/execution error. Running replay exposes uncertainty without granting another attempt.

Reviewer `enqueue(candidate, task?)`, `get(jobId)` and `drain()` use the same prior wire. Shared functions extract preparation, reservation SQL and safe job projection. Reviewer reservation still uses its own transaction and registered capture validation. Reviewer start, completion, and the legacy numeric-1 path retain their existing execution paths. The protected child, evaluator oracle, supported coverage and financial attestation preimages were reused without edits.

## Migration and changed paths

Control009 `db/control/009_discovery_verification_requests.sql`, SHA-256 `5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0`. The new mapping references the existing control007 composite step key, original dispatch and proposal assessment and exact control006 job/request pair. It preserves the original generation and revisions as bounded safe BIGINT values and grants SELECT/INSERT to the control app role. Existing migrations and runtime DDL were preserved. The generic sequential catalog discovers 009 and the integration test migrated through 008 before applying it and checking its exact ledger digest.

- `packages/evaluator/src/discovery-verification.ts`, `financial-attestation-jobs.ts`, `financial-attestation-registry.ts`, `financial-attestation-build.ts` and `packages/evaluator/package.json`
- `packages/evaluator/test/discovery-verification.test.ts`, `financial-attestation-build.test.ts` and `tests/integration/v4-verification-idempotency.test.ts`
- `packages/evaluator/AGENTS.md`, `db/AGENTS.md`, this tracked handoff and its ignored workspace report counterpart

The final 79-file financial build pin is `caf17a31bc429f84e0fbb900fad82219b90a21e76139a1a97d55dc0b6f3cc448`. The closure test walks imports, including package export targets, and the mutation test changes the producer and shared jobs/registry source one at a time. Subsequent trusted financial evidence must use the current pin. Test execution selected generated isolated construction pins with the existing protected launcher and capture adapter.

## Focused machine evidence

Node `24.22.2`, PostgreSQL `18.6`, isolated port `55441`, test namespace prefix `eapr_test_review_t2`. Integration files ran serially.

- RED. The first focused run found the new subject module absent and the build mutation test failed because the pinned producer source was absent. After the first implementation passed, the explicit snapshot-object-hash assertion independently failed on the missing preimage field. GREEN after adding it.
- `npm run typecheck` exited 0. `npm run test:unit -- packages/evaluator/test` passed 80 tests across 19 files. `git diff --check` exited 0.
- The isolated serial integration test asserts exact ledger, mapping, budget, queued/running/completed/failed job, reservation, report and attestation counts. Named barriers hold pre-commit, post-admission, post-claim before launch and in-progress launch. The test simulates rollback and discarded commit acknowledgement separately. It exercises new and historical spec conflicts, altered registered subjects, cross-scope denial, corrupted canonical bytes/indexes, duplicate and foreign-key constraints, same-key races with one launch, different-key third-attempt contention, reused native IDs in different dispatches and unchanged runtime state.
- The actual protected evaluator completes the original persisted input after a fresh producer recovers a queued job. It produces 13 nonempty passed checks, an eligible summary, report and attestation. Forged report-only, wrong request digest, missing mandatory coverage and different duplicate completion reject. Exact duplicate completion succeeds. Real reviewer and registry regressions exercise normal reviewer authorization/status, legacy reads and the existing completion/failure races.
- `npm run test:integration --` with the ten paths below passed 13 tests across 10 files on the final producer source in 186.72 seconds. An earlier full run before the final subject digest and shared-reader cleanup also passed 13 tests across 10 files. The first baseline real proof passed 1 test across 1 file before extending the matrix.
  - `tests/integration/v4-verification-idempotency.test.ts`
  - `tests/integration/financial-attestation-registry.test.ts`
  - `tests/integration/financial-attestation-composition.test.ts`
  - `tests/integration/financial-attestation-runner.test.ts`
  - `tests/integration/v2-verification.test.ts`
  - `tests/integration/bootstrap-verification.test.ts`
  - `tests/integration/bootstrap-financial-verification.test.ts`
  - `tests/integration/bootstrap-runner.test.ts`
  - `tests/integration/bootstrap-demo-candidates.test.ts`
  - `tests/integration/bootstrap-fixture-setup.test.ts`
- Setup failures before the baseline green were a 13+ character fixture label rejected by the lease helper and the sandbox denying PID checks for the already-running leased PostgreSQL instance. The label was shortened. The authorized local integration command used escalated execution on the assigned lease. No demo namespace was written. The fixture databases were created and dropped per suite.

## Remaining gate and lease

The test-owned transaction harness proves producer SQL, constraints and outcome handling. Gate J must use the private actual supervisor transaction and prove pause, owner replacement and loss, current reviewer/run/source/account and capture checks, old proposal/task/assessment historical recovery, current settlement and the scoped public tool observations. Tool registration, supervisor, application composition, activity and worker files are outside this candidate.

The evaluator producer, integration-test and control009 writer reservations are released to root on handoff. The PostgreSQL 55441 lease is released after the final serial integration run and fixture cleanup. The native cluster is available for root's follow-on isolated checks.
