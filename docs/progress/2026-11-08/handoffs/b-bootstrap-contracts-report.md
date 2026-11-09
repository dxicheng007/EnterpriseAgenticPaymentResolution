# S0 contract candidate handoff

Branch `codex/bootstrap-contracts`, base `e34a0f629a1fee90e738c317b2e243044f83a7a1`, candidate `a49a8cf6fb4fcb7bec6b402059d108f52068cea7` (`contracts: freeze bootstrap verification claims`). Assigned acquisition-sources worktree clean after commit. Candidate awaits independent review.

Brief SHA-256 `75b2ed6cd01ee6d576b2376c96eccf32ef582a38fda84d418e3f924d808fdd9f`. Addendum SHA-256 `e87ae79655681e9185c461fdaaafa9b706114826d31d12ec71f44e88423ccb2f`.

## Owned files

- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/bootstrap-verification.ts`
- `packages/contracts/src/bootstrap-verification-hash.ts`
- `packages/contracts/test/bootstrap-verification.test.ts`
- `docs/superpowers/plans/2026-11-08-contract-freeze-v3-bootstrap-verification.md`

## Export inventory

- `@eapr/contracts/bootstrap-verification` exports `BootstrapPinV1Schema`, `BootstrapBindingV1Schema`, `BootstrapAssertionIdSchema`, `BootstrapCaseIdSchema`, `BootstrapVerificationResultV1Schema`, `bootstrapRequiredAssertions`, `bootstrapRequiredCases`, `bootstrapAssertionCases`. Inferred types `BootstrapPinV1`, `BootstrapBindingV1`, `BootstrapAssertionId`, `BootstrapCaseId`, `BootstrapVerificationResultV1`.
- `@eapr/contracts/bootstrap-verification-hash` exports `hashBootstrapVerificationResult`.
- Server barrel keeps its existing root export target and adds both modules.

## Partial machine verification

- Node v24.22.2 using the prescribed Node/PostgreSQL PATH.
- RED `npm run test:unit -- packages/contracts/test/bootstrap-verification.test.ts` exited 1 before implementation. Vite rejected the missing public subpath export.
- GREEN `npm run typecheck` exited 0.
- GREEN `npm run test:unit -- packages/contracts/test` exited 0, 111 tests across eight files. An additional verbose run showed all five untouched v3 hash compatibility tests passing, including the prior profile/artifact/bundle golden hashes. Independent synthetic result golden digest `012880a6bc6feeaaaf905232b9e5d782bba5181318506d8d112d004d9d2c8bef`.
- Untouched legacy report and coverage checks `npm run test:unit -- packages/evaluator/test/verify.test.ts packages/evaluator/test/fixtures.test.ts` exited 0, six tests across two files.
- Standalone Vite client build of the public subpath passed with a resolver guard against Node imports, canonical.ts and the hash helper. The only contracts modules in the bundle graph were common.ts and bootstrap-verification.ts.
- `git diff --check` and `git diff --cached --check` passed. Staged scope matched the six files above. The diff preserves old schemas, check vocabulary, private v2, fixture pins, planBatch, canonical helpers and lockfile.

These results cover S0 shape and hash behavior. Trusted capture binding, proof authenticity, execution, eligibility and activation require later slices. The snapshot shape vector accepts both well-formed scalar digests and records the S2/S3 rejection obligation with actual capture context. No specification rulings were needed.
