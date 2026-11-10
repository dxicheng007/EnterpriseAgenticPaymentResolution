# Explicit Proposed-Scope Grant Producer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Deferred independent follow-on, pending root reprioritization. The active track is the pregenerated Company A review/activation → AI-off sync demo in [demo remaining work](2026-11-10-demo-remaining-work.md), observed at `origin/main` `088f719`. Dynamic grants, Gate J and live construction are not demo prerequisites. This saved plan starts no implementation or source release.

**Goal:** Persist explicit trusted reviewer grants for exact proposed source/scope associations and expose a bounded issuance API and transaction-bound verification authorization reader.

**Architecture:** Control validates the original persisted proposal against captured source evidence, saves an immutable grant, and publishes one safe event. A separate read-only port authorizes exact candidate associations; the existing financial producer records the selected grant without changing verification semantics. Actual Discovery consumption remains a separate release.

**Tech Stack:** Node 24, strict TypeScript, Fastify, Zod, PostgreSQL 18/`pg`, Vitest and existing source/evaluator services; no new dependencies.

**Spec:** [Accepted design](../../progress/2026-11-10/proposed-scope-grants-design.md), SHA-256 `cd50a229739ab9b5eee46a1c3c7fcb64f5dbad64182b0fdf228ec772a07e0f7a`; [independent review](../../progress/2026-11-10/proposed-scope-grants-design-review.md), SHA-256 `a5fe02ec4538f42f2854547b04ba1cc5129f8bd88b5d32bd520eee07ffadd7a6`; [user decision](../../progress/2026-11-10/generated-scope-grant-user-decision.md). Root accepts both review minors as plan requirements. Source inspection ended at `74cd969c2a51b67d0caeae18089585400beb3f2b`; concurrent selector work is excluded.

## Global Constraints

The following are verbatim constraints from the accepted design:

- “Separate explicit per-customer approval is still required before import or synchronization.”
- “A proposal, raw source tuple, successful compile, replay or financial report cannot issue its own grant.”
- “It does not append an account to general session/run/task `allowedAccountIds`, publish a runtime scope, read a parent baseline, clear a finding, or create activation authority.”
- “Persist no cookie, CSRF token, session ID, service credential, protected pin, fixture path or expected outcome.”
- “Source file I/O remains outside that transaction.”
- “No timer, invented expiry timestamp, standalone per-grant revocation endpoint, policy editor or automatic renewal is introduced.”
- “No backfill invents grants for old jobs, and no stored request can switch authorization modes on replay.”
- “A grant does not countermand pause.”
- “No success response precedes acknowledged commit.”
- “The producer's passing HTTP/SQL tests do not prove supervisor integration.”

Root reserves **`db/control/011_discovery_scope_grants.sql`**, having checked 128 local/origin refs and nine worktree catalogs. Recheck before source release; control001–010 remain byte-identical. This plan releases no source paths while Task5 owns the sole writer/SQL lease. Use a separately assigned DB namespace/ports; never stop another lane's service. No provider, browser, `.local` repin, runtime migration, financial-rule change or consumer mounting is authorized here.

## Review Focus

1. Wrong current authority can arrive after expensive source preparation or after SQL: pin synchronous final checks and rollback, including observed denial that must stay sticky.
2. A historical grant/job can survive proposal-head advancement: load immutable original inputs; never use the misleading current-head `historical:true` loader as history access.
3. Binding hash equality can conceal malformed provenance or oversized output: compare canonical bytes and validate every full envelope before committing.
4. Duplicate/lost-response issuance must save one grant/event without resuming work or spending verification attempts; nullable legacy mapping mode must never become an implicit fallback.
5. Changing the pinned producer changes the financial build digest: prove real current A/B verification and immutable old records, not merely schema/type success or fabricated attestations.

## Frozen representations and dependency choices

Use **direct relative leaf imports** for new `packages/contracts/src/discovery-scope-grants.ts`; do not modify contracts root exports or package manifests. Its runtime dependencies are existing `common`, `discovery`, and `canonical` leaves. The protected financial producer uses its existing contracts imports plus `IdSchema` and a required nullable ID field; it must not import the new leaf or any control/Discovery module. Consequently no build inventory addition is expected. Existing pinned producer bytes still change the financial build hash. Run both actual recursive inventory tests; a newly introduced import outside the inventory is a defect, not permission to omit it. Bootstrap inventories and protocol/fixture versions stay unchanged.

