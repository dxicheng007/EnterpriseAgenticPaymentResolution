# T4.1 observable discovery: contract proposal and implementation handoffs

**Status:** Proposal for root/B/A/C review, not a frozen amendment or permission to implement consumers before contract acceptance. No implementation or commit in this task.

**Baseline:** Initially `f3e5375808da004bc27092c3c159dac5dcad821c`; fix round 1 inspected `33364f0edd20fd82635aa09700b4dd240e212a86` and the activation-shape freeze addendum. Sources: PRD §§4–5, 8, 14, 17; implementation T4.1/T4.2; freeze F1/F4/F6/F7; shared-contracts public interfaces and ownership; executable APIs inspected below. Use the already approved product flow. No new product decision is needed for bounded scripted orchestration, source inspection, or the monitor.

**Outcome:** Persist actual tasks/tool invocations/source-scoped findings and actual structured connector/profile proposals; validate and compile the submitted proposals; expose truthful observable state and pause/resume. A scripted `ModelClient` proves enforcement and replay only. Default local startup without a provider remains unavailable for live discovery. No test script or fixture adapter becomes a production discovery engine.

## 1. Existing contracts are the baseline, not absent types

`packages/contracts/src/model.ts` already exports strict `ModelTurn`, `ModelResult`, `TaskContext`, `DiscoveryState`, `Finding`, and `ProductRole` schemas. Preserve these v1 exports and bytes; use explicit v2 schemas for the new discovery wire where necessary, not an optional-field soup or a second same-named type in another package.

| Existing boundary | Present behavior / impact |
| --- | --- |
| `model.ts` `TaskContext` | `{runId,taskId,role,allowedSourceRefs,allowedAccountIds}`; verification route parses it. IDs are not an authenticated bearer capability. |
| `FindingSchema` | Requires parent `Scope`; embedded in `CustomerProfile` and its hash. Compiler checks disposition/support for material findings. Changing it changes profile semantics and evaluator subjects. Leave it unchanged. |
| Current `CustomerProfile` | Optional `bootstrap` and addendum hashing are already present. Reuse the current schema/hash helper, including all bootstrap refinements. The evaluator currently returns `evidence_support:unavailable` for bootstrap-bearing profiles; thirteen financial checks do not prove bootstrap or activation readiness. |
| `ModelTurn` / `ModelResult` | Shared shape documented in shared-contracts; no provider adapter or scheduler exists. Reuse their core fields in v2, constrain bounds and consistency. |
| `DiscoveryState` | Abbreviated planned status/tasks/candidate ID; no producer/route consumer found. Retain export; new routes emit explicit schema version 2. |
| Source service | Complete captures, `getSnapshotRecords`, source capabilities; `readEvidence` scoped original association/locator; evidence `searchEvidence`/`permitsEvidence`. No need for source coverage parser or fixture account metadata. |
| Compiler | `compile(spec, profiles): Result<CompiledArtifact>`, pure; `planBatch` pure. Proposed profiles are not activation. No model path in worker. |
| Registry | `registerCandidate({spec,artifact,profiles,manifest,snapshot})`; immutable canonical files/rows; exact same registration repeat is safe. It recompiles/checks hashes, but is not sufficient evidence-support verification. |
| Verification jobs | `enqueue(candidate, {runId,accountId}?)`; persisted 3-attempt run/account budget; protected launcher/report binding. Enqueue has no caller idempotency key and in-process processing is not a durable recovery queue. Do not blindly retry it after a crash. |
| Activity | `publishActivity` commits counter/event with state transaction; `readActivity` reads one DB. SSE, retention-floor read, full cursor endpoint, and worker activity read bridge do not exist. |
| Local session | `authorizeReviewer(request,{mutation})`; source-wide review grants but narrower preview account grants. Mutations require loopback origin + CSRF. Task tools must never pass themselves off as this reviewer. |

**Consumer inventory B must check:** `apps/control/src/routes/verification.ts`, `packages/contracts/src/{activity,connector,index}.ts`, compiler findings/hash paths, `packages/evaluator` profile/report paths, `tests/integration/evidence-v2-store.test.ts`, existing fixture/schema tests. No existing profile/Finding/TaskContext v1 hash is migrated. New test fixture shapes import v2 explicitly.

## 2. Proposed strict v2 schemas — B owns publication

All objects strict with existing prototype-key rejection. IDs/hashes/timestamps use existing schemas; no URL/path/credential fields. Sets reject duplicate keys and serialize lexically. JSON values remain bounded safe JSON, never code. V2 additions live in `packages/contracts/src/discovery.ts`; export through `index.ts`. Reuse existing role and v1 schema field definitions via an intentional B refactor if needed, keeping v1 accepted/rejected shapes identical.

```ts
type DiscoveryBinding = {
  companyId: Id; sourceRef: Id; manifestId: Id; manifestHash: Hash;
  snapshotId: Id; snapshotHash: Hash;
};
type DiscoverySubject =
  | { kind: 'source' }
  | { kind: 'source_account'; sellerEntityId: Id; sourceAccountId: Id };
type SourceReadGrant = {
  companyId: Id; sourceRef: Id; sourceWide: boolean;
  accounts: {sellerEntityId: Id; sourceAccountId: Id}[];
};
type DiscoveryTaskContextV2 = TaskContext & {
  schemaVersion: 2; binding: DiscoveryBinding; sourceRead: SourceReadGrant;
  investigationId: Id; taskRevision: Version; dispatchId: Id;
};
```

`TaskContext` is the existing strict v1 schema, unchanged. `DiscoveryTaskContextV2Schema` explicitly reproduces/extends its field definition with the fields above; do not parse v2 through v1 and drop extras implicitly. `toVerificationTaskContext(v2): TaskContext` explicitly projects the five old fields for the existing verifier. A syntactically valid context is not trusted: the dispatcher loads the persisted row/grants and checks the current dispatch fence before every tool. The model never supplies or edits a context. `allowedAccountIds` remains parent candidate/read capability from trusted session configuration; source discovery never appends a guessed account ID to it.

`SourceReadGrant` matches `EvidenceCapability`. `sourceWide:false` requires nonempty distinct seller/account tuples. Source-wide reads are explicitly granted at run creation from the reviewer's authorized source; they are not inferred from empty accounts or a name. Delegation may narrow but never expand. Each task belongs to one run/capture/source. Source account IDs and buyer-name claims are evidence observations, not parent identity decisions.

### Model adapter v2

```ts
type ModelMessageV2 = Extract<ModelMessage, {kind:'text'}> | {
  kind: 'assistant_tool_calls';
  calls: {toolStepId:Id; providerToolCallId:Id; name:string; arguments:JsonObject}[];
} | {
  kind: 'tool_result'; toolStepId:Id; name:string; result:JsonValue;
};
type ModelTurnV2 = Omit<ModelTurn, 'messages'> & {
  schemaVersion: 2; dispatchId: Id; messages: ModelMessageV2[];
};
type ModelResultV2 = ModelResult & { schemaVersion: 2; dispatchId: Id };
interface ModelClient {
  readonly mode: 'scripted' | 'live';
  readonly modelId: Id; // operator configuration, not a tool/model argument
  run(input: ModelTurnV2): Promise<ModelResultV2>;
}
```

