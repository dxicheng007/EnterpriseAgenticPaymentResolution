# Implementation contracts and repository map

**Status:** Planned interfaces, not existing code. Read with `prdv2.md` and the implementation plan. All paths below are repository-relative.

## Operating decisions

- Three lanes A/B/C are the user's Codex agent workstreams, not three separate human approval authorities. One integrator controls shared-contract changes and merges. Product agents inside the application are a different concept.
- Node 24 LTS, npm workspaces, TypeScript strict mode, React/Vite, Fastify, Zod, `pg`, PostgreSQL 18, Vitest, Playwright. Pin current compatible patch releases at bootstrap, record them in the lockfile, and use a pinned PostgreSQL image digest for rehearsal. These are implementation choices within PRD defaults.
- Use explicit SQL migrations and small repositories, not a new ORM. Transactions use a checked-out `pg.PoolClient`; no `pool.query` across transaction statements.
- One local PostgreSQL instance, separate `control` and `runtime` databases and service roles. Shared-contract tests do not require database access; database integration tests require actual PostgreSQL and fail clearly if it is unavailable.
- Default ports: web 5173, control 3001, worker 3002, PostgreSQL 5432. Every port/database pair is configurable per worktree. The final integrated demo uses the defaults.
- Bind HTTP/DB services to localhost. Runtime launch strips model keys and receives only its database URL, source allowlist, registry path, and local service token. Model access belongs solely to the control process.
- Raw files and model-produced artifacts are immutable local content-addressed files, with hashes/metadata in PostgreSQL. Do not serve fixture truth or filesystem paths outside the approved evidence root.

## File ownership

```text
apps/
  control/src/server.ts              # B: server composition; A/C export feature plugins
  control/src/routes/                # A: sources/discovery; C: review/connections proxy
  worker/src/server.ts               # B: worker HTTP API and scheduler
  web/src/features/
    health/ sources/ preview/ review/ agents/ connections/  # C
packages/
  contracts/src/                     # B/integrator: Zod schemas + inferred TS types
  storage/src/                       # B: pooled clients, tx helpers, repositories
  sources/src/                       # A: mock APIs, uploads, manifest/read adapters
  evidence/src/                      # A: immutable files, citations, search
  discovery/src/                     # A: product roles, tool registry, model adapter
  compiler/src/                      # B: restricted DSL -> normalized artifact
  finance/src/                       # B: supported monetary/relationship validation
  runtime/src/                       # B: bootstrap, capture, apply, hold, checkpoint
  parent/src/                        # B: target read/write projections within runtime DB
  client/src/                        # C: browser/control typed client
  evaluator/src/                     # C: independent harness; no imports from finance
db/control/ db/runtime/              # B coordinates; task owns its reserved new migration
infra/                              # B: Compose and role/bootstrap scripts
scripts/                            # B: lifecycle/verification; A: generator; C: rehearsal
fixtures/visible/                    # A: exposed synthetic inputs
fixtures/truth/                      # A: generator output; evaluator-only at runtime
tests/fixtures/                      # shared public development examples and fakes
tests/integration/                   # slice owner; real PostgreSQL/API assertions
tests/e2e/                          # C: browser tests
tests/live/                         # A/C: genuine model runs, opt-in command
```

Only B/integrator changes root `package.json`, lockfile, base TS/test configuration, shared contracts, existing migrations, and composition files. A task owner may author the new uniquely numbered migration explicitly reserved in that task; B reviews its schema and integration before merge. Never edit an already-applied migration. A/C request interface changes with an example and consumer impact. Bootstrap creates the agreed dependency set once, so subsequent work does not constantly edit the lockfile. Each feature gets its own UI file and route plugin; registering a plugin is a small integrator change.

## Shared type vocabulary

Implement schemas in `packages/contracts/src/{common,source,evidence,connector,review,runtime,activity}.ts`, then export from `index.ts`. Unknown input keys are rejected for executable plans and mutation commands. Raw source payloads remain JSON and are validated against the pinned source contract before transformation.

