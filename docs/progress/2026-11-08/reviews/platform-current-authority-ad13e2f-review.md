# Task 1 review — current authority

## Spec compliance

- **✅ Spec compliant for this bounded task.** No missing, extra, or misunderstood implementation requirement was identified in the supplied candidate diff.
- **Candidate:** `d6c2dd4e713d3bd56fb2f879e1cf90fdd8456ead..ad13e2fe87abeb03cfd1f2ab15eac19dc413ebaa`. Reviewed the immutable `review-d6c2dd4..ad13e2f.diff`, not moving HEAD. Read the complete diff in sequential chunks; no changed source file was separately opened. The later mechanical line-number index did not add a second code-review pass.
- **Scope:** All 14 changed files match the task's owned paths and the additional migration-ledger reservation. The only capture-suite change pins accepted runtime003 and adds runtime004's actual digest (`tests/integration/sync-capture.test.ts:228`). Parent-storage changes only its privileged reset dependencies (`tests/integration/parent-storage.test.ts:61`). No production activation, parent, capture, source, composition, UI, HTTP, scheduler, or model code is changed; historical migrations are absent from the diff.
- **Contracts:** All six strict schemas/types are present, with explicit safe positive epochs, full identity consistency, legal action/status pairs, checked transition arithmetic, changed timestamp equality, and ordered observation intervals (`packages/contracts/src/current-authority.ts:5`, `:10`, `:22`, `:40`). The leaf export and both evaluator source inventories and mutation-test lists are updated (`packages/contracts/src/index.ts:22`, `packages/evaluator/src/bootstrap-runner.ts:61`, `packages/evaluator/src/financial-attestation-build.ts:10`, `packages/evaluator/test/bootstrap-build.test.ts:46`, `packages/evaluator/test/financial-attestation-build.test.ts:46`).
- **Admission:** Required trusted composition is documented; strict parsed grants and input are frozen before subsequent asynchronous work. A private per-call token/nonce/hash is cleared in an awaited `finally`. Actual persisted-source admission precedes occupied-key replay/conflict comparison. Final mutation admission and failed-observation recovery admission run outside SQL transactions (`apps/worker/src/sync/current-authority.ts:25`, `:52`, `:65`, `:82`, `:91`).
- **Durability and integrity:** The repository validates A5, immutable head pins, canonical audit digests, command/reviewer binding, historical no-op state, and resume semantics. Missing head plus account history fails closed, including exact retry. Initial projection performs no writes (`apps/worker/src/sync/current-authority-store.ts:53`, `:101`, `:118`, `:141`, `:163`). Runtime004 supplies scoped RESTRICT FKs, immutable command history, nondeletable heads, transition guards, and only the specified app privileges (`db/runtime/004_current_authority.sql:2`, `:25`, `:72`, `:104`, `:109`).
- **Concurrency and semantics:** Reads use one repeatable-read/read-only client. Mutations acquire the shared account lock and head lock inside each transaction callback, preserve exact-result precedence, and use unchanged semantic helpers for paused-to-active transitions. The future fence enforces active status and expected epoch without financial writes (`apps/worker/src/sync/current-authority-store.ts:197`, `:226`, `:244`, `:266`, `:330`; `apps/worker/src/sync/current-authority.ts:179`).

## Strengths

- **Clear trust boundaries:** Service admission and repository integrity are separate, with neither a permissive authorizer nor an exported actor/token mint. Tests explicitly label opaque request handles as an internal trust fixture (`tests/integration/current-authority.test.ts:181`, `:241`, `:367`, `:406`).
- **Useful database evidence:** The suite creates genuine A/B A5 imports, checks source-derived originals, preserves original activation reads, and compares parent/financial/import/delivery tables across the suite (`tests/integration/current-authority.test.ts:63`, `:159`, `:170`, `:295`).
- **Deterministic race coverage:** Controlled barriers and observed PostgreSQL blocking exercise duplicate/conflicting/stale commands, resume versus revoke, the future writer-lock prefix, snapshot consistency, rollback, and a real one-shot SQL40001 retry with an intervening revoke (`tests/integration/current-authority.test.ts:590`, `:631`, `:663`, `:689`, `:735`, `:788`, `:812`). These tests assert persisted results, epochs, command counts, and activity counts.
- **Corruption and retention coverage:** Owner-only fixtures verify privileges and scoped FKs, missing-head failure on read/new command/retry, corrupt A5/pins/audit/observation bindings, illegal SQL transitions, and maximum-safe-epoch behavior (`tests/integration/current-authority.test.ts:869`, `:924`, `:968`, `:997`, `:1044`, `:1064`).
- **Failure paths preserve authority:** Source failures cannot prevent pause/revoke/replay; stale observations cannot restore revoked authority; revoked request permissions prevent both commit and concurrent-winner recovery (`tests/integration/current-authority.test.ts:512`, `:535`, `:560`, `:590`). Activity publication is last in the transaction and has an explicit rollback test (`apps/worker/src/sync/current-authority-store.ts:319`; `tests/integration/current-authority.test.ts:788`).

