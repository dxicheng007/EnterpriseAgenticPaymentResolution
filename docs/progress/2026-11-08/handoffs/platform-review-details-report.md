# Platform exact-package review details

- Base `850e22a37ea7676b31d9248491f4f43e658f646a`
- Implementation candidate `ef4077eb5c630049c65ee09613ce4ffbe0458436` on `codex/platform-review-details`
- Scope and review authority: [accepted design](platform-review-details-design.md) and [independent design review](../reviews/platform-review-details-design-review.md). This is an implementation handoff for fresh independent review.

## Implementation

- `packages/contracts/src/review-details.ts` exports `ReviewDetailsV1Schema` and `ReviewDetailsV1`. It builds from browser-safe leaf schemas, checks response cross-bindings, and sorts the projected set fields without changing saved plan array order. `packages/contracts/src/index.ts` adds the server-side re-export.
- `apps/control/src/review-repository.ts` adds `readPrepared(accountId: string, packageHash: string): Promise<StoredPreparation | null>`. The lookup uses both keys and the existing canonical prepared-row decoder.
- `apps/control/src/review-details.ts` exports `createReviewDetails(repository: Pick<ReviewRepository, 'readPrepared'>)` with `get(accountId: string, packageHash: string, grants: LocalReviewerContext): Promise<ReviewDetailsV1>`. It checks current grants, saved authority, artifact/profile/capture hashes and membership, plan bindings, and the recorded and planner-time parent snapshots before projecting the public fields.
- `apps/control/src/routes/review.ts` adds `createReviewDetailsPlugin(details, authorize: ReviewAuthorize): FastifyPluginAsync`. `apps/control/src/activation-composition.ts` mounts it as a sibling for `GET /api/review/:accountId/packages/:packageHash/details`. The extra reserved `apps/control/src/server.ts` branch recognizes malformed parameters on this mounted GET when the router rejects them before dispatch.
- `packages/evaluator/src/{bootstrap-runner,financial-attestation-build}.ts` include the additive contracts leaf in both existing build closures. `docs/demo/activation-review-setup.md` documents the historical read.
- `packages/contracts/test/review-details.test.ts` covers strict projection, ordered sets, version and cross-binding checks, and a real browser-targeted Vite build without server modules. `tests/integration/review-details.test.ts` covers real proof-backed preparations, exact historical reads, source and parent change, policy removal, request validation and grants, 14 corrupt owner-side copies, sentinel exclusion, and table/activity fingerprints. The details read uses the same session authorizer and production activation review composition.

## Verification

- RED: `npm run test:unit -- packages/contracts/test/review-details.test.ts` failed on the missing leaf. An isolated contract mutation check also produced four intended negative assertions when the cross-binding refinement was removed, for scope, hash, evaluation time and missing evidence.
- RED: `npm run test:integration -- tests/integration/review-details.test.ts` reached the expected HTTP 404 for the absent details route after genuine A4 preparation. Earlier setup attempts failed at an oversized test namespace label, sandbox loopback permission and a missing fixture manifest argument. After implementation the first real read succeeded, and the initial negative-matrix run showed the injection client normalizes a bare trailing query delimiter. The final test sends it by raw HTTP.
- GREEN: `npm run typecheck` passed.
- GREEN: `npm run test:unit -- packages/contracts/test/review-details.test.ts packages/contracts/test/fixtures.test.ts packages/contracts/test/v3-hash-compatibility.test.ts packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts` passed 38 tests in 5 files.
- GREEN: `npm run test:unit` passed 444 tests in 69 files.
- GREEN: `npm run test:integration -- tests/integration/review-details.test.ts tests/integration/review-preparation.test.ts tests/integration/activation-intents.test.ts tests/integration/activation-review-composition.test.ts tests/integration/activation-composition.test.ts` passed 8 tests in 5 files. Serial disposable lease used PostgreSQL 18 port `55441`, test prefix `eapr_test_review_t2`, demo namespace `eapr_review_t2`, and loopback ports `3241`/`3242` with reviewer origin port `5182`. Sandbox escalation was used for loopback only. PostgreSQL lease and all listed implementation paths are released to root after completion.
- Candidate diff check and base-to-candidate database diff passed. The ordered migration path/hash inventory SHA-256 is `4c1501d7f3f7a7ca3c99fad7da3393dfcaf53daefe78106d07f6a4cd2a75ead3`. Control migration 009 SHA-256 is `5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0`. The database tree is byte-identical to the base.

## Evidence boundaries

Both genuine preparations for Company A produced 0 cents before and 80,000 cents proposed after at `2026-10-01T00:00:00.000Z`. The second preparation used parent version 1 with a separately recorded earlier snapshot time. A subsequent parent fixture demonstrated the effective full reversal reopening a 300,000-cent allocated invoice at the reversal instant, while both historical details remained stable. The projection-only owner-side copy separately verified saved 300,000-to-380,000-cent balances at cutover with an effective reversal. The current protected bootstrap oracle accepts financially empty baselines. The copied case establishes projection behavior only.

The checks establish partial backend evidence. Independent exact-candidate review, Experience's exact-bound browser proof, E1/V3, joint acceptance, and ongoing sync remain separate. Disposable proofs were issued from the candidate's build closures. Existing preserved demo policy/proof installation was outside the lease.
