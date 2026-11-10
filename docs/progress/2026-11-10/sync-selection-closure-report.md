# Task 4 implementation report

Base `121f6719bb5e7a5d1736b3d0f4d0dd957f52ffcf`. Candidate `47aa1002b64fd8bb30ff14fc8babe89535e944dd` on `codex/platform-sync-selection`. Commit subject `feat: select complete earliest sync dependency groups`. The commit contains the two released paths.

## Behavior

`selectSubjectGroup` admits exact applicable subject deliveries after Task 3 guards. It excludes financial events only when the full event reference, committed identity, lane, validated unit member and original receipt agree. Applicable semantic events enter both compiler invocations. A scoped semantic hold affects its own subject. A different account's ordinary semantic hold remains visible in the compiler output.

The first invocation classifies the whole unfinished subject corpus. Indexed item and group references are checked exhaustively. The selector follows the earliest item's entire compiler group and every exact typed candidate representative's entire group. The complete index includes mapped held and coalesced items, and the held result carries the canonical no-match index hash. Target prerequisite witnesses carry their original receipts. Same-key claims from a different Scope block the affected closure. Replays preserve their initial or ongoing receipt associations and new coalesced events carry no invented original.

The second invocation uses the same target and inspection time, with precisely the closure and applicable semantic history. It must produce a single accepted financial group. The implementation verifies the final compiler plan, operation and lineage indexes and retains the final plan verbatim. The projected balance comes from that final classification. An accepted nonempty all-replay group returns a null plan and the original receipts. The original stored snapshot hash and the inspection-time compiler snapshot hash remain separate.

## Machine evidence

| Command | Exit and result | Output |
| --- | --- | --- |
| `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'closure_'` before implementation | 1. Four assertions failed against a neutral export; three are clean behavioral RED. The coupling expected code was corrected later, as disclosed below. The scaffold omitted the dependency hold, retained observations and all-replay proposal. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-4-red.log` |
| `npm run test:unit -- apps/worker/test/sync-selection.test.ts -t 'closure_'` | 0. All 23 closure cases passed, 42 unrelated cases deselected. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-4-green.log` |
| `npm run test:unit -- apps/worker/test/sync-selection.test.ts packages/compiler/test packages/finance/test` | 0. All 124 tests across seven files passed. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-4-selector-compiler-finance.log` |
| `npm run typecheck` | 0. | Local `.superpowers/sdd/2026-11-10-sync-selection/task-4-typecheck.log` |
| `git diff --check -- apps/worker/src/sync/selection.ts apps/worker/test/sync-selection.test.ts` | 0. | Checked before commit. |
| `git diff HEAD --exit-code -- apps/worker/src/sync/selection.ts apps/worker/test/sync-selection.test.ts` | 0. | Checked after commit. |

The tests use the real compiler for the 700-cent funding, 500-cent allocation and 900-cent invoice. The selected projection is 400 cents even when an independent invoice puts the full-corpus projection at 700 cents. They verify the exact missing-index hash, representative membership, original receipts, held coupling and capacity across an existing allocation edge, 1,000-occurrence admission and 1,001-occurrence refusal. Tests that modify classifier indexes, lineage or add a synthetic cycle are defensive seam tests. The smaller committed limit is a defensive detached DTO because both frozen grant schemas fix the limit at 1,000. The exact-outcome unit projection exercises the pure join and depends on Task 7 for admission of real P1 history.

| Released path | Base SHA-256 | Verified candidate SHA-256 |
| --- | --- | --- |
| `apps/worker/src/sync/selection.ts` | `55984d729651305e72c7c17037b5402b9075bc863c675e964185a998e79d91ee` | `cde61a45723ea4bfea4559c76cc2cc637c48c623cc347d2dd0b197ec7624a116` |
| `apps/worker/test/sync-selection.test.ts` | `753678a1de4e558ffdb4b1a1bb52dfae0fbcef59b06b27de87b0b0e1b7bc5527` | `ada9a59f1621f94a1eb170eaf5831d9d019464e833e76262b782ddde459a751f` |

## Self-review and handoff

Reviewed the two-path diff and exact candidate. The Task 2 and Task 3 implementation bodies are intact. Existing test setup gained an optional baseline vector with its prior default preserved. The selector file grew because it now contains full and selected classifier-reference checks as well as closure and receipt validation, all within its reserved path. Task 8 must include the top-level dependencies for held closures in each classification witness and retain the global incomplete limit behavior. Task 7 owns exact canonical delivery-claim admission before constructing a ready cut.

This is partial machine evidence. The synthetic cross-stream cases prove the pure behavior. The genuine producer-admission, separate-feed, PostgreSQL snapshot/history and zero-write gates remain required. Independent exact-candidate review and joint acceptance are pending. Both source paths are released to the controller. Concurrent documentation changes were outside the commit.

## RED provenance clarification after independent review

The original coupling assertion incorrectly expected `ALLOCATION_CAPACITY`. Its preliminary real-compiler assertion checked the held group membership and hold index without checking the hold code. The RED log therefore records a failure against the neutral selector's empty blocker list, but that assertion also contained the wrong expected code. The first run with selector behavior returned the compiler's actual `FUNDING_OVERALLOCATION` hold. I corrected the test expectation to that code at the time, without changing the coupling fixture inputs, finance or compiler behavior, or the selector's pass-through of compiler holds. The other three original RED failures establish behavioral RED against their expectations. The coupling result has real-compiler group evidence and final GREEN coverage. Its original failure does not establish clean RED against the corrected hold-code assertion. The original RED log was preserved without a rerun.
