# Discovery D0 Offline Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Root controls the execution method, worktree, writer permit and fresh reviewer; this plan authorizes no extra subagents.

**Goal:** Publish a reusable strict offline model-policy representation, canonical hash and typed unavailable resolver for trusted control callers.

**Architecture:** One control-only module owns one policy schema reused by the configuration parser and hash helper. Its real configuration entry point always returns a safe unavailable result; no client is constructed. Existing default composition already omits ModelClient and remains unchanged.

**Tech Stack:** Node 24, strict TypeScript, existing Zod 4, existing contracts canonical hash helpers, Vitest unit project; no new dependency.

**Spec:** [Accepted Discovery model configuration contract](../../progress/2026-11-10/discovery-model-configuration-contract.md), SHA-256 `8dd506cb483242069c8b140c83c2598de11110452225e352f2c5548271fa76d9`. Independent architecture review `/private/tmp/eapr-discovery-config-design-review.md`: spec PASS, quality PASS for that exact document. Its three nonblocking notes are preserved below. This plan covers D0 only; source review and machine evidence remain pending.

## Global Constraints

- Fixed policy values: `maxInputTokens: 8192`, `maxOutputTokens: 2048`, `timeoutMs: 60000`, `maxPreparedRequestBytes: 131072`; altered values, including lower ones, do not parse as this exact version. Later strict turns may have lower effective ceilings.
- Omitted or disabled configuration is unavailable; valid configured metadata remains `MODEL_LIVE_RELEASE_PENDING`. No parser result establishes provider support, authorization, a working meter or live readiness.
- No environment/key inspection, file/registry lookup, provider selection, network/SDK/client construction, live call, database/schema change, or provider credential flow.
- No source changes to Discovery, supervisor, worker, browser, shared contracts, composition, startup, package manifests or financial/grant/approval paths.
- Reuse strict validation and canonical hashing; no second policy validator, dummy factory, speculative registry or unused composition option.
- This is reusable offline representation and typed resolution only. Do not describe it as integrated live enforcement, Blocker D closure, Gate J/V4 acceptance or financial eligibility.

## Review Focus

1. Omitted configuration versus explicit malformed values: only omitted resolver input defaults to disabled; `null`, `{}` and wrong versions return safe invalid diagnostics.
2. Unsupported extra fields, including secret-looking and prototype keys at each nesting level: reject without stripping or reflecting input.
3. Literal ceilings and identifier/hash boundaries: reject coercion, fractions, negative zero, nonfinite/unsafe integers and invalid IDs/hashes.
4. Canonical identity: property order leaves policy hash unchanged; every accepted identity change changes it; supplied self-hashes are invalid.
5. Apparent configured readiness: even a fully valid synthetic policy yields only unavailable status and a fixed safe reason, with no client, policy, credential or raw validation issue in that result.

---

### Task 1: Publish the offline configuration parser, policy hash and resolver

**Files:**

- Create: `apps/control/src/discovery-model-configuration.ts` — sole strict policy/configuration implementation and public server-only entry points.
- Create/test: `apps/control/test/discovery-model-configuration.test.ts` — synthetic offline examples, strict failure cases and identity tests.
- Inspect only: `packages/contracts/src/{common,canonical}.ts`, `apps/control/src/{discovery-composition,composition}.ts`, `vitest.config.ts`.
- Do not modify `composeDiscovery` or its callers: local composition already passes no model client; existing explicit test injection remains unchanged.

**Interfaces:**

Consume existing `strict`, `guardKeys`, `IdSchema`, `HashSchema`, `hashCanonical` and corresponding types from `@eapr/contracts`, plus `z` from `zod`. Use the existing package exports; no new contracts export is necessary. Define the accepted design's exact `TrustedModelPolicyV1`, `DiscoveryModelConfiguration` and `DisabledDiscoveryModel` shapes, preferably inferred from their single schemas. Policy fields are `schemaVersion`, `providerId`, `modelId`, `adapterId`, `adapterVersion`, `meterId`, `meterVersion`, `providerRulesHash`, `endpointBindingId`, and strict `limits`; configuration has exactly `schemaVersion/state` and, only in its configured branch, `policy`.

Export these types and functions from the new module:

```ts
function parseDiscoveryModelConfiguration(input: unknown):
  | { ok: true; value: DiscoveryModelConfiguration }
  | { ok: false; code: 'MODEL_CONFIGURATION_INVALID' };

function hashDiscoveryModelPolicy(policy: TrustedModelPolicyV1): Hash;

function resolveOfflineDiscoveryModel(input?: unknown): DisabledDiscoveryModel;
```

