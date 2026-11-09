# A1a protected financial attestation runner

Base `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542`  
Candidate `4a79b53f405590b3da96681d6cb64709e7a834e3` on `codex/financial-attestation-runner` in the acquisition-evaluator worktree.  
Handoff SHA-256 `4363879226cc6994dcfec28966029b9e2a7d36cdc2bd3667ec97761f23885be5`.

## Implementation

- The protected child accepts separate probe and execution envelopes. It binds full normalized input to the request hash and a private fd 3 context. It validates the registered snapshot object, aggregate content, every member stream and all event hashes before probing or running. The launcher re-resolves the candidate and verifies the build on both sides of transport. Production child URL, cwd, and caps are fixed.
- The child opens the construction v2 pin by hashed identity inside a private, physically resolved directory disjoint from served roots. It decodes the first bounded bytes once for evaluation and reads the validated bundle digest from those same bytes. The shared evaluation core consumes that decoded fixture. A later read must equal the exact first bytes and the build must still match before completion. Probe performs no subject run. Fixed exit failures expose only safe categories.
- The completion gate checks the reserved job, request, reservation, capture, evidence and build pins. It requires the complete thirteen-entry report shape and sanitizes diagnostics through the original report validator before hashing. Actual subject transport failure aborts the attested request. Schema-valid outcomes with failed or unavailable checks may return ineligible audit reports. The root-approved optional strict mode in `cases.ts` preserves legacy handling by default. The numeric 1 legacy report and subject protocols still work.
- Safe entrypoints are `@eapr/evaluator/financial-attestation-launcher` and `@eapr/evaluator/financial-attestation-verify`. The launcher exports `createProtectedFinancialLauncher({registry, roots})` and `readFixedFinancialBuildHash()`. The verification entrypoint exports `deriveFinancialCapture`, `validateFinancialCompletion` and `validateFinancialProbe` with the shared typed ports. The protected decoder and core stay in evaluator-only modules.

## Changed paths

```
packages/evaluator/package.json
packages/evaluator/src/cases.ts
packages/evaluator/src/evaluator-runner.ts
packages/evaluator/src/financial-attestation-build.ts
packages/evaluator/src/financial-attestation-evaluator.ts
packages/evaluator/src/financial-attestation-launcher.ts
packages/evaluator/src/financial-attestation-protocol.ts
packages/evaluator/src/financial-attestation-runner.ts
packages/evaluator/src/financial-attestation-verify.ts
packages/evaluator/src/financial-evaluate.ts
packages/evaluator/src/launcher.ts
packages/evaluator/test/cases.test.ts
packages/evaluator/test/children/financial-attestation-execution-failure.mjs
packages/evaluator/test/children/financial-attestation-interposition.mjs
packages/evaluator/test/children/financial-attestation-wire.mjs
packages/evaluator/test/financial-attestation-build.test.ts
packages/evaluator/test/financial-attestation-protocol.test.ts
packages/evaluator/test/financial-attestation-runner.test.ts
packages/evaluator/test/financial-evaluate.test.ts
tests/integration/financial-attestation-runner.test.ts
```

## Source closure

The new financial digest hashes 76 sorted repository-relative `{name,hash}` entries. The manifest includes the new attestation modules and extracted core, legacy evaluation and candidate lookup dependencies, actual compiler/finance/parent subject closure, evidence/source validation, A0 contracts, storage transaction, package manifests, root TypeScript configuration and dependency lock. The closure test walks each pinned TypeScript file's local imports and resolves workspace package exports. Isolated mutations exercise compiler, finance, authority contracts, the core, wrapper and lock.

- Financial build `2df59861411a90667e15a502716bb0ce4660c7dd3d46044f8a308f5ff7b8725f`
- Legacy build `a020a5ac465458de279849934529e27f511fe8f03bc0cfd3c24e4654bd346f5a`. Its existing list adds only `financial-evaluate.ts`. The original hard-coded expectation adds the same file.
- Bootstrap evaluator `0031e4e3f7f074fce0caeb322c365a23abd27d3131506c8f4405d78cb8d62a71`, subject `94d731e44ca0ed9818fe41ab3c909601f79a74282019391a78338f9a985e73f2`. Both changed because their existing manifests include the evaluator package manifest. Bootstrap code and manifest lists were untouched. These intermediate pins describe the exact candidate and should be refreshed after later closure changes.

## Machine verification

Node 24.22.2 and PostgreSQL 18.6 with the assigned lease. `EAPR_PG_PORT=55435 EAPR_CONTROL_PORT=3301 EAPR_WORKER_PORT=3302 EAPR_WEB_PORT=5176 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2`.