Shared leaf exports strict schemas/types named `ProposedScopeAssociation`, `ScopeGrantSelection`, `ScopeGrantProvenance`, `ProposedScopeGrant`, `ScopeGrantDescriptor` and their `…Schema` counterparts:

```ts
type ProposedScopeAssociation = {
  schemaVersion: 'proposed-scope-grant-1'; reviewerId: Id; runId: Id; proposalId: Id;
  binding: DiscoveryBinding; scope: Scope; parentCustomerId: Id; sourceAccountIds: Id[];
};
type ScopeGrantSelection = {
  expectedProposalRevision: number; expectedProfileHash: Hash; expectedBindingHash: Hash;
};
type ScopeGrantProvenance = {
  proposalRevision: number; proposalPayloadHash: Hash; profileHash: Hash;
  evidenceIds: Id[]; issuedAt: IsoInstant;
};
type ProposedScopeGrant = {
  grantId: Id; permission: 'candidate-verification';
  association: ProposedScopeAssociation; bindingHash: Hash; provenance: ScopeGrantProvenance;
};
type ScopeGrantDescriptor = {
  proposalRevision: number; profileHash: Hash; association: ProposedScopeAssociation;
  bindingHash: Hash; evidenceIds: Id[]; grant: ProposedScopeGrant | null;
};
```

Require positive safe revisions (`VersionSchema` plus safe-integer ceiling), full scope/company agreement, nonempty distinct source-account IDs, strict nested keys and existing ID/hash/instant grammar. Normalize only declared sets lexically; reject duplicate input IDs. Association hash is `hashCanonical(association)`; ID is exactly `'scope-grant:' + bindingHash`. The provenance issuer is `association.reviewerId`, never a second supplied identity. A descriptor's non-null grant must equal its current association/hash, though issuance revision/profile may differ.

Bounds use UTF-8 bytes of `canonicalJson(value)` unless identified as raw HTTP bytes:

| Value | Limit / exact derivation |
| --- | --- |
| POST body | 1,024 raw bytes and 1,024 canonical bytes; only `ScopeGrantSelection` |
| Association | 65,536 bytes; source-account set nonempty and at most 1,000 IDs (resource envelope only) |
| Citation provenance | `proposalCitationIds(validatedOriginalSubmitted)`, distinct lexical sort; at most 256 IDs and 32,768 canonical bytes; no transitive finding expansion or historical-union additions |
| Full `ScopeGrantProvenance` | 40,960 bytes |
| Full saved `ProposedScopeGrant` / POST response | 131,072 bytes |
| Full GET descriptor, including nested saved grant | 262,144 bytes |
| API error / issuance activity | 4,096 bytes each; no unbounded diagnostics/prose |

Count and byte limits both apply. Complete lists or failure; never truncation. A valid selected object exceeding any producer/output bound returns 409 `SCOPE_GRANT_LIMIT` with message `Proposed scope grant exceeds supported limits.`, `diagnostics:[]`, bounded correlation ID, and **no write/event**. Raw body too large returns 413 with the same safe error envelope; malformed schema/body/query is 400 `DISCOVERY_INVALID`. Serialize validated successful bodies with `canonicalJson` so measured and transmitted bytes agree. Validate the exact prospective grant/event/response before insertion. Existing persisted rows that violate strict canonical/projection validation fail 503 `DISCOVERY_UNAVAILABLE`, not a misleading usable grant.

Other HTTP failures retain `LOCAL_SESSION_*` statuses, 403 `DISCOVERY_FORBIDDEN`, authorized absence 404 `DISCOVERY_NOT_FOUND`, stale/hash/conflicting selection 409 `DISCOVERY_CONFLICT`, and dependency/readiness/commit uncertainty 503 `DISCOVERY_UNAVAILABLE`. Application route errors use fixed messages, `diagnostics:[]`, `Cache-Control:no-store`, no raw dependency error. Pre-routing malformed/overlong URLs retain the existing safe server400/414 generic envelope (also ≤4,096 bytes, no raw URL or resource access); test it without adding another framework-error router. Error correlation uses valid `request.id`, falling back to fixed `scope-grant-error` if invalid. Service errors carry these explicit code/status pairs.

## Task 1: Freeze bounded contracts, immutable storage and safe activity