Core fields are existing `runId/taskId/role/instructions/messages/toolSchemas/limits` and result `providerCallId/message?/toolCalls/usage/stopReason`. In `ModelResultV2.toolCalls`, existing `id` means the provider-native **tool call** ID; the result-level `providerCallId` identifies the provider response, not a tool step. On accepting a dispatch result, the server maps each tool-call `id` to `providerToolCallId` and creates `toolStepId = 'step:' + hashCanonical({dispatchId, providerToolCallId})`. `dispatchId` is globally unique and server-owned. Persist toolStepId as primary key and `(dispatchId,providerToolCallId)` as a unique key, plus runId/taskId/name/ordinal/input hash. The model cannot choose toolStepId. Reaccepting identical dispatch output resolves the same rows; same dispatch/native ID with changed name/arguments/output conflicts before executing any call. Different dispatches always have different step IDs, even across tasks with reused native IDs.

V2 deliberately excludes inherited v1 `tool_result {callId,...}`. Every result matches an earlier call's **toolStepId and name** exactly once; no unresolved batch is skipped. Inspector routes, activity links, replay lookups, and verifier idempotency use toolStepId only. The adapter keeps native IDs as provenance; if provider transcript IDs need remapping, use toolStepId or an explicit reversible adapter map, never search by bare providerToolCallId. Reconstruct messages from bounded validated dispatch/tool records and immutable authorized evidence refs, not raw provider transcripts/hidden reasoning. Provider-specific requests stay behind the adapter. Instructions/tool schemas/limits/run/task/dispatch IDs come from server policy; source text stays tool data. Validate model output before any call.

**R1 examples/tests:** dispatch `d1` in task `t1`, dispatch `d2` in `t1`, and dispatch `d3` in `t2` may all return native `call-1/readEvidence`; their three computed toolStepIds must differ and each inspector/transcript result must resolve its own run/task/evidence. Replaying `d1/call-1` returns the original step and one saved result; changing its arguments conflicts. A repeated verification step uses that exact toolStepId as requestKey and consumes one attempt. Cross-run toolStepId detail reads are forbidden/not found without leaking the other result. Schema tests reject v1 callId-only results; DB/dispatcher tests establish identity and authorization.

V2 schema: maximum 4 tool calls per response, unique call IDs, arguments at most 64 KiB canonical UTF-8 each; `tool_calls` iff at least one call, `done|limit|error` require no calls; result dispatch ID equals request. Message at most 2,000 characters; it is not an authority command and is not stored/rendered as hidden reasoning. Tool names validated against a closed enum at dispatch. An unknown tool is recorded as rejected `TOOL_FORBIDDEN`, not dropped or dynamically registered. A structurally malformed result blocks the task with `MODEL_OUTPUT_INVALID` and executes no partial calls.

Initial operator policy: 8,192 max input tokens and 2,048 max output tokens per call, 60,000 ms timeout; maximum 128 KiB canonical request/response bytes in addition to token caps. These are proposed implementation resource defaults, not financial semantics. An adapter must enforce provider input/output limits with its actual tokenizer/config before a live call. T4.1 test adapter implements a deterministic budget meter; it does not claim measured provider billing. Missing/over-budget usage or wrong dispatch/provider identity blocks the result. Preserve actual known usage and an explicit unknown-usage count after interruption; never show zero as unknown.

### Source-scoped findings and structured proposals

```ts
type DiscoveryFindingV2 = {
  schemaVersion: 2; id: Id; revision: Version; taskId: Id;
  subject: DiscoverySubject; fieldPath: JsonPointer; value: JsonValue;
  provenanceClass: 'observed'|'derived'|'inferred'|'unresolved';
  evidenceStatus: 'supported'|'contradicted'|'insufficient';
  evidenceRefs: Id[];
  derivationInputs: {findingId: Id; revision: Version}[];
  alternatives: {value: JsonValue; evidenceRefs: Id[]}[];
  unresolvedQuestions: string[];
  reviewDisposition: 'pending'; origin: 'agent';
};
type DiscoveryProposalV2 = {
  schemaVersion: 2; id: Id; revision: Version; taskId: Id;
  spec: ConnectorSpec; profiles: CustomerProfile[];
  findingRefs: {findingId: Id; revision: Version}[];
  investigationIds: Id[]; // server-owned applicability binding, not model input
};
// Tool input only: the server computes this representation hash.
type CustomerProfileDraft = Omit<CustomerProfile, 'hash'>;
type ProposalResult = {
  proposalId: Id; revision: Version;
  state: 'draft'|'compile_blocked'|'compiled';
  artifactHash?: Hash; profileHashes: Hash[]; diagnostics: Diagnostic[];
  assessment: {
    revision: Version; observedRunRevision: Version;
    investigationIds: Id[];
    blockerRefs: {findingId:Id; revision:Version; code:Id}[];
    diagnosticCodes: Id[];
  }; // server-owned; never supplied by draft/revise/finish
};
```

These are explicitly new discovery sidecars, not changes to frozen `Finding` or profile hashes. `DiscoveryFindingV2` is bound by its run/task DB FK to the complete capture. Source-level findings can exist before any parent scope is proposed. Evidence status is an agent claim, displayed as such; server validates reference existence, authorization, binding, and derivation DAG but cannot turn semantic support into a verified fact. Publication forces `origin:agent/reviewDisposition:pending`; model attempts to confirm/reject reviewer decisions fail.

Finding values/alternatives total at most 8 KiB; at most 10 alternatives, 10 questions of 512 chars, 50 evidence refs, 50 derivation refs. Maximum 100 finding identities and 10 revisions each per investigation. Any derivative input is an exact existing revision in the same run; cycles and stale expected revisions reject. Revisions are append-only and prior cited revisions remain readable. Contradicted/insufficient/inferred claims remain explicit; they do not become supported by prose confidence.

Model produces **actual structured `ConnectorSpec` and customer profile fields**, not instructions to copy `demo-candidates.ts`. Tool input uses strict `CustomerProfileDraft` without `hash`; server computes `hashProfile` and validates the resulting `CustomerProfile`. Do not require a model to calculate cryptographic hashes or accept its hash as authority. T4.1 proposal `profiles` has exactly one item, keeping compilation/registration/verification subject identical under the current single-account task verifier. A run holds multiple separately versioned customer proposals using the same company connector spec; identical spec ID/version must mean identical canonical spec bytes. This is a bounded interface choice, not a rule to combine customers. Strictly validate both, compute/check profile/spec hashes, enforce captured source/company and cited membership, compile the supplied objects, retain structurally valid compile-failed drafts and diagnostics. Structurally malformed drafts are rejected tool results, not falsely typed `DiscoveryProposalV2` rows. At most one profile per exact proposed parent account; source account aliases must have source evidence and cannot collide across current proposals. Profile IDs/versions must be scoped to this run's proposal identities to avoid registry collisions with existing fixture artifacts. Server may assign deterministic object IDs/versions/hashes as representation bookkeeping; it must not supply missing mappings, terms, buyer identities, or monetary values.

