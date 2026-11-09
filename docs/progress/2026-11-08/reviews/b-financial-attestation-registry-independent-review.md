# A1b independent exact-candidate review

Reviewed candidate `766714f80d31c6d2bbb961ff3094bc4a9a0d7615` on `codex/financial-attestation-registry`, against base `5ce860b4a74d8db13c96c27a2af8bd5164527625`, in `/Users/devincheng/.codex/worktrees/acquisition-evaluator/EnterpriseAgenticPaymentResolution`. HEAD matched and the worktree was clean before and after verification. No implementation edits or commits were made.

## Result

No actionable findings. The candidate satisfies the bounded A1b registry/jobs assignment on the reviewed evidence. This is independent acceptance of this candidate's A1b implementation, not activation authority, deployment-policy installation, A1c composition, a full slice gate, or joint user acceptance.

Reviewed all eight changed files and their actual validation, launcher, immutable-candidate, schema, transaction, migration, report-sanitization and build-closure dependencies against repository/area instructions, the A1 handoffs, implementation report, accepted authority proposal/handoffs and authority freeze.

## Boundary checks

- Enqueue allocates a server job ID, re-resolves exact registered subject and full capture, validates the protected probe/current build, and commits budget, queued job and exact immutable input together before launch. Task attempts use the existing atomic maximum-three upsert. Probe failure does not consume an attempt or issue a report. Start reloads and validates the saved bytes; restart does not automatically execute incomplete jobs.
- Complete locks the original job, revalidates its saved request and exact completion, and inserts the sanitized report, completion bytes and attestation in the same transaction as completed state. Failed/queued completion rejects. Exact sanitized replay preserves report-array order and all proof bytes; differing normalized completion rejects. Fail updates queued/running only and serializes with complete.
- Trusted reads reconstruct full captured membership and hashes, compare stored canonical bytes and indexed/job bindings, validate the report's mandatory coverage and eligibility, and re-read the immutable registered candidate. They require one complete current policy entry matching the financial tuple, capture, full profile set, selected profile and scope. They do not combine policy fields across entries or claim to verify the bootstrap sidecar. Missing/unattested/noneligible proof remains unavailable; binding/schema/byte disagreement is a safe mismatch.
- Legacy completed jobs remain inspectable but lack trusted attestation. Public job diagnostics and persisted report diagnostics remain fixed/sanitized. New safe modules do not open protected truth or mount public issuance routes.
- Control006 adds exact report/job and reservation/request foreign-key associations and SELECT/INSERT-only privileges for the new immutable tables; existing report privileges remain immutable. Migration discovery includes numbered006 without modifying earlier migrations. Independently computed006 SHA-256 is `a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45`.
- Both new modules and their transitive local imports are in the fixed financial build closure. Package exports are additive. Future composition changes still require new build pins and separate operator policy installation.

## Independent verification

Used Node24 and PostgreSQL18 binaries with isolated `EAPR_PG_PORT=55435`, control3301, worker3302, web5176, `EAPR_TEST_PREFIX=eapr_test_review_t2` and `EAPR_DEMO_NAMESPACE=eapr_review_t2`. No main database was used.

- `npm run test:unit -- packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/financial-attestation-registry.test.ts`: 3 tests passed in 2 files.
- `npm run test:integration -- tests/integration/financial-attestation-registry.test.ts`: 1 comprehensive test passed, 16.52 seconds. This independently reran actual A/B captured protected execution with all13 checks, reservation-before-launch observation,005→006 upgrade, role restrictions, immutable-byte/restart checks, legacy and incomplete exclusion, mutation/policy conflicts, atomic rollback and both deterministic complete/fail lock orderings.
- `git diff --check 5ce860b4a74d8db13c96c27a2af8bd5164527625..HEAD`: passed.

Initial test startup was blocked by the filesystem sandbox's Vitest cache write restriction in the evaluator worktree. Authorized escalation succeeded; the results above are completed runs, not the blocked attempts.

These are focused checks. Full typecheck,333-unit run and original verification/bootstrap integration regressions are builder-reported evidence reviewed here, not independently repeated. No new independent adversarial test was added; the integration assertions were inspected and rerun. No live-model, financial production, browser-composition, activation or user-acceptance claim follows.