- `Id`, `Hash`, `IsoInstant`, `IsoDate`, `Cursor` are validated strings. Hashes are SHA-256 of canonical JSON/bytes. Cursor strings have transport-specific ordering; do not compare arbitrary opaque strings lexicographically.
- `MoneyCents` is a safe integer number in TypeScript/JSON and `BIGINT` in PostgreSQL. Parse DB strings explicitly, reject outside `Number.isSafeInteger`, and apply the stricter approved transaction limit of 5,000,000 cents. Account aggregates may exceed a transaction limit but must remain safe integers. Never use floating-point decimal multiplication to parse source money.
- `Scope = { companyId: Id; sellerEntityId: Id; accountId: Id }`. Account IDs include seller scope; customer canonical identity can be shared without merging accounts.
- `Diagnostic = { code: string; severity: 'blocker'|'warning'; message: string; sourceIds: Id[]; fieldPaths: string[] }`.
- `Result<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] }` for compiler/validation operations; HTTP mutation conflicts use typed errors and status codes below.

### Source and evidence

`SourceEvent` fields: `id`, `sourceRef`, `streamId`, `sequence` (positive safe integer for mocks), `recordId`, `recordVersion`, `scope`, `kind` (`invoice|payment|credit|allocation|reversal|semantic_change`), `effectiveAt`, `observedAt`, `schemaVersion`, `semanticVersion`, `contentHash`, `payload` (JSON object). Unknown runtime source account IDs are represented in the raw payload/envelope and must not be assigned to a guessed approved scope.

`ChangePage = { streamId: Id; after: Cursor; next: Cursor; complete: boolean; events: SourceEvent[] }`. Only a complete captured page can advance its cursor. Reject conflicting duplicate IDs/content hashes. An empty page may retain `after`; a nonempty page must advance under the adapter's cursor semantics.

`BootstrapManifest` fields: `id`, `companyId`, `epoch`, `asOf`, `schemaVersions` (resource-to-version map), `semanticVersions` (account-to-version map), `streams` (array of `{streamId,snapshotId,resumeAfter}`), `files` (array of `{batchId,sequence,sha256}`), `hash`. All members are pinned; a missing/changed member blocks review.

`SourceSnapshot = { id; manifestId; sourceRef; capturedAt; contentHash; evidenceIds: Id[]; eventIds: Id[] }`.

`EvidenceRef = { id; snapshotId; sourceId; locator: PdfLocator|CsvLocator|JsonLocator|EmailLocator; excerpt; sha256 }`. Locator variants are `{kind:'pdf',page,start,end}`, `{kind:'csv',row,column}`, `{kind:'json',pointer}`, `{kind:'email',messageId,start,end}`. Use 1-based page/row numbers and offsets into stored extracted text. Missing or out-of-range citations are errors, not empty strings.

`Finding` fields: `id`, `scope`, `taskId`, `fieldPath`, `value` (JSON), `origin` (`agent|deterministic|reviewer`), `provenanceClass` (`observed|derived|inferred|unresolved`), `evidenceStatus` (`supported|contradicted|insufficient`), `reviewDisposition` (`pending|confirmed|rejected`), `evidenceRefs: Id[]`, `derivationInputs: Id[]`, `revision`, `supersedesId?`.

### Connector and finance

`MappingOp` is a discriminated union: `field(path)`, `constant(value,evidenceRef)`, `decimal_to_minor(path,scale:2)`, `date_parse(path,format,timezone:'UTC')`, `enum_lookup(path,values)`, `approved_lookup(path,tableId)`, `existing_invoice_lookup(path)`, `normalize_text(path,mode:'trim'|'lower')`, `effective_term(contractId,datePath)`. Reject unknown operations, prototype keys, unknown lookups, and cyclic mapping dependencies.

`ConnectorSpec` fields: `id`, `version`, `sourceRef`, `targetSchemaVersion:'1'`, `sourceContracts` (reviewed schemas/units/versions by resource), `capture` (stream resource references/cursor strategy), `mappings` (target entity/field -> `MappingOp`), `requiredValidators: string[]`, `allowedKinds`, `maxTransactionCents:5000000`, `maxRecordsPerCycle:1000`, `evidenceRefs: Id[]`, `runtimeModelCalls:'forbidden'`. Do not trust `requiredValidators` to omit mandatory platform rules; the compiler adds/enforces the mandatory set.

