# A3b — composed registered parent reads

Design-only immediate implementation handoff after accepted A2. Inspected main `dbda6725eb21328871089b28c3da0e7d6af8b0a0`, accepted A3a, and the frozen A2 supplement `b-activation-policy-handoff.md`. Root confirms A1c composition ownership is released. This document assigns no concurrent permission over A2 or C1 files. Root reserves the paths below before dispatch and serializes any intervening edits. No code, tests, commits, or approval authority are delivered by this brief.

## Outcome and boundaries

The default local preview reads actual isolated runtime parent state over authenticated worker HTTP. A real A2-published inactive scope resolves before any approval, returning deterministic version zero without writing runtime rows. Existing persisted records and historical snapshots are authoritative. Both real worker GET routes and scoped control proxies are mounted by normal startup, not only by test composition.

Consume the authority proposal sections on read endpoints/scope publication and the v2 freeze's parent-query/evaluation semantics. A3b grants no authority, installs no policy, and does not require a policy merely to inspect a registered scope. Do not mount activation mutation, receipt-key lookup, review preparation, ongoing sync, or source semantics as part of this slice. AS default mounting belongs to A4/A5. Do not introduce ConnectionState or status transitions.

## Exact proposed file reservation

New files:

- `apps/worker/src/parent-reads.ts` — shared read-only scope resolution and parent/activation service.
- `apps/worker/src/routes/parent.ts` and `apps/worker/src/routes/activation-reads.ts` — private GET plugins.
- `apps/worker/src/parent-read-composition.ts` — production scope reader and route composition.
- `apps/control/src/parent-read-client.ts` — authenticated bounded worker transport and preview TargetReader adapter.
- `apps/control/src/routes/parent.ts` — scoped parent and activation GET proxies.
- `tests/integration/parent-reads.test.ts` — real registry, runtime DB and HTTP read proof.
- `tests/integration/parent-read-composition.test.ts` — local composition, setup cycle and preview proof.
- `docs/demo/parent-read-setup.md` — scope-only setup, defaults and failure behavior.

Narrow existing edits, all one writer after root reservation:

- `apps/control/src/composition.ts`: inject real parent adapter, mount scoped proxies, register source-derived candidates without depending on preview target reads, and truthful catalog mode.
- `scripts/dev.ts`: mount worker reads and pass the bounded control client at the fixed loopback worker origin. Preserve process credential isolation and existing verification startup behavior.
- `apps/worker/src/server.ts`: only route parameter-length and safe malformed-URL handling needed by IdSchema/read routes; use existing featurePlugins for mounting. Preserve health behavior.
- `apps/control/src/server.ts`: only corresponding safe malformed-URL handling if required; leave health WorkerClient unchanged by using the new separate client module.
- `packages/contracts/src/local-demo.ts`: additive targetMode enum member `persisted-parent`; retain `empty-fixture` for explicit fixture test composition. No authority schema/hash changes or contracts-index exports.
- `tests/integration/local-composition.test.ts`: inject explicit fixture adapter where a test intentionally covers legacy fixture composition, and update default-composition claims to real reads. Preserve original source/verification assertions.
- `apps/AGENTS.md`, `scripts/AGENTS.md`, `packages/parent/AGENTS.md`: narrow current-state documentation after proof.

No A2 storage/publication/setup files, A1 financial modules, discovery/C1 routes or UI, SQL, package exports/lockfiles, parent persistence/projection code, bootstrap runner/build manifests, or slice gate changes. Existing PreviewResult already uses generic target wording for any mode other than empty-fixture; no web change is necessary for this metadata correction. If an additional path is essential, report it to root for serialization rather than editing another owner's file.

## Accepted dependency ports

A2's exact safe reader:

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