Every proposal must reference the exact current finding revisions it claims to consume. A later finding/proposal revision marks prior compilation/replay/verification links stale for the current view; historical objects remain. Do not insert v2 findings directly into `CustomerProfile.findings`. Proposed profile v1 findings must have `reviewDisposition:pending`, `origin:agent`; server rejects forged confirmed/reviewer facts. Existing compiler may block those material findings, which is correct. Findings can remain the discovery sidecar while directly cited profile terms are checked by existing compilation/independent evidence verification; do not erase a contradictory sidecar to get a passing artifact.

**R2 server-owned blocker assessment:** `findingRefs` records consumed provenance only. It cannot select the findings the server considers. On draft/revise the server derives applicability keys from `(runId, capture binding, sourceRef, sellerEntityId, sourceAccountId)` and the run/capture's source-wide key, validates every raw tuple belongs to the captured source, then resolves the server-owned investigation IDs. There is one investigation row per exact key enforced by a DB unique constraint; `delegateTask` for the same account returns that investigation regardless of a new task/proposal/name. Assessment queries blockers by these stable applicability keys, not a model-supplied investigation ID. A logical proposal retains the union of its prior investigation bindings across revisions; dropping an alias/reference does not silently clear an existing blocker. A genuinely different account proposal may be separate, but cannot make the run's unresolved earlier investigations disappear.

For this bounded slice, conservatively treat **every** `contradicted`/`insufficient`/`inferred`/`unresolved` finding in those investigations as a potentially material blocker; do not let the model choose a “nonmaterial” flag or exploit an unrecognized fieldPath. Findings with source subject apply to every proposal of this run. The server checks finding subject against task investigation and evidence/event association: if applicable scope cannot be established from these existing bindings, record `FINDING_APPLICABILITY_UNRESOLVED` in the source-wide blocker set rather than guessing financial applicability or moving it to an unrelated account. Known capture/compiler/authorization diagnostics independently remain blockers; an empty finding set does not clear them.

Record blocker origin `{findingId,revision}` when first raised, append revisions/diagnostics on later observations, and retain unresolved entries independently of current findingRefs. A model revision from contradicted to supported is new evidence for investigation, **not** a resolution authority. T4.1 has no tool that clears a known potentially material contradiction or confirms a pending fact; keep `FINDING_RESOLUTION_PENDING` until an independently specified resolution/reviewer workflow exists. This conservative limit may block a candidate; it must not be bypassed by a new ID, omitted citation, revised scope, or a positive financial verification summary. It does not change the v1 compiler or invent financial effective-time rules.

Under the run lock, every new/revised finding or blocker updates the server assessment revision, persists exact blocker refs, stales affected current compilation/replay/report links, and increments run revision in the same transaction. Compile/publication and `finishRun` compare observed run/assessment revisions and recompute the server-owned set before presenting a current candidate or completion. Pure compile may still produce historical diagnostic artifacts, but a nonempty/unresolved assessment yields `compile_blocked` for current presentation, and `finishRun` stays blocked. Never relabel a registry object or eligible financial report as a cleared discovery assessment. A compiled candidate still grants no approval, activation, or eligibility itself.

**R2 examples/tests:** publish contradictory term `f-term@1` for raw account A2; draft/revise A2 with `findingRefs:[]`, no profile findings, and direct term citations. Compile's structural success must not remove `f-term@1` from assessment, expose a current compiled candidate, or let finish complete. Attempt a new investigation/proposal/name for A2: the stable key resolves the existing investigation, duplicate rows fail uniqueness, and the new proposal inherits `f-term@1` even with no consumed refs. Repeat with source-wide contradiction, unrecognized fieldPath, dropped alias, agent `supported` revision, a positive financial report, and publication racing an already-running compile. All retain a blocker/stale binding. An independently scoped A3 finding does not become an A2 financial fact; ambiguous applicability becomes source-wide unresolved. No test invents a new economic applicability rule.

### Observable state v2

```ts
type DiscoveryStateV2 = {
  schemaVersion: 2; id: Id; revision: Version; binding: DiscoveryBinding;
  mode: 'scripted'|'live'; modelId: Id;
  status: 'queued'|'running'|'paused'|'blocked'|'completed'|'failed';
  inFlightModelCalls: number; inFlightToolSteps: number;
  tasks: {
    id: Id; investigationId: Id; subject: DiscoverySubject; role: ProductRole;
    question: string; dependencyIds: Id[];
    status: 'queued'|'running'|'waiting'|'succeeded'|'failed'|'interrupted';
    attempt: number; revision: Version; toolRounds: number; repairRound: number;
    diagnosticCodes: string[];
  }[];
  findings: {id:Id; revision:Version; taskId:Id; subject:DiscoverySubject}[];
  proposals: ProposalResult[];
  verificationJobs: {proposalId:Id; proposalRevision:Version; jobId:Id}[];
  usage: {modelCalls:number; inputTokens:number; outputTokens:number;
    unknownUsageCalls:number; cost:{status:'unavailable'} };
  diagnostics: Diagnostic[];
};
```

All counts are nonnegative safe integers bounded by server policy. Money cost unavailable is truthful for T4.1; no fabricated dollars or live counters. `completed` means the bounded task graph finished with at least one current compiled proposal, no unresolved task dependencies, and no unresolved server-owned blocker in any investigation opened in the run or its source-wide set, checked under the current run revision. Uninvestigated captured accounts remain listed as outside this run's constructed scope; completion never asserts all accounts understood. Opened investigations cannot be erased to obtain completion. `blocked` retains partial proposals and enumerates missing evidence/budget/capability/dependency causes. Verification eligibility remains only the existing protected summary. No `ready`, `approved`, `active`, runtime model-call count, or parent-write receipt is invented in this state.

## 3. Before/after HTTP — reviewer-only routes

Before: no discovery endpoints; only health/source/evidence/fixture-preview/verification routes. After (all no-store, strict request schemas):

| Endpoint | Input | Success |
| --- | --- | --- |
| `GET /api/discovery/capabilities` | none | `{schemaVersion:2,mode:'unconfigured'|'scripted'|'live',startAvailable:boolean,diagnostics:Diagnostic[]}` |
| `POST /api/discovery/runs` | `{schemaVersion:2,companyId,manifestId,idempotencyKey}` | 202 `{schemaVersion:2,runId}`; same key+binding returns same run |
| `GET /api/discovery/runs/:runId` | none | 200 `DiscoveryStateV2` |
| `POST /api/discovery/runs/:runId/pause` | `{schemaVersion:2,expectedRevision,idempotencyKey}` | 200 state v2 |
| `POST /api/discovery/runs/:runId/resume` | same | 200 state v2 |
| `GET /api/discovery/runs/:runId/findings/:findingId?revision=N` | explicit positive revision | 200 `DiscoveryFindingV2` |
| `GET /api/discovery/runs/:runId/proposals/:proposalId?revision=N` | explicit positive revision | 200 proposal + compile result, safe replay/verification references |
| `GET /api/discovery/runs/:runId/tools/:toolStepId` | none | persisted safe tool summary bound to this run/task/dispatch and evidence/finding/proposal refs; never lookup by bare provider tool-call ID |