`CustomerProfile` fields: `id`, `version`, `hash`, `scope`, `parentCustomerId`, `sourceAccountIds`, `approvedLookups`, `contractTerms` (effective intervals, fixed monthly fee, USD, cadence/anchor, evidence), `semanticVersion`, `findings: Finding[]`.

`CompiledArtifact` fields: `id`, `sourceRef`, `hash`, `specHash`, `compilerVersion:'1'`, `runtimeVersion:'1'`, `targetSchemaVersion:'1'`, `normalizedPlan`, `sourceContractHashes`, `requiredProfileHashes`. Canonical hashing excludes timestamps and generated artifact IDs; changing executable semantics changes the hash. Hashes detect change, not provenance/authenticity; registry/approval checks establish permitted use.

`TargetState` contains a `version`, account-scoped invoices/payments/credits/allocations/full reversals, and parent identity/contract/billing configuration records. Financial records retain sourceRef+seller+record-kind+recordId as economic identity. Events also have eventId/version for delivery deduplication. Updating recordVersion alone must never create a new monetary transaction.

`MutationPlan = { hash; scope; artifactHash; profileHash; expectedTargetVersion; eventIds; operations; expectedBalanceCents; lineage }`. Allowed operations are insert existing source financial record, add explicit allocation, full reverse a source payment/credit, and insert/reuse parent reference/configuration during bootstrap. No arbitrary target field update or invoice-issuance operation.

`PlanOutcome = { plans: MutationPlan[]; holds: Hold[] }`; `Hold = { eventIds; scope?: Scope; code; dependencies: Id[]; diagnostics: Diagnostic[] }`. Unscoped failures pause the relevant source rather than a guessed account.

### Review and runtime

`VerificationReport` fields: `id`, `artifactHash`, `profileHashes`, `manifestHash`, `harnessVersion`, `checks` (stable test IDs with pass/fail), `coverage`, `unexplainedDifferenceCents`, `eligible`, `createdAt`. Eligibility requires a registry-issued report; agents cannot submit an arbitrary passing report.

`ReviewPackage` fields: `id`, `revision`, `hash`, `scope`, `artifactHash`, `profileHash`, `manifestHash`, `verificationReportId`, `previewPlanHash`, `expectedTargetVersion`, `diagnostics`, `ready`. Any relevant candidate revision changes package hash. Preview records are not parent writes.

`ActivationRequest = { reviewPackageId; expectedPackageHash; expectedArtifactHash; expectedProfileHash; expectedTargetVersion; idempotencyKey }`. Reviewer identity comes from a server-managed local demo session, never an agent-authored body field. The mock UI labels this identity as demo-only.

`CustomerActivation` fields: `id`, `scope`, `artifactHash`, `profileHash`, `manifestHash`, `baselineCursors`, `allowedKinds`, `limits`, `reviewerId`, `epoch`, `status:'active'|'paused'|'revoked'`, `approvedAt`.

`SyncReceipt` fields: `id`, `scope`, `activationId`, `epoch`, `artifactHash`, `planHash`, `eventIds`, `targetRecordIds`, `beforeBalanceCents`, `afterBalanceCents`, `status:'applied'|'replayed'`, `committedAt`. Store one authoritative receipt for a successful operation; repeated delivery returns that receipt with a replay response marker.

`ConnectionState` fields: `scope`, `status:'inactive'|'active'|'paused'|'revoked'`, `artifactHash?`, `epoch`, per-stream captured cursors, pending/applied/quarantined counts, contiguous application positions and gaps, current/as-of balances, lastReceiptId, lastError, `runtimeModelCalls:0` backed by isolation tests. Unenrolled accounts are inactive with no artifact/receipt; data holds are separately visible, not confused with approval status.

`ParentView = {scope,version,asOf,snapshotHash,balanceCents,records:TargetState,legacyReferences}`. Parent reads accept optional `asOf` and `snapshotHash` query parameters: one selects financial effective time, the other the historical known/approved snapshot. Default is latest known state at the current effective time. `SourceDossier = {companyId,manifestId,snapshotIds,evidenceIds,complete:boolean,missingMembers:Id[],diagnostics:Diagnostic[]}`; partial inputs remain explicitly incomplete.

