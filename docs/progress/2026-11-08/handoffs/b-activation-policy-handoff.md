# A2 — operator policy, safe scope publication, and immutable bundle transport

Design-only implementable supplement to accepted A2/authority architecture. Inspected main `85e2c11dda2b1b61087299e4952b21ca8d27bebb`, accepted A1b ports, A0 schemas, S3a/S3b setup/registry ports and A3a parent storage. A1c is concurrently owned; AS is accepted but not default-mounted. No implementation, tests, commits, or subagents occurred here. Root must accept these concrete paths/ports before dispatch. No SQL: control007 belongs to discovery findings/proposals and control008 to later review/activation intents.

## Deliverable and ownership

Implement operator-only preparation/installation of exact safe policy; safe immutable scope members plus atomic current index; independent read-only loaders; and a bundle publisher driven only by an injected durable-intent reader. This slice installs no customer approval and mounts no activation route. Final local policy/proof generation waits until relevant source closures stabilize; library/setup/test implementation can proceed concurrently with A1c.

New owned files:

- `scripts/prepare-activation-policy.ts` — operator CLI and orchestration.
- `packages/storage/src/activation-files.ts` — bounded canonical read and atomic no-overwrite publication helpers, internal to the new storage modules.
- `packages/storage/src/activation-policy.ts` — policy installation/read helpers without protected imports.
- `packages/storage/src/activation-registry.ts` — scope members/index and bundle file publication/read helpers, without database or evaluator imports.
- `apps/control/src/activation-publication.ts` — trusted registry selections and durable-intent adapter.
- `packages/storage/test/activation-policy.test.ts`, `packages/storage/test/activation-registry.test.ts`.
- `tests/integration/activation-policy-setup.test.ts`, `tests/integration/activation-publication.test.ts`.
- `docs/demo/activation-policy-setup.md` — exact operator setup/installation and limitations.

Narrow existing reservation: `packages/storage/package.json`, only safe `./activation-policy` and `./activation-registry` exports. Root serializes this shared file. Run with `node --import tsx scripts/prepare-activation-policy.ts`; no root package command/lockfile change is needed. No A1c-owned files, `scripts/dev.ts`, `server.ts`, evaluator implementation/build manifests/package exports, contracts, bootstrap setup files, source modules, parent modules, SQL, or web edits. New private file helper is not an extra generic package export.

## Existing ports to consume

Use `ActivationTrustPolicyV1Schema`, `ActivationTrustPolicyEntryV1Schema`, `RegisteredScopeIndexV1Schema`, `ActivationBundleV2Schema` and their existing hash helpers `hashActivationTrustPolicy`, `hashRegisteredScopeIndex`, `hashBundleV2`. These schemas normalize declared sets; write canonical parsed bytes and validate hashes using the corresponding helper, not raw file hash as a substitute for semantic hash. Reject empty activation policies even though the shape schema currently permits an empty entries array. Preserve v1 hashes.

Actual evaluator setup interfaces:

```ts
// Safe public exports
readFixedFinancialBuildHash(); // financial-attestation-launcher
readFixedBootstrapBuildPins(); // bootstrap-launcher -> {evaluatorBuildHash,subjectBuildHash}
createFinancialAttestationRegistry(db, candidates)
  .readRegisteredFinancialAttestation(reportId, {
    artifactHash, requiredProfileHashes, capture, policy,
  }); // returns {report,attestation}, rejects ineligible or missing provenance
createBootstrapVerificationRegistry(db, candidates)
  .readRegisteredBootstrapResult(resultId, {pin,binding,planHash});
// returns {result,plan}, validates stored completion and passed result

// Existing PRIVATE operator/evaluator source import, only in setup script:
readBootstrapExpectation(
  {fixtureSetId,fixtureSetVersion,hash:fixtureHash},
  {...capture,registration:{artifactHash,manifestHash,snapshotId,snapshotObjectHash}},
  roots,
);
```