The run POST externally keeps the plan's company/manifest selection but adds explicit version/idempotency. `startDiscovery(input, reviewer)` service returns `{runId}`. Body cannot select model/fixture/truth paths, budgets, role grants, reviewer identity, customer approval, provider key, or protected test set. All POSTs call the existing session authorizer with `mutation:true`; GETs with false. Persist reviewer ID as audit origin, never persist cookie/CSRF/session token. Current reads/actions require current source grant, not just knowledge of run ID. Do not bind durable ownership solely to ephemeral sessionId; restart creates new local session for same reviewer/source grants.

Start verifies the exact **complete aggregate**, manifest/source bindings, hashes and evidence before committing a run. It does not call capture on GET/POST, replace the selected manifest with latest, or derive identity from fixture metadata. Resolve and pin operator model configuration at creation. Unconfigured start returns 503 `MODEL_UNAVAILABLE`, no fake queued work. Scripted mode can be injected by tests only and is visibly labeled; default `npm run dev` must not silently install it. A capability response is configuration availability, not a successful provider call.

Typed `ApiError`: malformed 400 `DISCOVERY_INVALID`; existing session401/403; absent references404; stale revision/key changed body/capture mismatch409 `DISCOVERY_CONFLICT`; unconfigured/dependency503. A valid forbidden tool returns typed `TOOL_FORBIDDEN` to that task with no side effect. Exhausted budgets are persisted blocked state, not an HTTP success pretending completion. Duplicate idempotency key with identical action returns its stored result even if later state advanced; client then refetches current state. Same key with different canonical body returns409.

Pause is durable immediately: no new model dispatch or tool step may be **claimed** after its commit. Already claimed model/tool work may settle, including an external verification enqueue that was reserved before pause; do not claim that an HTTP/provider operation already in flight can be atomically canceled. State honestly shows `paused` plus in-flight model/tool counts. Record completed model usage and validated output as pending steps; claim no pending tools until resume. Control-state tool claim/effect/result is one transaction serialized against pause, so it either commits before pause or does not start. Do not claim remote cancellation merely because an AbortSignal fired. Resume preserves graph, completed tool results, all budgets, current proposal/finding revisions. It retries only specifically interrupted bounded/idempotent steps; no new run/reset budget. A model outcome unknown after process interruption becomes `interrupted` + actionable block; there is no automatic provider retry hidden behind resume.

## 4. Tool registry and source access — actual calls, least authority

All roles: describe/query/search/read plus `publishFinding`, `readFinding`, and `requestInvestigation`. Only coordinator: `delegateTask`, `beginRepair`, `finishRun`. Only connector: draft/revise/compile/replay/compare/requestVerification/readVerification. Coordinator gets read-only proposal/verification summaries through task context, not activation tools. No eval/shell/SQL/network/browser/source-admin/upload/capture/grant/activate/apply/revoke tools; deny unknown names even if a tool message claims the reviewer authorized them.

Concrete tools (each strict input/output schema in B contract module; executor supplies run/context):

| Tool | Arguments / result boundary |
| --- | --- |
| `describeSource` | `{}` → pinned source capabilities/contracts/streams and immutable capture binding |
| `querySnapshot` | `{resource?:Id,account?:{sellerEntityId,sourceAccountId},afterEventId?:Id,limit:1..50}` → ordered captured raw events with their valid citation IDs, next cursor/null. No SQL/filter expressions/arbitrary source or URL. Cursor must belong to same fixed filtered capture. |
| `searchEvidence` | `{query:string(1..256),limit:1..20}` → existing bounded authorized search hits + citation IDs; no filesystem search |
| `readEvidence` | `{evidenceId,range?:{start:number,end:number}}` → captured evidence identity/locator/hash plus bounded authorized excerpt, at most 8,192 UTF-16 units, no split surrogate, no path/credential. Range within cited text and original citation retained. Never fabricate a new immutable citation on read. |
| `publishFinding` | `{findingId?:Id,expectedRevision:0..N,subject,fieldPath,value,provenanceClass,evidenceStatus,evidenceRefs,derivationInputs,alternatives,unresolvedQuestions}` → new immutable revision ref; origin/disposition/task supplied by server |
| `readFinding` | `{findingId,revision}` → exact source-scoped finding within this run |
| `requestInvestigation` | `{subject,question,dependencyFindingRefs}` → persisted bounded coordinator request; cannot spawn a task or widen grants itself |
| `delegateTask` | `{subject,role:identity|contract|receivables|connector,question,dependencyIds}` → server investigationId/taskId/revision; resolve-or-create the unique bounded investigation for this captured raw tuple/source, derive grants from run policy, never accept grants in input |
| `beginRepair` | `{investigationId,proposalId,expectedProposalRevision,diagnosticCodes}` → increment repair round once; linked unresolved compile/verification diagnostics must exist |
| `draftConnector` / `reviseConnector` | `{proposalId?,expectedRevision:0..N,spec:ConnectorSpec,profiles:[CustomerProfileDraft],findingRefs}` → proposal revision/validation result; all actual content required, no fixture shorthand; server adds only computed hashes |
| `compileConnector` | `{proposalId,revision}` → pure compile result and artifact/profile hashes or diagnostics; repeat exact step safe |
| `runSandboxReplay` | `{proposalId,revision}` → existing deterministic planner output over fixed capture and isolated empty target scoped to proposed profile; targetMode:'empty-sandbox', parentWrites:0. No target override or worker write. |
| `compareArtifacts` | `{left:{proposalId,revision},right:{proposalId,revision}}` → deterministic field/rule/profile/hash differences for same run; not semantic approval |
| `requestVerification` | `{proposalId,revision,profileHash}` → existing protected `VerificationJob` via the retry-safe adapter in §7; initial+2 repair attempts enforced; exact allowed parent-account capability required |
| `readVerification` | `{jobId}` → same-run authorized safe job/summary; final holdout never returned to repair tools |
| `finishRun` | `{}` → server validates task/proposal state and completes or returns blockers; coordinator cannot declare eligibility |

Tool result limit 64 KiB canonical UTF-8. Do not silently truncate event sets: return a smaller paginated page or typed `TOOL_RESULT_LIMIT`; no semantic assertion can rely on hidden truncation. Oversized single record is an explicit blocker. Evidence searches can paginate only using a pinned stable capture/index, never live document replacement. Raw source records and exact cited originals remain independently accessible; the narrow source-coverage parser is neither a dependency nor an answer oracle.

