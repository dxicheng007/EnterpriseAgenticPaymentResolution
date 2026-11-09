# Bounded follow-on handoff drafts

Not dispatch authorization. Read `v3-bootstrap-verification-proposal.md` and root's independent review before work. All wire definitions, recipes, assertions and equality rules are normative only after freeze. Root assigns one writer per file; no concurrent edits to shared exports, evaluator transport, build manifest or SQL. These are individually reviewable slices; never activate through test-only passing results. Existing repository/area AGENTS and Node24/Postgres18 requirements apply.

## S0 — contracts-only freeze (B)

Allowed: `packages/contracts/src/bootstrap-verification.ts`, `packages/contracts/src/index.ts`, new `packages/contracts/test/bootstrap-verification.test.ts`, and a separately assigned new freeze addendum under `docs/superpowers/plans/`. Publish the proposal's BootstrapPinV1, BootstrapBindingV1, enum lists, BootstrapVerificationResultV1 and result hash helper. No old schema edits. Protocol private types are owned by S3. Do not implement ActivationBundleV2 in this slice; its dependency/shape must nevertheless be approved in the addendum before S5.

Checks: strict unknown/prototype keys, scalar normalization, duplicate enum entries/case IDs/profile hashes, hash all non-own fields, null plan hash, snapshotHash explicitly equal to source snapshot.contentHash (distinct from hashCanonical(snapshot) in the object registry), positive execution matrix and status consistency. Existing report/check/private v2 parsers and hash compatibility unchanged. This schema parser alone does not authenticate results.

Commands: `npm run typecheck`; `npm run test:unit -- packages/contracts/test`. Record these as partial contract proof. Deliver exact freeze hash and export list.

## S1 — pure bootstrap planner/projection (B)

Depends S0 freeze; can run concurrently with S2 and S4 after file assignments.

Allowed: new `packages/compiler/src/plan-bootstrap.ts`, new `packages/parent/src/bootstrap.ts`, `packages/compiler/package.json`, `packages/parent/package.json` for explicit exports only, new `packages/compiler/test/plan-bootstrap.test.ts`, new `packages/parent/test/bootstrap.test.ts`. Existing plan-batch.ts/state.ts APIs and implementation stay unchanged. Use type-only existing shapes; no control/runtime/migration work.

Implement four-argument pure API and copied full target projection from proposal §2. Validate metadata duplicates/scopes, canonical exact reuse versus conflict, selected/unresolved hold classification, no-plan/replay blockers, exact ensure order and leaf lineage, shifted suffix and full hash. Financial balance zero alone does not block. No plan minted from blocked financial subset. Preserve no-I/O/no-clock behavior and unchanged target.

Acceptance: public A three ensures/five financial operations/balance80000; B zero-balance/nonempty permitted; two configurations reverse term order; null and empty-array leaves; input-array permutations normalize only declared sets; exact reuse retains explicit ensures/original bytes; customer/account/config conflicts; selected hold coexisting with nonempty financial plan blocks; missing event IDs and source-wide holds block; unrelated routing exclusion remains visible without blocking selected scope; all financial regression tests unchanged.

Commands: `npm run typecheck`; `npm run test:unit -- packages/compiler/test packages/parent/test packages/finance/test`.

## S2 — protected descriptor and independent oracle (evaluator owner)

Depends S0 freeze; independent of planner implementation. Allowed: new `packages/evaluator/src/bootstrap-fixtures.ts`, `bootstrap-reference.ts`, `bootstrap-cases.ts`, new matching `packages/evaluator/test/bootstrap-{fixtures,reference,cases}.test.ts`, and new `scripts/prepare-bootstrap-verification.ts` plus integration test `tests/integration/bootstrap-fixture-setup.test.ts`. No edit to existing v2 fixture parser/store/pin bytes, producer, candidate builder, compiler/finance/parent code. Do not expose new protected modules in product imports or browser exports.

Implement immutable sidecar descriptor/pinning and actual source-fact support from proposal §3. If a helper is needed from evidence-support.ts, coordinate S4 ownership; do not refactor it concurrently. A small independent local table is acceptable; copied subject output is not. Operator script references existing v2 pin and explicit reviewed IDs/profile hashes, derives observed name/terms only from validated producer facts. Reject overwrite with changed bytes. Protected roots must remain disjoint from served roots. No provider or API key.

