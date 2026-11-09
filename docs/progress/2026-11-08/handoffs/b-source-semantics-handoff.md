# AS — authoritative current source semantics implementation handoff

Status: exact implementation assignment candidate for fresh independent review. No implementation authorization until root accepts that review. Prepared against `ae5c7e1`, with A0 contracts accepted at `6336517` and D1 source tools accepted at `5b4c257` (D1d4 per root). This document changes no product code, SQL, tests or runtime state. No tests were run and no commit was made for this handoff.

Authority: repository/area AGENTS; contract freeze F1, F4 and F5; additive authority freeze; accepted activation proposal SHA-256 `23e7117c3b1ac8cb5c4c44b044ed2efd53530f55e38294f0165ec9ba9db1f737`, especially §7; accepted activation handoffs SHA-256 `063bab1a66159f118f269c97c84a537c1529a64a0c8a7d743039f6b4096be45a`, AS. Both brief hashes were checked during preparation. Equality of opaque revisions in the accepted proposal supersedes F5's older abbreviated “newer” wording. This is source observation, not activation authorization or financial policy.

## 1. One writer and exact paths

Root assigns one AS implementer the following complete producer/transport slice. That implementer owns the source-owner and C private-route roles for these paths only; there must not be concurrent writers to them.

| Path | Permitted change |
| --- | --- |
| `packages/sources/src/current-semantics.ts` (new) | Locked authoritative reader and private pure fold/validation helpers |
| `packages/sources/src/manifest.ts` | Add service method delegating to reader; preserve existing methods |
| `packages/sources/src/index.ts` | Narrow reader/type exports only; preserve D1 exports |
| `packages/sources/test/current-semantics.test.ts` (new) | Focused schema/fold/error unit tests |
| `apps/control/src/routes/source-semantics.ts` (new) | Private GET plugin only |
| `apps/control/src/source-semantics-composition.ts` (new) | Construct producer, capability authorizer and plugin; expose independent control observation port |
| `tests/integration/source-semantics.test.ts` (new) | Native PostgreSQL producer, actual composed HTTP, race and isolation proof |

Use existing `buildControl({featurePlugins})` to mount the new composition in integration and the separately authorized caller. No edit to `server.ts` is necessary. This assignment does not silently mount a new capability in default local startup. Root confirmed default mounting is deferred to A4/A5 integration; its implementer must obtain root's explicit serialized reservation of the actual caller path. Standalone AS acceptance does not mean the default endpoint is running. Completion must identify the exported composition and actual tested mount, and must not claim default `npm run dev` exposes it unless separately integrated and tested.

Forbidden paths/scope: D2's `discovery-composition.ts`; discovery lifecycle/tools; `verification-composition.ts` and A1c general verification composition; A1b evaluator/launcher/financial provenance and control006; contracts/schema/hash/build manifests; existing source publication/append implementations; `scripts/dev.ts`; default `composition.ts`; worker/runtime/parent paths; all SQL/migrations. Do not add a package dependency, package subpath or contracts-root export. Existing source package root exports suffice. If a source index change affects a frozen protected build closure, report it to its owner for serialized reconciliation; do not change that owner's build manifest.

No A4 readiness/grant consumer, A5 worker client/activation, sync, policy preparation, source writes, activity, protected truth access, model call, worker control-DB access or new financial behavior belongs here.

## 2. Exact existing contracts and proposed local ports

Import the existing `SemanticPreflightSchema`, `SemanticPreflight`, `SemanticVersionMapSchema`, `IdSchema`, `hashManifest`, `hashEvent`, and existing manifest/event schemas from `@eapr/contracts`. Do not create SemanticPreflightV2, add manifest metadata to the response, or duplicate validators.

Existing wire success shape is exactly:

```ts
// Existing contracts type, shown here rather than redefined in implementation.
type SemanticPreflight = {
  sourceRef: Id;
  checkedAt: IsoInstant;
  versions: SemanticVersionMap;
};
```

Local source export:

```ts
readCurrentSemantics(
  dependencies: { db: Pool; clock: Clock },
  catalog: ReadonlyMap<Id, SourceDefinition>,
  sourceRef: Id,
): Promise<SemanticPreflight>;
```

