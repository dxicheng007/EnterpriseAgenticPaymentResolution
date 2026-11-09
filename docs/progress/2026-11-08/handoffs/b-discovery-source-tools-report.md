# D1 pinned source discovery tools

Base `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542`. Candidate `72421385fb0aeeebb117b40b631f185ce822262b` on `codex/discovery-read-tools` in the acquisition-verification-startup worktree. Candidate worktree clean. Accepted evidence brief and implementation handoff hashes remain those recorded in the D0 report.

## Changes and port

- New `packages/sources/src/discovery-tools.ts` and additive `packages/sources/src/index.ts` export `createDiscoveryReadTools({db,store}, catalog): DiscoveryReadTools`, `DiscoveryReadPreparationInput`, `PreparedDiscoveryRead`, and `DiscoveryReadTools`. The exact port is `prepare(input: {binding: DiscoveryBinding; sourceRead: SourceReadGrant} & DiscoveryReadToolCall): Promise<{facts: ValidatedDiscoveryCapture; result: DiscoveryReadToolResult}>`.
- The root-approved `packages/sources/src/discovery-reads.ts` and `dossier.ts` changes retain verified facts, events, file/API citations and extractions from the same capture read. The existing public `readDiscoveryCapture` still returns the original facts-only shape. Existing capture validation and write behavior are preserved. The new adapter does no post-verification DB content reload. It uses the shared evidence locator on the original-verified extraction and shares `permitsEvidence` and `searchEvidence` with existing evidence consumers. No evidence-records.ts change remains.
- Binding and grant must agree before capture I/O. Exact selected binding, manifest schema versions, event contract and original hashes, and citation membership are verified. Missing or unpinned evidence IDs are uniformly forbidden with no existence lookup. Typed existing SourceErrors propagate when a valid pinned fact set cannot be produced. Successful or typed call-failure results return that invocation's detached facts.
- Query filters the exact validated records, then uses lexical stream ID and numeric sequence. The cursor is a position in the current filtered set. API citation IDs are attached through verified event/original associations. For Company B batch files, the existing decoder must reproduce the exact pinned event. The actual captured payload-column citation for that decoded row is used. Ambiguous/unproved links fail closed and file-citation coverage remains unknown for all account-only reads and searches, including query citation IDs. Page reduction retains continuation and the first oversized record returns `TOOL_RESULT_LIMIT`.
- Read excerpts use UTF-16 offsets relative to the citation and return absolute offsets, the exact original citation identity without excerpt, and the selected UTF-8 SHA-256. The full canonical byte cap includes locator metadata. The source adapter does not publish results or make reviewer decisions.
- Added `packages/sources/test/discovery-tools.test.ts` and `tests/integration/discovery-source-tools.test.ts`. The integration suite uses both captures, control app role, a disposable admin corruption harness, and isolated runtime DB observations. A barrier after the final dossier SQL read verifies no client remains checked out and a later privileged extraction-row mutation cannot replace prepared content. Source authorization and final transactional authority remain separate.

## Checks

- Node 24.22.2 and Homebrew PostgreSQL 18. Assigned lease used PG 55438, control 3601, worker 3602, web 5179, test prefix `eapr_test_review_t2`, demo namespace `eapr_review_t2`. Disposable test namespaces were dropped by the integration suites. No further D1 DB work is running.
- `npm run typecheck` passed.
- `npm run test:unit -- packages/contracts/test/discovery-tools.test.ts packages/sources/test/discovery-tools.test.ts packages/evaluator/test/bootstrap-build.test.ts` passed, 3 files and 17 tests. The evaluator recursive closure still passes with the source-index export.
- `npm run test:integration -- tests/integration/discovery-source-tools.test.ts tests/integration/discovery-capture-read.test.ts tests/integration/v1-manifests.test.ts tests/integration/v1-evidence.test.ts` passed, 4 files and 23 tests.
- `git diff --check` and `git diff --cached --check` passed.

This is focused D1 source capability evidence. Independent candidate review is pending. D2 owns advertisement, scheduling, guarded rechecks, authority transitions, and persistence. No HTTP or live model path was mounted. No findings, financial authority, activation, or sync proof is claimed.

## Round 1 review correction

Prior candidate `72421385fb0aeeebb117b40b631f185ce822262b`. Corrected candidate `d4f14bff7ba1bfb269cb166efd9c2828b691e4a2`, direct child of the prior candidate. Only `packages/sources/src/discovery-tools.ts` and `tests/integration/discovery-source-tools.test.ts` changed.

The query now requires reverse completeness of the verified batch-row association for every pinned CSV stream event before it constructs a result. An omitted batch produces the existing typed `409 MANIFEST_MEMBER_MISSING` capture failure. This proof precedes per-citation account filtering, so complete captures still return the verified CSV citation for source-wide reads and omit file citation IDs for account-only reads. The capture publisher and capture reader keep their existing behavior.

- Red `npm run test:integration -- tests/integration/discovery-source-tools.test.ts -t 'rejects pinned CSV events'` failed because the prepared query returned a raw event with no original-row citation. The regression publishes and completes a Company B manifest with its original event watermark and no batch file.
- Green `npm run typecheck` and `npm run test:integration -- tests/integration/discovery-source-tools.test.ts` passed, 9 integration tests, including the complete-capture companion.
- `git diff --check` and `git diff --cached --check` passed. The assigned 55438 lease is released and the candidate worktree is clean. Fresh scoped independent review is pending.