### Stable public interfaces

Use these exact names from the following modules; dependencies are injected for tests, not accessed through globals.

```ts
// packages/compiler/src/compile.ts
compile(spec: ConnectorSpec, profiles: CustomerProfile[]): Result<CompiledArtifact>
// packages/compiler/src/plan-batch.ts — pure; immutable target snapshot input
planBatch(artifact: CompiledArtifact, profile: CustomerProfile,
  events: SourceEvent[], target: TargetState): PlanOutcome
// packages/finance/src/balance.ts
computeBalance(state: TargetState, asOf: IsoInstant): MoneyCents
// packages/evaluator/src/verify.ts — separate protected runner
verifyArtifact(input: {artifact: CompiledArtifact; profiles: CustomerProfile[];
  manifest: BootstrapManifest; fixtureSetId: Id}): Promise<VerificationReport>
// packages/runtime/src/activate.ts
activateCustomer(request: ActivationRequest, actor: ReviewerContext): Promise<SyncReceipt>
// packages/runtime/src/capture.ts
capturePage(page: ChangePage): Promise<{captured: number; cursor: Cursor}>
// packages/runtime/src/apply.ts
applyBatch(plan: MutationPlan, expectedEpoch: number): Promise<SyncReceipt>
// packages/runtime/src/run-cycle.ts
runCycle(sourceRef: Id): Promise<{applied: number; pending: number; quarantined: number}>
// packages/runtime/src/control.ts
setConnectionStatus(scope: Scope, status: 'paused'|'active'|'revoked',
  expectedEpoch: number, actor: ReviewerContext): Promise<CustomerActivation>
```

`ReviewerContext = { reviewerId: Id; sessionId: Id }` is constructed only by reviewer route middleware. Agent callers have a distinct `TaskContext = {runId,taskId,role,allowedSourceRefs,allowedAccountIds}`; no union that lets a task masquerade as a reviewer. Runtime routes use a separate local-service credential never exposed to product tools. Resuming a paused connection requires unchanged approved semantics; a revoked connection cannot use the resume endpoint and requires a fresh reviewed activation. Old source transactions remain deduplicated if the customer is re-enrolled.

`ProductRole = 'coordinator'|'identity'|'contract'|'receivables'|'connector'`. `ModelMessage` is a discriminated union of visible text `{kind:'text',role:'user'|'assistant',text}` and captured tool result `{kind:'tool_result',callId,name,result:JsonValue}`. `ModelTurn = {runId,taskId,role:ProductRole,instructions:string,messages:ModelMessage[],toolSchemas:JsonObject[],limits:{maxInputTokens:number,maxOutputTokens:number,timeoutMs:number}}`. `ModelResult = {providerCallId,message?:string,toolCalls:Array<{id,name,arguments:JsonObject}>,usage:{inputTokens:number,outputTokens:number},stopReason:'done'|'tool_calls'|'limit'|'error'}`. The adapter enforces configured limits before provider requests and records responses; provider-specific request shapes stay behind it.

`DiscoveryState = {id,companyId,manifestId,status:'queued'|'running'|'paused'|'blocked'|'completed'|'failed',tasks:Array<{id,role,question,dependencyIds:Id[],status,attempt,revision}>,findingIds:Id[],candidateArtifactId?:Id,modelCalls:number,inputTokens:number,outputTokens:number,diagnostics:Diagnostic[]}`. Task status is `queued|running|waiting|succeeded|failed|interrupted`. Startup marks interrupted in-flight work explicitly; resume only retries bounded idempotent steps.

### HTTP surface

Control: `GET /api/health`; `POST /api/sources/uploads`; `GET /api/sources/:companyId/dossier`; `GET /api/evidence/:id`; `POST /api/discovery/runs`; `GET /api/discovery/runs/:id`; `POST /api/discovery/runs/:id/pause|resume`; `GET /api/events?after=<cursor>`; `POST /api/connectors/preview`; `POST /api/connectors/:id/verify`; `GET /api/review/:accountId`; `POST /api/review/:accountId/corrections`; `POST /api/review/:accountId/activate`; `GET /api/connections`; `GET /api/connections/:accountId`; `POST /api/connections/:accountId/pause|resume|revoke`; `GET /api/parent/:accountId`.