`registryRoot` is `.local/artifacts`, not its `activation-registry` child. The reader validates the complete captured index and every referenced immutable member before returning. Resolve sourceRef from the validated profile/manifest, not a new index field. Capture once per request; never resolve current index again midway through a read. Missing/malformed/incomplete index is unavailable, not an empty registry; a missing account in a valid index is 404. Do not construct a mock index in production, infer scope from URL IDs, enumerate historical profiles as fallback, or trust registration hash alone as approval.

A3a already exports:

```ts
readStoredTarget(client, scope, snapshotHash?): Promise<StoredTarget | null>;
projectStoredParentView(records, evaluationAsOf): ParentView;
readStoredActivation(client, scope): Promise<StoredActivation | null>;
```

Use `@eapr/parent/snapshots` and `@eapr/parent/activation-store`. StoredTarget contains records/snapshotHash/digest. StoredActivation retains the paired activation/receipt. Do not invoke lockFirstImport, persistFirstImport or a sentinel helper from a read path. Obtain/release a runtime PoolClient with normal ownership; use only SELECT/read-only transactions if a grouped read requires a coherent DB snapshot. No control DB connection or evaluator dependency in the worker closure.

New internal service ports can be ordinary TypeScript interfaces within the reserved app modules; do not add shared public schemas. Expose parent read by account/query and activation read by account, with an injected authorization callback that runs before registry access. The production worker callback validates the existing service Bearer credential; that credential authorizes the trusted control service to read registered scopes. Scope resolution still uses the A2 registry, never caller-supplied scope. Control performs reviewer source/account authorization. No new token issuance or browser service credential is needed.

## Worker HTTP behavior

Mount GET `/internal/parent/:accountId` and GET `/internal/activations/:accountId`. Authenticate first. Validate the decoded Id and raw URL query, including duplicate keys, before resolving state. Parent query is exactly ParentReadQuerySchema: optional independent scalar `asOf` and `snapshotHash`; reject unknown keys, duplicate keys, arrays, invalid dates/hashes and malformed encodings with 400. Activation query has no selectors; reject unexpected/duplicate keys. Preserve IdSchema's full permitted length at the router boundary and safe error bodies.

Resolve the account through one valid A2 snapshot. Scope/profile/manifest disagreement is unavailable; absent account is 404. On parent read call readStoredTarget with the complete resolved scope and optional hash. A missing selected historical snapshot is always 404, including the computed hash of an unstored inactive state. Only an unselected latest lookup with no persisted target may return an empty TargetState: exact registered scope, version 0, records.asOf = entry.manifestAsOf and all financial/metadata arrays empty. This is read-time projection of real registered metadata, not a fixture granting authority. It inserts nothing, including no sentinel, snapshot, pointer or activity.

Project ParentView at normalized explicit query asOf or one observation of the injected clock. Keep records.asOf, version, records and snapshotHash unchanged. Envelope asOf/balance reflect evaluation time. Historical selection does not implicitly use historical cutover as the evaluation instant. The frozen approved-cutover balance therefore requires explicit asOf. Never copy query asOf into persisted records or change hash to match evaluation time.

Activation read returns strict ActivationStateV1: registered scope with paired null activation/initialReceipt when inactive; otherwise the stored exact paired facts. Do not substitute the current registry profile for historical approved activation bindings. Registry selection replacement cannot rewrite records, snapshots or the initial receipt. All failure/success responses are no-store. Use safe fixed ApiError bodies: malformed400, unauthorized401, forbidden403, unknown scope/snapshot404, dependency/integrity failure503. Keep read-specific diagnostic strings local and consistent; do not add authority diagnostic enum members for transport errors. No internal file paths, DB messages, token values or raw corrupted bytes in responses.

## Control HTTP and preview

Mount frozen GET `/api/parent/:accountId` and additive GET `/api/accounts/:accountId/activation`. Reuse local session `authorizeReviewer(request,{mutation:false})` for GET; preview retains its current mutation/CSRF checks. Require allowedAccountIds and allowedSourceRefs against trusted registered metadata before forwarding. A forbidden account/source receives 403 without returning its parent state; a permitted account absent from the valid registry is 404. This order avoids using parent responses to discover unauthorized data. Use the same production A2 reader in control for trusted metadata; do not grant source access merely because an account string matches. Validate the returned complete scope against that captured metadata.