`createSourceService(dependencies, catalog)` gains the bound method `readCurrentSemantics(sourceRef): Promise<SemanticPreflight>`. The reader does not need EvidenceStore. Resolve catalog entries by exact sourceRef, rejecting ambiguous duplicate source registrations rather than selecting the first. Capture an immutable trusted catalog definition for the call; requests cannot supply definitions or contracts.

New composition export:

```ts
composeSourceSemantics(
  dependencies: { db: Pool; clock: Clock },
  options: {
    catalog: ReadonlyMap<Id, SourceDefinition>;
    capability: { token: string; sourceRefs: readonly Id[] };
  },
): {
  plugin: FastifyPluginAsync<ControlServices>;
  readCurrentSemantics(sourceRef: Id): Promise<SemanticPreflight>;
};
```

The internal direct read port enforces the same configured source allowlist, creates a fresh producer observation per invocation, and is available only to trusted composition callers. It does not cache the HTTP result or accept an observation supplied by a browser. Its existence does not implement A4. The plugin closes over this port and an explicit capability authorizer. Do not export credentials in the return object.

Use existing `SourceError` and `ApiErrorSchema` for transport errors. Source semantic diagnostic names are already frozen in `ActivationAuthorityDiagnosticCodeSchema`: `SOURCE_SEMANTICS_UNAVAILABLE`, `SOURCE_SEMANTICS_MISMATCH`, `SOURCE_SEMANTICS_UNSUPPORTED_ORDER`. AS uses UNAVAILABLE for failed authoritative observation and UNSUPPORTED_ORDER for conflicting independent stream order. MISMATCH is reserved for future consumer comparisons; the producer accepts no selected profile or baseline. Reuse existing `SOURCE_FORBIDDEN`, `SOURCE_NOT_FOUND` and source input error conventions for auth/not-found/malformed input. No new diagnostic enum or arbitrary upstream error text.

## 3. Authoritative observation algorithm

1. Validate sourceRef with IdSchema, resolve its trusted catalog definition, and enter existing `withTransaction`. On the single checked-out client acquire `lockSource(client, sourceRef)` from `uploads.ts` before reading manifests/events. Reuse that exact advisory lock, including its namespace. No new sentinel or advisory-lock scheme.
2. Select newest published row for that source by PostgreSQL numeric `epoch DESC`, not JSON/text ordering, capture completion, dossier existence, snapshot completeness or caller pin. `source_manifests.epoch` already supplies numeric order. Latest incomplete dossier/capture is still the current semantic authority. Missing latest data is unavailable; never fall back to an older complete manifest.
3. Parse and validate the selected manifest; verify its recomputed hash; bind row manifest_id/company_id/source_ref/epoch to the parsed manifest and pinned source definition. Reuse `validateManifestStreams` as a minimum and verify the referenced stream/resource contracts against the pinned definition. Do not call existing pool-based `readManifest`, `fetchChanges`, `getSnapshotRecords` or complete-capture/discovery readers from inside the transaction: all observation SQL must use this client and locked state.
4. Copy the validated manifest.semanticVersions. This is the baseline metadata, even if baseline document capture is incomplete. Do not reconstruct it from historical financial events or substitute profile revisions. Discover semantic-bearing resources by pinned `SourceContract.kind === 'semantic_change'` and their registered streams; do not hardcode `a-semantics`, `b-semantics`, company names or payload field names. Validate stream assignment rather than silently dropping an unsupported semantic resource.
5. For each semantic-bearing stream, use its exact selected-manifest `resumeAfter` watermark. Read subsequent rows strictly `sequence > resumeAfter`, ascending numeric sequence through the locked observed high water. Validate safe numeric conversions, contiguous sequence and row/event source, stream, sequence, id and content_hash equality; parse and run `validateSourceEvent` against the pinned definition, including `hashEvent` equality. Reject gaps, missing watermarks, conflicting duplicates or corrupt rows with no partial result. If paging is used, keep every page/high-water read on this same client under the same lock. Events at/before the watermark cannot override the manifest map.
6. Fold only validated `semantic_change` events from those contracts. The revision is the validated envelope `event.semanticVersion` used by existing compiler semantic checks; do not derive it by sorting revision IDs or interpreting arbitrary payload fields. A fully scoped event replaces its exact `sellerEntityId/sourceAccountId` map entry. A semantic event missing seller or account is governing and writes `*`. Preserve an existing governing `*`; a later scoped event does not erase it. A later published manifest is its own authoritative starting map. Preserve distinct sellers and unrelated accounts; do not resolve parent accounts, manufacture an approved scope, or collapse same account IDs across sellers.
7. Existing A/B each have one semantic-bearing stream. Numeric sequence orders events only within its stream. Disjoint-key folds can coexist. If independent streams require an order to determine a key's revision, fail `SOURCE_SEMANTICS_UNSUPPORTED_ORDER`; do not sort stream IDs, event IDs, timestamps, effective dates, revision strings or manifest array order to invent a total order. No stream-authority precedence is introduced here.
8. Financial events never update the metadata map, even when their envelope semanticVersion differs. Validate and return exactly `SemanticPreflightSchema.parse({sourceRef, checkedAt, versions})`. Obtain checkedAt once from the injected clock during the locked observation; it is audit time, not TTL, lease, effective-time filtering or permission to reuse old truth. No source/activity/snapshot write is allowed. Finish/release the transaction before returning over HTTP. There is no lock across a worker/control financial transaction, network request or protected fixture read.