Worker private: `POST /internal/activate`, `/internal/capture`, `/internal/apply`, `/internal/run-cycle`, `/internal/connections/status`; `GET /internal/connections/:accountId`, `/internal/receipts/:key`, `/internal/parent/:accountId`. Source operator injection/reset is under `/demo/*`, enabled only with `DEMO_OPERATOR_ENABLED=true` and a separate token. No agent generic HTTP tool.

Errors: 400 malformed input; 401 missing session/service credential; 403 wrong caller/capability; 409 stale version/hash or conflicting idempotency key; 422 unsupported semantics/evidence/financial blockers; 503 transient dependency unavailable. Error body `{code,message,diagnostics,correlationId}` excludes secrets and stack traces.

### Durable events and SQL responsibilities

Control tables: snapshots/manifests/files, findings/revisions, discovery tasks/tool calls, connector candidates/artifact registry, protected verification reports, review packages, reviewer actions, activity events. Runtime tables: activations, inbox, capture checkpoints, target entities, allocations/reversals, applied identities, receipts, runtime activity events. Keep control mirrors non-authoritative.

Normalize unique/FK relationships needed for financial checks. All child writes validate scope against their referenced account. Never treat a normal PostgreSQL sequence ID as commit order: publish stream cursors using a per-stream sequence row locked and incremented in the same transaction as the persisted event. The SSE aggregator uses a composite `{controlCursor,runtimeCursor}` token, since separate databases have no shared atomic event sequence. Reconnect replays committed events, with client deduplication by stream+sequence.

Lock activation row first, then target account/state, then affected target rows in stable ID order. All apply/revoke/version-switch paths use the same order. On a new activation, use a unique scope key plus transactional insert-or-lock to serialize concurrent first approvals. Capture uses a stream checkpoint lock and conditional cursor advance; it never acquires account locks. Retry SQLSTATE `40001`/`40P01` at most three whole-transaction attempts with bounded jitter; network fetch/model calls occur before the transaction.

## Test interfaces and fixtures

Define helpers in `tests/fixtures/index.ts`: `scopeA`, `scopeB`, `baselineA` (300000 invoice, 200000 allocation, 20000 credit -> 80000 outstanding), `latePaymentA` (30000 -> 50000), `afterLatePaymentA` (the resulting target state with explicit allocation), `validSpecA`, `profileA`, `baselineManifestA`, `validSpecB`, `profileB`, `baselineManifestB`, `renamedSchemaA`, `invoiceBeforePaymentVariant`, `ambiguousRemittanceB`. Fixture specs are labeled development-only. Live model tests must generate their own artifact from visible sources.

`tests/fixtures/harness.ts` exports `createTestSystem({modelMode:'stub'|'disabled'|'live', dbNamespace, failpoint?})`, returning `{control,worker,sourceAdmin,db,close}`. `control`/`worker` expose typed HTTP clients, `sourceAdmin` is operator-only, and `db` supplies scoped assertion queries. Each test uses fresh database names prefixed `eapr_test_`; destructive test helpers refuse any other names. They are not imported by runtime packages.

`ActivityEvent` fields: `stream:'control'|'runtime'`, `sequence`, `phase:'build'|'run'`, `scope?`, `runId?`, `taskId?`, `role?`, `type`, `at`, `payload`. Required event types: source.captured, task.started/completed/blocked, tool.called/result, finding.revised, artifact.compiled, verification.completed, customer.activated, event.pending/quarantined, batch.applied/replayed, connection.paused/revoked. Persist before emitting; unknown cursors return typed resync instructions rather than silently dropping history.

## Official implementation references

[Node releases](https://nodejs.org/en/about/previous-releases), [node-postgres transaction client requirements](https://node-postgres.com/features/transactions), [Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/), [Vitest](https://vitest.dev/guide/), and [Playwright fixtures](https://playwright.dev/docs/test-fixtures). The plan fixes application contracts; exact compatible dependency patches are selected and locked at bootstrap.