- `npm run typecheck` passed.
- `npm run test:unit -- packages/evaluator/test` passed 78 tests in 17 files, including legacy evidence/case/subject regressions, build closure and mutation vectors, aggregate stream framing, fd 3 privacy, timeout cleanup and strict-versus-legacy transport behavior.
- `npm run test:integration -- tests/integration/financial-attestation-runner.test.ts tests/integration/v2-verification.test.ts tests/integration/bootstrap-verification.test.ts` passed 5 tests in 3 files. Actual metadata-bearing A/B captures used a real candidate registry and completed all 13 checks. The new test covers malformed/substituted binding, omitted/added/duplicate events, stale build and pin mismatch, symlink-overlapping roots, sanitized diagnostics, an actual ineligible altered-term outcome and subject startup failure. The ABA interposition installed invalid pin bytes after the first read and restored the original before the first real subject start. The eligible result and byte equality prove evaluation did not reopen the swapped fixture for its oracle. The original A/B fixture bytes remained unchanged.
- `git diff --cached --check` passed before commit.

These are scoped transport/core and legacy regressions. The integration PostgreSQL lease supplied registered capture inputs. Financial reservation storage, registry issuance, HTTP composition, policy, activation, live behavior and joint acceptance remain later slices. Fresh independent exact-candidate review is pending.

## Independent review fix round 1

Reviewed candidate `4a79b53f405590b3da96681d6cb64709e7a834e3` remains the original implementation above. Superseding exact candidate `4ff530765374cc3e016a1024e44718a4105e3af2` on the same clean branch and original D0 base.

A strict private mismatch frame contains only its protocol tag, job ID and request hash. The same bounded transport validates the frame and its exact request binding before the financial wrapper converts it to `REQUEST_MISMATCH`. The existing launcher exposes `FINANCIAL_ATTESTATION_MISMATCH`. The child emits this frame for validated request/context, fixture/capture or build conflicts, including post-run pin or source build change. Decode failures, missing or inaccessible proof and abnormal subject execution continue through the unavailable path. No protected error text is forwarded. A valid negative comparison still yields a sanitized ineligible report.

The running-child regression uses the real protected evaluator through the private test transport. A test-only interposer copies the compiler's `plan-batch.ts` into the temporary pin directory. At the first real subject spawn it changes the isolated copy and makes subsequent digest reads of that one closure entry resolve to the copy. All other closure entries and the actual subject are unchanged. The test verifies the mutation marker, then requires a mismatch with no completion. Since this bypasses the parent launcher build check, the assertion exercises the child's post-run guard. The working source is never modified.

Changed paths relative to the reviewed candidate

```
packages/evaluator/src/financial-attestation-evaluator.ts
packages/evaluator/src/financial-attestation-protocol.ts
packages/evaluator/src/financial-attestation-runner.ts
packages/evaluator/test/children/financial-attestation-interposition.mjs
packages/evaluator/test/children/financial-attestation-wire.mjs
packages/evaluator/test/financial-attestation-runner.test.ts
tests/integration/financial-attestation-runner.test.ts
```

The financial closure retains 76 paths and now hashes to `2410a562440e38a08e7f33c5cd3426aeb58ebd1be177a3ef499a9c5ac56f8c5a`. Legacy and bootstrap closure inputs were untouched by this round.

Commands ran with the same Node/PostgreSQL versions and lease listed above.

- Red on `4a79b53` with regression tests added, `npm run test:integration -- tests/integration/financial-attestation-runner.test.ts` failed at both new assertions. A real reserved pin conflict returned `FINANCIAL_ATTESTATION_UNAVAILABLE`, and the running-child build mutation returned `EXIT_FAILED` at the private boundary.
- Green `npm run typecheck` passed.
- Green `npm run test:unit -- packages/evaluator/test/financial-attestation-protocol.test.ts packages/evaluator/test/financial-attestation-runner.test.ts packages/evaluator/test/financial-attestation-build.test.ts` passed 4 tests in 3 files. The wire test covers the fixed mismatch frame, a wrong request hash and rejection of extra detail.
- Green `npm run test:integration -- tests/integration/financial-attestation-runner.test.ts` passed in 31.53 seconds. Both registered A/B positives, the real pin mismatch, the temporal source mutation, the malformed fixture unavailable case, forced subject startup failure and the ineligible altered-term report were exercised.
- `git diff --cached --check` passed before commit.

Fresh independent review remains pending. This round is scoped to A1a transport and evaluator proof.
