# B discovery L2: authenticated lifecycle and atomic delegation

Architecture/implementation handoff; no implementation approval is implied for the source prerequisite. Root accepted the source prerequisite and integrated it through `1dae289`; this replacement handoff still requires fresh scoped fix review before implementation dispatch. The narrow supervisor ownership amendment below was approved by root during this elaboration. Implement with Sol; independent exact-candidate review remains separate. No product or financial policy is added here.

## Baseline and authority

Integrated lifecycle L1 is `42bcfa6`; current main is `58387c4eb55ec5cd1c185b9c190b372b7141b054` (documentation successor to accepted source integration). Consume `v4-lifecycle-handoffs.md` L2 and its state/crash protocol, accepted orchestration proposal SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf` §§2–5, executable `docs/superpowers/plans/2026-11-08-contract-freeze-v3-discovery-shapes.md`, and current `packages/contracts/src/discovery.ts`. L1 independent review approves L1 only. Source prerequisite candidate `413d6e9783e255308cbc2e4001ae2c77a045d7f4` is now independently accepted and integrated through `1dae289`, with no API delta affecting this handoff.

Preserve all v1/shared contracts, budgets, migration004, timeout/accounting semantics, owner fencing, start/action idempotency and runtime isolation. Findings/proposals/jobs stay genuinely empty. A task may succeed; a run cannot complete without the later construction/assessment publishers. Preserve `CONSTRUCTION_UNAVAILABLE` and existing sticky lifecycle blockers.

## Ownership and missing implementation port

Original authorized L2 additions: `packages/discovery/src/{service,roles,tasks}.ts`, `apps/control/src/routes/discovery.ts`, `apps/control/src/discovery-composition.ts`, `tests/integration/v4-lifecycle-http.test.ts`; narrow plugin append/configuration in `apps/control/src/composition.ts`. Source implementation and source tests remain separately owned. No compiler, evaluator, worker, web, migration, shared wire or activity-reader edits.

**Root-approved narrow existing-file allowance:** `packages/discovery/src/supervisor.ts`, solely to advertise the real role tool schemas and execute delegation inside its private owned transaction. Current L1 `reserve` hardcodes `toolSchemas:[]`; `transact` is private; `resolveUnavailableStep` always rejects. New service/tasks files alone cannot implement atomic delegation without bypassing fencing. Do not export the raw PoolClient/transact or introduce a generic callback/tool registration facility. Import the closed dispatcher from tasks.ts into the supervisor. A named `executePendingStep(runId,taskId,toolStepId)` method is the narrow internal port; preserve existing L1 test entry points or adapt only with root-assigned test ownership. Add regression cases in the new HTTP integration file rather than requiring edits to L1 tests. Relative source imports are already used by control; a package-export change is not required. No repository edit is necessary to make the optional L1 recheck mandatory in the production service wrapper.

## Service and composition interfaces (internal only)

`createDiscoveryService` accepts `{db,clock,modelClient?,readCapture,recheckCapture,resolveAuthority}`. `readCapture` returns the accepted source reader's full facts; `recheckCapture(client,facts)` is a required SQL-only function, never optional in this interface. `resolveAuthority` has the existing L1 synchronous signature `(reviewerId,selection:{companyId,sourceRef,manifestId}) => Grants | undefined`; no I/O inside that callback. The service exposes `capabilities`, `startDiscovery`, `readState`, `pause`, `resume`, and lifecycle `close`. Route methods consume authorization returned by the real reviewer authorizer, never a body/context supplied by a model. Start/action input/output types are the executable v2 types, including schemaVersion in responses.

Composition owns the source catalog, store adapter, trusted authority closure and optional ModelClient. Routes receive service plus `authorizeReviewer(request,{mutation})`. The plugin is registered through existing featurePlugins and uses supplied `{db,clock}`. Plugin close stops scheduling and closes the owner; it cannot leave a dispatch pump running after Fastify shutdown. Default local composition supplies no ModelClient and does not acquire a supervisor merely to expose capability/read/action endpoints. A configured test composition acquires the existing dedicated supervisor and schedules eligible persisted tasks/pending ordered steps; service startup/resume wakes actual work, not fabricated task records. Poll/wake cadence is routine implementation detail; every effect still passes the supervisor's guarded owner transaction. No new public scheduler endpoint, fixture selector, provider environment option or model key.

Use the existing single reviewer configuration (`demo-reviewer`), catalog source refs, and catalog candidate account IDs as the common trusted policy inputs to session construction and resolver. Resolve sourceRef through catalog/company, never request-body sourceRef or latest manifest. Reject an unknown reviewer or company/source mismatch. Derive explicit `{companyId,sourceRef,sourceWide:true,accounts:[]}` only from the configured reviewer source grant. Copy existing parent allowedAccountIds; empty is valid. Candidate metadata supplies existing parent permissions only, not capture membership or discovery answers. Do not call buildDemoCandidate from discovery modules or inspect final artifact/verification fixtures.

Three distinct concepts must stay distinct:

1. Capture facts: immutable binding, captured raw seller/account tuples, citation IDs. They prove membership, not grants, identity resolution, customer approval or economic facts.
2. Persisted run/task grants: server-created ceilings. A child may narrow source scope; it cannot add parent account IDs or enlarge the run ceiling.
3. Current policy: the server resolver is checked at reads/actions/replay and every new scheduler claim; persisted context is not current authority. Request authorization is also required for every HTTP operation. A new process-local session for the same reviewer can access an authorized durable run; sessionId/cookie/CSRF is never persisted. No invented session expiry.

Test revocation by changing the trusted test policy closure, not by passing a model grant or adding a policy-edit HTTP API. L1 checks both the persisted run ceiling and current policy for task claims. Preserve those checks at the new tool claim, including when replaying stored results.

## Exact HTTP surface

All responses and errors are `Cache-Control: no-store`. Authenticate before parsing/exposing resource details. GET authorization uses mutation:false; POST uses mutation:true (existing session cookie, loopback origin and CSRF). Strict bodies reject extra keys, and runId uses IdSchema. Do not accept meaningful query/body selectors outside this surface.

| Route | Request | Response |
| --- | --- | --- |
| GET `/api/discovery/capabilities` | none | 200 DiscoveryCapabilitiesResponseV2 |
| POST `/api/discovery/runs` | StartDiscoveryRequestV2 `{schemaVersion:2,companyId,manifestId,idempotencyKey}` | 202 StartDiscoveryResponseV2 `{schemaVersion:2,runId}` |
| GET `/api/discovery/runs/:runId` | none | 200 DiscoveryStateV2 |
| POST `/api/discovery/runs/:runId/pause` | DiscoveryActionRequestV2 `{schemaVersion:2,expectedRevision,idempotencyKey}` | 200 saved/current state per L1 action rules |
| POST `/api/discovery/runs/:runId/resume` | same | 200 saved/current state per L1 action rules |

Do not mount findings/proposals/tool-detail/events/monitor routes yet. Capability reports unconfigured/startAvailable:false plus safe MODEL_UNAVAILABLE diagnostic with no client; scripted/startAvailable:true only for explicitly injected test client. Availability is configuration, not a provider health assertion. Reads and exact authorized replay remain possible without the client.

Use safe ApiError bodies with request correlationId, never raw SQL/provider/blob errors. Lifecycle/request errors retain the existing boundary: malformed input 400 DISCOVERY_INVALID; actual session401/403; missing references404; changed idempotency body/stale revision/capture mismatch409 DISCOVERY_CONFLICT; absent client503 MODEL_UNAVAILABLE; unavailable dependencies503. SourceError is a separate passthrough boundary: apply the accepted adapter `Object.assign(error, { statusCode: error.status })` and preserve its original status, code, safe message and safe diagnostics, adding route correlationId and no-store. In particular retain source422 SOURCE_CONTENT_INVALID / CITATION_INVALID and distinct source404/409/503 fields; do not generically rewrite source errors as discovery errors or translate422 to409. The accepted source error boundary already supplies safe fields.

Start ordering is L1's accepted ordering: authorize selected source; look up actor/key; authorize saved binding and compare canonical full request; exact replay returns stored response with zero writes, scheduling, capture reads or client requirement. Changed request conflicts after authorization. For new key require configured client before capture read, validate exact capture, then transactionally reauthorize, recheck capture, insert run/source investigation/coordinator/activity. Concurrent losers return the exact authorized winner or conflict; never substitute latest or schedule a second run. State and actions reauthorize current run source policy. Pause/resume retain L1 cross-action key namespace, CAS, saved action replay, sticky blockers and no implicit unknown-call retry.

## Source prerequisite consumption and transaction recheck

Accepted source API:

```ts
readDiscoveryCapture(
  {db,store}: {db: Pool; store: Pick<EvidenceStore,'get'>},
  catalog: ReadonlyMap<Id,SourceDefinition>,
  input: {companyId: Id; manifestId: Id},
): Promise<{
  readonly binding: DiscoveryBinding;
  readonly sourceAccounts: readonly Extract<DiscoverySubject,{kind:'source_account'}>[];
  readonly evidenceIds: readonly Id[];
}>;
```

It validates complete pinned aggregate, original bytes/hashes, streams/events/citations and dossier, returning detached sorted facts. Missing-seller raw events remain captured evidence but cannot produce a complete seller/account tuple. They stay eligible for source-wide investigation; do not invent a seller or drop their evidence. Never invoke captureBaseline/captureSnapshot to satisfy a start.

External blob reads happen before new-run transaction, with no checked-out transaction held. The accepted source reader's own post-I/O rechecks do **not** replace L2's required repository `recheckCapture` callback. The service wraps each new start with its own local captured facts, passes binding to L1 readCapture, and passes a closure over those exact facts to mandatory recheckCapture. No mutable global “last capture” variable; concurrent starts and transaction retries must not mix facts. Exact existing start replay bypasses both callbacks.

Implement SQL-only recheck in discovery-composition.ts on the actual passed PoolClient: select exact manifest and aggregate snapshot by pinned IDs, verify relational company/source/manifest identities, parse stored contracts, recompute/check manifest hash and compare both immutable binding hashes, require aggregate stream_id null, and compare pinned aggregate citation membership against validated evidenceIds. Select the exact dossier FOR SHARE (it is mutable), require matching company/manifest, complete with no missing members/blocker diagnostics, exact aggregate snapshot and evidence membership. Keep that dossier lock through run insertion. Fail before insertion on absence/mismatch. Use the exact pinned source-event membership when checking sourceAccounts for delegation; complete account tuples come only from that aggregate's validated raw records. No latest-row lookup or pool read masquerading as the client recheck.

Exact SQL fields for the composition-owned recheck (parameters come only from the validated facts/saved binding):

```sql
SELECT manifest_id, company_id, source_ref, epoch, manifest
FROM source_manifests WHERE manifest_id = $1;
SELECT snapshot_id, manifest_id, stream_id, snapshot
FROM source_snapshots WHERE snapshot_id = $1;
SELECT manifest_id, dossier FROM source_dossiers
WHERE manifest_id = $1 FOR SHARE;
SELECT source_ref, stream_id, sequence, event_id, content_hash, event,
       api_source_id, api_original_hash, api_byte_length, api_extraction