The new client uses a supervisor-configured loopback origin/fixed encoded route, existing service token, bounded timeout, redirect rejection and strict ParentView/ActivationStateV1 parsing. Validate response scope/account and parent version/hash/record bindings; malformed or wrong-scope service responses fail unavailable. Validate query before transport and preserve 400/401/403/404/503 semantics without leaking private errors. No arbitrary URL, header, or account-to-scope override from browser input.

Implement existing `TargetReader.readTarget(scope,asOf,capability)`. Check both capability sets and exact full requested scope against a captured trusted registration. Call the real parent endpoint with explicit asOf, validate the full returned scope, then return a copy of records with planner asOf set to that explicit instant. Preserve all records/version. The transport ParentView's snapshotHash remains the recorded-state hash; a planning copy can legitimately have a different hash when its instant changes. Current preview already copies target asOf before planning; retain the accepted compiler/finance path. No runtime writes occur from the adapter or preview. Candidate registration is a distinct control-side write and must not be described as a zero-write control operation.

## Startup and fresh setup cycle

Normal `npm run dev` mounts these real plugins and injects the actual client into local preview. Catalog targetMode becomes persisted-parent. Do not quietly fall back to the former empty fixture when worker, registry, policy, or verification setup is absent. Parent read availability is independent of activation-policy and protected verification availability. Existing health remains its frozen DB/service probe; do not change readiness semantics to imply activation readiness.

Keep source inspection and the candidate catalog usable when registration storage, the scope index or worker parent reads are unavailable. Catch registration setup failure at its own boundary; do not abort local composition or remove valid evidence-bound candidates. GET `/api/demo/candidates` remains 200 after session authorization, with the existing candidates and `diagnostics` array. No new readiness boolean or response object is needed. Use existing Diagnostic shape with local code `PARENT_READ_UNAVAILABLE`, severity `blocker`, empty fieldPaths, and candidate account IDs in sourceIds when known; safe message: “Parent records are unavailable for preview. Complete registered-scope setup and retry.” Registration failure may use the same safe diagnostic and the setup guide explains the distinct operator steps. Never include paths or original exception messages. Derive current availability on each catalog refresh using bounded authenticated reads for authorized candidate scopes; do not retain a startup-only missing-index diagnostic after successful publication. These probes also perform zero runtime writes. A normal missing registered account remains 404 on its read API; missing/corrupt index or worker dependency is 503. Preview preserves its existing `PREVIEW_REFERENCE_NOT_FOUND`/`PREVIEW_DEPENDENCY_UNAVAILABLE` error mapping. Availability diagnostics are observations, not readiness or authority promises.

The current PreviewPage already renders catalog diagnostics and exposes Refresh candidates; PreviewResult already shows “Target balance before proposed import” unless targetMode is empty-fixture. Passing persisted-parent removes the old empty-target claim without a new UI flow or web-file reservation. No successful zero-balance preview is shown when the parent adapter is unavailable. Preserve source inspection links and existing RequestFailure rendering. The setup guide supplies operator instructions rather than exposing registry paths or setup controls in the product UI.

There is an actual dependency cycle to remove: current preview registers the candidate only after reading its target, whereas A2 scope publication needs an already registered candidate. Build/register the existing source-derived demo candidate during local composition/setup from the validated capture, existing buildDemoCandidate output and compile result. Use the real createCandidateRegistry and existing immutable registration validation, regardless of verification-pin availability. Keep the complete source capture checks; never fabricate financial/metadata fields or make a target solely to register a source subject. Reuse that registry for later verification/preview registration so exact repeat writes remain idempotent. Registration publishes no current scope index and no policy. Tests must prove this step leaves runtime untouched.

