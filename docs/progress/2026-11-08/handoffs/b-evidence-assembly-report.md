# B captured evidence assembly handoff

- Base `09104d49481d285e71d9162e674824045ae27427` (accepted C1).
- Candidate `3dd6173dacc7d8d80d796a32ea946029f3adc2c8`, branch `codex/source-evidence`.
- Tracked files: `scripts/prepare-verification.ts`, `scripts/evidence-verification-input.ts`, `tests/integration/local-verification-startup.test.ts`, `tests/integration/evidence-verification-setup.test.ts`, `docs/demo/verification-setup.md`.
- Dedicated acquisition-sources worktree, Node 24.22.2 and PostgreSQL 18.6. Lease `EAPR_PG_PORT=55434 EAPR_CONTROL_PORT=3201 EAPR_WORKER_PORT=3202 EAPR_WEB_PORT=5175 EAPR_TEST_PREFIX=eapr_test_review_t1` set before test process imports. Isolated test database namespaces, unique immutable pin keys, and a disposable module-relative checkout for explicit upgrades. Historical local and main state were outside the test scope.

## Implementation

The script accepts two bounded, decoded companions or the existing both-absent legacy startup mode. Fresh-root upgrade requires both. Undecodable inputs use the safe setup-required code. Decoded input mismatches, captured content and association mismatches, and immutable publication conflicts use the safe conflict code.

The private helper reads every actual aggregate citation through both scoped source APIs and independently reads the file or API-event association from PostgreSQL. It preserves the response and original bytes, verifies the matching stored file identity or captured event, resolves literal support inside returned ranges, and supplies the frozen generated-demo account bindings. C1 preflights both bundles before publication and owns version-2 rebind, validation, and immutable publication. Both selected bindings are construction pins, one for Company A and one for Company B, with snapshot and manifest bindings from the captured dataset. The supervisor return shape is the existing allowlisted metadata.

Focused assertions cover paired pins and actual protected reader roundtrips, both-absent v1 and reserved schema-less v2, malformed/partial/oversized/symlink companions, producer/truth mismatch, unsupported literal, wrong company/file/event/snapshot association, missing and corrupted originals, idempotence and immutable conflict. Explicit upgrade assertions cover original visible and evidence-store byte fingerprints, unchanged source DB state, preserved historical v1 pins and prior selection backup, restart reuse, missing fresh-root companions, and a second-publication failure preserving the previous selection and the newly published unselected A pin. Reviewer startup exercises v1 evidence support unavailable with zero cases and checks HTTP responses for private-path or fixture metadata disclosure. Assertions added for private contents use hashes or boolean comparisons.

## Machine verification

- RED `npm run test:integration -- tests/integration/local-verification-startup.test.ts`, before production edits. Exit 1, 2 passed and 1 failed. Fresh-root upgrade reserved versions `['1','1']` where the new assertion required `['2','2']`.
- GREEN `npm run typecheck`, exit 0.
- GREEN `npm run test:unit`, exit 0, 20 files and 121 tests.
- GREEN `npm run test:integration -- tests/integration/local-verification-startup.test.ts tests/integration/evidence-verification-setup.test.ts`, exit 0, 2 files and 4 tests on final candidate content.
- First `npm run test:integration`, exit 1, 11 files passed and 1 failed, 63 tests passed and 1 failed. Existing HTTP reviewer job poll in `local-verification-startup.test.ts` reached the 7000ms deadline in the `running` state. No production timeout or test deadline changes. Final focused rerun passed.
- Full retry `npm run test:integration`, exit 0, 12 files and 64 tests in 66.27s on final candidate content. The timeout did not recur.
- `git diff --cached --check` passed before commit. Tracked tree clean after commit.

These are partial project checks. Independent exact-head review and joint acceptance are pending. C1 can still report evidence support unavailable for v2. B does not change assertion logic or establish integrated B+C2 coverage. C3's existing expected-only browser setup remains v1, and the composed actual-v2 browser checkpoint is separate. No live, activation, financial execution, or later-slice claim.
