# B handoff: V4a contracts and pure helpers only

**Assignment:** Implement the database-free schema/helper boundary and publish its versioned freeze addendum. No discovery scheduler, route, model adapter, UI, evaluator behavior, SQL migration, or activity database read in this step.

**Single architecture authority:** `v4-orchestration-contract-proposal.md`, accepted SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`, plus its completed independent fix review. This brief selects that architecture's §2/§3/§6 contracts; it does not replace the architecture or authorize speculative additions. Current checkout inspected for this brief: `b4e4365804f4518bb27f245dc05fcc03e8ad7500`.

**Owner:** B/integrator. Read root/packages guidance and current v2 activation addendum. Use `superpowers:executing-plans` task by task. Root has approved this bounded architecture; do not reopen user product approval. Implementation gets its own exact-commit review.

## Owned files

- Create `packages/contracts/src/discovery.ts`: browser-safe strict shapes/types and explicit v2→v1 context projection; no crypto, Buffer, database, filesystem or provider import.
- Create `packages/contracts/src/discovery-helpers.ts`: server-only canonical tool-step ID and cursor encode/decode helpers; reuse existing `hashCanonical`, canonical encoding and cursor error conventions. Browser consumers import `discovery.ts` directly.
- Modify only exports in `packages/contracts/src/index.ts`.
- Create `packages/contracts/test/discovery.test.ts`, `packages/contracts/test/discovery-helpers.test.ts` (unit only; no DB/model/environment requirement).
- Create `docs/superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md`: executable shape/helper freeze, exact examples and explicitly deferred consumer obligations, with accepted architecture SHA/source attribution.
- Do **not** modify `model.ts`, `connector.ts`, `canonical.ts`, `activity.ts`, source-coverage files, existing freeze documents, root configuration/lockfile, fixtures/truth, or existing migrations in this assignment. Current v1 schemas can be consumed explicitly without factoring their definitions; request an owner-reviewed tiny exception only if a demonstrated implementation obstacle requires it.

## Exact exports

Every `*Schema` exports its corresponding inferred type without `Schema`, unless noted. Do not rename existing v1 exports.

| Exports from `discovery.ts` | Exact source/meaning |
| --- | --- |
| `DiscoveryBindingSchema`, `DiscoverySubjectSchema`, `SourceReadGrantSchema` | Approved §2 source/capture/subject/grant shapes, unchanged field names |
| `DiscoveryTaskContextV2Schema`, `toVerificationTaskContext(context: DiscoveryTaskContextV2): TaskContext` | Approved §2 complete v2 shape; explicit five-field v1 projection, **not authorization** |
| `ModelMessageV2Schema`, `ModelTurnV2Schema`, `ModelResultV2Schema` | Approved §2; v2 result references toolStepId, provider IDs remain separate; no inherited callId-only tool result |
| `DiscoveryFindingV2Schema`, `CustomerProfileDraftSchema`, `DiscoveryProposalV2Schema`, `ProposalResultSchema` | Approved §2 pending-only finding, current profile without hash, one-profile proposal, result including server-owned assessment |
| `DiscoveryStateV2Schema` | Approved §2 state, task/in-flight counts, findings/proposals/verification refs, explicit unknown usage/cost unavailable |
| `DiscoveryCapabilitiesResponseV2Schema` | `{schemaVersion:2,mode:'unconfigured'|'scripted'|'live',startAvailable:boolean,diagnostics:Diagnostic[]}` |
| `StartDiscoveryRequestV2Schema` | `{schemaVersion:2,companyId:Id,manifestId:Id,idempotencyKey:Id}` |
| `StartDiscoveryResponseV2Schema` | `{schemaVersion:2,runId:Id}` |
| `DiscoveryActionRequestV2Schema` | Pause/resume `{schemaVersion:2,expectedRevision:Version,idempotencyKey:Id}` |
| `DiscoveryCursorV1Schema` | `{v:1,runId:Id,controlCursor:NonnegativeSafeInteger}`; distinct from frozen composite `UiCursor` |
| `ControlActivityWindowSchema` | `{highWater:NonnegativeSafeInteger,retainedAfter:NonnegativeSafeInteger}` with floor ≤ high-water |
| `ControlActivityPageSchema` | `{events:ActivityEvent[],highWater,retainedAfter,nextAfter:NonnegativeSafeInteger,hasMore:boolean}`; approved R3 response. This is just a shape, not a DB read |

`ModelClient` implementation/interface placement stays with A's discovery package; do not create an adapter here. Tool-specific argument schemas, inspector composite responses, authorization services, and HTTP plugins are later narrow B/A/C handoffs; this step publishes the listed shared types only. Do not invent a parallel service or status API.

Server-only helper exports from `discovery-helpers.ts`:

```ts
createToolStepId(input: {dispatchId: Id; providerToolCallId: Id}): Id;
encodeDiscoveryCursor(input: DiscoveryCursorV1): string;
decodeDiscoveryCursor(
  wire: string,
  expected: {runId: Id; highWater: number; retainedAfter: number},
): DiscoveryCursorV1;
class DiscoveryResyncRequiredError extends Error {
  readonly code = 'RESYNC_REQUIRED';
}
```

Use existing `InvalidCursorError` (`CURSOR_INVALID`) for malformed/wrong-run/future cursors. Invalid expected server bounds are programmer/configuration validation errors, not authenticated cursor claims. Parse cursor syntax/canonical bytes/run identity/future bound before applying retained-floor check; valid `controlCursor < retainedAfter` throws DiscoveryResyncRequiredError. No implicit defaults, clock, capture reads, or normalization of an invalid cursor into success.

## Required invariants and deliberate limits

1. Strict unknown-key and recursive prototype-key rejection, safe integers, existing Id/Hash/role/JSON schemas. No v1 export/accepted wire/hash preimage changes. Source grant fields must agree with binding company/source and sourceRef be included in context.allowedSourceRefs; account tuples unique, `sourceWide:false` requires nonempty accounts. These are internal consistency checks, not authenticated authority or evidence membership.
2. Existing `TaskContext` fields are reproduced explicitly in v2; project exactly runId/taskId/role/allowedSourceRefs/allowedAccountIds to the current v1 parser. Never treat successful projection as authorization. V2 cannot embed reviewer/service credentials or confirmed disposition literals.
3. `ModelMessageV2` uses approved text variant, assistant calls `{toolStepId,providerToolCallId,name,arguments}`, and results `{toolStepId,name,result}`. In a complete `ModelTurnV2`, require each result to match an earlier open call's stepId/name exactly once, no duplicate step IDs, no skipped open batch before a new assistant batch or end-of-turn. Native IDs may repeat in **different batches**. Result-level dispatch equality with a separate request remains an A runtime check; a standalone ModelResult schema cannot authenticate it.
4. Model response max4 unique native tool calls; `stopReason:'tool_calls'` iff calls nonempty; other reasons no calls. Argument max64 KiB; total turn/result max128 KiB UTF-8 canonical JSON bytes; result message max2,000 characters. Use browser-safe UTF-8 byte counting after safe-JSON validation (canonical key ordering does not change byte length); do not import Node hashing into `discovery.ts`. Actual token accounting/provider bounds remain adapter obligations. Turn limits positive and within input8192/output2048/timeout60000 policy; no model/client-selected increases. Unknown syntactically valid tool names must remain representable so dispatcher can report TOOL_FORBIDDEN, not dynamically register them.
5. Finding value+alternatives max8 KiB, max10 alternatives, max10 questions of512 chars, max50 evidence refs and derivation refs; distinct exact ref tuples. Agent origin/pending disposition literal. Schema validates local refs shape, not DB existence/current head, semantic support, or derivation acyclicity across stored findings. Server publication/assessment owns those checks.
6. **Preserve current profile refinements when omitting hash.** `CustomerProfileSchema` is guarded/refined and now includes optional bootstrap. Do not copy a historical field list or peel a Zod wrapper then call `.omit({hash:true})` and lose cross-field checks. Implement a draft adapter: first reject an own `hash` property (including undefined), guard the input, temporarily add a syntactically valid synthetic hash, validate with the **complete current CustomerProfileSchema**, then return parsed fields without that synthetic hash. It is shape validation only; actual hashProfile is called by the later proposal service. This preserves bootstrap.customer.id/parentCustomerId equality, exact term/configuration coverage, uniqueness, and all current nested guards. Never persist/return the synthetic hash. No change to the production full-profile schema/helper is needed.
7. Draft/profile finding objects accepted for discovery must retain origin agent/disposition pending as architecture requires; do not rewrite or silently normalize forged confirmed/reviewer values. Exactly one profile in a proposal. Proposal investigationIds and result assessment are strict serialized server-output shapes; a model tool must not be allowed to supply them later. A shape alone cannot establish that its output came from the server.
8. Result `compiled` requires artifactHash and exact one profile hash; a blocked assessment cannot have current state compiled. Keep valid historical blocked/draft forms representable. The schema may reject internally contradictory result/state combinations but **cannot discover an omitted blocker**. R2's durable run/capture/account-key assessment, sticky blocker provenance, atomic invalidation and finish guard remain A's DB consumer obligations. No schema-derived approval/eligibility flag.
9. State uses distinct task/proposal/finding keys, unique ref sets and safe counters; task attempt≤9/toolRounds≤8/repairRound≤2, in-flight model count≤4. Cost remains `{status:'unavailable'}`. Do not invent authenticated task capabilities, a scheduler, state completion algorithm, or financial applicability tests inside schemas.
10. Page schema: control stream only, increasing distinct sequences, all ≤highWater and >retainedAfter, nextAfter≤highWater and ≥each returned sequence; hasMore true requires nonempty events and nextAfter equal last event; hasMore false requires nextAfter=highWater. Checking requested runId/after/limit and proving lookahead exhaustion belongs to the DB reader. Scalar floor checks do not imply pruning exists.

## Exact helper vectors

`createToolStepId` validates strict two-field input then computes `'step:' + hashCanonical({dispatchId,providerToolCallId})`. No task/name/ordinal/payload/provider response ID enters its preimage. Changed arguments for a reused step are a later durable conflict, not a different step identity.

| Input native ID `call-1` | Exact output |
| --- | --- |
| dispatchId `d1` | `step:639b1ce6bb54e5d1b35f5648b06704d688cc562cf4325d11449f89c2fde0461d` |
| dispatchId `d2` | `step:c4bef3bf03ec0d8cb537dc998a1968af3eee4799dfae84705c15fb6ea301aa2a` |
| dispatchId `d3` | `step:3aaa9770344c9d9919f522d1cafb4d4c37abe392cd8adceab42525039cc845f2` |

Cursor canonical UTF-8 bytes have lexicographic object keys, no whitespace, unpadded base64url:

```text
{"controlCursor":0,"runId":"run-a","v":1}
eyJjb250cm9sQ3Vyc29yIjowLCJydW5JZCI6InJ1bi1hIiwidiI6MX0

