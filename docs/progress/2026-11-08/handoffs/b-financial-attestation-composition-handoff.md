# A1c — compose accepted financial provenance through the reviewer route

Design-only dispatch supplement to the accepted `b-financial-attestation-handoffs.md` A1c section. That section remains normative; this document resolves actual ports and file reservations, not new financial behavior. Baseline inspected: main `98a13af32366a66a19512c0873fdb480ea8de4a1`, including accepted A1b `766714f80d31c6d2bbb961ff3094bc4a9a0d7615`. A1a/A1b acceptance is upstream evidence, not composed acceptance. No implementation, tests, commits, or subagents in preparing this handoff.

## One bounded implementation assignment

Deliver actual local reviewer session → preview registration → existing verify POST → source capture validation → protected probe → durable reservation → protected thirteen-check run → atomic report/attestation completion. Both A/B metadata-bearing demo candidates must traverse this path. Do not implement approval, parent reads, bootstrap composition, policy installation, or import here. No model client or key is needed.

Owned new files:

- `apps/control/src/financial-capture.ts`
- `apps/control/src/financial-verification-composition.ts`
- `tests/integration/financial-attestation-composition.test.ts`

Owned narrow existing edits:

- `apps/control/src/verification-composition.ts`: retain safe pins, selector, setup diagnostics, registry directory validation; substitute the attested service and pass trusted dependencies/options.
- `apps/control/src/composition.ts`: pass its actual source dependencies, catalog and service into verification composition; retain existing `featurePlugins` mounting and honest availability degradation.
- `apps/control/src/routes/verification.ts`: only replace concrete legacy jobs typing with the common structural port if TypeScript requires it. Preserve routes, authorization ordering, request/response schemas and error mapping.
- `scripts/dev.ts`: reserve `localFeaturePlugins` verification option construction only, to supply fixed attestation roots described below. Preserve other authors' startup and service configuration; root serializes any simultaneous edit.
- `tests/integration/local-verification-startup.test.ts`: adjust local composition options and provenance expectations; retain legacy protocol checks against the legacy launcher where they explicitly test it.
- `docs/demo/verification-setup.md`: narrow explanation that new local jobs have financial provenance and old reports require a rerun for later activation; no activation-ready claim.

No `server.ts` reservation: AS owns its current shared fix. Existing `featurePlugins` is sufficient. No migrations, catalog implementation, package exports, evaluator build lists, bootstrap source, source producer, worker, UI, or setup-script changes are assigned. `readMigrationCatalog()` already discovers numbered SQL; accepted control006 is present. If a closure or unrelated regression requires another file, report the exact dependency to root before editing it.

## Callable ports and adapter

The accepted exports already suffice:

```ts
// @eapr/evaluator/financial-attestation-launcher
createProtectedFinancialLauncher({ registry, roots });
readFixedFinancialBuildHash();
// Types: FinancialCaptureReader, FinancialCaptureV1, FinancialFixtureSelectionV1.

// @eapr/evaluator/financial-attestation-jobs
createFinancialAttestationJobs({
  db, candidates: registry, captures, launcher,
  selectFixture, readBuildHash: readFixedFinancialBuildHash,
});

// @eapr/evaluator/financial-attestation-verify
deriveFinancialCapture(capture);

// @eapr/evaluator/financial-attestation-registry
createFinancialAttestationRegistry(db, registry)
  .readRegisteredFinancialAttestation(reportId, {
    artifactHash, requiredProfileHashes, capture, policy,
  });
```

Use the existing `createCandidateRegistry(db, registryRoot)` once for preview registration, capture lookup, launcher rechecks, jobs, and later trusted reads. Do not create an independent in-memory candidate authority. The returned jobs object has `enqueue(candidate, task?)`, `get(jobId)`, `drain()` compatible with existing routing. Its `get` reads the common `verification_jobs` table, including historical legacy jobs. Existing immutable report readers remain unchanged; no provenance backfill.