`parseDiscoveryModelConfiguration(undefined)` is invalid; omission handling belongs only to the resolver. The parser returns parsed data on success and only the safe code on failure. The hash helper reuses the same policy schema to reject malformed runtime values, then returns `hashCanonical({kind:'discovery-model-policy',version:1,policy:parsedPolicy})`. If an invalid runtime value reaches this typed helper, throw `Error('MODEL_CONFIGURATION_INVALID')` without exposing raw input/Zod issues. This reuse is not a second independently maintained validator.

Resolver behavior is exact: omitted input or valid disabled input returns `{available:false,reason:'MODEL_UNCONFIGURED'}`; parse failure returns `{available:false,reason:'MODEL_CONFIGURATION_INVALID'}`; valid configured input returns `{available:false,reason:'MODEL_LIVE_RELEASE_PENDING'}`. It delegates validation to the parser and returns no policy/hash/client. Exporting this callable entry point is the coherent D0 seam; do not add unused application wiring to make it appear mounted.

- [ ] **Step 1: Write the focused failing offline tests.**

Use one clearly synthetic valid policy, never a real provider/model choice:

```ts
const policy = {
  schemaVersion: 1,
  providerId: 'test-provider', modelId: 'test-model-rev1',
  adapterId: 'test-adapter', adapterVersion: 'v1',
  meterId: 'test-meter', meterVersion: 'v1',
  providerRulesHash: 'a'.repeat(64), endpointBindingId: 'test-endpoint',
  limits: { maxInputTokens: 8192, maxOutputTokens: 2048,
    timeoutMs: 60000, maxPreparedRequestBytes: 131072 },
} satisfies TrustedModelPolicyV1;
const configured = { schemaVersion: 1, state: 'configured', policy } as const;
const invalid = { ok: false, code: 'MODEL_CONFIGURATION_INVALID' };
```

Add the following named tests with these assertions (table-drive repeated fields; no provider/client fixtures):

- `parses only exact disabled and configured shapes`: expect parsed disabled/configured values to equal their inputs; parser `undefined`, `null`, `{}`, arrays, versions other than 1, unknown states and missing policy all equal `invalid`.
- `does not coerce or strip policy fields`: extra field at configuration/policy/limits, policy on disabled branch, `apiKey:'do-not-reflect'`, URL/path fields, and JSON-parsed `__proto__`/`constructor`/`prototype` keys at each relevant level return `invalid`. Error output must not contain the marker. Version strings and altered limits fail.
- `enforces exact bounded policy fields`: for each ceiling reject its value minus/plus one, `0`, `-0`, `0.5`, `NaN`, `Infinity`, unsafe integer and numeric string. For all ID fields reject empty, whitespace, forbidden characters and 161-character strings; 160-character valid IDs parse. Reject short, uppercase or nonhex evidence hashes; valid 64-character lowercase hex parses.
- `hashes the domain-separated parsed policy`: expect the helper to equal `hashCanonical({kind:'discovery-model-policy',version:1,policy})`; explicitly reordered policy/limits keys produce the same hash. Each provider/model/adapter/adapter-version/meter/meter-version/evidence/endpoint identity change produces a different hash. A supplied `policyHash` or altered ceiling fails parsing and, when deliberately cast for a runtime-negative test, causes the hash helper's safe error.
- `never makes configured metadata available`: `resolveOfflineDiscoveryModel()` and valid disabled return exact unconfigured objects; malformed input returns the exact invalid object; configured input returns the exact pending object. Test exact equality, including absence of client/policy/hash/error-detail fields; parser does not mutate input. A local `fetch` trap may assert zero calls while these functions run, restored after the test; introduce no factory merely to spy on it. Source review additionally confirms no I/O-capable imports or dynamic environment access in the module.

- [ ] **Step 2: Run the focused test and record its red evidence.**

With Node 24 on PATH, run `npm run test:unit -- apps/control/test/discovery-model-configuration.test.ts`. If the new module/exports are missing, record that failure as setup evidence only. Then create the smallest compilable module exporting the required types/signatures, with minimal unfinished behavior, and rerun the same focused command before completing Step 3. Observe and record at least one intended parser/hash/resolver assertion failure against the specified behavior: for example, valid configuration is incorrectly rejected, the policy hash differs from the prescribed domain-separated hash, or configured metadata returns the wrong unavailable reason. Record the test name and expected/actual assertion values. A missing import, compilation/setup error, or throw-only placeholder is not behavioral red evidence; correct setup until the intended assertion actually runs and fails. Only then proceed to full implementation and the green checks. Do not run database, browser or provider checks.