**Files:** create `packages/contracts/src/discovery-scope-grants.ts`, `packages/contracts/test/discovery-scope-grants.test.ts`, `db/control/011_discovery_scope_grants.sql`, `tests/integration/discovery-scope-grants-storage.test.ts`; modify only the event/payload allowlists in `packages/storage/src/activity.ts`.

**Interfaces:** Produces the five DTO/schema pairs above and ledger below. Reuses `canonicalJson/hashCanonical`, `ActivityInputSchema`, `publishActivity`, `readMigrationCatalog`, `migrationIdentities`, `migrate`, `provisionTest/dropTest`, `createControlDb`, and `testNamespace` (label ≤12 lowercase alphanumeric characters).

Ledger columns: `grant_id TEXT PK`, `run_id`, `proposal_id`, `reviewer_id`, `account_id` (all non-null existing ID grammar/160-character maximum); `binding_hash` (64 lowercase hex); `binding_bytes BYTEA` (1–65,536 bytes); `issued_proposal_revision BIGINT` (1–MAX_SAFE_INTEGER); `issued_payload_hash`, `issued_profile_hash` (hash grammar); `evidence_ids_bytes BYTEA` (2–32,768 bytes); `issued_at TIMESTAMPTZ NOT NULL`.

Constraints: unique `(run_id,proposal_id,binding_hash)`; unique `(grant_id,run_id,proposal_id,account_id)`; FK `(run_id,proposal_id,issued_proposal_revision)` → `discovery_proposal_revisions(run_id,proposal_id,revision)`; FK run → `discovery_runs(id)`. CHECK valid UTF-8 JSON object in binding bytes, JSON array/count≤256 in evidence bytes, and projected `reviewerId/runId/proposalId/scope.accountId` exactly equal relational columns with missing/null projections rejected (use `COALESCE(comparison,false)`, not a nullable CHECK). Require finite `issued_at`. CHECK `grant_id='scope-grant:' || binding_hash`. Application readers additionally enforce strict shapes, canonical byte equality, hashes, sorted IDs and complete source/profile consistency. No SQL crypto extension is needed. Existing unique key supports run/proposal lookup; no redundant index.

Add `discovery_verification_requests.proposed_scope_grant_id TEXT NULL` and composite FK `(proposed_scope_grant_id,run_id,proposal_id,account_id)` to the ledger unique key, default MATCH SIMPLE and NO ACTION. Preserve all existing FKs/rows. Grant SELECT/INSERT only on new table; existing table-level mapping SELECT/INSERT already covers the added column. No new UPDATE/DELETE/TRUNCATE/table-wide privileges.

Activity: add only type **`discovery.scope_granted`** and payload field `grantId:IdSchema`. Issuance uses `{stream:'control',phase:'build',type:'discovery.scope_granted',at:issuedAt,runId,payload:{grantId,proposalId,proposalRevision}}`; no task, scope, issuer, evidence text, hash dump or grant contents. Existing `publishActivity` is the sole event writer and takes its counter lock last.

- [ ] **RED contracts:** assert strict shape, safe revisions, duplicate sets, wrong projection/hash/ID and exact count/byte boundaries, including multibyte bounds and combined-envelope upper bounds; over-limit data is rejected before mutation. Where constituent caps make a full-envelope limit unreachable, assert the derived maximum fits rather than invent an impossible boundary fixture. Run `npm run test:unit -- packages/contracts/test/discovery-scope-grants.test.ts` and observe behavioral assertions fail after minimal exports exist.
- [ ] **GREEN contracts:** implement the schemas and shared bound constants; rerun the focused command.
- [ ] **RED storage/activity:** using real app-role SQL and populated control010, assert upgrade creates precisely the ledger/column/FKs, null legacy mappings survive, wrong-run/proposal/account grant FK fails, duplicate association fails, limits/projections fail, grant mutation/DDL/cross-DB privileges deny, and the safe event retains all three correlation fields. Run `npm run test:integration -- tests/integration/discovery-scope-grants-storage.test.ts`; record intended missing schema/event behavior.
- [ ] **GREEN storage/activity:** implement011 and the two allowlist additions. Prove fresh001–011 and010→011, idempotent migrate, unchanged001–010 ledger/file hashes, runtime catalog/ledger fingerprint unchanged, and real42501 privilege denials. Direct event transaction rollback must roll back both counter/event. Rerun the same integration file and typecheck.
- [ ] **Commit:** `feat: add immutable proposed scope grant storage`. Obtain exact-candidate review before dependent integration; record actual011 hash, never invent it in this plan.

