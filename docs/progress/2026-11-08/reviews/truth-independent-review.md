# Independent A generator truth v1 review

Decision: approve the bounded producer checkpoint. No actionable correctness or scope findings identified. This is independent source/spec review plus focused machine verification, not full F6 eligibility or joint user acceptance.

Reviewed detached candidate `00919fe1c5b5333233d358c98cb16a45a895f75f` against accepted base `c926c356cfbd97c975aa5bda2a9ea872fac81df2` in the acquisition-review worktree. HEAD matched and the working tree was clean. Reviewed repository/package/source/script/test guidance, the producer brief, relevant frozen F6/F8 requirements, all four changed files, and accepted C2 decoder/member/binding implementation. No product files, helpers, financial semantics, public contracts, or evaluator code were edited by this review.

## Specification and quality assessment

- Both companies now declare integer-cent facts before rendering. Protected economic fields come from those declarations; event identity/version/effective-time association comes from their rendered raw events. Production generation imports no compiler, finance, evaluator, or runtime subject. A decimal rendering preserves digit formatting without floating-point decimal parsing; B preserves integer minor units.
- The protected output passes the exact accepted strict C2 v1 decoder, canonical normalization/hash checks and manifest/event membership checks. Sorted unique input events, economic keys, accounts and evidence match consumer conventions. Semantic events stay in input membership and out of financial records. Build identity hashes the generator, canonical scenario and dependency lock bytes; there is no new helper to omit.
- Existing A anchor is preserved; other buckets, including B known and unknown buckets, have no invented anchors. The existing ambiguous B receipt remains in a separate raw bucket with null anchor, one payment and no allocation. Visible known accounts and approved test-profile bindings exclude it. Missing or reassigned unknown truth and changed manifest/event hashes are rejected. This does not establish the separate C-owned unknown-identity hold/zero-write gate.
- Truth and visible destinations are physically resolved and checked against each other and repository served roots. Existing protected files fail before creating visible output; writes use exclusive creation and mode 0600. Public return and CLI output preserve their previous shape and omit protected paths/contents. Known PDF/email evidence includes original-byte hashes; no invented aggregate snapshot citations or CSV semantic excerpt is introduced.
- The focused tests meaningfully exercise strict compatibility, repeatability, changed seeds/pins, raw identity boundaries, immutable output, path separation, and exact baseline bytes. No acceptance assertion was changed to force a mapping pass. Combining A1/A2 in one commit is a documented handoff process deviation, not a product defect.

## Independent execution

- `npm run test:unit -- packages/sources/test/generator-truth.test.ts packages/sources/test/change-feed.test.ts packages/evidence/test`: **17/17 passed**, 3 files. The first attempt was blocked by sandbox writes to Vite's cache; the authorized escalated rerun passed.
- `npm run typecheck`: **passed** with Node 24 on PATH.
- Separately archived the exact accepted base into isolated review scratch, ran its generator and the candidate generator with the same fixed regression configuration into fresh disjoint roots, and compared every recursive visible file by path and SHA-256: **62/62 identical**. Public summary bytes also matched. This independently reproduces byte preservation rather than trusting only the candidate's embedded expected digest.
- Independently inspected generated private file permission bits: **0600** for both outputs.
- `git diff --check c926c35 00919fe`: **passed**.

No database or HTTP services were started, so none required cleanup. The producer reports three PostgreSQL tests and real persisted aggregate capture → C2 compatibility; those claims were reviewed as producer evidence, not independently rerun here. The focused independent tests reconstruct complete source event membership from generated API/CSV originals and exercise the accepted consumer directly. Full F6 coverage, CSV evidence-support coverage, final unseen holdouts, live-generated connectors and joint user acceptance remain unproven and outside this checkpoint. Protected truth and pin contents are intentionally omitted from this report.
