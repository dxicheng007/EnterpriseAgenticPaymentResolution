# D1 independent exact-candidate review

Candidate: `72421385fb0aeeebb117b40b631f185ce822262b` on `codex/discovery-read-tools`, acquisition-verification-startup worktree. Base: `0f0fca3a9d0a429aa792b0da5ce854e6f8d17542`. HEAD and clean candidate worktree confirmed before and after review.

Spec verdict: **changes requested**. Quality verdict: **changes requested**. One actionable finding remains.

## P2 — Reject pinned CSV events with no verified captured original row

Location: `packages/sources/src/discovery-tools.ts:164` (association construction at lines 123–137).

`eventEvidence` proves that each included batch row reproduces a pinned event, but never proves the reverse: that every pinned CSV event has a captured, original-verified batch row. The query then turns an absent association into `[]` and returns the raw event successfully. A Company B manifest can retain the `b-files` stream watermark/event IDs while omitting the batch file that produced those events. `publishBaseline` checks stream membership/hash but does not require that file; `captureBaseline` and `readDiscoveryCaptureContents` permit CSV event rows with null API originals. Consequently this path can produce a source-wide successful query containing an event whose original batch was never read or verified by this invocation.

This violates D1's required original-byte validation and reproducible CSV event-to-existing-citation relation. An empty citation list after deliberately applying account-only file-coverage restrictions is a separate accepted outcome; it must not conceal a missing original association before coverage filtering.

Required correction: establish complete captured CSV event-to-original-row proof before returning source-wide raw records (preferably as a capture preparation invariant), failing closed with an existing typed safe SourceError when a pinned CSV event lacks that proof. Preserve the accepted account-only citation filtering after the association is established. Do not fabricate citations or load an unpinned batch to repair the result.

Required regression: upload a real Company B batch, publish/capture a manifest retaining its `b-files` event IDs and watermark but omitting its batch file, then prepare a source-wide query. It must reject with the typed capture/binding failure and must not produce `ok:true` raw event content. Keep a companion complete-capture assertion proving source-wide queries retain the existing row citation and account-only queries may omit that citation solely because file coverage is unknown.

The finding is established by a static call-chain trace, not a new runtime reproduction. Root confirmed the accepted D1 requirement applies to this case and will route correction to the original author.

## Reviewed behavior without additional findings

- Entire six-file candidate diff reviewed, plus the accepted E1/E2 brief and D1 handoff and relevant source/evidence/capture/contracts/composition dependency seams. The approved helper expansion preserves the original facts-only `readDiscoveryCapture` public shape. No evidence-records edit remains.
- Full binding and source grant consistency precede content return; selected membership, original bytes, stored extraction, citations and capture hashes are checked by the existing reader. Parsed grants and cloned source definition are detached. Results use retained validated content, with no unverified post-validation content reload. The added privileged-mutation barrier regression tests this distinction.
- Exact seller/account tuples and sellerless source-wide-only access are preserved. Unknown/unpinned evidence IDs use the same forbidden result and do not trigger an evidence-ID existence lookup. Unknown document coverage denies account-only reads/ranges/search and filters file citations from query results.
- Existing included CSV row associations are reproduced with `decodeBatch` and matched to exact pinned events and actual captured payload-column citations; no guessed row citation is minted. The missing reverse-completeness check is the finding above.
- Query ordering, current-filter cursor membership, page reduction and continuation preserve the next oversized record. Search uses stable captured citation order and the existing case-sensitive excerpt search helper.
- E1 selects relative-to-citation ranges using absolute page/body coordinates, rejects empty/out-of-span/surrogate-splitting endpoints, hashes the selected UTF-8 text, preserves the original citation identity, and applies the full-envelope byte cap. The nonzero-base, long-citation/narrow-selection and oversized-locator tests address the accepted boundaries.
- Existing typed SourceErrors propagate when no validated facts can be produced; no fabricated facts or raw exception text is introduced into tool results. No source writes, lifecycle persistence, runtime/model operations or public mount were added.

## Verification and limits

Builder-reported evidence: typecheck passed; focused unit suites passed (17 tests); four focused PostgreSQL suites passed (23 tests) on the assigned isolated lease. These were reviewed as reported machine evidence, not rerun or independently claimed execution. Reviewer ran `git diff --check 0f0fca3a..7242138` successfully and confirmed exact HEAD/clean candidate status. No database was used by this review; no code, commit, branch or candidate-worktree changes were made.

This review covers D1 source capability only. D2 separately owns whole-batch preflight, owner-guarded claims/settlement and capture rechecks, current authority, recovery and sticky blockers. It does not establish mounted discovery, live model competence, financial correctness/approval, activation, sync, full V4 or joint user acceptance. Corrected candidate requires a fresh scoped exact-head review.