## Task 2: Implement exact proposal adaptation, issuer and transaction reader

**Files:** create `apps/control/src/proposed-scope-grant-proposals.ts`, `apps/control/src/proposed-scope-grants.ts`, `apps/control/test/proposed-scope-grant-proposals.test.ts`, `tests/fixtures/proposed-scope-grants.ts`, `tests/integration/discovery-scope-grants.test.ts`; narrowly modify `packages/storage/src/transaction.ts` so `probeMigration` accepts `Pick<Pool,'query'>` instead of only `Pool`, allowing the existing implementation to run on the caller's PoolClient. No copied readiness algorithm.

**Exact ports:** `createProposedScopeGrants({db,clock,expectedMigrations,issuerReviewerId,resolveAuthority,readTools,recheckCapture})` returns:

```ts
{
  describe(actor: ScopeGrantActor, ref: {runId: Id; proposalId: Id}): Promise<ScopeGrantDescriptor>;
  issue(actor: ScopeGrantActor, ref: {runId: Id; proposalId: Id}, selection: ScopeGrantSelection): Promise<ProposedScopeGrant>;
  authorizeProposedVerificationOn(client: PoolClient, input: ProposedVerificationScopeInput): Promise<ScopeGrantDecision>;
  close(): Promise<void>;
}
type ScopeGrantActor = {reviewerId: Id; allowedSourceRefs: readonly Id[]};
type ProposedVerificationScopeInput = {
  run: Pick<RunRow,'id'|'reviewer_id'|'binding'|'grants'>;
  task: Pick<TaskRow,'id'|'grants'>; proposalId: Id; profile: CustomerProfile;
  mode: {kind:'new'} | {kind:'saved'; grantId: Id};
};
type ScopeGrantDecision = {kind:'granted'; grantId: Id} | {kind:'scope-required'};
```

`resolveAuthority` is the existing synchronous server policy signature; `readTools` is `DiscoveryReadTools`; `recheckCapture` is `(client:PoolClient,facts:CaptureFacts)=>Promise<void>`. Construct once in composition, inject dependencies; service must not import its composition or scripts. Full expected migration identities including011 are mandatory. Probe readiness on the same client for transactional reader/issuance; failure yields503. Current policy failure throws403, absent exact grant returns `scope-required`; corruption/dependency failure throws503. A read-only consumer object exposes only the authorization function.

**Adapter:** export `readScopeGrantProposalOn(client, {runId,proposalId,revision?}, {lockCurrent:boolean})` returning `{submitted:ProposalInput,payload:DiscoveryProposalV2,payloadHash:Hash,isCurrent:boolean}`. Omitted revision selects current; explicit revision selects exact immutable revision independently of current head. Load original `submitted`, `payload`, hash and originating step/run/task identity. Parse Draft schema for revision1; otherwise Revise schema with `expectedRevision=revision-1` and exact proposal ID. Check step name `draftConnector`/`reviseConnector`, same task and the originating step arguments parsed through that same Draft/Revise schema canonically equal saved submitted. Invoke existing exported `proposalPayload({runId,taskId,proposalId,revision,investigationIds:payload.investigationIds},submitted)`; require exact canonical payload/hash equality. Do not cast published data to `ProposalInput`, reconstruct financial fields, call `loadVerificationSubject({historical:true})`, or add Discovery helper code. Pass validated original `submitted` directly to existing `prepareProposalEvidence`. Citation provenance uses the derivation above.

**Issuer algorithm:** source/run ownership and configured issuer checks precede object inspection. GET loads current proposal and grants coherently under current source authorization; it performs no source/evaluator/runtime writes. POST first resolves exact submitted revision and association. An exact saved issuance replay may return its original record after current ownership/source/canonical checks without fresh source preparation. If absent, require selected current head/hash, prepare evidence with saved run source grant outside a transaction, then lock run → proposal head → dossier via `recheckCapture`, reload exact selection and recheck saved/current source coverage. Validate tuples, capture and citations; preserve unresolved diagnostics/blockers rather than converting them to approval. Construct complete bounded response, insert grant, publish activity **last**, synchronously recheck authority before transaction callback returns, then return only after acknowledged COMMIT. No later lock acquisition after activity. Use existing bounded `withTransaction` retry only for40001/40P01; reruns must repeat all checks. Observed denial during preparation stays denied for that operation. On ambiguous commit return503; a fresh authorized exact retry resolves deterministic saved identity. No autonomous ambiguous retry or success guess.

