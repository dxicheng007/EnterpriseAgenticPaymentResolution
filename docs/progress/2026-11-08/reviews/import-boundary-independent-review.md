# Independent import-boundary review

Candidate: `1cbb0916390b47dd3317b8e0ab872f9804eb543d`
Base: `0fdecc25bf350ff3a17a59fc5e8afb295f3ede4a`
Checkout: `/Users/devincheng/.codex/worktrees/acquisition-evaluator-review/EnterpriseAgenticPaymentResolution`

Spec verdict: PASS for the scoped control/evaluator import-boundary prerequisite.
Quality verdict: PASS. No actionable findings in the six-file candidate.

The public `@eapr/evaluator/registry` graph reaches jobs, verify, launcher and runner, but no longer reaches reference-model, fixtures, fixture-store, subject-comparison, subject-runner or evaluator-runner through module imports. The fresh Node subprocess regression test exercises actual workspace exports and fails resolution of protected module names before they load. Package exports do not expose subject-comparison. The control-facing createCandidateRegistry/createVerificationJobs and validateReport/createProtectedVerificationLauncher services remain available.

The comparison implementation moved unchanged from verify.ts into subject-comparison.ts, including record comparison, holds, plan count, balances, target version, asOf, artifact/profile hashes and scope checks. evaluator-runner imports and invokes it while retaining its independent reference-model and protected fixture path. Existing real-child baseline and wrong-mapping checks pass, including a nonmonetary mismatch with zero cents difference. The new execution file is included in evaluatorBuildHash, which the evaluator child rechecks. validateReport's strict parsing, identity/version/hash bindings, mandatory coverage, eligibility derivation and diagnostic redaction are unchanged. No route, authorization, job reservation or registry storage behavior changes appear in the diff.

Fresh independent verification on Node v24.22.2:

- `npm run test:unit -- packages/evaluator/test`: 5 files, 33 tests passed.
- `npm run typecheck`: exit 0.
- `git diff 0fdecc25bf350ff3a17a59fc5e8afb295f3ede4a..HEAD --check`: exit 0.
- `git status --short`: clean after verification.
- Programmatic extraction confirmed the moved comparison function and its comment are byte-for-byte identical to the base implementation.

Setup note: The first run passed 32 tests but failed the new import test with ERR_MODULE_NOT_FOUND for @eapr/evaluator. The review checkout had stale workspace dependency links. Authorized `npm ci --offline` restored locked dependencies without manifest/lock changes; the complete rerun above passed. This was a review environment prerequisite, not a candidate defect. The producer's reported pre-fix RED was read but not independently reproduced by modifying the checkout.

Scope: Reviewed root/package/evaluator AGENTS guidance, F6 protected-process requirements, producer report and the exact six-file git diff. Also read the complete B startup brief at `/Users/devincheng/.codex/worktrees/acquisition-local-build/EnterpriseAgenticPaymentResolution/.superpowers/sdd/2026-11-08-implementation-plan/briefs/b-verification-startup.md`; its Accepted APIs and fixed paths requirement explicitly permits registry/jobs/launcher in the control import graph while excluding fixture readers, generator, expected-value code and the operator helper. The candidate satisfies that scoped prerequisite. This accepts only the import-boundary prerequisite. It does not accept the separate six-new-case WIP, complete V2 coverage, live integration, filesystem access controls or joint user acceptance. No DB check was necessary for the unchanged persistence/authorization code. No product edits, helper code, commit or push were made.
