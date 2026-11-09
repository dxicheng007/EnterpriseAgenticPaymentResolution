# D1 source tools — scoped round 1 fix review

Candidate: `d4f14bff7ba1bfb269cb166efd9c2828b691e4a2`. Prior reviewed candidate: `72421385fb0aeeebb117b40b631f185ce822262b`. Candidate worktree: acquisition-verification-startup/EnterpriseAgenticPaymentResolution. Exact HEAD and clean status confirmed.

Original P2 (pinned CSV events missing captured original rows): **ADDRESSED**.

Scoped spec verdict: **PASS**. Scoped quality verdict: **PASS**. No new actionable breakage found in the two-file fix diff.

`eventEvidence` now derives CSV stream IDs from the source definition used by preparation and checks every pinned capture event in those streams against the existing `associated` set. Membership in that set requires a captured batch row, an actual captured payload-column citation, exact decoded-event equality, and an unambiguous association. The reverse-completeness check covers the entire capture, not merely the filtered result page. It runs before per-citation account coverage filtering and before any successful query result is returned. Missing proof throws the existing typed `409 MANIFEST_MEMBER_MISSING` SourceError; no citation is fabricated and no unpinned batch is loaded.

The regression reuses Company B events whose real batch was uploaded in `beforeAll`, publishes a later manifest retaining their event IDs and stream watermark while omitting the batch file, completes capture, and asserts query rejection with the typed error. Thus it exercises the reported upstream-permitted state rather than assuming publication rejects it. The retained complete-capture companion asserts the exact CSV citation for source-wide queries and an empty CSV citation list for account-only queries while preserving the API citation. Moving the same-byte later-capture fixture to Company A retains both cross-company and same-company/different-manifest evidence-ID denial coverage and avoids consuming Company B's later epoch before the new regression.

## Evidence and limits

Reviewed the original finding, round 1 builder report, accepted evidence-tools brief and D1 implementation handoff, supplied fix diff, and exact candidate implementation/test context. Reviewer ran `git diff --check 72421385fb0aeeebb117b40b631f185ce822262b..d4f14bff7ba1bfb269cb166efd9c2828b691e4a2` successfully. Builder-reported meaningful red regression, passing typecheck, and passing nine-test PostgreSQL source-tools suite were reviewed as reported evidence, not independently rerun. No concrete concern required duplicate database execution; no lease was used.

This is a fresh review of the original P2 correction and new breakage in this fix diff only, not a repeat full D1 audit. No candidate code, database, branch, or commit was changed. Lifecycle mapping and persistent blockers remain D2 responsibilities. This does not establish mounted/live discovery, financial correctness or authority, activation, sync, full V4, or joint user acceptance.
