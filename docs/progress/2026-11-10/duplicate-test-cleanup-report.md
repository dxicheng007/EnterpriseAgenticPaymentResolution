# Duplicate integration test cleanup

- Base `7161d6ebd31c124848d4fbff2642adb61fde51f1`
- Cleanup commit `299d0e88f95252f11c0b05142a1a981d0fd15bd3`
- Commit subject `test: remove excluded duplicate integration tests`

Immediately before removal, `cmp` confirmed each pair was byte-identical. SHA-256 matched the brief for all eight files, and the working copies matched the base blobs. All four retained files were checked again after staging and after committing.

| Deleted copy | Retained test | SHA-256 shared by both | Bytes | Lines deleted |
| --- | --- | --- | ---: | ---: |
| `tests/integration/review-preparation.test 2.ts` | `tests/integration/review-preparation.test.ts` | `1b3f2939a33203d39f97a6d785e0e443e8656761a29b979ad5d69a147c265baa` | 2686 | 45 |
| `tests/integration/v3-activation.test 2.ts` | `tests/integration/v3-activation.test.ts` | `742182563b8317a680bcf514864cd111b082d64be2bb1065acf47ddd1196101a` | 54809 | 900 |
| `tests/integration/v4-offline-live-stub.test 2.ts` | `tests/integration/v4-offline-live-stub.test.ts` | `65e331eb776ea3c69a5755c14b6f31c497158d962ed58d6d3abd876f1a887e7a` | 6129 | 135 |
| `tests/integration/v4-verification-idempotency.test 2.ts` | `tests/integration/v4-verification-idempotency.test.ts` | `6f26c419357557a8e4aa9f868c26a8da9531b83286f9b1f65b3af822a3e388a6` | 33366 | 555 |

The integration project uses `tests/integration/**/*.test.ts`. Vitest’s installed glob library, `tinyglobby`, returned the same 63 paths before and after deletion. It included every retained test and excluded all four copies. The configuration matched the base byte for byte.

The staged and committed diffs passed `git diff --check` and contained exactly the four deletions above, with 0 insertions and 1,635 deleted lines. The three pre-existing untracked files retained their original SHA-256 hashes. The tracked worktree and index were clean after committing.

Verification covered bytes, hashes, integration file selection and the exact Git diff. No test suite or database operation was run. The source-writing permit is released for independent review.
