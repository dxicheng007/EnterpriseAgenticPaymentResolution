# Contract freeze v3 addendum · bounded discovery shapes

Contract-only V4a base `fbd6f0fe3ce6bf3fda9a128c7d6aebf4d1549970`. The accepted architecture input is `v4-orchestration-contract-proposal.md` with SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`. The independent architecture fix review in `v4-orchestration-contract-fix-review.md` covers tool-step identity, durable blocker assessment and bounded activity continuation. This addendum publishes the schema and helper portions of §§2, 3 and 6. The [original freeze](2026-11-08-contract-freeze.md) and the [activation addendum](2026-11-08-contract-freeze-v2-activation-shapes.md) still govern their existing contracts, hashes and verification requirements.

## Executable contracts

The [discovery module](../../../packages/contracts/src/discovery.ts) is the source of the exact types. Browser code imports that module directly. The package root exports these schemas, each corresponding inferred type without the `Schema` suffix, and the projection and server helpers below. The server-only [helper module](../../../packages/contracts/src/discovery-helpers.ts) uses the existing canonical JSON, hash and invalid-cursor implementations.

| Schemas | Contract |
| --- | --- |
| `DiscoveryBindingSchema`, `DiscoverySubjectSchema`, `SourceReadGrantSchema`, `DiscoveryTaskContextV2Schema` | A source/capture binding with manifest and snapshot IDs and hashes. The subject is either the whole source or one seller/account tuple. A restricted grant has at least one account. Grant company/source agree with the binding, and the bound source occurs in `allowedSourceRefs`. `toVerificationTaskContext` explicitly parses the five v1 fields `runId`, `taskId`, `role`, `allowedSourceRefs` and `allowedAccountIds`. |
| `ModelMessageV2Schema`, `ModelTurnV2Schema`, `ModelResultV2Schema` | Versioned dispatch envelope and ordered transcript. A historical batch carries one to four calls with distinct native and step IDs. Across the transcript a step ID occurs in one call and its corresponding result. Each result closes its earlier step by exact ID and name. Native IDs may repeat across batches. The next call batch and end of turn require the previous batch to be resolved. Result tool calls preserve native IDs and ordinal order. `tool_calls` requires one to four distinct calls. Other stop reasons require no calls. |
| `DiscoveryFindingV2Schema` | Source or source-account finding with `origin:'agent'` and `reviewDisposition:'pending'`. Evidence and derivation references are structurally checked. Alternatives and questions retain their input order. |
| `CustomerProfileDraftSchema`, `DiscoveryProposalV2Schema`, `ProposalResultSchema` | Draft profile has the full current profile shape except its hash. A serialized proposal carries one full profile and investigation IDs. Draft and full discovery profiles require pending agent findings. A compiled result requires an artifact hash, exactly one profile hash and an assessment with empty blocker references and diagnostic codes. Blocked and historical draft results can carry prior hashes. The general diagnostics array is separate from the assessment codes. |
| `DiscoveryStateV2Schema` | Versioned status, task/finding/proposal references, verification job references and explicit usage. Model calls in flight are at most four. Task counters are at most nine attempts, eight tool rounds and two repair rounds. Usage includes an explicit unknown-call count and `cost:{status:'unavailable'}`. |
| `DiscoveryCapabilitiesResponseV2Schema`, `StartDiscoveryRequestV2Schema`, `StartDiscoveryResponseV2Schema`, `DiscoveryActionRequestV2Schema` | Versioned capability, start and pause/resume shapes. Start selects company, manifest and idempotency key and returns a run ID. Pause/resume carries expected revision and idempotency key. |
| `DiscoveryCursorV1Schema`, `ControlActivityWindowSchema`, `ControlActivityPageSchema` | Run-scoped control cursor, retention window and bounded continuation shape. |

Objects use strict keys and recursively reject prototype keys. New set fields reject duplicates and emit lexical order by their exact key or JSON-encoded tuple. Task, current finding and proposal keys are their identity IDs. Verification references are keyed by proposal ID, proposal revision and job ID. A finding reference is keyed by finding ID and revision, with code added for blocker references. Existing connector, profile and activity parsers retain their own semantics. Diagnostic lists, alternatives, questions and model message/call arrays are ordered.

Model and finding free-form JSON use the existing safe JSON shapes with the F1 canonical number domain applied locally. Numbers must be safe integers and negative zero is rejected. Decimal source amounts retain their string form. Each free-form v2 JSON value permits up to 128 nested object or array containers, counted from its root. The depth check runs before recursive parsing. The existing v1 and profile JSON parsers keep their current domains. The model argument maximum is 65,536 bytes per call. Turn and result envelopes are each limited to 131,072 UTF-8 JSON bytes. Key ordering leaves that byte count unchanged. The result message maximum is 2,000 characters under the string schema. An explicitly undefined optional message is omitted from the parsed result. Turn limits are positive and at most 8,192 input tokens, 2,048 output tokens and 60,000 ms. Tool names are strings so that an unknown name can reach the dispatcher's closed registry and receive `TOOL_FORBIDDEN`. A finding limits the JSON object `{value,alternatives}` to 8,192 UTF-8 bytes, with up to ten alternatives, ten questions of at most 512 characters each, fifty evidence IDs per evidence set and fifty exact derivation references.

## Development shape examples

A source-wide investigation can use an empty parent account list and publish pending observations before proposing parent scope.

```ts
const context = {
  schemaVersion: 2, runId: 'run-a', taskId: 'task-a', role: 'contract',
  allowedSourceRefs: ['legacy-a'], allowedAccountIds: [],
  binding: {
    companyId: 'company-a', sourceRef: 'legacy-a', manifestId: 'manifest-a',
    manifestHash: 'a'.repeat(64), snapshotId: 'snapshot-a', snapshotHash: 'b'.repeat(64),
  },
  sourceRead: { companyId: 'company-a', sourceRef: 'legacy-a', sourceWide: true, accounts: [] },
  investigationId: 'investigation-a', taskRevision: 1, dispatchId: 'd1',
};
const projected = {
  runId: 'run-a', taskId: 'task-a', role: 'contract', allowedSourceRefs: ['legacy-a'], allowedAccountIds: [],
};
const finding = {
  schemaVersion: 2, id: 'f-term', revision: 1, taskId: 'task-a', subject: { kind: 'source' },
  fieldPath: '/terms/monthly', value: null, provenanceClass: 'unresolved', evidenceStatus: 'insufficient',
  evidenceRefs: [], derivationInputs: [], alternatives: [], unresolvedQuestions: [],
  reviewDisposition: 'pending', origin: 'agent',
};
```

For the [public fixture A](../../../tests/fixtures/index.ts), a draft is `profileA` without its own hash. The profile parser retains its bootstrap refinements through the draft adapter. It requires the customer ID to match `parentCustomerId` and distinct configuration bindings to cover exactly the profile terms. For example, the optional bootstrap customer is `{id:'buyer-shared-1',displayName:'Shared Buyer',evidenceRefs:['ev-a-identity']}` with `billingConfigurationIds:[{termId:'term-a-1',id:'config-a-1'}]`. A supplied hash, including an explicit undefined property, fails. The adapter adds a temporary syntactically valid hash for validation and drops it from the output. The proposal service later computes the actual hash. Reattaching `hashProfile(draft)` to the absent-bootstrap example retains fixture A's existing profile hash `f68f5593688f4d3cbd09047abec9dc2fb1053998354892a87fc7766b500aa42c`. Present-bootstrap drafts retain the same hash as their equivalent full profiles after the server hashes and reattaches that metadata.

A structurally valid blocked proposal result can contain `assessment:{revision:1,observedRunRevision:2,investigationIds:['inv-a'],blockerRefs:[{findingId:'f-term',revision:1,code:'FINDING_RESOLUTION_PENDING'}],diagnosticCodes:[]}` with `state:'compile_blocked'`. Setting that result's state to `compiled` fails even when both hashes are present. An empty serialized assessment carries no evidence that the correct blocker set was queried.

## Exact helper vectors

`createToolStepId({dispatchId,providerToolCallId}):Id` parses exactly those two fields and computes `'step:' + hashCanonical({dispatchId,providerToolCallId})`. The provider response ID, task ID, call name, ordinal and arguments are outside this preimage. A second batch can use native `call-1` with its own step ID. Two results with different step IDs remain distinct.

| Dispatch ID with native `call-1` | Tool step ID |
| --- | --- |
| `d1` | `step:639b1ce6bb54e5d1b35f5648b06704d688cc562cf4325d11449f89c2fde0461d` |
| `d2` | `step:c4bef3bf03ec0d8cb537dc998a1968af3eee4799dfae84705c15fb6ea301aa2a` |
| `d3` | `step:3aaa9770344c9d9919f522d1cafb4d4c37abe392cd8adceab42525039cc845f2` |

`encodeDiscoveryCursor(cursor)` emits unpadded base64url of the canonical JSON bytes. `decodeDiscoveryCursor(wire,{runId,highWater,retainedAfter})` checks server bounds, then the wire and run before comparing the floor.

```text
{"controlCursor":0,"runId":"run-a","v":1}
eyJjb250cm9sQ3Vyc29yIjowLCJydW5JZCI6InJ1bi1hIiwidiI6MX0
{"controlCursor":3,"runId":"run-a","v":1}
eyJjb250cm9sQ3Vyc29yIjozLCJydW5JZCI6InJ1bi1hIiwidiI6MX0
```

A wire longer than 1,024 bytes, noncanonical or malformed JSON/base64url/UTF-8, a different run or a future position throws the existing `InvalidCursorError` with `CURSOR_INVALID`. With floor 2 and high-water 4, position 2 parses, position 1 throws `DiscoveryResyncRequiredError` with `RESYNC_REQUIRED`, and position 5 throws `CURSOR_INVALID`. Invalid expected bounds fail validation as programmer errors. The existing two-stream `UiCursor` has its own protocol.

A valid page has increasing control event sequences above `retainedAfter` and at or below `nextAfter`, with `retainedAfter <= highWater` and `nextAfter <= highWater`. With high-water 4, retained floor 0 and matching run event sequences 1, 3 and 4 at limit 1, successive pages use next positions 1, 3 and 4 with `hasMore` true, true and false. An exhausted page with zero matching events also returns next position 4. A nonempty continuing page ends at the last emitted sequence strictly below high-water. Shape checks alone cannot prove that the reader used the requested run, offset and limit or found a lookahead row.

## Consumer obligations and verification limits

- Authenticate the reviewer and source grant before reads or mutations. The dispatcher must read persisted grants, verify capture membership and the current dispatch fence, and ensure delegation can only narrow grants. A structurally consistent grant or v1 projection carries no authenticated capability. Source grants do not approve parent identity.
- Check exact result dispatch identity, provider policy, actual token accounting, tool allowlists and budgets. Reconstruct the bounded transcript from durable records. Use tool-step identity for replay, cross-run isolation and verification request keys. The durable dispatcher detects changed name or arguments for an already accepted dispatch/native ID and prevents partial execution.
- Validate evidence, capture applicability, current references and the stored derivation graph before publishing findings or proposals. The server derives investigation IDs and blocker assessments from stable run/capture/account keys, retaining blocker provenance across revisions and omitted citations. Under the run lock it must invalidate stale compilation and verification links and recheck the assessment before compilation publication and finish. Serialized shapes cannot authenticate server-owned fields, detect missing blockers, or establish semantic support, approval, eligibility or activation.
- Read each authorized activity page with coherent high-water and retention bounds and limit-plus-one matching rows. Prove exhaustion within the same database snapshot. Resume SSE at the last delivered event after disconnect and reauthorize each page. Actual retention, delivery and resync behavior require consumer tests. The composite control/runtime stream remains a separate protocol.
- Present-bootstrap `evidence_support` remains unavailable. The thirteen financial checks do not prove bootstrap or readiness. Independent protected assertions and exact-subject verification remain governed by the [activation addendum](2026-11-08-contract-freeze-v2-activation-shapes.md#bootstrap-and-readiness).

The [discovery shape tests](../../../packages/contracts/test/discovery.test.ts) and [helper vectors](../../../packages/contracts/test/discovery-helpers.test.ts) provide partial V4a machine evidence. The activity reader, persisted orchestration, provider adapter, routes, UI, reviewer acceptance and exact-candidate independent implementation review have separate evidence. Full T4.1, V4, T4.2, live construction, bootstrap, activation and deterministic runtime proofs remain separate.
