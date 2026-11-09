# Evidence tools implementation split — D0/D1 and D2

Task elaboration only. Accepted semantic authority is `b-discovery-evidence-tools.md`, SHA-256 `c9cd2d998bcf2c1f2eef0af02e2163f2953f1a1e9ab21fcdf567d1c6d69ad4c0`; retain that document unchanged. Observed main HEAD when preparing this split: `2a2d3c36ad4e26bf3245d15b940352507b4611ad`. Root reports M1 server candidate a32721c with fresh Astra PASS staging and M2 client/UI active. Root determines integrated base before dispatch; do not assume a staging candidate is integrated.

This document assigns interfaces/paths/checkpoints, not new tool, source, financial, recovery, or approval policy. Accepted E1/E2 and current-query cursor semantics remain exact. No implementation, migrations, commits or policy changes made here. Existing server/source stream behavior and root integration authority are unchanged.

## Recommended smallest coherent split

Use **two Sol tasks**: task S = D0 strict contracts followed by D1 source adapter; task L = D2 lifecycle claims/recovery/composition. D0 is a reviewed interface checkpoint within S, not a third implementer with another cross-package handoff. D0+D1 can share a task because they form a read-only library tested without supervisor/model execution. D2 is independently meaningful only against the accepted D0 port and D1 behavior; it must not invent a second adapter or schema to start early.

Sequence:

1. S reads accepted handoff and begins new-file D0 schema/descriptor work. A0 exclusively owns contracts index.ts/package.json, adding three bootstrap closure names. **S must wait for A0 completion/root release before any export edit**, then rebase and preserve every A0 export. No package manifest edits are needed by default. Direct module imports allow new-file work without touching the locked files; this is not permission to publish a conflicting root export patch.
2. S delivers D0 exact schema/descriptor names, private port declarations below, focused tests and candidate hash for root's interface acceptance. Root can review this coherent checkpoint before D1 completes. No reader is advertised by runtime merely because a descriptor now exists.
3. After D0 acceptance, S implements D1 on its source-owned paths. L may implement against the accepted D0 seam in its separate paths; final D2 real-source tests and integration depend on accepted D1. Root supplies an exact base/export seam to L rather than relying on another worktree's mutable files.
4. M1 owns discovery-composition.ts until integrated/released. D2 must wait before its narrow adapter wiring hunk. M2 client/UI, events route and HTTP activity interfaces are outside both evidence tasks.
5. Root integrates accepted S, then final D2 candidate against it, with independent exact-candidate review and assigned test leases. If D1 is delayed, D2 may show focused unit progress with typed test dependencies but cannot claim the source integration is complete.

## D0 — contracts and closed argument descriptions (task S)

Own new `packages/contracts/src/discovery-tools.ts`, `packages/contracts/test/discovery-tools.test.ts`. After A0 release only: narrow additive exports in `packages/contracts/src/index.ts`; leave package.json unchanged unless root separately authorizes an actual export requirement. Do not edit existing discovery/model/findings/proposals schemas or bootstrap closure names. No discovery roles.ts edit in D0.

Publish these concrete names (types inferred without Schema suffix):