If an unsupported source definition requires interpreting a second revision field, resolving conflicting independent streams, clearing a governing event without a new authoritative baseline, or inventing precedence, stop that unsupported case with the frozen unavailable/order diagnostic and raise the exact missing rule to root. Do not broaden semantic policy. No such extension is required for the accepted A/B definitions.

## 4. Private route and trust setup

Serve only `GET /internal/sources/:sourceRef/semantics`. The path contains an Id, not a URL or file path. No source selector, baseline, selected profile, semantic map, target, operator instruction or arbitrary endpoint may enter through body/query. Reject unexpected query inputs and request bodies rather than treating them as options. Return `Cache-Control: no-store` on success and errors.

Composition requires an explicitly installed nonempty source-read bearer token plus a fixed validated duplicate-free sourceRef allowlist. Missing/malformed capability disables composition by failing configuration; never synthesize a permissive token or inherit reviewer, worker-service or demo-operator authority. Trusted operator setup supplies a distinct secret through server-only configuration; do not put it in browser environment variables, public responses, evidence packets, logs, discovery capability/tool tables or registry bundles. Root/caller installs it outside this assignment; no new secret-generating script is needed. Hold a copied immutable allowlist, not mutable request state.

Authenticate the bearer capability before catalog/DB lookup, using bounded exact token comparison with timingSafeEqual after length checks. Missing/invalid token and nonallowlisted source yield 403 SOURCE_FORBIDDEN with no read or existence leak. A valid allowed but unregistered source yields 404 SOURCE_NOT_FOUND. A registered source with no usable published manifest, corrupt observation or source DB failure yields 503 SOURCE_SEMANTICS_UNAVAILABLE; unsupported conflicting order yields 503 SOURCE_SEMANTICS_UNSUPPORTED_ORDER. Malformed source IDs/request syntax use existing 400 source input error conventions. Never expose SQL, token, original source bytes or raw exception messages.

The source process in the local composition owns the existing source/control application pool; worker never receives that pool or credentials. The capability grants read access only and cannot invoke source uploads or scenario operator methods. Browser reviewer cookie/CSRF alone is not authorization. Future A5 owns a separate worker HTTP client using a configured allowlisted loopback origin, fixed route, source-read credential, timeout and no redirects; that client is not AS work. No browser/bundle-supplied origin is permitted.

## 5. Required proof for this exact candidate

Use the native isolated PostgreSQL harness/application roles and real published source data. No new schema and no test-only replacement producer can satisfy completion. Unit checks support, but do not replace, these integration cases:

- **Current published authority:** publish epochs 2 and 10 with differing metadata, make epoch10's dossier/capture incomplete, observe epoch10 through the real producer and composed GET. Prove no complete-capture fallback; also test missing published manifest fails unavailable.
- **Numeric post-watermark fold:** metadata baseline differs from a semantic event at the watermark; only later events apply. Use sequence2 and sequence10 and non-monotonic opaque revisions (including a lexical “decrease”) to prove event sequence, not revision ordering, governs. Cover multiple pages if reader pages.
- **Validation:** corrupt manifest hash/row identity, wrong source/company, stream or watermark mismatch, event hash/row-envelope mismatch, missing sequence and unsupported contract all fail without a partial versions response. Corruption setup uses test admin facilities only, never a product mutation endpoint.
- **Scope:** same account name under distinct seller keys remains distinct; selected key, unrelated key and governing `*` are preserved independently. Scoped updates never clear `*`; unscoped valid semantic events create it. Ordinary financial event versions cannot change metadata. Validate returned maps with the existing schema and include prototype/invalid key rejection.
- **Independent stream order:** use a registered synthetic definition with two semantic streams, conflicting revisions for the same key, and prove503 UNSUPPORTED_ORDER; no fabricated lexical/timestamp precedence. Disjoint keys do not need a fabricated total order.
- **Publication race:** deterministic barriers with the real source publication transaction holding the existing lock; start observation while publication is uncommitted, prove it waits, then commit and verify an entirely new manifest/watermark/fold. Reverse ordering so observation holds the lock and publication waits; the observation is entirely old and the next is new. Do not use timing sleeps as the assertion.
- **Append race:** exercise real scenario append (A and B) sharing the same lock, with controlled transaction barriers. Observe wholly before/after appended semantics, never partial state. Include publication followed by append so watermark membership is not counted twice.
- **Actual composition/authentication:** buildControl with the exported plugin, real source DB and actual HTTP listen/fetch for at least the successful observation and denial cases. Valid capability for allowed source works; no/incorrect bearer, reviewer cookie, demo-operator token and worker-health token fail. Valid token for foreign/nonallowlisted source fails before reading. Allowed unknown source404. Distinct calls through direct control port and route obtain distinct fresh observations after append; neither reuses an earlier returned object.
- **Transport isolation:** extra query/body/path inputs cannot alter the selected source or endpoint; GET cannot invoke uploads/operators; private source-read token does not grant source mutation. Error responses remain strict/sanitized and no-store. DB outage produces503 through actual route, not an invented empty map.
- **Zero writes:** compare source rows/dossiers/snapshots, activity/counters, migration ledgers and runtime state before/after repeated successful and failed observations, excluding only explicitly separate fixture publications/appends. Show runtime untouched and no worker control-DB dependency/import. Transaction locks are allowed; persistent writes are not.

Selected-profile/baseline equality and successful exact-receipt outage bypass remain A4/A5 consumer obligations. AS proves the exact selected/unrelated/governing map output those consumers will receive; do not implement a new approval comparator merely to claim consumer acceptance. Future consumers must strictly parse the response, match requested sourceRef, compare every selected key with both profile and approved baseline by equality, block missing/mismatched selected key or any governing `*`, ignore unrelated keys, fail closed on unavailable/malformed output, and retain successful exact receipt recovery without new semantics. These are recorded dependencies, not AS test claims.

## 6. Delivery and gates

After root accepts fresh independent handoff review, implement only the reserved paths, then run:

```sh
npm run typecheck
npm run test:unit -- packages/sources/test/current-semantics.test.ts packages/sources/test/change-feed.test.ts
npm run test:integration -- tests/integration/source-semantics.test.ts
```

Use Node24/PostgreSQL18 per repository setup. Record commands, exact candidate commit, assertions and any skipped cases; label all these focused checks partial. Run broader existing source tests only when the changed exports/service behavior or failures justify them. No source/activation slice machine gate, default-startup claim, user acceptance, live-agent claim, parent mutation or financial correctness claim follows from these checks. Root arranges independent exact-candidate code review before Sol's producer becomes an accepted A4/A5 prerequisite. Any necessary shared-path edit requires root to reassign that path before implementation, not an opportunistic edit by AS.
