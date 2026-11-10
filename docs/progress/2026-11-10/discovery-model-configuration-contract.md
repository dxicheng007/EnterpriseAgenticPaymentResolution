# Discovery D: trusted configuration and actual-input contract

**Status:** Draft for fresh independent architecture review, 2026-11-10. This specifies an offline Platform prerequisite and the later Discovery consumer boundary. It does not select a provider/model, establish access, release consumer paths, mount live transport, close Blocker D/Gate J/V4, or claim implementation or test evidence.

**Assigned document:** `docs/progress/2026-11-10/discovery-model-configuration-contract.md` in the Platform integration worktree. No source, Git, tests, database, provider, credential access, or service operation belongs to this drafting task.

## 1. Authority and inspected baseline

The [policy audit, section D](discovery-unblock-policy-audit.md#d--live-providermodelactual-input-meter-boundary) resolves limits, isolation, actual-input enforcement and honest accounting. The [current PR43/PR46 review](discovery-pr43-pr46-review.md#live-transport-historical-five-finding-matrix-and-remaining-corrections) remains the Discovery transport correction queue; this contract supplies its missing trusted binding boundary, not another implementation of T2/T3/T5.

Normative sources are [PRD process and agent boundaries](../../../prdv2.md#local-process-boundaries), [accepted orchestration sections 2, 4 and 8](../2026-11-08/handoffs/v4-orchestration-contract-proposal.md), [Discovery shapes freeze and consumer obligations](../../superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md), [original freeze](../../superpowers/plans/2026-11-08-contract-freeze.md), [T4.2 and verification conventions](../../superpowers/plans/2026-11-08-implementation-plan.md), and [verification playbook](../../superpowers/plans/2026-11-08-verification-playbook.md). Follow repository, apps, packages and Discovery instructions and [orchestration ownership](../../superpowers/plans/2026-11-08-agent-orchestration.md). Existing authority outranks this draft.

Inspected local boundaries:

- `packages/discovery/src/model.ts`: `ModelClient {mode,modelId,run(turn)}` and frozen 8,192 input / 2,048 output / 60,000 ms ceilings.
- `packages/discovery/src/live-model-transport.ts`: injected `configured/modelId/baseUrl/apiKey/estimateTokens`; prepares OpenAI-compatible messages/tools, but meters the abstract turn and uses bytes/4 for the final body. This concrete adapter does not select an accepted product provider.
- `packages/discovery/src/live-model-tokens.ts`: explicitly approximate byte heuristic, insufficient for live admission.
- `apps/control/src/discovery-composition.ts`: optional injected `modelClient`; default omission preserves unavailable start and authorized saved reads/actions.
- `packages/discovery/src/{repository,service,supervisor}.ts`: persisted model ID/mode and ceilings, accounting and fenced dispatch lifecycle. Current run `policy` contains ceilings, not the full binding below; scheduling by model ID/mode does not establish policy equality.
- `db/control/004_discovery.sql`: existing `model_id` and `policy JSONB`. No D migration is required for the additional policy representation. Preserve existing rows and historical reads.

## 2. Chosen scope and alternatives

The technical choice is an injected, provider-neutral, control-only policy descriptor plus an exact prepared-request/meter seam. Configuration validation and live admission are separate. The first deliverable needs no network capability, key, SDK, model choice or Discovery source edits.

A provider-specific environment loader now would require deferred provider/access decisions and duplicate transport ownership. Reusing an abstract-turn meter or bytes/4 violates actual-input enforcement. A callback accepting arbitrary mutable objects makes measured and sent inputs separable. Those alternatives are excluded.

Two increments keep this reviewable:

1. **D0, offline Platform producer:** strict parser, safe unavailable result, disabled composition seam and focused offline tests. All configurations remain unavailable for live start. No provider factory is invoked.
2. **D1, later coordinated consumer:** Discovery implements prepared-request binding, persisted policy checks and accounting/cancellation integration; Platform supplies reviewed trusted dependencies. Provider-specific evidence and separately configured access precede root's release of an actual live mount. D0 completion does not imply D1 readiness.

## 3. D0 configuration and composition interface

Proposed server-only module: `apps/control/src/discovery-model-configuration.ts`. Reuse strict validation, ID/hash schemas and canonical hashing. Reject unknown keys, invalid/unsafe integers, negative zero, empty identifiers and unsupported versions; do not coerce values. This is not a browser or model tool wire:

```ts
type DiscoveryModelConfiguration =
  | { schemaVersion: 1; state: 'disabled' }
  | { schemaVersion: 1; state: 'configured'; policy: TrustedModelPolicyV1 };

type TrustedModelPolicyV1 = {
  schemaVersion: 1;
  providerId: Id;
  modelId: Id;                 // exact immutable provider model revision
  adapterId: Id;
  adapterVersion: Id;          // immutable reviewed implementation identity
  meterId: Id;
  meterVersion: Id;            // tokenizer + protocol accounting implementation
  providerRulesHash: Hash;     // reviewed tokenizer/model/protocol evidence manifest
  endpointBindingId: Id;       // trusted routing reference, never an arbitrary URL
  limits: {
    maxInputTokens: 8192;
    maxOutputTokens: 2048;
    timeoutMs: 60000;
    maxPreparedRequestBytes: 131072;
  };
};

type DisabledDiscoveryModel = {
  available: false;
  reason: 'MODEL_UNCONFIGURED' | 'MODEL_CONFIGURATION_INVALID'
    | 'MODEL_LIVE_RELEASE_PENDING';
};

declare function parseDiscoveryModelConfiguration(input: unknown):
  | { ok: true; value: DiscoveryModelConfiguration }
  | { ok: false; code: 'MODEL_CONFIGURATION_INVALID' };

declare function resolveOfflineDiscoveryModel(input: unknown): DisabledDiscoveryModel;
```

`policyHash = hashCanonical({kind:'discovery-model-policy',version:1,policy})` over strict parsed policy. Policy has no self-referential hash. Metadata is non-secret and bounded by existing ID/hash contracts. Identity must resolve through a trusted registry, never dynamic imports or paths supplied by callers. An arbitrary evidence hash is not trusted merely because it parses. `modelId` cannot be an unverified moving alias; any exact revision mapping belongs to the evidence.

`resolveOfflineDiscoveryModel` treats omitted input as disabled, explicit disabled as unconfigured, malformed input as invalid, and valid configured metadata as live-release-pending. It returns no ModelClient and performs no environment, file, network, registry, SDK, secret or database access. It never treats syntactic validity as readiness or silently discards invalid disabled-input fields.

The narrow composition integration omits `modelClient` for every resolver result. Preserve current capability/status contracts; do not expose raw policy, endpoint IDs, parser detail or secret hints to explain unavailability. Control may retain the safe internal reason. Existing explicit test-only ModelClient injection remains a separate test dependency, never obtained from production configuration. Missing live configuration must not break authorized saved history/replay.

**No environment spelling is frozen by D0.** Configuration is typed trusted injection; startup supplies disabled without reading provider variables. `OPENAI_API_KEY` in `scripts/live-build.ts` remains a harness/operator convention. A later root-owned loader may map explicit names after provider/access selection; it must not pass provider credentials to worker or web subprocess environments. D0 neither retrieves nor tests for a key.

## 4. D1 immutable request and exact meter consumer interface

This is an owner handoff for the existing Discovery adapter, not a second model stack or a D0 implementation requirement. Keep public ModelTurnV2/ModelResultV2 schemas and ModelClient unchanged in D0. Place eventual private consumer types with `packages/discovery/src/model.ts`; share server-only imports with control after root releases those paths.

```ts
type PreparedRequestBindingV1 = {
  schemaVersion: 1;
  runId: Id; taskId: Id; dispatchId: Id;
  turnHash: Hash;
  policyHash: Hash;
  bodyHash: Hash;
  requestHash: Hash;
  outputTokenCap: number;
};

type ExactInputMeasurementV1 = {
  schemaVersion: 1;
  requestHash: Hash;
  policyHash: Hash;
  providerId: Id; modelId: Id;
  meterId: Id; meterVersion: Id;
  inputTokens: number;
};

type MeterOutcome =
  | { ok: true; measurement: ExactInputMeasurementV1 }
  | { ok: false; code: 'MODEL_METER_UNSUPPORTED' | 'MODEL_METER_FAILED' };
```

A private trusted adapter instance owns `prepare(turn, pinnedPolicy)`, `measure(prepared)` and `send(prepared, measurement, {signal})`. `prepared` is an opaque instance-owned handle. Its immutable binding above is inspectable by control-only tests; its private payload is one finalized UTF-8 request body string plus fixed routing/protocol options. A `readonly` annotation, mutable Buffer or only shallow freeze is insufficient. Preserve the exact string in a private closure or equivalent immutable storage; reject foreign-instance handles or a previously sent dispatch. Do not expose provider payloads in browser contracts, tools, activity or ordinary logs.

Preparation is pure, bounded and does no I/O. Validate the complete turn with ModelTurnV2Schema, preserve ordered transcript/native-to-step linkage and strict tool schemas, and hash that validated turn. Include instructions, messages, tool arguments/results, schemas and every provider wrapper in preparation. Invalid schemas fail rather than silently omitting advertised tools. No request mutation is permitted after metering.

`bodyHash` is SHA-256 of exact UTF-8 bytes sent. `requestHash` is `hashCanonical({kind:'discovery-prepared-request',version:1,runId,taskId,dispatchId,turnHash,policyHash,bodyHash,outputTokenCap})`. Policy binds provider/model/adapter/meter versions, evidence identity, endpoint reference and ceilings. Routing/protocol options must be fully determined by immutable adapter/policy; authentication attaches only within the trusted transport closure and never enters hashes or persisted policy. Any option affecting input, tokenization, output limits or routing needs a different binding. Retries, redirects or SDK default transformations must not silently replace this request.

The meter consumes the same handle, not an independently reconstructed turn or reserialized copy. Its implementation and supported provider/model/protocol tuple come from the trusted registry. Measurement includes every actual input token, including framing, tool schema serialization and applicable special tokens. Cached-input discounts affect billing, not context/input limits. Bytes, characters, words and estimated tokens are not an exact meter. If accounting cannot be established for included content or hidden overhead, return unsupported; do not select a default tokenizer, estimate a margin or call a provider to discover the count.

Only the trusted meter instance can mint an admissible measurement: retain its result privately against the prepared handle and compare that retained value at send. A plain object containing plausible hashes and counts is not evidence and cannot authorize I/O.

Before send verify handle and measurement provenance, exact run/task/dispatch/turn/policy/request bindings, exact meter/version/provider/model tuple, safe nonnegative integer measurement, payload bytes and effective limits. Changing a body, model, endpoint, policy, adapter, tokenizer, schema or cap invalidates measurement and requires fresh preparation. Identical body bytes do not permit reusing measurement for another dispatch.

Effective input/output/time limits cannot exceed persisted policy or strict turn limits, or 8,192 / 2,048 / 60,000. Output cap is encoded in the actual provider request and equals the bound cap; provider evidence must prove its meaning covers applicable output accounting. Enforce the selected model's context window, including input plus reserved output and other required provider capacity. Unsupported cap semantics or insufficient context fail closed. Reject prepared bytes above 131,072, in addition to frozen 131,072-byte abstract turn/result bounds. The existing separate 256 KiB raw-response limit must be enforced incrementally before allocation grows beyond it; that remains Discovery's T5 correction.

## 5. Run pinning and configuration changes

Before a new live run, trusted control resolves and verifies the exact registry tuple. Discovery persists the full versioned descriptor/hash alongside existing ceilings in `discovery_runs.policy`, with `model_id` equal to the exact model ID. Keep top-level ceiling fields needed by current consumers; publish an explicit versioned policy schema, not arbitrary JSON. No secrets, request bodies or credential references enter this row. The proposed exact live representation is:

```ts
type StoredLiveModelPolicyV1 = {
  schemaVersion: 1;
  maxInputTokens: 8192; maxOutputTokens: 2048; timeoutMs: 60000;
  binding: { policy: TrustedModelPolicyV1; policyHash: Hash };
};
```

Strictly validate and recompute the hash on read; duplicated ceilings must match the descriptor. This is a live-only extension, not a reinterpretation of historical scripted policy rows.

Discovery checks the saved full policy hash against client policy at reservation and before actual transport dispatch, with current owner/generation/authority/capture fences. Model ID/mode equality alone is insufficient. After configuration replacement/restart, an unavailable/different tuple blocks live dispatch; it cannot repin the run or reset counters. Exact start replay and authorized historical reads precede current model availability as specified. Old scripted policies retain existing test behavior. Old live rows without the binding are unavailable for new live calls, not silently upgraded. A new policy requires a new run for new live work.

Existing JSONB supports this without DDL; strict application types, run creation, scheduling and fences are coordinated Discovery consumer work. D0 does not edit those paths or claim pinning is implemented. Do not add an unrelated dispatch audit table or general configuration service.

## 6. Failure, usage and interruption obligations

Codes below are proposed internal values. They do not automatically expand public activity allowlists or tool/result schemas. Map into existing bounded unavailable/failed/blocked behavior; Contracts publishes shared additions only if needed.

| Stage/outcome | Required behavior |
| --- | --- |
| Missing/disabled/invalid config; unreleased mount | No client/provider call. Safe unavailable reason, no scripted substitution. |
| Unsupported/failed meter; binding mismatch | No provider I/O; non-executable blocked outcome. Codes `MODEL_METER_UNSUPPORTED`, `MODEL_METER_FAILED`, `MODEL_REQUEST_BINDING_MISMATCH`. |
| Invalid prepared input; byte/token/context/cap exceeded | No provider I/O; bounded invalid-request/budget failure. |
| Valid response and known usage | Account actual input/output once under original dispatch fences; validate envelope/ceilings before executable tools. Actual usage is not preflight count. |
| Refusal or normalization/schema error with independently valid usage | Preserve known usage; no executable tools, fabricated done or fabricated provider ID. |
| Missing/invalid usage or uncertain outcome after send | Block, retain explicit unknown usage, no tools or automatic retry. Never substitute zero tokens. |
| Timeout, owner loss, pause interruption or shutdown | Preserve durable interruption/fencing, request supported cancellation, retain unknown where usage is unavailable and reject late executable results. |

With a valid provider response ID, a known-usage normalization error can return strict ModelResultV2 with `stopReason:'error'`, no calls and actual usage. If independently valid usage exists but response ID/envelope is invalid, use a bounded server-only failure carrier bound to the original dispatch; its consumer records usage without accepting a result or synthesizing an ID. Current `catch -> accept(undefined,true)` discards such metadata. Discovery must publish and consume that carrier and prove it with the real supervisor before release; D0 does not fix it. A rejection alone cannot communicate usage through today's ModelClient contract.

The proposed private carrier has this strict bounded payload:

```ts
type ModelCallFailureV1 = {
  schemaVersion: 1;
  runId: Id; taskId: Id; dispatchId: Id;
  policyHash: Hash;
  requestHash?: Hash; // absent only when preparation did not produce a handle
  code: 'MODEL_REQUEST_INVALID' | 'MODEL_BUDGET_EXCEEDED'
    | 'MODEL_METER_UNSUPPORTED' | 'MODEL_METER_FAILED'
    | 'MODEL_REQUEST_BINDING_MISMATCH' | 'MODEL_PROVIDER_ERROR'
    | 'MODEL_INTERRUPTED';
  accounting:
    | { kind: 'not_sent' }
    | { kind: 'known'; inputTokens: number; outputTokens: number }
    | { kind: 'unknown' };
};
```

Use a private trusted Error subtype carrying this payload, validated by the consumer against the original reservation and client policy. Plain model/provider JSON cannot instantiate an authenticated carrier. Numbers are safe nonnegative integers; no provider response ID is required and no raw error/body/cause is exposed. A missing/invalid carrier remains unknown. `known` means independently validated actual usage; `unknown` means send may have happened without usable usage. `not_sent` means the adapter proves no transport attempt; caller/model assertions are not proof. A reserved scheduler attempt remains consumed even on local preparation failure. Proven not-sent contributes zero actual provider usage, not an unknown remote call; unknown is mandatory once send may have begun. Neither case fabricates a provider ID or successful result. Until this distinction is consumed, stay conservative and unmounted rather than introducing false accounting.

Usage and execution certainty are separate: known usage does not make a timed-out result executable. Retain valid usage available before terminal accounting despite normalization refusal. Once owner loss/interruption durably records unknown usage, late callbacks cannot mutate fenced history or clear it through an ordinary pool connection. Changing that accounting later requires a separately reviewed authenticated provider reconciliation path; none is implemented or implied. Keep explicit unknowns without it.

Discovery owns the four-unsettled-call permit. An optional trusted AbortSignal may pass through a coordinated internal ModelClient extension; no browser/model cancellation input is added. The 60,000 ms deadline covers preparation, request, reading and normalization. Deadline/abort must not settle a wrapper Promise early while the underlying invocation is unsettled and thereby release its permit. Local abort settlement does not prove remote cancellation or no billing. No automatic retry, alternative-provider fallback or resumed unknown dispatch is permitted. Provider cancellation/reconciliation and process-death concurrency limits remain release evidence, not generic-interface promises.

## 7. Ownership, exact next paths and checks

These are proposed future capabilities for root to release after draft review; this document releases none.

| Owner | Future paths | Boundary |
| --- | --- | --- |
| Platform D0 | New `apps/control/src/discovery-model-configuration.ts`; new `apps/control/test/discovery-model-configuration.test.ts`; narrow `apps/control/src/discovery-composition.ts` integration if required | Strict parse and always-unavailable resolution; omit client. No env/network/secret API or transport factory. |
| Discovery D1, separately coordinated | `packages/discovery/src/{model,live-model-transport,live-model-tokens,repository,service,supervisor}.ts`; focused package/integration tests named in its owner brief | Prepared request, meter consumer, persisted policy fences and accounting/cancellation extensions. Preserve transport correction ownership and active Gate J edits. No parallel scheduler. |
| Platform later release | `apps/control/src/discovery-model-configuration.ts`, `apps/control/src/discovery-composition.ts`; exact startup file only after root release | Trusted registry/access injection after evidence/configuration. No default live mount in D0. |
| Contracts, only if needed | Root-released exact export/schema path | Prefer private server types; preserve browser-safe ModelTurn/Result wires. No blanket export permission. |

No runtime, worker, web, financial, approval, scope/grant, evaluator, fixture, database or dependency-manifest edits are part of D0. A parser needs no SDK. No B automatic grant or C completion/repair rule is created. Worker/browser receive no model key, SDK, provider endpoint configuration or model execution path.

D0 later exact-candidate evidence: omitted/disabled/malformed/unknown-key/unsupported-version cases; noninteger or raised ceilings rejected; valid configured metadata still unavailable; changing any accepted identity field changes hash and altered fixed ceilings fail validation; trap transport/factory receives zero calls; default composition instantiates no model supervisor/client; authorized saved reads remain available. Run `npm run test:unit -- apps/control/test/discovery-model-configuration.test.ts` and `npm run typecheck`, label partial, obtain fresh independent source review. Any real saved-history/composition regression check remains an explicitly leased integration check, not implied by parser tests. No tests/provider runs were performed for this draft.

D1 offline evidence in Discovery's owner brief: measure/send share bytes; mutations, foreign handles, wrong policy/tokenizer/dispatch replay fail before fetch; instructions/tool/framing overhead count; 8,192 versus 8,193 and 2,048 versus 2,049 boundaries; lower turn/context limits; final-body byte expansion; actual encoded output cap; retained usage on refusal/normalization errors; no manufactured IDs; unknown/error outcomes execute no tools; incremental response cutoff; timeout/owner replacement retain permits until underlying settlement without duplicate attempt. Use deterministic barriers and real supervisor for lifecycle/accounting claims. Fake exact meters prove only this contract, not provider tokenization.

## 8. Pending evidence and actual external choices

No unspecified financial/product rule prevents D0. Interfaces, hashing, validation and cancellation plumbing are technical owner choices constrained above. The private failure carrier and run-policy representation are specified above. Root/Discovery coordinate their source release and the optional AbortSignal signature through the consumer handoff; the user need not design them.

Before real live release, require:

1. **User-configured access and exact provider/model selection:** deferred. Do not inspect environment keys, retrieve secrets, select an account, incur usage or infer authorization from an OpenAI-compatible transport.
2. **Provider-specific evidence:** exact model revision/endpoint protocol; immutable tokenizer implementation/assets; framing/tool/special-token accounting; supported content; context/output-cap semantics; usage-field meanings; response bounds; retry defaults; cancellation/reconciliation. Prove the registry tuple meters the input actually sent. A callback, manifest hash or stub does not establish this. Unsupported semantics keep the meter unavailable.
3. **Implementation evidence:** reviewed transport fixes, full policy/request binding, real supervisor accounting/fencing/cancellation and control-only dependency/subprocess credential isolation. Root controls mounting separately; `configured:true` cannot bypass release.
4. **Live acceptance:** separately authorized/configured source-driven A/B artifacts, real provider provenance and independent holdouts, followed by distinct joint gates. Offline checks, configured metadata and merged source establish no live call, financial eligibility or approval.

Self-review: fixed limits and truthful accounting are preserved; current public wires and default unavailability stay intact; future source ownership is explicit. No provider account, tokenizer default, financial policy, automatic grant, live mount, new DDL or parallel transport implementation is proposed. Fresh independent review of this exact draft precedes source work.