- `DiscoveryReadToolNameSchema`: four literals describeSource/querySnapshot/searchEvidence/readEvidence.
- `DescribeSourceInputSchema`, `QuerySnapshotInputSchema`, `SearchEvidenceInputSchema`, `ReadEvidenceInputSchema` with exactly accepted arguments/bounds; no run/context/grant/capture selectors in model inputs.
- `DiscoveryCitationIdentitySchema`: `{id,snapshotId,sourceId,locator,sha256}`, strict, no excerpt. Reuse existing locator validation without changing EvidenceRef.
- `DiscoveryReadToolFailureSchema`: `{ok:false,code}` closed accepted safe codes: DISCOVERY_INVALID, DISCOVERY_FORBIDDEN, DISCOVERY_CONFLICT, SOURCE_UNAVAILABLE, TOOL_RESULT_LIMIT, TOOL_FORBIDDEN, TOOL_UNAVAILABLE.
- `DescribeSourceResultSchema`, `QuerySnapshotResultSchema`, `SearchEvidenceResultSchema`, `ReadEvidenceResultSchema`: corresponding accepted success envelope or shared failure. Full result envelope <=65,536 canonical UTF-8 bytes. Preserve source number/string domains and inherited schemas; do not coerce money or invent financial normalization.
- `DiscoveryReadToolCallSchema`: strict internal discriminated union `{name:<literal>,arguments:<matching input>}`. This is trusted dispatcher bookkeeping, not another provider wire. `DiscoveryReadToolResult` is the union of those result types; use the per-name parser to ensure name/result matching, not union acceptance alone.
- `discoveryReadToolSchemas`: readonly closed four model descriptor objects with name/description/inputSchema matching actual runtime input parsers. Exporting descriptors does not enable them. D2 chooses whether to advertise implemented tools.

Range schemas enforce safe integer 0<=start<end; document-span/surrogate checks require the real authorized response and belong in D1. Read result structural checks enforce value.length<=8192, positive coordinate span matching returned value UTF-16 length, strict projection and bytecap; D1 checks exact original-relative selection and text hash. Query result structural ordering/duplicate checks should use the accepted ordered event semantics and unique citation IDs; source membership is D1 proof, not shape magic. Describe contracts unique/sorted resource and streams unique/sorted streamId. Search preserves ordered helper hits, does not relabel them exhaustive.

Model-envelope 128KiB validation remains existing discovery contract. Do not introduce server crypto into browser-safe module imports; existing canonical byte-size conventions may be implemented with the established schema approach, and source hash verification stays server-side. Avoid adding a package solely for JSON-schema generation.

D0 proof: exact valid vectors and strict/prototype/extra-field rejection; name/argument mismatch; limits and safe integers; duplicate set IDs/order; full EvidenceRef rejected by projection; empty range rejected; full65,536-byte envelope boundary including metadata, not only text; descriptor constraints match authoritative parsers. Run typecheck plus focused contracts unit tests, diff check. Record partial checkpoint, no real source authorization claim.

## Shared private port — fixed between S and L

No source→discovery package dependency. Existing `ValidatedDiscoveryCapture` exported by sources is structurally the current discovery CaptureFacts; use that existing source-owned type. No new persisted fact table or granted capability type. Names below are a private implementation seam implementing the accepted prepare shape:

```ts
// packages/sources/src/discovery-tools.ts
export type DiscoveryReadPreparationInput = {
  binding: DiscoveryBinding;
  sourceRead: SourceReadGrant;
} & DiscoveryReadToolCall;
export type PreparedDiscoveryRead = {
  facts: ValidatedDiscoveryCapture;
  result: DiscoveryReadToolResult;
};
export interface DiscoveryReadTools {
  prepare(input: DiscoveryReadPreparationInput): Promise<PreparedDiscoveryRead>;
}
export function createDiscoveryReadTools(
  dependencies: { db: Pool; store: Pick<EvidenceStore, 'get'> },
  catalog: ReadonlyMap<Id, SourceDefinition>,
): DiscoveryReadTools;
```

Contracts imports are types/schemas from the new D0 module and existing binding/grant types. D2 may define a structural Pick of this interface in its read-tools.ts to avoid runtime coupling; composition supplies the concrete source adapter. Correlation of result to input is runtime-checked with its matching D0 parser before acceptance and again before persisted result. No arbitrary callback registry, arbitrary tools, caller-provided prepare function per call, or model-selected source.

