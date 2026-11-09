# A1b financial attestation registry implementation

- Assigned worktree `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution` on `codex/financial-attestation-registry`.
- Base `5ce860b4a74d8db13c96c27a2af8bd5164527625`.
- Candidate `766714f80d31c6d2bbb961ff3094bc4a9a0d7615`, clean worktree after commit.
- Control006 SHA-256 `a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45`. The migration catalog discovers numbered SQL files. The integration explicitly upgrades from control005 before exercising the new tables.

## Ports and persistence

`createFinancialAttestationJobs({db,candidates,captures,launcher,selectFixture,readBuildHash})` exposes `enqueue(candidate,task?)`, `get(jobId)` and `drain()`. It resolves an immutable candidate and exact full capture, validates the protected probe and checks the current build before committing one budget/job/reservation transaction. It starts only that saved input. It uses the fixed launcher through the injected trusted port and issues only sanitized completion through the internal registry. Newly constructed services leave incomplete jobs in their stored non-success state. Existing completed jobs remain inspectable through the legacy summary shape.

`createFinancialAttestationRegistry(db,candidates)` owns the trusted `reserve`, `start`, `complete` and `fail` transitions. The report, exact sanitized completion bytes, attestation and completed job state commit together. Complete and fail serialize through the job row. Exact normalized replay returns the same report and attestation. The new rows have SELECT/INSERT grants. The composite foreign keys bind the attestation to both its original report/job and the original reservation/request hash.

`readRegisteredFinancialAttestation(reportId,{artifactHash,requiredProfileHashes,capture,policy})` joins the durable proof and validates canonical bytes, hashes, indexes, stored job scope/summary, immutable candidate, and current policy digest. A single complete policy entry must match all financial fields and an exact registered profile scope. It returns only an eligible financial report and attestation. The reader consumes no fixture or mutable capture service. Missing/unattested proof and noneligible reports return 503 `FINANCIAL_ATTESTATION_UNAVAILABLE`. A malformed or conflicting binding returns 409 `FINANCIAL_ATTESTATION_MISMATCH`.

## Changed paths and build closure

- `db/control/006_financial_provenance.sql`
- `packages/evaluator/src/financial-attestation-{registry,jobs}.ts`
- `packages/evaluator/package.json` adds the two explicit safe package entry points.
- `packages/evaluator/src/financial-attestation-build.ts` adds both new modules. Their evaluator, contracts, compiler and storage imports are already in the manifest. The updated `packages/evaluator/test/financial-attestation-build.test.ts` checks transitive local coverage and mutations of both modules.
- `packages/evaluator/test/financial-attestation-registry.test.ts`
- `tests/integration/financial-attestation-registry.test.ts`

The 78-entry fixed financial source closure at this candidate hashes to `7019df51b13dd65fa6a4757cffff1cf325c9f88b536cd527d62fc027703b1ede`. This is an intermediate build digest. Later integration must recompute actual pins before operator policy installation.

## Machine verification

Used Node 24.22.2 and PostgreSQL 18 binaries. PostgreSQL integration used `EAPR_PG_PORT=55435`, `EAPR_CONTROL_PORT=3301`, `EAPR_WORKER_PORT=3302`, `EAPR_WEB_PORT=5176`, `EAPR_TEST_PREFIX=eapr_test_review_t2` and `EAPR_DEMO_NAMESPACE=eapr_review_t2`.

- `npm run typecheck` passed on final files.
- `npm run test:unit` passed 333 tests across 51 files after final production changes.
- `npm run test:integration -- tests/integration/financial-attestation-registry.test.ts tests/integration/v2-verification.test.ts tests/integration/bootstrap-verification.test.ts` passed five tests across three files after final production changes.
- `npm run test:integration -- tests/integration/financial-attestation-registry.test.ts` passed on final files, including the last restart and runtime-isolation assertions.
- `git diff --cached --check` passed before commit.

Both metadata-bearing captures use generated construction evidence, real immutable candidate registration, actual fixed protected launches and all 13 checks. The test observes the committed original input before each launch, then reopens registry persistence and reads the proof with the current fixture temporarily unavailable. The scripted negative completion is storage and sanitization evidence only. Tests cover concurrent attempt caps, reservation rollback, completion rollback after report/attestation insertion, both complete/fail lock orderings, exact replay, conflicting replay, invalid persisted input and indexed digests, runtime isolation, unavailability, legacy inspection without issuance, and mixed policy entries.

This is scoped A1b machine evidence. A1c control composition, deployment policy installation, combined readiness, activation, broader slice verification, independent candidate review and joint user acceptance are separate work.