- [ ] **Step 3: Implement the module using the existing strict schema helpers.**

Use one strict literal-limits schema and one strict policy schema, shared by parser and hash helper; guard the configuration union before parsing so special keys cannot disappear. Infer public types from those schemas. Implement only the three interfaces above with safe failure output. Keep configuration validation pure and fail-closed. Do not add provider validation, optional clients, registry callbacks, lazy factories, environment names or fake live support. Ordinary ID/hash validation establishes syntax only; exact model revision and trusted evidence checks remain D1/release responsibilities.

- [ ] **Step 4: Verify the exact candidate and scope.**

Run `npm run test:unit -- apps/control/test/discovery-model-configuration.test.ts` and `npm run typecheck`; require both exit 0 and retain focused counts/output. Inspect the exact diff and `git diff --check`: only the two released files may change, and the new module must contain no I/O, provider imports or calls. Default `composeDiscovery` and its local caller remain byte-for-byte unchanged. These checks prove offline syntax/identity/unavailability only. Existing saved-history/composition behavior is preserved by leaving it untouched, not newly proven by this unit suite. No integration claim is made and no database lease is needed.

- [ ] **Step 5: Commit the coherent two-file candidate and hand off for fresh review.**

Stage only `apps/control/src/discovery-model-configuration.ts` and `apps/control/test/discovery-model-configuration.test.ts`; commit with `feat: add offline discovery model configuration`. Return full base/candidate SHAs, two changed paths, spec hash, red/green evidence and typecheck result to root. Independent source review must inspect this exact candidate; machine pass alone is not acceptance. Do not edit this plan to mark acceptance or continue into D1 without a separate release.

## Accepted D1 consumer handoff — explicitly deferred

The accepted design already specifies immutable prepared request and exact meter provenance, full persisted policy/hash binding, bounded known/unknown/not-sent failure carrier, output cap/context enforcement and unsettled-call cancellation semantics. Those are Discovery consumer obligations, not D0 implementations. Transport corrections remain with Developer1/Discovery; root coordinates shared `model/repository/service/supervisor` paths before edits. No new D0 source task implements them.

Dependency direction is **trusted control composition → Discovery package consumer**. At eventual mounting, control validates the complete policy and supplies the policy/hash with the trusted adapter/meter dependencies through the agreed server-only seam. Discovery must not import `apps/control/src/discovery-model-configuration.ts`, nor copy its schema/hash validation into transport. Before D1 needs lower-layer persisted-policy validation, root/Platform/Discovery must coordinate a single shared server-only extraction or injected validation port using this implementation; preserve one schema and the exact hash preimage. That ownership/path decision belongs to the D1 handoff, not speculative D0 source. No shared-contract or package-manifest capability is granted by this plan.

Carry all independent-review notes into that handoff:

1. **Strict limits projection:** `StoredLiveModelPolicyV1` includes schema/binding metadata; construct ModelTurnV2 limits by explicitly projecting only `maxInputTokens`, `maxOutputTokens`, `timeoutMs`. Preserve full private policy for hash/fence checks. Passing the whole stored policy as strict turn limits is invalid; do not widen the public schema.
2. **Ordinary pause settlement:** reviewer pause prevents new tool claims. An already-claimed valid model response may settle into pending steps under the accepted orchestration rules. Distinguish that from actual timeout/owner-loss interruption in cancellation/accounting tests; never reject every response merely because the run was paused.
3. **No unused D0 scaffold:** this plan intentionally leaves already-disabled composition unchanged. No second validator/factory or unused option is warranted. Reuse the representation at the eventual real dependency boundary.

Provider/model/access selection, supported exact tokenizer/protocol evidence, actual provider usage/cancellation behavior, separately released live mounting, real source-driven A/B artifacts and independent holdouts remain pending. This offline task closes none of those gates.

## Plan self-review and execution boundary

D0 spec coverage maps to Task 1: strict shapes/limits and safe resolver, canonical identity, focused offline evidence, and unchanged unavailable default. Accepted D1 behavior is preserved as a consumer handoff with its two concrete integration cautions; no unimplemented behavior is labeled completed. The five review-focus classes all have explicit tests. All functions, shapes and paths agree with the accepted design; the added hash helper exposes its exact prescribed preimage. Only two source/test paths are proposed for release.

This plan was authored and self-reviewed without source/Git changes, tests, database/provider operations or subagents. Root requested plan-only work now and owns the next fresh plan review, writer permit and source execution; no implementation starts from this document alone.
