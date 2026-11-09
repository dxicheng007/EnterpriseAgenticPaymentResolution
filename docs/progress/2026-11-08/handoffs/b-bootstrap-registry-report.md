# S3b bootstrap registry candidate

- Base `735e680088f3fb4ad43ed1a72439a1f293351879`.
- Head `dbf2f09451e6094a0f801867751cac2ff3db16ea` on `codex/bootstrap-registry` in the acquisition-sources worktree.
- Commit `feat: persist immutable bootstrap verification completions`. Worktree clean after commit.

The trusted jobs service resolves the immutable candidate and configured pin before reserving. The registry allocates the UUID and persists the canonical request and evaluated target before the launch. It validates S3a's full completion envelope against that request and stores the returned canonical result, completion, and observed plan atomically. Concurrent completions serialize on the reservation. Exact replay is idempotent and differing valid or invalid bytes reject. The reader verifies the committed request and proof bytes, exact trusted expected pin, binding, and plan hash, the result's passing coverage, and the candidate association. Control migration 005 follows 004. The application role can only insert/read proof and change job state.

The integration ran real Company A and Company B construction captures through the fixed protected launcher and registered their proof. It closed the original control pool and reopened the passing proofs from PostgreSQL and the immutable candidate store. Company B's valid baseline had zero balance and a nonempty plan. The scripted comparison used a temporary evaluator entrypoint with only subject transport redirected. The exact scripted child is the fixed subject runner with the following code inserted immediately before its strict stdout parse, plus a `hashPlan` import and absolute test module paths.

```ts
if (requestId === 'bootstrap-subject:captured_baseline') {
  const plan = outcome.plans[0];
  const changed = { ...plan, expectedBalanceCents: plan.expectedBalanceCents + 17 };
  outcome.plans = [{ ...changed, hash: hashPlan(changed) }];
}
```

The temporary child passed the altered outcome through real bounded subject transport. Real evaluator comparison retained that observed baseline and produced a failed result. The test launcher used bounded evaluator transport and the standard completion validator. The registry persisted the unchanged canonical returned envelope and plan. After the pool closed and reopened, the integration verified the stored result, envelope, plan bytes, full plan hash and observed-byte hash. The proof reader rejected the failed comparison. Additional checks covered queued/running/failed jobs, changed expected target/snapshot/build/scope/plan, malformed completions, exact replay, competing valid completions, transaction rollback injected between proof insert and state update, and an unavailable reader.

## Focused machine checks

- Red migration behavior on base with initial test only. Native PostgreSQL returned null for `to_regclass('bootstrap_verification_results')` before migration 005. The first invocation rejected the invalid demo namespace before test collection. The corrected invocation reached the expected assertion.
- `npm run typecheck` passed.
- `npm run test:unit -- packages/evaluator/test` passed, 73 tests across 13 files.
- `npm run test:integration -- tests/integration/bootstrap-verification.test.ts tests/integration/v2-verification.test.ts` passed, four tests across two files in 29.25 seconds.
- `git diff --cached --check` passed before commit.

Checks used Node 24 and PostgreSQL 18, assigned PostgreSQL 55434, control 3201, worker 3202, web 5175. `EAPR_TEST_PREFIX=eapr_test_review_t1` and `EAPR_DEMO_NAMESPACE=eapr_review_t1`. The latter is the allowed equivalent under native-db's separate demo namespace grammar. Test databases were disposable and used separate provisioned control/runtime credentials.

This is focused machine evidence for S3b and the existing financial integration. The negative scripted case is transport and persistence evidence. This candidate awaits independent review. Combined readiness and financial attestation, HTTP and authorization composition, activation and worker behavior are separate scopes.