Acceptance: prepare seeded actual A/B captures with seed bootstrap-v1 and asOf 2026-10-01T00:00:00.000Z through existing capture/evidence helper; sidecar names/terms are producer-supported; missing/mismatched citations/fact account/fixture/profile pins fail; substituting hashCanonical(snapshot) for sidecar snapshot.contentHash fails even with the sidecar hash recomputed; exact registered snapshot object validation is also required; inherited amendment support and terminal null interval preserve observed/derived meaning; two-term ID ordering; original v2 files bytes unchanged. Imports test oracle forbidden dependencies. Mutation test wrong subject legal name/term/config scope even when subject hashes are rebuilt. Unit vectors may be public, but production construction oracle never reads tests/fixtures as truth.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test/bootstrap-fixtures.test.ts packages/evaluator/test/bootstrap-reference.test.ts packages/evaluator/test/bootstrap-cases.test.ts`; `npm run test:integration -- tests/integration/bootstrap-fixture-setup.test.ts`. Require actual sidecar roundtrip and reproducible content hashes in local test output, never protected literals in shared logs.

## S3a — dedicated bootstrap transport and checker (evaluator owner)

Depends S1+S2. Allowed: new evaluator files `bootstrap-protocol.ts`, `bootstrap-runner.ts`, `bootstrap-subject-runner.ts`, `bootstrap-evaluator-runner.ts`, `bootstrap-comparison.ts`, `bootstrap-launcher.ts`, `bootstrap-verify.ts`; new corresponding test files and `test/children/bootstrap-*.mjs`; `packages/evaluator/src/runner.ts` only a minimal internal transport extraction/export for fixed bootstrap wrappers if necessary; `packages/evaluator/package.json` safe launch/validation entry exports only. Keep protocol.ts and current report/v2 evidence wire untouched. No registry or UI.

Implement proposal §4–5 fixed private types, strict BootstrapEvaluatorCompletionV1 and BootstrapLauncher return, and safe result, full exact coverage table and actual positive/negative cases. Pin full evaluator/subject source closures; hash before/after run. Comparison builds expectations without subject planners/projectors. Primary result binding uses exact request capture/target; synthetic probe variants never replace it. Retain the actual schema/hash-valid captured_baseline subject plan before comparison and carry it in the completion envelope; no oracle reconstruction or second planner invocation. Match protocol/job/requestHash, exact reserved binding and pins, result/plan nullability, hashPlan and observed canonical plan bytes hash. Failure produces no successful launcher completion. All nine assertions and ten cases mandatory; negative probes do not substitute for captured baseline/exact reuse.

Acceptance: separate child really invokes planBootstrap; actual exact fixture passes, mutant outcome pointer omission/addition, shifted indices/order/hash fails; rebuilt wrong-name/term candidate fails support; unexpected child request ID/protocol, forged result, stale build/fixture/profile/manifest/events/snapshot/target/asOf or plan hash rejected. Timeouts/oversize/stderr/extra report lines and process cleanup match existing caps. Source closures catch compiler/finance/oracle/contracts/lock changes. A result-only response, wrong completion protocol/job/requestHash, nullability disagreement, changed plan bytes/byte hash or result/plan hash disagreement must fail. A source whole-object hash substituted for snapshot.contentHash must fail even after recomputing surrounding result hashes. No protected path/expected facts in child input or public diagnostic.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test`; focused integration `npm run test:integration -- tests/integration/bootstrap-verification.test.ts` once S3b provides it. Before S3b, describe proof as transport/oracle-only.

## S3b — immutable bootstrap completion and reader (evaluator + B database owner)

Depends S3a and the reviewed, merged control 004 discovery-lifecycle catalog. Allowed: new `packages/evaluator/src/bootstrap-jobs.ts`, `bootstrap-registry.ts`, new unit test `bootstrap-registry.test.ts`, new `tests/integration/bootstrap-verification.test.ts`, and `db/control/005_bootstrap_verification.sql`, reserved by root. Do not apply 005 before 004 or insert 004 later; neither SQL file is created by this architecture task. Package export patch serialized with S3a. No edits to applied SQL or financial job/report semantics.

Implement exact registry ports/tables in proposal §6, internal server-allocated job IDs, pin reservation before execution, immutable canonical input and target, strict BootstrapEvaluatorCompletionV1 consumption, complete request/protocol/job/pin/binding/plan/result and canonical-byte validation, and atomic completion. No result-only registry completion path; preserve the actual retained baseline bytes from the successful launcher return. Read only completed result with exact expected pin/binding/plan hash and canonical result/plan bytes. Authenticated scope policy belongs to later route composition; do not expose unauthenticated result submission.