Reuse `readEvidence` / `requireCoverage` / `permitsEvidence`. Current document association lookup has unknown account coverage (`identities:[]`), so account-limited tasks must be denied whole documents unless a source-owned multi-account coverage extractor actually proves every exposed identity. Initial identity discovery has explicit source-wide grant and can read them. Do not “fix” that denial by trusting coverage UI labels. Bounded excerpt support still must prove allowed excerpt coverage; an arbitrary character range is not an authorization proof. Wrong-company or wrong-manifest evidence is rejected before returning text even if file bytes share a hash.

Queries read only the pinned immutable event membership, validating hashes and source contracts. Unknown IDs remain unknown; names cannot create a parent ID. Every finding/proposal citation must be in that capture and readable under task grant. Source instructions cannot expand registry membership, invoke arbitrary tools, or mutate review dispositions. No original full document/model transcript is persisted in activity. Tool inspector shows allowlisted arguments/IDs/counts/outcome codes and scoped excerpt links; raw content retrieval continues through authorized evidence service.

## 5. Bounded orchestration, persisted revisions, and crash boundaries

**Investigation definition:** server IDs represent one exact raw `(sellerEntityId,sourceAccountId)` tuple or the run's one source-wide unresolved investigation. A coordinator can propose creating an account investigation only for an actual captured raw tuple; this is work organization, not identity resolution. Reuse same tuple's investigation ID; it cannot evade budgets by renaming customer/name/account alias. Additional aliases require cited findings and must not merge legal entities or grant new access. Maximum 20 account investigations + one source investigation in this T4.1 local resource policy; exceeding it blocks explicitly, never silently drops events. No promise of complete company scale.

**Limits:** max 4 simultaneously unsettled `ModelClient.run` calls globally across all runs in one control supervisor; max 10 non-coordinator tasks per investigation (all four specialist roles count); one coordinator task/run; max 8 tool-bearing rounds per task, max 4 calls/round; max 9 model dispatch attempts/task including a final no-tool completion turn, interrupted attempts count; max 2 repair rounds per investigation, no task/turn counter reset; verifier separately enforces 3 attempts per run/account as frozen F6. Source investigation has the same task/repair limits, preventing a company-level loophole. Max 20 outstanding investigation requests per task; requests are not tasks until coordinator delegates within budget.

The coordinator chooses actual investigation queries/dependencies/tasks based on tool results. No runtime fixed sequence predetermines all findings or inserts a final artifact. A deterministic harness may script decisions to exercise branches, but cannot satisfy T4.2 model competence. Scheduler validates dependency IDs same-run, no cycles, no self-dependency, all required predecessors succeeded before dispatch. Succeeded predecessors are immutable; failed/interrupted dependencies leave tasks waiting with blocker, not silently skipped.

`attempt` is dispatched model-call count, `revision` is optimistic-lock version for task row, `toolRounds` increments before accepting a tool-bearing result, and repairRound binds the task to the current investigation attempt. Budgets reserved durably before the corresponding call/publication; rejected or malformed outputs consume their call attempt and known usage. Budget exhaustion sets task status `failed`, publishes existing `task.blocked` with run blocked and exact limit/counter; dependency waits use `waiting`, not a new undeclared task status. No unlimited new helper tasks/retries. Reviewer resume does not raise limits. Higher limits are a later operator policy revision/new run, not a model tool.

**Single control supervisor with fail-stop ownership fencing:** one dedicated PostgreSQL connection holds a session advisory lock for the discovery scheduler. All new dispatch/tool claims and scheduler completion/state transactions execute on that **same lock-owning connection**, serialized locally; ordinary pool connections may serve authorized reviewer reads/actions but cannot perform scheduler claims/completions. No reconnect/retry through `withTransaction(pool,...)` may substitute another connection for a failed supervisor transaction. Loss/error/end of the owner connection immediately invalidates its local owner token, stops new calls/claims/completions, and aborts adapters where supported. A transaction reserved before loss may already be in flight; no later callback from that owner may persist a completion through another connection.

On acquiring the lock, the replacement increments a durable singleton `discovery_supervisor.generation` in a short transaction; claims record that generation in dispatch/step rows. Scheduler mutations require the local owner token still valid and exact generation/dispatch/step fences. Under the replacement generation, unfinished old-generation claims are marked interrupted; late old results are rejected as stale (unknown usage stays explicit), never reattributed to new steps. Previously committed results remain. Reconciliation of an already started external verification request uses its original toolStepId/requestKey through the retry-safe adapter; it does not replay its side effect under a fresh key. This is local fencing, not a claim to cancel an unreachable remote provider.

In-process 4-slot semaphore spans all runs and releases only when an invocation settles. No ordinary transaction or row lock spans model/evidence/blob/evaluator I/O. Reviewer pause is still serialized by the run lock against scheduler claims. On shutdown stop claims and drain/mark interrupted. Additional processes may serve reads but cannot dispatch. No live remote concurrency guarantee after uncertain process death is claimed; T4.2 owns provider cancellation/reconciliation. **Barrier test:** lose owner connection while a scripted call waits, acquire replacement lock/generation on another connection, then release the old result; old process must create zero new claims/results, replacement preserves completed steps and marks old pending step interrupted. An ordinary old pool connection remaining healthy cannot bypass the fence.

**New control tables (A authors, B reserves/reviews migration number):**

- `discovery_runs`: binding, schemaVersion/mode/modelId/policy, reviewerId, status/revision, usage counters, unique start idempotency key+actor.
- `discovery_supervisor`: singleton monotonic generation; increment only by new lock-owning supervisor; generation fenced in every claim/completion.
- `discovery_investigations`: run/subject unique, specialist/repair counters and current blockers.
- `discovery_tasks`: run/investigation/role, bounded question, dependency edges, status/revision/attempt/round counters.
- `discovery_dispatches`: unique dispatchId, task+attempt unique, supervisor generation/fence revision, status (`reserved|returned|interrupted`), known usage/providerCallId, bounded validated pending tool calls. Raw model message/hidden reasoning excluded.
- `discovery_tool_steps`: server toolStepId primary key; unique `(dispatchId,providerToolCallId)` and `(dispatchId,ordinal)`; run/task/dispatch FKs, name, canonical input hash, supervisor generation, state (`pending|running|succeeded|failed|interrupted`), safe result refs/diagnostics. Same mapped native ID/different name or args conflicts. Preserve historical attempts.
- `discovery_findings`: append-only `(run,id,revision)` with exact source-scoped payload; current revision managed under run/task lock.
- `discovery_proposals`: append-only `(run,id,revision)` structured content or content-addressed blob hash, server-derived investigation bindings and consumed finding revision set, compile/replay/verification links and stale marker.
- `discovery_blockers` / `discovery_proposal_assessments`: durable run/investigation blocker origin refs and unresolved status; append-only assessment revisions with exact applicable blocker refs and observed run revision. Models cannot delete/resolve entries or supply assessment rows. Update heads/stale links transactionally with finding publication.
- `discovery_actions`: unique reviewer/run/idempotency action+body hash+stored response.