FROM source_events WHERE source_ref = $1 AND event_id = ANY($2)
ORDER BY event_id;
SELECT evidence_id, snapshot_id, file_id, api_source_id, evidence
FROM source_evidence WHERE snapshot_id = $1 OR evidence_id = ANY($2)
ORDER BY evidence_id;
```

Execute through the supplied transaction client, not db.query. Parse manifest/snapshot/dossier/event/evidence using their existing contracts. Check row identities against embedded identities, manifest `hashManifest(manifest) === binding.manifestHash`, stored manifest.hash equality, aggregate snapshot.contentHash === binding.snapshotHash, snapshot.manifestId/sourceRef/id and exact complete dossier binding. Read events for the aggregate's snapshot.eventIds only, require exact unique ID membership, embedded IDs/source/stream agreement and stored content_hash matching the event's canonical hash contract. Derive the complete seller/account set from those exact records and compare to validated sourceAccounts; do not treat missing seller as validation failure. Compare returned evidence IDs exactly to validated evidenceIds and snapshot.evidenceIds; each citation snapshot identity must equal the pinned aggregate and associations must retain the appropriate file/API source identity. Reject extra or absent membership. Source reader retains responsibility for full document/API original verification; this is the database recheck of the same immutable selected content, not a second blob validator. A wrong hash/binding, missing row, altered dossier or membership mismatch aborts insertion/effect. Do not add INSERT/UPDATE rights to immutable source tables.

Implementation port/hunk inventory: supervisor options accept the required trusted capture-read/recheck dependencies for mounted delegation, reserve uses the fixed role schema from roles.ts, and pending-step resolution switches to the closed tasks.ts dispatcher within private transact. Keep L1 unavailable resolution compatible for its tests. The wrapper makes capture dependencies mandatory for the mounted service; no optional no-op production branch. Repository.start already passes the caller client to its recheck seam, so no repository hunk is currently required. If compilation or integration reveals a concrete need beyond these hunks, report it rather than expanding the public surface. Root permits minimal repository integration only for a demonstrated need.

Rationale for bounded recheck: migration002 grants application SELECT/INSERT only on files/events/manifests/snapshots/evidence; their existing PK-bound content cannot change/delete under the application role. Dossiers permit UPDATE, so they need a transaction lock and fresh validity checks. The reader already proves original bytes and referenced immutable rows. The recheck is not a promise against privileged corruption or physical blob loss after validation. Do not hold a transaction over store.get or introduce capture-write locks/migrations. If the accepted source candidate changes these immutability assumptions, report the exact race to root before implementing a substitute protocol.

Delegation after restart must obtain the same binding's validated facts outside the owner transaction and compare the whole binding to the saved run; missing facts block rather than granting membership from names. Recheck DB binding/dossier on the owner client before its effect. A per-binding in-process cache may only contain validated immutable facts; it is not authority and cannot survive restart as an unauthenticated supplied object. This slice needs no new persisted membership table or source tool result publisher.

## Strict internal delegateTask schema and closed roles

Publish this schema locally in tasks.ts; no shared-contract edit or v1 change:

```ts
type DelegateTaskInput = {
  subject: DiscoverySubject;
  role: 'identity' | 'contract' | 'receivables' | 'connector';
  question: string;
  dependencyIds: Id[];
};
type DelegateTaskSuccess = {
  ok: true; investigationId: Id; taskId: Id; revision: Version;
};
// Typed safe failures preserve the closed existing result convention:
// {ok:false,code:string}; never exception text or arbitrary model payload.
```

Strict keys recursively reject prototype keys. Use existing subject/Id/Version schemas. question is nonempty and at most 8,192 UTF-8 bytes (the existing L1 bound). dependencyIds rejects duplicates and sorts lexically, each a valid Id; the existing overall model argument/envelope limits apply. Do not impose an invented new dependency budget. Required fields have no implicit defaults. No run/task/context/grant/model/reviewer/budget/proposal/capture fields may enter input. revision is the newly persisted child's actual revision, not parent/run revision. Success result identifiers and shape are internal tool output, not an added HTTP contract.

Only coordinator may execute delegateTask. Advertise exactly that tool for coordinator; specialist toolSchemas is empty in L2. roles.ts holds the closed recognized policy: all roles recognize describeSource/querySnapshot/searchEvidence/readEvidence/publishFinding/readFinding/requestInvestigation; coordinator additionally recognizes delegateTask/beginRepair/finishRun; connector additionally recognizes draftConnector/reviseConnector/compileConnector/runSandboxReplay/compareArtifacts/requestVerification/readVerification. Apart from authorized delegateTask, recognized role-authorized tools return TOOL_UNAVAILABLE; unknown names and role-forbidden names return TOOL_FORBIDDEN. Never advertise deferred tools as implemented. Before the first delegation effect, preflight every delegate in the entire accepted batch: strict argument schemas, duplicate dependency IDs, roles, exact pinned captured-tuple membership (or explicit source subject), and existence/same-run validity of every dependency ID. Perform database preflight through the supervisor-owned guarded transaction under the same run/task/dispatch/generation fences; external capture validation remains outside that transaction. A schema-valid later delegate with an uncaptured tuple or nonexistent/cross-run predecessor invalidates application of the batch before any child, count increment or tool effect. Recovered pending batches require this preflight before their first new effect too; no raw pool fallback or arbitrary callback registry. Unknown/forbidden names remain explicit failed tool results rather than disappearing. Each effect must still recheck current authority, capture, capacity, ordering and fences at claim time. Normal later capacity exhaustion or policy changes can reject a later step; preflight does not reserve whole-batch capacity or require every effect to share one transaction.

For delegation, validate raw tuple membership in the exact pinned facts, source-wide subject explicitly, coordinator authority and persisted narrowing. Under supervisor-owned serialized transaction, lock run/investigation/task in existing order, current generation/returned dispatch/step/attempt fences, runnable status, current authority and ordered pending-step eligibility; recheck capture; call existing insertSpecialist; persist succeeded step/result and task/run revisions; publish tool.called/tool.result and needed existing safe task/activity summaries, all in the same transaction. If capacity fails, persist exact budget blocker plus failed result atomically. Never call addTestSpecialist from production or run a child insert on an ordinary service pool transaction.

Same subject resolves one investigation; distinct successful steps may create distinct bounded tasks there. Exact step replay returns its saved result/revision without another child or counter change; changed accepted dispatch output still conflicts before tools. Dependencies must be existing same-run nodes, cannot self-reference the server-new child, and cannot form a cycle because edges only point from a new node to existing nodes with immutable dependencies. A parent coordinator dependency is not silently removed: it legitimately waits for that predecessor. All predecessors must succeed before dispatch; failed/interrupted predecessors remain waiting with persistent blockers. Historical succeeded tasks remain immutable.

Pause and owner loss must retain L1 semantics: delegation effect/result either commits before pause or does not begin after it; rollback cannot leave a child/count/event behind. Recover committed pending output without another model invocation; refence only safe unclaimed steps. A committed succeeded step is never repeated. Owner loss cannot fall back to a healthy pool for completion. Model done is never finishRun; beginRepair stays unavailable without exact proposal/diagnostic publishers.

## Required focused proof and handoff

Use actual session bootstrap/CSRF and migrated isolated PostgreSQL application roles. Barriers establish ordering; sleeps are only test timeouts. Compare persisted rows/counters/revisions/activity and runtime schema/rows/ledgers before and after tests.

- Unauthenticated routes401; POST missing/wrong CSRF403; extra body keys400. Authorized source with zero parent accounts starts source investigation. Unknown company, wrong selected manifest/source and incomplete/corrupt aggregate fail before lifecycle/activity writes. Model cannot select grants, identities, configuration or budgets.
- New no-client start503 with no rows/activity; default local composition capabilities unconfigured. Existing exact authorized start replay with client absent returns original202 response without capture reads/scheduling/writes. New session/same reviewer works; revoked policy blocks state/actions/start replay/dispatch and tool claims despite saved context.
- Source adapter proof covers422,404,409,503: HTTP retains original safe SourceError code/message/diagnostics and status, with correlationId/no-store; no source code rewrite or422-to409 translation.
- Concurrent identical starts produce one run/source investigation/coordinator/event; changed body409. Barrier after blob validation but before insertion, mutate dossier to incomplete, then continue: recheck rejects with no lifecycle rows/activity. Successful recheck holds dossier lock through insertion: a competing application-role dossier update waits until insertion commits (or rolls back); no external store call occurs inside the transaction. Add missing/wrong manifest/snapshot hash and event/citation membership cases between validation and recheck using privileged disposable setup, labeling those corruption probes rather than application-role mutation capabilities.
- A scripted coordinator emits real delegateTask; persisted child/result/revision and investigation count agree. Same tuple twice shares investigation; same raw account with different sellers remains distinct. Sellerless records are not fabricated tuples. Unknown tuple, role coordinator, forged grant/extra key, duplicate/cross-run dependency and later invalid batch arguments produce no partial child effects.
- Two-call semantic-preflight proof: first delegate valid, second schema-valid but with a cross-run predecessor; repeat with nonexistent predecessor. Assert zero children, specialist/investigation count increments or tool effects for either call. Repeat with a valid first delegate and a later uncaptured seller/account tuple, asserting the same zero-effect boundary. These are separate from malformed-schema and single-invalid-call tests.
- Unknown tools forbidden, authorized deferred tools unavailable, wrong-role delegate forbidden; only actual delegate schema advertised. Tool IDs remain globally dispatch-scoped. Success replay has one task/count/event/result; changed output conflicts. Crash before delegate commit rolls back; after commit replay preserves saved result. Pause-first creates no child; delegation-first commits then pause observes it; paused model output remains pending until resume.
- Concurrent capacity claims at specialist9/account19 respect10/20 and sticky blockers. Failed/interrupted predecessor waits with blocker across pause/resume/restart; succeeded predecessors stay immutable. Four unsettled-model global limit, owner-loss fencing and timeout accounting still pass unchanged L1 suite.
- L1 review's two extra proofs: native call-1 in a third dispatch on a different task yields a distinct helper ID and correctly linked transcript/result; a structurally otherwise valid byte-oversized response at the persistence boundary creates no partial tool rows/effects and retains independently trustworthy known usage (otherwise increments unknown once).

Run Node24/PostgreSQL18 with root's assigned exclusive test lease: `npm run typecheck`; `npm run test:unit -- packages/discovery/test`; `npm run test:integration -- tests/integration/v4-lifecycle.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/discovery-capture-read.test.ts tests/integration/local-composition.test.ts tests/integration/v4-activity-read.test.ts`; `git diff --check`. No duplicate/probe lease assumptions. Record exact commit/base, changed paths, commands/results and limits in implementation report. Commit coherent scoped implementation with subject `feat: expose authenticated discovery lifecycle` only under root's normal integration procedure. Machine checks are partial; independent exact-candidate review and joint user acceptance are separate. This is not V4/live construction/financial/activation/sync completion.