Implement `createFinancialCaptureReader({ registry, dependencies, catalog, service }): FinancialCaptureReader`, where `dependencies` supplies real control `db` and visible evidence `store`, `catalog` is the existing source catalog, and `service` is the existing `createSourceService` result. `readCapture({artifactHash,manifestId})`:

1. Resolve immutable candidate with `registry.getCandidate(artifactHash,manifestId)`.
2. Call exported `readDiscoveryCapture(dependencies,catalog,{companyId:candidate.manifest.companyId,manifestId})`. This proves complete visible originals/evidence/membership; it returns safe `binding`, not events. Do not import its private `readDiscoveryCaptureContents` or replace it with a coverage summary.
3. Read exact snapshot via `service.getSnapshot(candidate.snapshot.id)`, exact manifest via exported `readManifest(db,companyId,manifestId)`, and full events via `service.getSnapshotRecords(candidate.snapshot.id)`. Compare canonical full manifest/snapshot bytes to registered objects, not only content hash; compare all discovery binding fields to those same objects. Never select latest epoch or selected-account event subset.
4. Assemble artifact/profiles from the immutable registry plus exact manifest/snapshot/events; call `deriveFinancialCapture` for hash/membership/boundary validation. Return the validated full capture. Keep normalized profile/event ordering compatible with accepted protocol; the accepted jobs parser normalizes its parsed request before launcher execution.

Use the existing `createVerificationSelector(options.pins,captureBindings)` and wrap its result with an explicit `fixtureSetVersion === '2'` check/narrowing for `FinancialFixtureSelectionV1`; other versions cannot enter attested jobs. Preserve existing exact operator pins and IDs. The selected metadata is not the evidence digest: the fixed launcher probe obtains that digest. Do not reread or decode protected fixtures in control.

`composeVerification` must probe the complete expected migration identities and require version at least 6 before constructing/mounting the attested service. Keep current registry directory checks. `financial-verification-composition.ts` assembles capture reader, fixed launcher and jobs from these dependencies; it need not invent another route. Return the same `{registry,plugin}` shape to local composition. Missing/conflicting setup still produces existing safe setup diagnostics and leaves source inspection/preview usable. Do not fall back to legacy execution while claiming this attested service is available.

## Default development wiring is part of this slice

Actual default `scripts/dev.ts` currently supplies only pins, registryRoot and expectedMigrations. The new launcher requires trusted `{evidencePinRoot,servedRoots}`. Extend `LocalVerificationOptions` with this trusted root configuration; pass it through composition. In `localFeaturePlugins`, derive the repository-fixed `.local/protected-evaluator` root from `import.meta.url`, matching `prepare-verification.ts`/fixture-store's existing pinned destination. Do not confuse it with `.local/demo/protected` or a selected truth producer directory.

Supply actual visible/served storage roots, including the configured `EAPR_DEMO_EVIDENCE_ROOT`, repository-fixed `.local/demo/visible`, and registry root. These are the trusted startup configuration, never request fields. Resolve paths consistently; the protected launcher enforces realpath and disjointness. Include any additional actually served root if composition acquires one. Tests may inject isolated real temporary roots through trusted options. No environment variable or browser field selects an arbitrary evaluator executable or build reader. No protected truth/sidecar path is passed to worker/web or exposed in API output. Existing operator preparation/selection files and evidence-v2 pin bytes stay unchanged.

Default `createLocalComposition` must use this service when valid operator version-2 pins are present. An isolated helper test that never reaches default composition is insufficient. A1c does not promise all later readiness dependencies merely because `verificationAvailable` is true.

## Required composed proof

