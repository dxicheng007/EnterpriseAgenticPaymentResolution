# S4b — same-subject financial eligibility bridge (evaluator owner)

Depends freeze, not new bootstrap runner. Allowed: `packages/evaluator/src/evidence-support.ts`, `packages/evaluator/src/launcher.ts` build-file manifest only if needed, existing evaluator tests plus new `packages/evaluator/test/bootstrap-financial-compatibility.test.ts`, new `tests/integration/bootstrap-financial-verification.test.ts`. Coordinate any evidence helper exports with S2. Do not change VerificationReport/check enum/private fixture v2 or planBatch.

Remove the explicit valid-bootstrap-profile exclusion narrowly; financial captured run keeps exact new profile and artifact bytes and validates all previous financial evidence, identity, terms, source capture, financial operations and financial lineage. Ensures in this financial run remain unsupported. Do not inspect or certify ensure behavior in evidence_support. Keep unsupported findings/mappings unavailable and unsupported money failed. Re-run and issue a real new financial report for the metadata-bearing subject with updated build; no report aliasing.

Acceptance: all thirteen pass for supported exact registered metadata-bearing A/B subjects; old report does not bind new profile/artifact; wrong money, evidence, finding and mapping mutations remain rejected; financial report alone cannot satisfy any bootstrap API/readiness gate. Existing v2 evidence fixtures/pins retain identical bytes and tests.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test`; `npm run test:integration -- tests/integration/bootstrap-financial-verification.test.ts tests/integration/v2-verification.test.ts tests/integration/evidence-verification-setup.test.ts`.


Use accepted proposal v3-bootstrap-verification-proposal.md §6 and executable bootstrap result freeze; exact subject semantics remain unchanged. S2 owns only new bootstrap-fixtures/reference/cases modules and does not edit evidence-support.ts; no shared helper edit is needed. This task does not alter demo-candidates or mount metadata-bearing profiles in startup. Test subjects may derive reviewed bootstrap metadata from visible captured agreements; protected producer values are verification-only. No bootstrap authority/readiness shortcut.

Assigned isolated lease PG55435/control3301/worker3302/web5176; EAPR_TEST_PREFIX and EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2. Read applicable AGENTS. No subagents, dependencies or public schema changes. Observe meaningful assertion-level red, implement narrow behavior, run specified checks once and report exact counts/commit/limits to b-bootstrap-financial-bridge-report.md here. Commit labeled under20words; no merge/push; fresh Astra review follows.