`authorizeProposedVerificationOn` revalidates readiness, persisted run/task association, `coversGrant(run.grants,task.grants)` and `coversGrant(resolveAuthority(...),task.grants)`; full proposed tuples must also fit saved task and current source permissions. Derive association from server profile/run, load canonical ledger and validate exact bytes/hash/projections/provenance. Saved mode requires exactly that grant ID. Do not load a current proposal head in saved mode; the consumer must supply the original authenticated subject. New mode likewise cannot replace the consumer's current subject/assessment check. No source file I/O, SQL transaction ownership, attempt reservation or parent reader in this function.

**Fixtures:** one new private helper owns isolated directory/DB lifecycle, actual `loadDemo` A/B captures/read tools and test-only proposal publication. Reuse `prepareProposalEvidence`, `validateProposalPublication`, `publishProposal` and `proposalPayload`; do not copy their logic or existing giant test harnesses. Seed only necessary durable test run/task/dispatch/step associations as the app role. Scripted test inputs are explicitly synthetic. Every test owns cleanup in `finally`; close own pools/servers before `dropTest`, retain safe assertions before disposal, no global cluster stop.

- [ ] **RED adapter:** unit cases reject swapped submitted/published profiles, wrong revision/task/tool, hash tamper and invalid original input; exact revision1/revision2 and historical non-head inputs pass without casts. Run `npm run test:unit -- apps/control/test/proposed-scope-grant-proposals.test.ts`.
- [ ] **GREEN adapter:** implement the strict adapter with existing representation function; rerun unit cases.
- [ ] **RED service:** real A/B captures with zero parent account grants: assert explicit issuance saves exact provenance and one event, GET writes nothing, unresolved blockers persist, identical concurrent issuance/retry yields one original record/event, same-association term repair reuses grant, alias/capture/run/proposal changes require a new grant. Barriers change head/dossier/current policy during preparation and before commit; assert no row/event on failure. Include255/256/257 citations, exactly-at/over canonical bounds, corrupt stored bytes, unavailable schema, stale historical issuance absent versus existing, restart/same-reviewer session identity, and saved-mode mismatched grant rejection. Run `npm run test:integration -- tests/integration/discovery-scope-grants.test.ts`.
- [ ] **GREEN service:** implement issuer/reader and lifecycle; rerun both focused files plus typecheck. Inject fault only through test seams around preparation/precommit/commit acknowledgment, never product HTTP. Prove source/parent/account grants, run/task state, verification budgets and runtime fingerprint unchanged. Check activity equals exact safe fields and contains no secrets.
- [ ] **Commit:** `feat: issue source bound verification grants`. Independent review covers real transactions and both review minors; no consumer acceptance claimed.

## Task 3: Preserve grant mode through the existing financial producer

**Files:** modify `packages/evaluator/src/discovery-verification.ts`, `tests/integration/v4-verification-idempotency.test.ts`, `packages/evaluator/test/financial-attestation-build.test.ts`; new `tests/integration/discovery-scope-grants-mapping.test.ts`. Reuse Task2 fixtures. **Owner prerequisite:** root must separately coordinate the narrow `packages/discovery/src/verification-tools.ts` compatibility change with Discovery and release it atomically with the producer type update. It is limited to explicit null on existing legacy new admission, exact nullable stored values on recovery/job-read bindings, and fail-closed lookup/recovery/job-read checks for non-null mode. No grant lookup, account-check relaxation, supervisor, state projection or consumer implementation in that edit. If unavailable, finish independent tasks and hold this checkpoint; do not use optional fields/casts to hide the dependency.

**Interface change:** `PersistedBinding` and therefore internal `AdmissionBinding` gain required `proposedScopeGrantId: Id | null`. Null is explicit legacy; non-null selects the exact ledger grant. Producer row parser always reads the nullable SQL column, validates it and preserves it. `requireBinding` compares it. New INSERT supplies the exact gate selection. On existing request-key conflict/lookup, the stored mode wins; another mode/grant conflicts. The gate's lookup input remains request identity; it must load original stored authorization itself. The producer never consults current broad account grants or grants permission.

The mechanical Discovery reader must reject non-null new-grant mappings as `VERIFICATION_SCOPE_REQUIRED` until its separately accepted full consumer exists; do not let unchanged account-only checks accidentally expose a new-mode job. Preserve nullable value in return shapes for future consumption. This temporary fail-closed check is compatibility, not grant support. All product admission remains null-mode; only the separately identified test-owned gate exercises non-null admission. This does not certify existing state projections or other Gate J consumers.