Use FKs/checks/unique constraints to enforce identities, scope and counters; grants only required app SELECT/INSERT/bounded UPDATE. Preserve past finding/proposal payloads; mutation of current status cannot change their hashes. A can reserve planned `005_discovery.sql` only after B confirms migration allocation; do not edit applied 001–003 or assume 004 is free.

**Transaction flow:**

1. Lock run → investigation → task (consistent order), check not paused/terminal, dependencies, revision/budget. Reserve dispatch with unique attempt, increment counters, update task/run revision, `publishActivity(task.started)` in same transaction. Commit, then call model outside transaction.
2. Validate model result outside transaction; on the still lock-owning supervisor connection, lock the same rows, fence by generation/exact dispatch/current task state, atomically map native tool IDs to server toolStepIds, store result/usage/pending steps, publish allowed summary, commit. Pause does not erase accounting. Duplicate response for same dispatch must match result hash or conflicts. Ownership loss takes the interrupted path; no completion on an ordinary pool connection.
3. For pure read tool: claim unique step in short transaction only if run running; external immutable read; commit bounded result refs + tool result activity. On interruption safe to re-read immutable content; no finding/candidate writes repeated.
4. For control-state tools (findings/delegation/draft/repair): tool step claim/result, append revision/counters, update server-owned blocker/assessment heads and stale links, and `publishActivity` happen in **one** transaction. Re-delivery of toolStepId returns saved result, not another revision/task. Invalid expected revision returns `FINDING_REVISION_CONFLICT` / `PROPOSAL_REVISION_CONFLICT`, never a last-write-wins overwrite.
5. Compile/replay is pure computation outside DB transaction over pinned input; persist result only after checking proposal/finding/run/assessment revisions and recomputing the independent blocker set. Registry file writes/registration happen outside discovery transaction and are repeat-safe under existing immutable keys. On restart reconcile exact registered artifact before retry; a registered historical artifact cannot override a stale or blocked current assessment.
6. Verification is an external asynchronous side effect and uses the explicit durable idempotency dependency below. A process death after enqueue cannot justify enqueueing again without finding the existing key/job. Tool success records the job ref, not “verified.” Poll job independently; publish safe completion event only for the exact retained binding.
7. On supervisor restart mark in-flight dispatches/tasks interrupted in one transaction and emit state summary. Completed tools/revisions remain; pending safe read/compile steps resume only under bounds. Unknown provider outcomes or non-idempotent verification state block rather than guess. Graph completion is a server state transition with assertions, not parsing the assistant's word “done.”

Persist tool `called` before dispatch, `result` with outcome, and state publications with state updates. External I/O cannot be rolled back; fencing and idempotency are required rather than a claim of cross-system atomicity. Source/model content never becomes SQL or executable code. Worker/runtime packages get no discovery import, model dependency/config/credential, or source of agent-authored authority.

## 6. Activity/SSE and a small truthful monitor

**Do not pretend the full frozen `/api/events` exists.** Its composite cursor covers actual control and runtime streams; current worker only offers health. T4.1 needs control activity, so propose an additive run-scoped projection, subject to B/root acceptance:

```ts
type DiscoveryCursorV1 = {v:1; runId:Id; controlCursor:number};
GET /api/discovery/runs/:runId/events/cursor
// 200 {cursor:string}; canonical unpadded base64url JSON of DiscoveryCursorV1
GET /api/discovery/runs/:runId/events?after=<cursor>
// SSE event: activity; id:<cursor after event>; data:<existing ActivityEvent>
```

This is the existing `control` activity table/counter projected by authorized runId, not another event store or invented runtime state. Full F7 `/api/events` remains a separate B worker-read bridge dependency. Cursor decoding has max1024 bytes, canonical round trip, correct run ID, safe numeric position, no extra keys; reject future cursors. Omitted after =0; explicit query wins over Last-Event-ID. The endpoint never emits other-run or runtime events. Runtime cursor is absent, not hardcoded zero.

**R3 bounded continuation contract:** B adds `readControlActivityPage({after,limit,runId}) -> {events,highWater,retainedAfter,nextAfter,hasMore}`; `limit` is 1..1000. Acquire high-water `H` and retention floor `F` and select the page from **one SQL statement/MVCC snapshot**, with explicit `after < sequence <= H`, runId filter, ascending sequence, and `limit + 1` matching rows to prove exhaustion. No unbounded second query may return events beyond H. `retainedAfter=F` means all sequences **greater than F** are retained; `after===F` is valid, `after<F` requires resync, and `after>H` is invalid. Initially F=0 with no pruning; do not invent an unsupported retention job. Any future pruning must atomically record its floor and be observed coherently with H/page.

Return at most limit events. If a matching lookahead row exists, set `hasMore:true` and `nextAfter` to the last returned event sequence, never H. If no lookahead exists, exhaustion through H is proven: set `hasMore:false,nextAfter:H`, including an empty run projection. All returned sequences are within `(after,H]`, and nextAfter is monotonic and never exceeds H. Filtering unrelated rows is safe only under this exhaustion rule. A continuation read may capture a newer H, but starts at the previous safe nextAfter; it cannot skip the unfinished suffix. Do not change the persisted sequence.

SSE emits each activity ID at that emitted event's exact sequence; the internal scan position can advance to page.nextAfter only after all returned events were sent. The standalone cursor endpoint's H is used for initial/resync state acquisition, **never to advance an unfinished replay page**. Empty-projection progress may remain internal; disconnect may rescan unrelated rows harmlessly. Heartbeats are comments, not synthetic events/checkpoints. Unknown/future/malformed cursor400 `CURSOR_INVALID`; `after<F` gives409 `RESYNC_REQUIRED`. After headers, replay/storage/session failure emits `resync_required` and closes.

**R3 examples/tests:** with sequences `1:A,2:B,3:A,4:A`, run A and limit1, H=4: page1 emits1/next1/more; page2 emits3/next3/more; page3 emits4/next4/exhausted. For run C absent through H=4, page is empty/next4/exhausted. For 101 run events and limit100, first next is event100 with hasMore true; event101 remains for the next page. Publish event5 after the page statement snapshot/barrier is acquired: it cannot appear in the H=4 page and is delivered by the next read. Floor F=2 accepts after2 and rejects after1. Add disconnect after each page's first emitted event and prove no skipped committed event; use barriers, not sleeps.