`readBootstrapExpectation` lives in `packages/evaluator/src/bootstrap-fixtures.ts`, has no public package export, and returns protected truth/support alongside descriptor. The setup script must extract only safe descriptor pin/binding fields and discard the rest; never log/serialize/spread its return into safe artifacts. It validates the protected descriptor against exact evidence-v2 bytes and subject/capture. No new protected helper/export is necessary. Its production roots already default to `.local/protected-bootstrap` and `.local/protected-evaluator` with served-root separation.

## Operator preparation and explicit installation

Expose testable `prepareActivationPolicy(deps, selection)` from the script. Dependencies are trusted candidate registry, A1c `FinancialCaptureReader`, financial registry reader, and fixed build readers; only the operator script invokes the private descriptor reader. Consume A1c's accepted capture-reader export after merge; until then code against its announced `readCapture({artifactHash,manifestId})` structural interface. Do not edit or duplicate its capture implementation. CLI wires existing control application DB/candidate registry/visible source service/store and the eventual A1c reader; no runtime DB credential.

Operator selection is a strict local file containing `policyId` and nonempty entries `{artifactHash,manifestId,selectedProfileHash,financialReportId,bootstrapFixture:{fixtureSetId,fixtureSetVersion,fixtureHash}}`. These are references/pins, not expected financial facts. CLI flags: `--selection-file <path>` and optional explicit `--install`; repository-fixed production destinations below. Bounded no-symlink regular-file read with same-user/private-file checks following existing bootstrap setup. Test-only root/dependency injection stays in callable helpers, not an HTTP/environment-supplied executable or oracle override.

For every selection:

1. Resolve `getCandidate(artifactHash,manifestId)` and actual full capture. Require selected profile exists exactly once, has supported bootstrap metadata, belongs to manifest/source, and full profile set matches artifact. Derive capture with accepted `deriveFinancialCapture`.
2. Read both fixed build closures. Read/validate selected protected bootstrap descriptor through the existing private helper. Require descriptor contains the exact selected profile/scope and matches the capture. Its `descriptor.evidencePin` is the financial evidence pin; its `descriptor.hash` is the distinct bootstrap fixture hash. Never use one for the other.
3. Form the complete indivisible policy entry from validated descriptor pin, exact registered subject/capture, and actual fixed builds. Financial constants remain runner `eapr-financial-1`, protocol/harness `1`; issuer `eapr-control-registry-1`; bootstrap runner `eapr-bootstrap-1`, protocol `1`.
4. Form a candidate policy from all validated entries and its correct hash; pass that candidate policy to the real financial provenance reader for each selected `financialReportId`. This breaks no trust boundary: the candidate policy is an operator validation input, not yet installed authority. The reader must validate actual persisted completion/provenance at the exact selected build/capture/pin. No raw SQL report shortcut and no old report promotion. Recheck fixed builds before publication and revalidate descriptor pin/capture before install. Failure publishes no current policy.

Preparation returns/writes only safe canonical policy plus bounded safe digest/selection report. Default invocation prepares a hash-addressed candidate and prints its digest; `--install` is the explicit operator action selecting that verified policy as current. Do not automatically install on dev startup, an agent verification run, or a reviewer grant. Missing protected bootstrap setup fails with a fixed safe setup code and documentation directing the operator to existing `prepare-bootstrap-verification.ts`; do not synthesize review facts or automatically repin evidence.

Production paths: `.local/activation-policy/policies/<policyHash>.json` and `.local/activation-policy/current.json`, deliberately separate from the control-written `.local/artifacts` registry. Current file contains the full canonical policy, atomically replaced only by operator installation. Both control and worker later independently load this same operator-owned read-only current policy once per process lifetime. Parent directory trust is configured by supervisor, not discovered from bundle/request issuer/path. Check realpath/no symlink, ownership/modes, canonical bytes/hash, schema and nonempty entries. The local same-OS-user trust limitation is unchanged; a hash or issuer alone is not authentication. Do not make control grant code able to install policy through a package import used by its request handler.