Use real native PostgreSQL and fixed production protected child, not a fabricated completion. Reuse established demo/evidence operator test helpers outside product code. Exercise real Fastify routes with actual local session cookie/CSRF, POST preview to register, POST `/api/connectors/:id/verify`, and authorized GET `/api/verification-jobs/:jobId` until completion. For each A/B metadata-bearing candidate assert all thirteen checks and complete coverage, safe persisted report plus attestation, and exact capture/evidence/build binding. Read the attestation through the real trusted reader using an explicitly test-only matching policy; do not write an installed policy or imply production approval authority.

Cover:

- No cookie/CSRF, foreign candidate/source/account, invalid profile set and extra body fields cannot enqueue/probe; public body cannot select fixture/build/actor/events/report/attestation. Task-specific denial uses the existing task-authorized plugin seam, including foreign task job GET; do not invent task auth on the demo reviewer session.
- Event omission/substitution, whole snapshot mutation with unchanged content hash, wrong manifest/capture, missing visible original/evidence, and absent/mismatched protected pin fail without eligible attested completion. Keep fixed sanitized public failures and durable attempt budget behavior. Spy/count capture/probe only for denial-order assertions; successful composed path uses the real implementations.
- Restart/recreate control service and registry, reread exact safe proof bytes; no replay of expected values into product code. Legacy completed job/report stays readable but real attestation reader rejects it for lack of provenance.
- Missing control006/invalid expected ledger or invalid root/pin setup does not mount attested availability; valid default local composition produces real provenance. No parent/runtime writes or approval authority arise from verification.

Suggested focused commands (record exact actual commands/results, all partial): `npm run typecheck`; evaluator unit suite; `npm run test:integration -- tests/integration/financial-attestation-composition.test.ts tests/integration/local-verification-startup.test.ts tests/integration/v2-verification.test.ts tests/integration/bootstrap-financial-verification.test.ts`. Root selects broader regressions after scoped evidence. Preserve legacy wire tests. Independent review must inspect the exact final candidate; no V3/live-model/joint-acceptance claim follows.

## Immediate A2 dependency contract — implementation next, not another redesign

After accepted A1c and final build stabilization, A2 owns safe operator policy preparation, immutable publication and the trusted scope index under the already accepted authority proposal/A2 brief. It must consume actual registered subjects/captures and operator-pinned evidence-v2 plus bootstrap descriptors. Financial build comes from `readFixedFinancialBuildHash`; bootstrap builds from `readFixedBootstrapBuildPins` in `@eapr/evaluator/bootstrap-launcher`. Protected descriptor validation stays in operator/evaluator setup, never control/worker. Financial evidence bundle hash and bootstrap descriptor hash remain distinct; descriptor evidencePin must exactly match the financial pin. Use completed A1 provenance plus explicit validated operator tuple inputs, never public eligible summaries or claimed issuer IDs.

Output is an `ActivationTrustPolicyV1` of exact indivisible subject/capture/scope/build/fixture tuples, installed read-only and independently loaded by control and worker at startup. Missing/malformed/uninstalled policy blocks new activation; A1c must not create a permissive placeholder. Build/source changes require fresh proof and final policy tuples. Operator setup may explicitly install a policy; a grant request cannot. Existing successful receipts remain recoverable after rotation.

The companion scope index must allow A3b to resolve a registered inactive account to its exact scope/source/manifest and manifest instant without parent writes or URL-invented scope. A3 accepted storage alone does not supply that publisher/loader: main currently has parent persistence/snapshots/activation-store modules, no mounted parent route. Root assigns A2 publication/loader paths and A3b route adapter against their actual final ports; do not make a fake index to claim A3b complete. A2 also provides hash-addressed activation-bundle publication/recovery for A4/A5, but no bundle may be published as a grant before durable authenticated reviewer intent exists.

No material product/financial gap was found for A1c. Remaining coordination is explicit root reservation of the narrow `scripts/dev.ts` hunk, exact baseline with control006, and later A2/A3b publisher/loader ownership. A1c is implementable now without A2, AS server edits, a provider key, new contracts, or more architecture work.
