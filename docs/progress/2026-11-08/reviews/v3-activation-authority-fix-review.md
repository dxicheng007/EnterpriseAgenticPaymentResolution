# V3 activation authority — scoped fix re-review

Reviewed 2026-11-08. Architecture/source inspection only. Scope: prior R1/R2 and new breakage introduced by the fix diff; no broad redesign, implementation, SQL, tests, commits, or subagents.

## Exact candidates

SHA-256 verified from current files:

- `v3-activation-authority-proposal.md`: `23e7117c3b1ac8cb5c4c44b044ed2efd53530f55e38294f0165ec9ba9db1f737`
- `v3-activation-authority-handoffs.md`: `063bab1a66159f118f269c97c84a537c1529a64a0c8a7d743039f6b4096be45a`
- `v3-activation-authority-fix.diff`: `44a78ca1de9ccd3d57a1338e1cf0d9230ffb543e7a562d8a585a895584cbcbcc`

Review baseline is R1/R2 in `v3-activation-authority-independent-review.md`, which identifies original proposal `5db6e910f7e1f359462dce82c8ae1e8879c97a8ef3983fc8c15b2c15f3f46363` and original handoffs `501a2acae8abde46a00a7cfec887951c8c2d952ef0ef4f9f063aeb3242fcb95f`.

## Findings

### R1 — ADDRESSED

Proposal §7 and new handoff AS explicitly assign the authoritative source reader to A and private authenticated producer route/composition to C. A5 owns its worker client, not an implicit unassigned producer. A4, A5 and the dispatch graph require accepted AS producer/route/composition.

The producer obligation matches historical `v3-contract-proposal.md` §6: latest published manifest even when capture is incomplete; pinned definition and source/hash validation; strict post-watermark numeric semantic-event folding; scoped keys and governing `*`; no ordering of opaque revisions or conflicting independent streams; ordinary financial events do not rewrite metadata. Independent control/worker observations use a separate source-read capability and allowlisted transport; worker receives neither control DB access nor operator injection authority. Exact successful retries bypass fresh observation, and dependency failures block new grants.

The proposed transaction mechanism is grounded in existing source code: `uploads.ts` exports the transaction advisory `lockSource`; `dossier.ts:publishBaseline` uses it for numeric-epoch publication; `scenario-admin.ts:append` uses it for event append. AS requires one transaction client, no writes, and no lock across HTTP or worker transactions. Required tests now cover the producer, actual authenticated route/composition, incomplete latest capture, numeric order/watermark, key selection, ordinary financial events, publication/append races, authentication and malformed/unavailable responses.

### R2 — ADDRESSED

Proposal §7, handoff A3 and the dispatch graph consistently split A3a storage/schema work after A0/root assignments from A3b composed registered-inactive reads after A3a plus A2 publication/loader. A4/A5 explicitly require completed A3b. Mocks cannot establish A3b completion, and pending registry work cannot justify URL-derived scope. This preserves the trusted read-only resolver and zero-write inactive-target semantics in historical contract §7 and the existing proposal.

## Verdicts

**Specification verdict: PASS for the scoped corrections.** No new financial-policy or authority contradiction found in the fix diff against the cited semantic/parent contracts and frozen F4/F5 source and activation boundaries. No new blocking finding.

**Handoff-quality verdict: PASS for R1/R2 closure.** The new producer owner, concrete proposed paths, composition owner, consumer boundaries, acceptance obligations and corrected dependency graph are sufficient for root to prepare exact one-writer dispatches. AS producer/route acceptance is the prerequisite gate; A4/A5 retain the later end-to-end new-grant failure and successful-receipt recovery proofs explicitly required by proposal §7. Those downstream integration proofs must not be represented as already complete when accepting AS alone.

This is acceptance of the corrections, not dispatch authorization or implementation acceptance. Root must still freeze the candidate and allocate concrete files and future migration numbers. Control004 remains discovery; control005 remains reserved to S3b/bootstrap registry. Logical later control A/B and runtime R labels assign no migration numbers. Current S3a/S3b acceptance, installed policy tuples, real exact-subject proofs, machine verification and joint user acceptance remain separate prerequisites. No tests ran in this review.