`loadActivationPolicy({policyPath}): Promise<ActivationTrustPolicyV1>` reads a configured trusted path and returns an immutable/copy-isolated policy snapshot. Missing/unavailable/empty/malformed installation throws fixed unavailable/mismatch diagnostics without paths or private content. Control/worker composition catches this to disable new activation; health semantics and mounting remain separately assigned. Policy rotation is atomic install plus service restart. Do not enforce current policy inside the immutable bundle reader or receipt lookup: successful exact receipt recovery must remain possible under older authority; A4/A5 impose current policy for new application only.

## Scope publication and A3b consumer port

Existing registry object filenames are byte hashes, resolved via control DB rows. Worker cannot infer them from profile/manifest semantic hashes. Publish a small safe independent view rather than exposing that DB:

- `.local/artifacts/activation-registry/profiles/<profileHash>.json`
- `.local/artifacts/activation-registry/manifests/<manifestHash>.json`
- `.local/artifacts/activation-registry/indexes/<indexHash>.json`
- `.local/artifacts/activation-registry/current.json` (full canonical `RegisteredScopeIndexV1`).

Use the accepted index fields unchanged: `{accountId,scope,profileHash,manifestId,manifestHash,manifestAsOf}`. No invented sourceRef field; derive it from validated profile/manifest members. Exact scope/profile/manifest/hash/asOf/source equality is checked by both publisher and loader. Files are immutable; publish members and historical index first, then atomically replace current index. A concurrent reader captures one index byte set and reads only its immutable referenced members; no second current-index lookup during that request.

Control adapter exposes `publishRegisteredScopes(selections)` where each selection is `{artifactHash,manifestId,selectedProfileHash}`. It resolves existing immutable candidates, validates selected profile/source and builds entries/members internally. No public route accepts entries or raw profiles/manifests. For bounded local setup, operator selection explicitly chooses each account's current subject; historical profiles do not become automatic fallback. Retain unrelated current entries; reject duplicate account selections or any attempt to change a previously registered account's scope. Serialize the read-merge-publish section using an exclusive local writer lock; a stale/unavailable lock fails safely without partial current publication. Do not silently prune entries or add deletion semantics. Preserve immutable historical indexes/members.

Library ports for immediate A3b implementation:

```ts
createRegisteredScopeReader({registryRoot}).readSnapshot(): Promise<{
  index: RegisteredScopeIndexV1;
  resolveRegisteredScope(accountId: string): {
    entry: RegisteredScopeIndexEntryV1;
    profile: CustomerProfile;
    manifest: BootstrapManifest;
  } | null;
}>;
```

Validate the complete selected snapshot/member set before returning it; reject ambiguous/missing/hash-invalid members, not a partial map. Unknown account returns null only from a valid index; unavailable index is never treated as empty. Copy-isolate/freeze snapshot objects. A3b authenticates first, captures one snapshot per read and resolves the account; foreign/missing scope is 404. It then uses accepted `readStoredTarget(client,scope,snapshotHash?)`, `projectStoredParentView`, and `readStoredActivation` in parent modules. A registered inactive account can get deterministic version-zero at `entry.manifestAsOf` with zero writes; a missing historical snapshot is still 404. A2 does not mount these routes or insert a scope sentinel.

Scope publication is independent of policy eligibility/financial results: it asserts registered identity metadata, not approval authority. Provide operator setup mode `--publish-scopes` using the same strict selections (or a separate scope-only selection containing the three reference fields) to publish this safe view even before policy/proofs are ready. This avoids a dependency cycle: A3b must read real inactive state before A4 can run target-bound bootstrap verification. Do not require a passed bootstrap result to publish an index or construct a trust policy. Later combined readiness still requires real passed bootstrap proof at the actual selected parent target.

## Bundle publication and A4 consumer contract