Document the concrete operator sequence using accepted A2 scope-only mode: start source/local composition to register subjects, choose exact `{artifactHash,manifestId,selectedProfileHash}` references, then execute `prepare-activation-policy.ts --publish-scopes` with the accepted strict scope-only selection file syntax. Use actual accepted A2 CLI syntax after merge. This publication needs no eligible report, bootstrap result or installed policy. Do not automatically select historical subjects, publish scopes, install policy, or repin protected fixtures at startup. Until explicit scope publication, mounted reads/preview fail safely with dependency unavailable; source inspection remains available. Since each read captures the current index, successful publication should permit subsequent reads without worker restart. No need to load any default worker activation policy to read inactive or already approved records.

If A2's implemented exported factory/CLI differs from this frozen brief, resolve the concrete mismatch with its owner before coding a substitute. Root must ensure the default script passes only runtime DB + service credential + safe registry location to worker; control retains its own DB, and web gets neither credential nor registry filesystem access. Keep safe registry files out of served roots and tool routes.

## Required proof and acceptance

Use real isolated native PostgreSQL roles, accepted A2 candidate publisher/loader and actual buildWorker/buildControl HTTP listeners, not only Fastify injection or a mock target handler. Tests may seed committed approved aggregates through the accepted A3a test storage seam; clearly label that setup as storage/read proof, not authorized activation.

Required cases:

1. Valid real A/B registrations publish through A2; inactive first GET and activation GET return deterministic scope/version/time and paired nulls. No policy installed. Repeated reads/restart preserve result; snapshotHash selector for the unstored inactive projection is 404.
2. Snapshot all runtime tables/counts/canonical data/activity before and after first/repeated GETs, errors and preview; no change. Prefer an additional read-only DB transaction/role assertion to catch attempted inserts hidden by rollback. Control candidate registration is separately accounted for.
3. Missing/invalid credential, unauthorized reviewer/source/account, unknown account, malformed/duplicate/unknown selectors, invalid hash/date/encoding and maximum-length Id. Unknown/foreign stored snapshots do not leak across full scopes; shared customer IDs remain isolated.
4. Missing/current-index corruption, missing member/hash mismatch and worker outage produce unavailable; never synthetic empty state. A2 real atomic replacement during a held read proves one captured metadata set. Different selected profile for the same scope does not overwrite stored historical facts.
5. Seed nonempty persisted state with effective-time-sensitive balance; latest/default clock, explicit cutover, snapshot-only, asOf-only and combined selectors all satisfy frozen semantics. Approved original snapshot/records/hash remain byte-identical after latest advances and after restart. Activation/initialReceipt remain paired and exact.
6. Real control proxy and TargetReader use authenticated worker HTTP. Preview against persisted nonempty parent includes its beforeVersion/balance and planned effects, with no runtime mutation. Wrong-scope/malformed worker response fails closed. Existing evidence authorization/CSRF stays intact.
7. Fresh default composition registers source subjects before any successful preview and without verification pins; explicit real scope-only publication enables subsequent preview. Missing scope publication returns safe unavailable. Normal script mounts actual routes and reports persisted-parent; no test-only index or empty fallback. Existing source, discovery and attested verification availability behavior survives.

Run typecheck; new focused read/composition integration suites; existing parent-storage, local-composition and v2-preview suites; source/verification regressions only where touched dependencies justify them. Include an actual normal-startup smoke test under leased ports with operator-published safe scope selections, both previews and authenticated reads. Record exact candidate, commands, environment and results as partial A3b read-only proof. Do not claim V3, activation, sync, live agent work or joint acceptance. Root checks any source-closure effects of the local-demo schema change before final A2 policy preparation; do not rewrite evaluator build manifests merely to hide changed hashes.

No new financial/product policy gap was found. The startup registration/publication cycle and missing-policy distinction are resolved above from the accepted A2 registration-only boundary. Exact candidate review and root file reservation are dispatch prerequisites, not reasons to invent additional approval semantics.