Reuse F7 resync sequence: **get high-water cursor first, fetch state second, reconnect third**. Deduplicate `(stream,sequence)`. Events invalidate/refetch state; don't increment totals from both state and events. A refetch version older than displayed revision is ignored. Current `local-session.ts` stores sessions in process memory and has **no expiry timestamp**. Before cursor/state/historical finding/proposal/tool reads and before every SSE page poll, call the actual reviewer authorizer and check current run source grant. On authorization failure close transport with the supported error path; process shutdown closes streams and loses sessions. Bound each SSE transport to 60 seconds with a normal reconnect from the last delivered cursor, a transport policy rather than a claimed session TTL. After process restart the browser handles the actual 401 by opening a new local session. Tests invalidate/restart the real session service or inject an authorizer rejection; do not test fictitious expiresAt fields. SSE uses existing same-origin HttpOnly cookie, not credentials in URLs.

Activity allowlist additions B reviews: `discovery.started`, `discovery.paused`, `discovery.resumed`, `discovery.blocked`, `discovery.completed`, `discovery.interrupted`; existing task/tool/finding/artifact types reused. Payload allowlist gets only needed IDs/revisions/mode/counters (`proposalId`, `proposalRevision`, `findingRevision`, `taskRevision`, `dispatchId`, `toolStepId`, `inputTokens`, `outputTokens`, `modelCalls`, `unknownUsageCalls`, `repairRound`, `toolRounds`). No model prompt/response, questions containing full source documents, secrets, paths, hidden answer fields, arbitrary diagnostics, or reviewer tokens. Durable state may retain bounded explicit task questions/structured findings/proposals; activity remains a narrow summary.

C adds one existing-style Agents nav/page, not a dashboard framework. A source/manifest selector uses existing authorized dossiers; capability response governs start availability. Unconfigured page says “Live discovery is not configured”; no fake running timeline. Scripted test harness page prominently says “Scripted orchestration test — live construction pending.” Each actual task row shows role, question, state, rounds/budget blockers; inspector shows real recorded tool names/outcomes and authorized evidence links. Show generated proposal versions/compilation, exact independent verification separately, token usage and cost unavailable. Pause/resume only real backed actions. No chain-of-thought, fabricated collaboration messages, percentage progress, animated agent chatter, or implicit approval. Distinct legal entities/profiles retain their IDs.

## 7. Exact implementation ownership and ordered vertical slices

### V4a — B: contract and durable activity read primitives

**Own:** `packages/contracts/src/discovery.ts`, exports in `index.ts`, optional invariant-preserving factoring in `model.ts`; `packages/contracts/test/discovery.test.ts`; `packages/storage/src/activity.ts`, `packages/storage/test/discovery-activity.test.ts`; B composition/root workspace registration only when an A package exists. No source-coverage edits.

- Red schema: reject structurally inconsistent binding/grant fields, forbidden disposition literals, invalid bounded model output, v1 callId-only transcript results, mismatched dispatch, duplicate dependencies/citations/keys, future/wrong-run cursor. A syntactically valid forged grant can pass schema validation; actual authorization and capture membership tests belong to V4b/V4c. `toVerificationTaskContext` is a representation projection, never an authorization function. V1 schemas and absent-/present-bootstrap hash behavior remain unchanged.
- Red DB: committed sequence barriers, rollback, R3 limit1/interleaved/empty/101-event pages, coherent high-water/floor and publication-after-barrier, redacted payloads. Existing F7 concurrency tests stay authoritative.
- Implement strict v2 schemas and `readControlActivityPage({after,limit,runId})` + high-water read. Run focused contract/storage unit/integration tests and typecheck. Publish exact exported schemas and examples to A/C before consumers.

### V4b — A: persisted run/delegation/pause with actual scripted model turns

**Own:** new `packages/discovery/package.json`; `src/{model,coordinator,roles,tasks,budgets,repository}.ts`; tests under `packages/discovery/test/`; assigned `db/control/005_discovery.sql` after B reservation; `apps/control/src/routes/discovery.ts`; `tests/integration/v4-agent-tools.test.ts`. B registers workspace/composition. Scripted adapter belongs in test fixtures, not production exports/default startup.

- Red: authenticated start binds complete capture and idempotency; wrong source/manifest/no CSRF fails; syntactically valid forged context/grant or v2-to-v1 projection without the persisted dispatcher capability fails; start without ModelClient fails503 without fake task; model-chosen delegation yields persisted graph; malicious model cannot add grant/role/tool; 4 simultaneous calls across two runs, task/round/repair exhaustion blocks; DAG cycles fail.
- Red with deterministic barriers: pause commit before tool claim prevents side effect; pause during model call retains accounting/pending work; R1 repeated native call IDs across turns/tasks remain separate, exact toolStepId replay executes once; stale finding/task revision cannot overwrite; supervisor owner-connection loss and replacement generation reject old claims/results despite healthy ordinary pool. Restart retains succeeded steps and marks in-flight interrupted. No sleeps as correctness evidence.
- Implement repository, bounded scheduler and per-role tool dispatcher; initially read-only tools and delegation only, unsupported construction tools return `TOOL_UNAVAILABLE`, never a fake success. This slice proves run lifecycle, not connector construction or full T4.1.
- Checks: `npm run test:unit -- packages/discovery/test`; `npm run test:integration -- tests/integration/v4-agent-tools.test.ts`; `npm run typecheck`. Scoped commit after review; evidence labeled partial.

### V4c — A source/compiler orchestration; B contract review: genuine structured proposal path

**Own A:** `packages/discovery/src/{tools,source-tools,findings,proposals}.ts`, extend task integration test. If needed `packages/sources/src/discovery-reads.ts` + tests for scoped bounded capture reads; source service exports. **B owns** any compiler shared interface changes (prefer none), root composition registration and trusted registry injection.

- Red: source-wide identity read before parent identity exists; wrong-company/manifest citation rejected; account-limited document withheld; prompt injection cannot invoke shell/upload/activation; raw evidence remains accessible independent of coverage parser; unknown remittance remains unresolved.
- Red: finding revision CAS and DAG references; forged confirmed material fact fails; contradictory term omitted from draft/revise refs, re-delegated under a new same-account task/investigation attempt, or revised to agent-supported still blocks current compile/finish through server assessment; source-wide/unknown-applicability blockers remain; concurrent finding publication stales compile. Actual model tool JSON with unsupported mapping produces compiler diagnostics; changed evidence-selected field/amount yields changed proposal/hash or correct block, not a fixed fixture artifact. Reject imports/reads of final development artifacts in discovery production path.
- Red: model-submitted same-name/different-source-account profiles remain separate; unsupported amendment/mixed revision remains blocked by existing behavior; sandbox replay uses complete snapshot and only isolated target, all parent ledgers/activity unchanged; stale finding/proposal cannot publish current artifact.
- Implement actual structured draft/revise/compile/replay/compare tools using existing contracts/compiler/registry. Persist original model-proposed content and diagnostics; never fill a financial semantic gap with canned code. Candidate registration alone does not assert evidence support or eligibility.

### V4d — C evaluator adapter + A tool: retry-safe protected verification

**Dependency owned by C:** `packages/evaluator/src/jobs.ts` and `tests/integration/v4-verification-idempotency.test.ts`; new uniquely reserved control migration (B assigns after discovery/review migrations), adding durable request key/result binding. Preserve existing reviewer enqueue wire.

