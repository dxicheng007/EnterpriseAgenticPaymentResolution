# Immutable review details implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute the single cohesive backend task below, then obtain fresh independent review. Steps use checkbox syntax.

**Goal:** Let an authenticated reviewer inspect the financial preview and bounded future authority of the exact saved approval package.

**Architecture:** Add a strict browser-safe projection of the immutable prepared-review row. It reads only saved bytes under current account/source authorization and never re-prepares or mutates authority. Existing package/request hashes and wires remain unchanged.

**Tech Stack:** Existing Node24, TypeScript, Zod, Fastify, PostgreSQL18/pg, Vitest; no new dependency.

**Spec:** [Accepted design](../../progress/2026-11-08/handoffs/platform-review-details-design.md), [independent review](../../progress/2026-11-08/reviews/platform-review-details-design-review.md).

## Global constraints

- Preview performs zero parent writes. Only explicit per-customer reviewer approval may grant bounded standing authority. Worker receipts are authoritative.
- Keep credentials and protected verification truth out of product tools, browser bundles, and evidence packets.
- Preserve ReviewPackage/ActivationRequest canonical shapes and hashes; no migration or saved companion-byte change.
- Historical readability under current grants does not imply current eligibility, approval or import.
- Preserve order-sensitive saved plan operations, lineage and event arrays. Sort only declared set-valued fields.
- No worker, finance, compiler, Discovery, source-adapter, UI or protected-evaluator behavior changes. Build-manifest additions below are solely closure maintenance.

## Review focus

1. Authorized historical reads remain byte-stable after head/source/parent changes and unavailable current setup.
2. Corrupt nested bindings fail with a redacted unavailable error even if outer test-row digests are recomputed.
3. Safe projection cannot accidentally spread proof, attestation, policy, path or other-profile data.
4. Financial time/balance and version identities remain exactly those of the saved package, not latest data.
5. Browser-safe schema dependencies and recursive build pin manifests remain complete.

## Task 1: Implement and mount exact package details

**Create:** `packages/contracts/src/review-details.ts`, `packages/contracts/test/review-details.test.ts`, `apps/control/src/review-details.ts`, `tests/integration/review-details.test.ts`.

**Modify:** `packages/contracts/src/index.ts` export; `apps/control/src/review-repository.ts` decoder reuse and immutable lookup; `apps/control/src/routes/review.ts` additive plugin; `apps/control/src/activation-composition.ts` narrow mount. Add the new schema leaf to `packages/evaluator/src/financial-attestation-build.ts` and `packages/evaluator/src/bootstrap-runner.ts` build source lists, preserving all current entries. Guide updates may touch `apps/AGENTS.md` and `docs/demo/activation-review-setup.md` only for this endpoint.

**Narrow additional reservation:** `apps/control/src/server.ts` frameworkErrors recognition for the mounted details GET only, covering malformed escapes and overlong account/hash parameters with the same redacted400/no-store contract. Preserve other paths/methods and unmounted fallback; include these cases in the new integration test.

**Read/reuse, do not edit:** `tests/fixtures/activation-proof.ts` (`issueActivationProofs`), existing A4 integration setup and current leaf schemas. Request a concrete extra path if necessary. Root serializes shared evaluator manifest paths after the D4b producer handoff.

**Interfaces:**

- Add `ReviewDetailsV1Schema` and inferred `ReviewDetailsV1` with exactly the accepted design fields/literal rule vocabulary and required cross-field refinements. Browser imports direct leaf modules; server hash recomputation stays in server code.
- Add repository `readPrepared(accountId: string, packageHash: string): Promise<StoredPreparation | null>`, where StoredPreparation retains the existing decoded `{review, companion, fingerprint, sourceRef}` shape. Reuse the decoder used by readHead; select by both account and hash. No latest fallback or write.
- Export `createReviewDetails(repository: Pick<ReviewRepository, 'readPrepared'>)` returning `{ get(accountId: string, packageHash: string, grants: LocalReviewerContext): Promise<ReviewDetailsV1> }`. It has no fresh registry/parent/source/launcher dependencies.
- Export `createReviewDetailsPlugin(details, authorize: ReviewAuthorize): FastifyPluginAsync` in existing routes/review.ts, serving `GET /api/review/:accountId/packages/:packageHash/details`. Preserve existing plugin signatures/callers and error envelope; reject query/body, strictly validate paths, require reviewer session/current account/source, no-store on success/failure. Mount as an additive sibling from composeActivationReview.

- [ ] **Write failing contract and backend cases.** Cover all seven test groups in the accepted design, including source authorization, foreign hashes, stored-history stability, independent expected before/after cents/time, safe evidence membership, corruption with recomputed outer digest, recursive sentinel exclusion and row/activity fingerprints proving zero writes. Existing public verificationReportId is allowed; protected bootstrap proof/pin/policy payloads are not. Use real A4 preparation/issued proofs for end-to-end evidence, never arbitrary eligibility flags.
- [ ] **Run the new focused tests and record the failure.** Commands: `npm run test:unit -- packages/contracts/test/review-details.test.ts`; `npm run test:integration -- tests/integration/review-details.test.ts` on root's exclusive lease. Distinguish missing implementation from setup failures.
- [ ] **Implement the schema, immutable lookup, safe projection and plugin.** Use accepted design's canonical equality and capture-membership checks. Project field by field. Require complete mandatory validators/known versions. Do not expose a raw companion, selected policy or registry path. Preserve all existing review preparation/intent behavior.
- [ ] **Mount narrowly and maintain complete source-build lists.** No new production setup or policy installation. Existing policies/proofs are not claimed current after closure changes; tests issue their own fresh proofs.
- [ ] **Run covering checks.** Typecheck; focused new contract tests plus evaluator bootstrap/financial build-closure tests; new real integration and existing review-preparation, activation-intents, activation-review-composition and activation-composition suites. Run PostgreSQL serially on assigned55441. Record exact counts and limits; no fullV3/E1 claim.
- [ ] **Commit and report.** Labeled subject under20 words; full base/candidate, files/signatures, RED/GREEN, unchanged migration hashes, limitations and released paths in `docs/progress/2026-11-08/handoffs/platform-review-details-report.md` plus root-designated task workspace report. No push/merge or subagents. Fresh Astra reviews exact candidate before Experience consumes.

Root owns publication and combined regression. UI key persistence, stale refresh/code handling and session-grant renewal remain Experience tasks; this backend does not silently fix or accept them. Actual approval browser proof and joint clarity acceptance remain separate.