Storage exposes `readActivationBundle({registryRoot},bundleHash)` and a trusted immutable writer used only by `apps/control/src/activation-publication.ts`. Store at existing frozen `.local/artifacts/activation-bundles/<hash>.json`. Both parse strict v2, verify `hashBundleV2`, compare canonical bytes on repeat publication, and reject wrong hash, traversal, symlinks, truncated/oversized/noncanonical files and conflicting existing bytes. Use atomic no-replace publication (temporary sibling plus link/no-clobber equivalent), not replacement rename over an existing bundle. Bound bytes explicitly; use the existing 10 MiB protected-envelope ceiling as the initial safe file bound, fail unavailable rather than truncate. Readers never delete or mutate files.

Control adapter proposed exact port:

```ts
createActivationPublication({registryRoot,readCommittedIntent}).publishIntent(intentId);
// readCommittedIntent(intentId) -> Promise<null | {
//   intentId: string; bundleHash: string; bundleBytes: Uint8Array;
//   request: ActivationRequest; reviewer: ReviewerContext;
// }>;
// publishIntent -> {bundleHash:string,idempotencyKey:string}
```

The injected A4 reader is trusted control DB code: it returns only a committed authenticated reviewer intent from future control008, never a browser body. Publisher checks selected intent identity, strict parsed canonical bundle, exact request/reviewer equality and bundle hash before file I/O. Null is unavailable. No public arbitrary-bundle method is mounted. A4 prepares outside transaction, commits exact canonical bundle/request/reviewer association under its head lock, then calls `publishIntent`; crash recovery calls it again by original intent ID and republishes identical bytes. It never changes actor/time/request to rebuild a lost file. A2 tests can use a controlled durable-reader seam and filesystem crash/retry, but cannot claim real control008 transactional intent coverage. A4 owns those DB/barrier tests.

Storage bundle reader performs representation/integrity validation, not full readiness or grant acceptance. A4 owns both real proof readers, target/cutover plan binding, semantic compatibility, current installed policy and head/intent CAS; A5 independently verifies and grants under runtime locks. No fake current policy, successful receipt, or grant from publisher success.

## Verification and dispatch gates

Unit tests cover canonical normalization, mutation of each bound field, cross-entry tuple swapping, missing/empty policy, foreign/untrusted installation root, symlink/filename escape, immutable overwrite collision, partial writes, stale writer lock, concurrent scope updates without lost entries, same-account scope conflict and retained historical member/index reads during replacement. Test loader no-I/O after captured snapshot and zero DB dependencies. Existing v1 vectors stay unchanged.

Native PostgreSQL setup integration uses real registered metadata-bearing A/B captures, operator-reviewed protected descriptors, and actual fixed-child A1 attested completions. Prove preparation accepts exact supported tuples and rejects descriptor/evidencePin mismatch, stale build, wrong selected profile/capture, old unattested report, missing/failed provenance and raw self-hashed report forgery. Install to isolated trusted test directory; independently load equal policy snapshots as control and worker would. No claims of default service mounting. Use real scope publisher/loader with real registry candidates; assert no parent/runtime writes and unknown versus unavailable behavior.

Publication tests cover intent absent, request/reviewer/key association mismatch, crash before bundle publication then same-intent republish, repeated exact bytes, conflicting existing bytes, and reading old valid bundle after current policy rotation. Mark durable intent reader seam as partial until A4's actual DB integration. Policy setup itself needs eligible real financial proof; target-specific bootstrap proof is an A4 dependency, with existing `createBootstrapVerificationJobs(...).reserve/execute` and `readRegisteredBootstrapResult` consumed there. Do not invent a target inside policy preparation.

Run `npm run typecheck`, focused new storage tests, new setup/publication integration tests and existing bootstrap-fixture/provenance regressions impacted by imports. Record exact checks as partial. Root verifies source-build closure effects, then reruns A1c financial verification and final operator policy preparation/install after all relevant code stabilizes. No provisional digest may be advertised as deployed current policy. Root then dispatches A3b using the real scope reader and A4 using these ports; no further architecture pass is needed unless a concrete conflict appears.

No material financial/product gap found. The only acceptance distinction is deliberate: A2 can prove policy preparation/publication now, but mounted independent startup loading, real target-bound combined readiness and durable intent publication require later A3b/A4 composition. AS default mounting remains separately owned and required before activation.