Proposed injected API:

```ts
enqueueDiscoveryVerification({
  requestKey: Id, // exactly server toolStepId from §2; never native call ID/model input
  candidate: CandidateRegistration,
  task: {runId:Id,accountId:Id},
}): Promise<VerificationJob>
```

Unique request key bound to canonical artifact/profile/manifest/task subject; same key same subject returns the existing job; changed subject409. Reserve job and frozen run/account attempt budget **once in one transaction**. Resolve/launch evaluator outside transaction. Recovery can find queued/running job by key; if recovery of an uncertain launcher isn't supported, expose failed/interrupted diagnostics and do not enqueue a second attempt implicitly. No truth/runner/pin selection in tool input. Publish completion summaries with exact subject binding, never hidden expected outputs. B reviews migration and budget behavior.

A integrates `requestVerification/readVerification` only after C publishes this API. Until then tool schema can be omitted or return explicit `TOOL_UNAVAILABLE` (and UI shows why); no 3-attempt consumption through speculative retry. Verify the proposal's exact one-profile artifact because current task enqueue requires one account. A multi-customer run remains a collection of separately compiled/registered/verified customer proposals sharing a reusable company spec. Never take one profile out of a registered multi-profile artifact and pass it to this verifier as if its subject were unchanged; multi-profile proposal support is outside this initial wire.

Red: crash after job reservation before tool result, replay same toolStepId consumes one attempt, same providerToolCallId in a different dispatch has a different request key, conflicting request key, concurrent repair requests at attempt3, wrong task/account/source, forged eligible report, unavailable mandatory case, bootstrap-bearing profile remains evidence-support unavailable/activation blocked, and no hidden truth in model/tool/activity. Existing `jobs.enqueue` behavior remains covered; no blanket rewrite of evaluator.

### V4e — A SSE route + C bounded monitor; B composition

**Own A:** `apps/control/src/routes/events.ts` exports the run-scoped control stream plugin using B read primitives. **Own C:** `packages/client/src/{discovery,discovery-events}.ts`, client tests, `apps/web/src/features/agents/{AgentPage,TaskTimeline,ToolInspector}.tsx`, one small `App.tsx` nav integration, existing-style feature CSS, `tests/e2e/v4-monitor.spec.ts`. **Own B:** composition files mount injected plugins/services; no browser provider credentials.

- Red: disconnect/reconnect sees all committed same-run events once, including bounded pages/counter-lock concurrency; wrong-run cursor fails; resync captures high-water before refetch and replays events committed during it; standalone cursor cannot skip unfinished replay; late older state cannot roll back UI; real process-local session loss/authorizer rejection closes the stream, rebootstrap handles401, bounded transport reconnect retains cursor (no invented session expiry metadata).
- Red: browser uses actual scripted model-generated task/proposal rows from integration harness, shows mode/test provenance, real blockers/token counts/cost unavailable, opens original evidence; no loaded-fixture progress, no live-provider claim, no fabricated ready/active state.
- Red: pause/resume persists through refresh and does not duplicate tasks/findings; model absent yields pending setup and no phantom start; selected account/profile change clears stale proposal/report links.
- Checks: focused client/discovery tests, `npm run test:integration -- tests/integration/v4-agent-tools.test.ts tests/integration/v4-verification-idempotency.test.ts`, `npm run test:e2e -- tests/e2e/v4-monitor.spec.ts`, typecheck. Full V4 remains pending until T4.2 live tests exist and pass. Do not change verifier registry so missing live tests count as success.

Each slice can be reviewed/rejected independently. B→A lifecycle may proceed before evaluator adapter; UI must not present absent tools as working. T4.1 construction completion requires V4c; its verification-tool completion requires V4d. Root controls exact candidate integration and independent review. No approval request for routine implementation choices; root review here is the requested architecture gate, not a new user product gate.

## 8. Precise gaps and limits to carry forward

1. **Generated proposal parent scope versus verifier capability:** local session currently grants only development candidate `allowedAccountIds`. Source-wide investigation is already authorized, but a generated second/third account cannot acquire verifier/preview permission by naming itself. For T4.1 verify only existing trusted allowed candidate scopes; other proposals remain inspectable/blocked with `VERIFICATION_SCOPE_REQUIRED`. Before genuine multi-account V4 verification, B/A/C must locate or specify how source-bound proposed parent IDs receive *read/verification-only* capabilities without identity approval. Do not broaden activation authority. This is an interface/authorization gap, not an instruction to invent parent identities.
2. **Material pending finding into existing profile:** current compiler requires confirmed supported material `Finding`s; discovery cannot confirm them. Keep pending findings as sidecars and preserve compiler refusals. If a later workflow needs to convert them into profile findings or establish parent IDs, route through the specified evidence-backed reviewer input workflow; do not loosen `profileDiagnostics` or auto-confirm. The exact reviewer conversion API is not implemented here.
3. **Historical/amended revision span:** account 2 mixed `sem-a-1/sem-a-2` needs A/B authoritative supported representation. No change to contract or monetary semantics in T4.1; retain diagnostic until resolved. Material absence must be raised to user by root after owner specification search.
4. **Full composite activity feed:** this proposal's control-only route is an explicit additive scope choice. Frozen `/api/events` still needs a real worker-authorized activity read bridge and dual-stream cursor implementation. Do not advertise it as completed by the subset route.
5. **Live provider lifecycle/pricing:** T4.2 must configure real model ID/provider, cancellation/unknown-call recovery, tokenizer/token caps and actual usage; missing configuration is pending, never scripted substitution. No provider/API keys or live calls are required or requested for T4.1.
6. **Present bootstrap requires a separate independent gate:** `CustomerProfileDraft = Omit<current CustomerProfile,'hash'>` includes current optional `bootstrap` and its cross-field refinements; do not reconstruct a pre-addendum profile shape. Use current `hashProfile`: absent/undefined bootstrap preserves old preimages, present bootstrap participates in the exact subject hash. At this baseline `evidence-support.ts` returns `unavailable` for a bootstrap-bearing profile; the unchanged thirteen financial checks cannot establish customer/account/configuration correctness, review readiness, or activation. Preserve the bootstrap-bearing draft and unavailable result; do not strip bootstrap or reinterpret a financial-only eligible report to bypass it. The addendum's separately frozen independent bootstrap assertion result/runner/build/subject/manifest bindings must exist and pass before review readiness/activation. V4a adds no new check vocabulary, protected assertion, or bootstrap proof. Tests cover absent-bootstrap hash compatibility and present-bootstrap preserved hash/unavailability, not fabricated success.

Routine choices above (route naming, bounded resource values, explicit v2 sidecars, immutable IDs, scoped monitor projection) are proposed for B/root review against the existing specifications. None introduces new financial behavior or enrolls a customer. The final live acceptance still requires genuine source-driven artifacts and independently checked results for both sources, followed separately by explicit per-customer activation and AI-free runtime proof.