Acceptance on native PostgreSQL: pending/failed/stale/foreign-scope job cannot read as successful; malformed/forged result and mismatched returned job/hash cannot complete; crash between insert/completion rolls back; two completion attempts cannot overwrite proof; restarted reader reconstructs exact canonical proof from committed row and immutable candidate; changed target/snapshot/build rejected; reader unavailable does not grant readiness. Add a transport-to-registry integration vector: a fixed scripted subject produces a distinctive schema/hash-valid baseline plan; real evaluator comparison retains it and emits the completion, launcher forwards the same canonical plan bytes, registry commits, pool/service restart reloads byte-identical plan/result and verifies both plan hash and observed-byte hash. A valid comparison failure may retain an observed plan but stays non-passing. Null/hash/byte/request mismatches and a second completion with differing bytes reject and leave stored original intact. Pair with the real A/B runner vector so scripted transport is not eligibility evidence. Preserve independent control/runtime credentials.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test`; `npm run test:integration -- tests/integration/bootstrap-verification.test.ts tests/integration/v2-verification.test.ts`. Exact final real A/B proof is still contingent on S4 financial evidence support.

## S4a — evidence-backed candidate metadata (C)

Depends freeze; may run with S1/S2. Allowed: `apps/control/src/demo-candidates.ts`; new `tests/integration/bootstrap-demo-candidates.test.ts`; existing candidate test expectations only when directly changed by profile identity/version. No protected imports or new extraction semantics.

Preserve parsed legal name exactly, cite actual agreement, pin stable reviewed config ID per term, and use a new profile version (plus spec/version changes only if required) so immutable registration does not conflict with an older financial-only profile. Candidate label is never a source of name. New exact subject recompiled/re-registered. Metadata alone never sets ready/eligible. Generated constructor remains restricted to existing supported designated agreements.

Commands: `npm run typecheck`; `npm run test:integration -- tests/integration/bootstrap-demo-candidates.test.ts tests/integration/local-verification-startup.test.ts`. Regression requires original visible evidence mismatch fails and no protected fixture read occurs.

## S4b — same-subject financial eligibility bridge (evaluator owner)

Depends freeze, not new bootstrap runner. Allowed: `packages/evaluator/src/evidence-support.ts`, `packages/evaluator/src/launcher.ts` build-file manifest only if needed, existing evaluator tests plus new `packages/evaluator/test/bootstrap-financial-compatibility.test.ts`, new `tests/integration/bootstrap-financial-verification.test.ts`. Coordinate any evidence helper exports with S2. Do not change VerificationReport/check enum/private fixture v2 or planBatch.

Remove the explicit valid-bootstrap-profile exclusion narrowly; financial captured run keeps exact new profile and artifact bytes and validates all previous financial evidence, identity, terms, source capture, financial operations and financial lineage. Ensures in this financial run remain unsupported. Do not inspect or certify ensure behavior in evidence_support. Keep unsupported findings/mappings unavailable and unsupported money failed. Re-run and issue a real new financial report for the metadata-bearing subject with updated build; no report aliasing.

Acceptance: all thirteen pass for supported exact registered metadata-bearing A/B subjects; old report does not bind new profile/artifact; wrong money, evidence, finding and mapping mutations remain rejected; financial report alone cannot satisfy any bootstrap API/readiness gate. Existing v2 evidence fixtures/pins retain identical bytes and tests.

Commands: `npm run typecheck`; `npm run test:unit -- packages/evaluator/test`; `npm run test:integration -- tests/integration/bootstrap-financial-verification.test.ts tests/integration/v2-verification.test.ts tests/integration/evidence-verification-setup.test.ts`.

## S5 — later consumers, not yet dispatchable

C preview: allow `apps/control/src/routes/preview.ts` and composition plus focused integration once S1 verified; use full planner for bootstrap-bearing profile and retain financial-only path for legacy profile. Zero parent writes; no readiness inference. No provider.

B bundle-v2 contract: separate review before edits to new versioned schema/hash exports/tests; leave v1 hashing/schema intact. Exact type is proposal §6. Root freezes worker trusted issuer/pin policy and C prepared-result companion storage before dispatch. The financial reader must separately freeze its trusted capture/evidencePin attestation: current reports do not carry the v2 bundle hash or capture membership. Resolve and validate that association from trusted immutable registration/fixture policy; do not infer it from manifest alone. This S5 dependency remains deferred and non-dispatchable.

C review readiness: blocked on S3b+S4b complete real results, S5 bundle freeze, trusted parent target and report-reader ports. Read exact completed financial+bootstrap rows; bind capture, selected profile, target, cutover, full plan and expected pins. Persist result association with immutable review preparation and include it in preparation fingerprint/head CAS. No browser-supplied passed flag. New control migration separately assigned from bootstrap verification migration.

B worker: blocked on above plus accepted parent persistence/source semantic/receipt ports. Trusted v2 bundle only; exact result subject/pin/provenance checks; recompute full plan from authoritative locked target at bound cutover; canonical bytes/hash equality; atomic approved import. Preserve exact-key retry and new-key ALREADY_ACTIVE. Never receive protected sidecar/oracle. No activation until all prerequisites exist.

Later acceptance commands: existing `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, scoped Playwright for review, then original `npm run verify:slice -- V0` regression. These do not themselves establish T3 acceptance: add separately assigned T3 tests for false readiness without either proof, stale proof/target, full recomputation tampering, zero-write preview, atomic rollback/retry and historical view. No broadening of this architecture task into those implementations.