The prepare dependency performs **read-only external preparation** and returns detached exact facts and bounded typed result. It never checks reviewer policy itself, publishes activity, mutates steps or starts a capture. D2 supplies saved task grant only after preliminary current/run authorization; guarded owner transactions remain final authority. D1 proves sourceRead/binding consistency and exact captured membership. Existing SourceError safe boundaries remain intact: unavailable/corrupt capture before facts exist may reject the promise with existing typed safe SourceError; D2 must map only known safe cases under accepted failure rules, never expose raw exception text or fake facts. No new broad HTTP SourceError rewrite.

For whole-batch preflight, D2 prepares all implemented reads outside transaction, then uses exact returned facts/results plus guarded SQL recheck for semantic validity before the first success/child. D0 invalid inputs fail before adapter access. No preflight result is persisted or sent to a model as successful tool output. After the guarded claim, D2 invokes prepare for the claimed read outside transaction and rechecks at settle. This may reread immutable data; no mutable “last capture” cache and no checked-out transaction over I/O. Per-invocation detached validated facts are required; optimizations must not weaken recheck or E2 fencing. Read preparation must distinguish invalid selector/cursor/range/coverage outcomes for batch rejection from successful data so a later invalid call never permits an earlier delegation effect. Existing deferred/forbidden tool names are classified by D2 and never sent to this port.

## D1 — source read adapter (task S after D0)

Own new `packages/sources/src/discovery-tools.ts`, narrow exports in `packages/sources/src/index.ts`, `packages/sources/test/discovery-tools.test.ts` for pure transformations and `tests/integration/discovery-source-tools.test.ts` for real source/evidence capture. Minimal existing source/evidence helper edits require demonstrated need and explicit path report to root; default reuse current helpers. No lifecycle, composition, roles, server routes, activity-reader, worker or evaluator edits.

Implement all four prepare variants, consuming existing readDiscoveryCapture/createSourceService/readEvidence/requireCoverage/permitsEvidence/searchEvidence primitives. Match entire saved binding, exact snapshot/citation association, raw contracts/hashes; never latest/capture writes, coverage UI, synthetic parent IDs, catalog seller membership or protected truth. Validate original bytes using accepted capture reader outside any owner transaction. Return only pinned source contracts/streams, authorized raw events with their associated citation IDs, authorized helper search hits, or E1 bounded identity+text.

Accepted policy stays unchanged: source-wide zero-parent access works; missing account selector means task-authorized records; explicit tuple must be captured and granted; sellerless source-only access; unknown document coverage denies account-only whole documents AND ranges/search exposure. Query uses current filtered membership and stream_id/sequence order, byte-aware page shrink and exact nextAfterEventId without skipping oversized record. Search traverses captured citation IDs lexically and preserves existing helper semantics. E1 uses base=response.text.startInclusive and omitted cited span, strict identity projection, no second excerpt, original citation untouched, selected UTF-8 hash and full envelope cap.

D1 behavioral proof: both source fixtures; exact seller/account collisions and sellerless records; wrong company/manifest/same hash; metadata/hash/member corruption; document-range coverage denial; page concatenation, changed-current-filter semantics, cursor membership; valid smaller byte page and oversized next record; search semantics; nonzero-base cited range,10,000-unit citation/100-unit result, empty/surrogate boundary failures, unchanged original, envelope metadata oversize. Assert no source/lifecycle/activity/runtime writes. Source adapter failures alone do not create lifecycle blockers: D2 owns persistent disposition. Use real migrated app-role source records and trusted disposable corruption setup where needed. No provider/model needed.

Checks: typecheck; focused new contracts/source unit suites; `tests/integration/discovery-source-tools.test.ts`, existing discovery-capture-read/v1-manifests/v1-evidence suites; diff check. Root assigns exclusive DB lease. D0/D1 report includes exact exported seam, paths, candidate hash, commands and limits. This is source read capability only, not mounted discovery or construction.

## D2 — owner-serialized claims, recovery and composition (task L)