## Issues

### Critical

- None identified.

### Important

- None identified.

### Minor

- None identified.

## Concrete dependency checks

- **Risk: reused A5 reads could accept mismatched grants or turn decoder failures into absence.** Checked `packages/parent/src/activation-store.ts:80`, `:171`, `:193` and snapshot decode helpers in `packages/parent/src/snapshots.ts:24`, `:33`, `:54`. A5 decoding validates canonical hashes, scalar indexes, proof/scope/plan/activation/receipt relationships, and the approved snapshot using the supplied client. The new wrapper recognizes the relevant existing decode error classes/messages and preserves unrelated SQL failures (`apps/worker/src/sync/current-authority-store.ts:53`).
- **Risk: retry logic could reuse a stale lock token or swallow SQL40001/40P01 before retry.** Checked `packages/storage/src/transaction.ts:11`. The shared helper invokes the callback anew after rollback/release, with at most three attempts. The new service acquires its token within that callback, and the repository preserves SQL errors from its asynchronous queries (`apps/worker/src/sync/current-authority.ts:211`; `apps/worker/src/sync/current-authority-store.ts:226`).
- **Risk: semantic reuse could broaden an approved account or silently accept wildcard declarations.** Checked unchanged `apps/worker/src/activation-validation.ts:72` and `:77`. Profile selection uses the saved expected hash; semantic validation enforces exact source, rejects wildcard declarations, and checks the approved accounts while allowing unrelated account revisions. Both preflight and locked commit reuse these helpers (`apps/worker/src/sync/current-authority-store.ts:285`; `tests/integration/current-authority.test.ts:458`).
- **Risk: frozen admission could still retain mutable nested input or accept extension keys.** Checked `packages/storage/src/activation-files.ts:111`, `packages/contracts/src/common.ts:23`, `:32`, `:45`, and `packages/contracts/src/review.ts:47`. Recursive freezing follows strict Zod parsing; guarded strict objects reject extension/prototype keys, reviewer audit has only reviewer/session identity, and instants normalize before comparison. The barrier test mutates caller-owned commands and nested grants after parsing without changing the admitted operation (`tests/integration/current-authority.test.ts:406`).
- The first batched dependency-read output was truncated; the omitted transaction/snapshot/common helper sections were read in a small recovery call. No broad repository crawl, git command, source edit, or database test was performed.

## Verification evidence and remaining limits

- Inspected the implementer's saved final summaries: `/tmp/eapr-authority-candidate-integration.log` reports **84 passed in 4 files**; `/tmp/eapr-authority-all-unit.log` reports **488 passed in 73 files**; `/tmp/eapr-authority-unit-green.log` reports **19 passed in 3 files**. A diagnostic scan of those three saved logs found no warning, stderr, deprecation, or unhandled-error messages. These are inspected implementer-run results, not new reviewer test executions.
- Typecheck success, runtime import-resolution inspection, and migration hashes are reported in `task-1-report.md`; their underlying command output was not separately supplied/inspected here. The static candidate diff supports the narrow scope and direct-import claims. No suites or graph checks were rerun to regenerate evidence.
- **⚠️ Outside this task's proof:** Actual HTTP/session/origin/CSRF and authenticated control-channel admission remain a future adapter responsibility (`apps/worker/src/sync/current-authority.ts:25`). The private WeakMap supplies request binding, not continuing session authority during SQL retries.
- **⚠️ Outside this task's proof:** The fence token requires a live caller-owned transaction; it does not automatically detect a recycled PoolClient (`apps/worker/src/sync/current-authority-store.ts:225`, `:329`). The current tests prove only the lock/status/epoch prefix (`tests/integration/current-authority.test.ts:689`), not a financial writer, V5/V6, full ConnectionState, or joint acceptance.
- **⚠️ Outside this task's proof:** Declared source revisions are checked with existing semantics; document/schema coverage and future data-hold handling are not established by this task (`apps/worker/src/activation-validation.ts:77`; `tests/integration/current-authority.test.ts:458`).

## Quality assessment

**Task quality: Approved.** The service, repository, contracts, and DDL have distinct responsibilities and fail closed on the specified authorization, storage, concurrency, and semantic boundaries. The extensive integration file is justified by the required local genuine-A5 fixture and failure/race matrix; no blocking duplication, swallowed integrity error, or unjustified abstraction was found.

**Finding count:** 0 critical, 0 important, 0 minor. No unresolved implementation defect identified; the verification limits above remain explicit and do not expand the task's acceptance claim.