- [ ] **RED mapping:** real app-role owner-gate harness, explicitly labeled producer-only, uses accepted run → investigation/task → step → mapping/budget/job lock order and last activity. Assert new-mode mapping FK/provenance, same-key one job/attempt, null-versus-ID and ID-versus-other-ID replay conflict, head advancement with original immutable bytes, queued recovery exact grant mode, lost COMMIT acknowledgment, and no budget/mapping on rollback/denial. Use `createDiscoveryVerification`, not mocked SQL functions. Run `npm run test:integration -- tests/integration/discovery-scope-grants-mapping.test.ts tests/integration/v4-verification-idempotency.test.ts`.
- [ ] **GREEN mapping:** apply producer field/read/equality/insert changes and owner-approved compatibility literals/denial. Existing test gate must read the actual stored nullable value on recovery, not recreate it from its configured current mode. Rerun the focused integration files and typecheck.
- [ ] **Verify build closure:** run `npm run test:unit -- packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/bootstrap-build.test.ts`. Extend the financial copy test to assert the planned producer/transaction changes alter its build hash; direct new control-only contract leaf is not reachable from pinned entrypoints. Do not modify inventories to bypass a failing recursive check. Compare recorded before/after actual `readFinancialBuildHash` and `readBootstrapBuildPins`: financial changes; bootstrap stays identical for these planned paths. If a newly released path changes that closure, return to root for explicit reservation/qualification before proceeding.
- [ ] **Genuine compatibility qualification:** run `npm run test:integration -- tests/integration/financial-attestation-runner.test.ts tests/integration/financial-attestation-composition.test.ts tests/integration/v4-verification-idempotency.test.ts` in disposable roots. These invoke the actual fixed launcher, subject runner, source captures and protected A/B v2 evidence, not fabricated eligible reports. Retain exact current build/capture/profile/job bindings, mandatory coverage and eligibility outcomes. Assert preexisting reservation/report/attestation bytes and protected fixture bundle hashes remain unchanged through011/replay; old stored build identities remain historical, never rewritten. Current requests use the current build; a stale queued reservation is not silently repinned/relaunched. Keep protocol/harness/fixture version values unchanged because no wire/evaluator semantics change. No preserved demo directory or operator fixture is repinned.
- [ ] **Commit:** `feat: bind verification requests to explicit scope grants`. Fresh producer review; actual Gate J remains outside this claim.

## Task 4: Mount bounded authenticated issuance independently of verification

**Files:** create `apps/control/src/routes/proposed-scope-grants.ts`, `tests/integration/discovery-scope-grants-http.test.ts`; modify `apps/control/src/discovery-composition.ts`, `apps/control/src/composition.ts`, `scripts/dev.ts`. No client/web/tool-descriptor changes.

**Interfaces:** route factory `createProposedScopeGrantPlugin({service,authorizeReviewer})`, with `service` optional for unavailable configuration and the existing local session authorizer. Register GET/POST `/api/discovery/runs/:runId/proposals/:proposalId/verification-scope`. Auth runs in `onRequest` before body parsing; POST passes `mutation:true`, GET false. Parse path IDs and reject all query parameters; GET rejects a body. POST additionally enforces JSON media type and raw1,024-byte body limit. Derive `ScopeGrantActor` from authenticated reviewer/source refs. GET returns descriptor200; POST returns saved grant200. Missing service returns503 after authentication. Use the frozen safe errors/bounds; no echo of request content.

`createLocalComposition` and `composeDiscovery` accept optional `scopeGrants:{issuerReviewerId:Id;expectedMigrations:readonly MigrationIdentity[]}`. `scripts/dev.ts:localFeaturePlugins` explicitly supplies `issuerReviewerId:'demo-reviewer'` and its existing complete `expectedMigrations`; no new env/token/config parser. `composeDiscovery` creates one shared `readTools` and one synchronous `resolveAuthority` closure for existing service and grant producer; inject `recheckDiscoveryCapture`, never import composition into the service. Mount grant plugin even if configuration is absent (authenticated503). Construct without DB I/O; request-time readiness handles missing011/storage without aborting source/proposal inspection. No requirement for a ModelClient or protected verification pins. Existing global health retains its full exact migration probe.