Own `packages/discovery/src/{read-tools,roles,tasks,supervisor,service}.ts`, narrow `repository.ts` state plumbing only if demonstrated necessary, `packages/discovery/test/` focused additions, `tests/integration/v4-discovery-evidence-tools.test.ts`. After M1 integrated/released only: narrow `apps/control/src/discovery-composition.ts` adapter construction/wiring, preserving M1 events mounting and existing policy/recheck. No contract/source implementation edits; send seam defects to S/root. No events route, client/UI, session/cache, activity reader, migration, package manifest, provider/model adapter, bootstrap or worker ownership.

New discovery read-tools.ts consumes D0 parsers/descriptors and the accepted private port, with closed dispatch. Advertise four readers to all roles only when actual readTools dependency is wired; coordinator retains delegateTask. Preserve recognized deferred TOOL_UNAVAILABLE and unknown/forbidden TOOL_FORBIDDEN. Do not make a descriptor-alone capability executable.

Pass readTools through service/supervisor options alongside existing CaptureAccess. Actual default local composition still has no configured ModelClient and starts no scripted model. Source adapter construction changes neither grants nor source contracts nor server stream mount. Keep recheckDiscoveryCapture on actual exclusive owner PoolClient, current authority plus saved run/task ceilings, run/task/dispatch/attempt/step/generation fences, ordered batch and same-step replay.

Implement accepted full batch preflight (read schemas/membership/ranges/coverage plus delegation dependencies) before first successful effect/claim, including recovered mixed batches. External preparation is outside owner transaction; guarded SQL recheck runs inside it. Claim pending→running and safe tool.called atomically; external read; settle safe bounded result and tool.result atomically with revisions. No pool fallback after owner connection loss. Replace pending-count revision arithmetic with explicit terminal accounting; running is not resolved. Service/reconcile must select/refence safe owner-loss reads while blocking next model until transcript closure. Persist only allowlisted activity summaries, never query/excerpt/arguments/transcript.

E2 is indivisible work here: owner loss adds no semantic blocker, stale callbacks rejected, otherwise-authorized immutable interrupted reads may refence/retry same step; pause preserves pending/in-flight and permits only already-claimed settlement. Authority-at-settle produces interrupted/non-in-flight and sticky forbidden blocker with no content; capture/size failures terminally fail with sticky blocker. Restored policy, owner replacement and pause/resume clear none. New valid run is the only progress for these sticky cases. No unknown model-call retry or budget reset. Existing readState running count must cease reporting dead generation work after reconcile; do not invent new wire status or hide genuine current in-flight work.

D2 proof: all accepted lifecycle and round1 E2 regressions; mixed valid delegate/read then invalid read/dependency has zero partial child/success in fresh/recovered batch; boundary barriers around claim, blob read, pause, current-policy revocation, capture recheck and commit; exact replay zero external I/O; crash before/after result; same native ID across dispatch/tasks; owner replacement never settles old callback or clears diagnostics; no unresolved batch advances model; truthful state counts; bounded result and combined transcript; safe activity and runtime DB unchanged. Use accepted D1 adapter for final integration, not only stubs. Test-only injected models never enter production composition.

Checks: typecheck; discovery unit suite; new v4-discovery-evidence-tools integration plus lifecycle/lifecycle-http/discovery-capture-read/activity/local-composition suites; source adapter integration where needed for changed wiring; diff check. Use root's exclusive DB lease, record focused checks as partial. Include M1 mounting regression in local composition so narrow wiring cannot remove stream support. M2 tests remain independently owned; no speculative browser changes to expose nonexistent tool details.

## Completion and escalation boundaries

Each task reports exact base/candidate/files/tests, failed or deferred checks, and handoff limitations. Root controls independent review/integration. No acceptance of full V4, real provider competence, findings/proposals, verification, financial approval, activation, sync or full dual-stream events. Existing004 tables suffice; control005 stays reserved bootstrap registry and no migration number is allocated. If concrete code makes the accepted port/transition impossible, report exact interface conflict to root and continue independent assigned work; do not silently add schema, permission, resume clearance, new capability or policy.