{"controlCursor":3,"runId":"run-a","v":1}
eyJjb250cm9sQ3Vyc29yIjozLCJydW5JZCI6InJ1bi1hIiwidiI6MX0
```

Reject wire >1,024 bytes, padding, standard-base64 characters, invalid/noncanonical UTF-8/JSON, reordered or extra keys, wrong run, negative/fractional/unsafe number, future cursor. Re-encode equality rejects noncanonical alternatives. At floor2/highWater4, cursor2 valid, cursor1 RESYNC_REQUIRED, cursor5 CURSOR_INVALID. Existing dual-stream UiCursor and helpers remain unchanged.

## Red/green sequence and completion evidence

- [ ] Add focused schema/helper tests first. Once imports/minimal declarations exist, show meaningful assertion failure, not only missing-file failure.
- [ ] Implement listed shapes/helpers with no DB dependency. Tests include old v1 fixtures unchanged; source-wide before parent scope; v2→v1 exact projection; forged syntactically valid grant still structurally parseable; wrong internally bound source rejected; pending-only findings; v1 callId rejection; repeated native IDs across two batches with distinct step IDs; duplicate/orphan/wrong-name/unresolved transcript; call/byte/count boundaries; one-profile bound and blocked-assessment/compiled contradiction.
- [ ] Test draft preservation using current public absent-bootstrap and bootstrap examples: synthetic hash never emitted; explicit supplied hash rejected; absent-bootstrap hash matches current helper after server-style reattachment; present-bootstrap hash preserved; mismatched customer ID, missing/excess term binding, duplicate metadata refs, and forged confirmed profile finding reject. This is schema/hash compatibility, **not** evidence_support execution or bootstrap acceptance.
- [ ] Test all exact identity/cursor vectors and rejection cases, and page shape boundary examples. Do not open PostgreSQL or instantiate a model/evaluator to make these pass.
- [ ] Run `npm run test:unit -- packages/contracts/test/discovery.test.ts packages/contracts/test/discovery-helpers.test.ts packages/contracts/test/fixtures.test.ts packages/contracts/test/v3-contracts.test.ts packages/contracts/test/v3-hash-compatibility.test.ts` and `npm run typecheck`. If file names drift, locate the existing compatibility tests before substituting; record exact commands/results as partial V4a.
- [ ] Write the new v3 discovery-shapes freeze addendum from the actual final exports/examples. It must state present-bootstrap evidence support remains unavailable, thirteen financial checks do not prove bootstrap/readiness, source grants do not approve parent identity, and full T4.1/V4/T4.2/live/activation/runtime proofs remain separate. Existing v1/freeze-addendum semantics are preserved.
- [ ] Review the diff; commit only owned files with subject `feat: freeze bounded discovery contracts`; report exact commit, export inventory, compatibility checks and deferred consumer obligations to root. Stop at this boundary for fresh implementation review.

No integration test is mandatory for this contract-only step. The separately assigned activity reader owns real PostgreSQL verification in `tests/integration`, never `packages/storage/test` under the unit project.