Expose the read-only authorization function from the producer for explicit later injection; **do not** add it to `DiscoveryVerificationDeps`/supervisor in this task. Keep `mountDiscoveryVerificationTools` default-off and unchanged. The grant endpoint persists permission even when tools are unmounted; it never advertises that verification is operational. Closing the plugin closes/drains only grant-service requests and releases its checked-out clients, not the shared pool or Discovery supervisor.

- [ ] **RED HTTP/composition:** real session bootstrap/cookie/CSRF and actual control service: unauthenticated401, wrong origin/token/service headers403, wrong issuer/run/source403 before data leak, invalid/query/body400, raw oversize413, safe resource limit409, missing011/config503. Authenticated source-only reviewer explicitly issues, GET never issues, duplicate/lost-response POST returns original grant with one event. Run `npm run test:integration -- tests/integration/discovery-scope-grants-http.test.ts`.
- [ ] **GREEN HTTP/composition:** implement plugin/options/dev wiring. Verify no model/pins still mounts usable producer; missing producer leaves ordinary source/discovery reads and real legacy reviewer behavior unchanged. Real existing-parent collision fixtures must show grant alone still cannot read parent/activation/connection/preview; ordinary independently authorized reads remain valid, no parent client call from issuance and no runtime mutations. Rerun HTTP test and `npm run test:integration -- tests/integration/parent-reads.test.ts tests/integration/parent-read-composition.test.ts`; typecheck.
- [ ] **Verify final producer checkpoint:** run the new contract/adapter tests, all four new grant integration files, existing mapping test, build closure and genuine compatibility suites once against the final changed candidate (reuse already-current results when no later relevant code changed). Record candidate/migration/build hashes, app-role privileges, safe exact bindings, counts, tests and limitations. No provider/browser/slice pass claim.
- [ ] **Commit:** `feat: expose authenticated proposed scope grant issuance`. Request fresh independent producer review before publishing the consumer port.

## Explicit external consumer handoff

Release the accepted DTOs/read-only port and exact producer provenance only after producer review. Discovery then owns all real-supervisor checkpoints: complete-batch preflight, final owner admission, current authority before/after SQL, saved response/transcript replay, `bindReadVerificationJob`, state projection, settlement and independent queued recovery. It must preserve existing `permits` including unrelated saved/current account ceilings; the new grant is only an alternate association check. Admission denies ungranted scope with `VERIFICATION_SCOPE_REQUIRED` before attempts/jobs/effects. No context-array widening or partial-profile filtering.

The current `loadVerificationSubject(...,{historical:true})` still joins the current head through `loadCompileSubject`; it cannot authorize original history. Consumer recovery must validate original immutable mapping subject bytes against exact historical proposal/assessment and registered candidate, then call saved-mode reader with the original grant ID. The current gate locks step before run; change it in the separate consumer release to accepted run → investigation/task → step → mapping/budget/job → activity order. Do not describe existing Gate J as compliant or accepted. Test all original grant/null modes, stale assessment, policy loss/restoration, pause, owner loss, ambiguous commit, denied mixed batch and running uncertainty on the actual supervisor before mounting.

Experience separately owns typed client/action presentation and real browser evidence. It consumes descriptor+explicit POST, never auto-issues on selection/page load, labels “Grant verification access” separately from verification/approval and handles stale/oversized/unavailable states. No UI or full proposal-detail/job surface is assigned here.

## Self-review and completion boundary

Both review minors are pinned: exact event/allowlist ownership with publish-last/idempotent evidence in Tasks1/2; exact citation derivation/count/bytes and all response/body/error bounds in Tasks1/2/4. Original submitted adaptation uses the existing exported representation function. No composition cycle, root export, speculative authority policy, extra worker dependency or consumer implementation is introduced. Task3 explicitly coordinates the unavoidable required-field compatibility edit and prevents interim access to new-mode rows.

Every Review Focus item maps to a real test task; type/schema checks do not substitute for role, transaction, actual protected-runner or supervisor proof. No further product-policy gap was found. This plan remains deferred and does not block the active demo track. Remaining release dependencies are root reprioritization, the root source lease, rechecked011 reservation, isolated DB allocation and Discovery's narrow compatibility-path coordination. Implementation/machine pass, independent candidate review, actual consumer acceptance and joint user acceptance remain separate. This plan was written without source edits, test/DB/provider/browser execution, Git mutations or subagents.
