# Protected build inventory repair

The source candidate is `cd777756a0154b79cbe7e51bbdd5e1f4057358c3`, based on `98c82efc73be6fafe746d2eb47ec6e6769e9a699` on `codex/platform-sync-apply-repair`. Machine evidence is partial. Independent review and joint acceptance are separate.

PR #44 added `packages/contracts/src/connection-state.ts` to the contracts entry point. The protected bootstrap and financial attestation source inventories omitted the new dependency. The repair adds it to the shared bootstrap inventory used by both the subject and evaluator and to the financial attestation inventory.

Both existing import-closure checks retain their original assertions. The mutation tests now change the contract file in isolated temporary copies and verify that its bytes affect both bootstrap hashes and the financial hash. Bootstrap still rejects a missing lockfile with `BUILD_MISMATCH`. Financial attestation rejects a missing connection-state source with `FINANCIAL_ATTESTATION_UNAVAILABLE`.

## Focused verification

Commands ran with Node v24.22.2.

- `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts` exited 1 before the inventory fix. Both closure assertions identified `connection-state.ts`, and both mutation tests encountered the omitted file when reading their temporary copies. One test passed and four failed. With the candidate change, all five passed across the two test files, with exit 0.
- `npm run typecheck` exited 0 on the candidate.
- `git diff --check` passed for all four candidate paths.

This evidence covers the protected build inventories and type checking. Fixture and policy repinning, database, browser, and live-provider verification fall outside this repair.
