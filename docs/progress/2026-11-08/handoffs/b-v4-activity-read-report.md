# V4a control activity read candidate

Candidate `f2b5545a967766edd86485de83f20e051e9b59df` on `codex/discovery-activity`, based on `15dd830cf638626d18af92c11859d57d11ff777c`. The clean candidate contains only `packages/storage/src/activity.ts` and `tests/integration/v4-activity-read.test.ts`.

- `readControlActivityWindow(db: Pick<Pool, 'query'>): Promise<ControlActivityWindow>`
- `readControlActivityPage(db: Pick<Pool, 'query'>, input: {after: number; limit: number; runId: Id}): Promise<ControlActivityPage>`

The reviewed proposal checksum matched. The page uses one lateral SELECT and a single MVCC snapshot, with exact run equality, an explicit upper bound from the counter, and `limit + 1`. The retention floor is explicitly zero. The implementation checks all fetched events including lookahead before returning the bounded page. The existing unscoped reader and publish transaction/counter path were preserved. Publication accepts the six approved discovery types and the approved typed summary additions.

## Machine evidence

Reserved PostgreSQL lease used port 55435, test prefix `eapr_test_review_t2`, and assigned service ports 3301/3302/5176. The harness reads `EAPR_TEST_PREFIX`, so that variable was set to the assigned prefix alongside `EAPR_TEST_NAMESPACE_PREFIX`.

- Red `npm run test:integration -- tests/integration/v4-activity-read.test.ts` exited 1. All four tests reached their intended failure after correcting test setup. The window/page exports were missing and publishing an approved discovery type raised Unsupported activity type.
- Green `npm run test:integration -- tests/integration/v4-activity-read.test.ts tests/integration/v0-foundation.test.ts` passed 12 tests in 2 files.
- `npm run typecheck` exited 0.
- `npm run test:unit` passed 198 tests in 28 files, including discovery cursor coverage.
- `git diff --cached --check` passed before commit.
- Broader `npm run test:integration` passed 79 tests in 15 files. The reserved PostgreSQL cluster was stopped after verification.

Test vectors cover empty H0/F0, limit-one run A continuation 1/3/4 at H4 with B isolation and case-sensitive absence, a trailing unrelated event range with exhausted nextAfter H, after=H, rejected cursor/input, and 101 events paged 100/1. Test-owner mutation of the lookahead proves fail-closed parsing. Before/after checks cover rows, counter, schema table inventory and ledgers, including aborted reads. Checked-out clients prove invisibility before commit, rollback, and coherent repeatable-read H/page versus a fresh snapshot. Existing foundation tests cover counter-lock contention. All new summary types/fields are exercised against disallowed metadata. This evidence is partial V4a storage evidence. Independent review and user acceptance are separate.

No contract rulings or changes.
