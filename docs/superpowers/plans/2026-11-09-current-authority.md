# Current authority and status fence implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` for this single bounded task. Do not dispatch agents or implement later synchronization stages. Implementation waits fresh independent plan review and root dispatch.

**Goal:** Give committed A5 grants a durable current status/epoch fence, authorized internal status commands, retry-safe audit results and consistent narrow reads while preserving original activation history.

**Architecture:** A required trusted-composition authorizer admits each internal call; a module-private request capability binds validated reviewer/grants to an immutable command. Runtime repositories preserve an immutable command log and nondeletable current head under the existing scope advisory lock. Resume observes existing source semantics outside transactions; no routes, production adapter, mounting or monetary writer are delivered.

**Tech Stack:** Existing Node24, strict TypeScript, Zod, pg/PostgreSQL18 and Vitest; no new dependency.

**Spec:** [accepted authority design](../../progress/2026-11-08/handoffs/platform-current-authority-design.md), SHA-256 `4077a1c0148b2d32a3de15b5b0e426bc29565cab5952db640cd542f0b4cc987e`; [design review](../../progress/2026-11-08/reviews/platform-current-authority-design-review.md), [retention correction review](../../progress/2026-11-08/reviews/platform-current-authority-retention-review.md), PRD §§10–13/19, frozen F1/F5/F7 and shared lock order. Source assessment began at `f8973dd239c69c1754936533ea95dcb19d36b0e0`; dispatch base updated to `b6c662a0417128ef4ad4bb94a7bbc85944790fa7` after root pull, branch `codex/platform-current-authority`.

## Global constraints

- Root exclusively reserved `db/runtime/004_current_authority.sql` after accepted main ended runtime003 and other active catalogs ended runtime002. Applied runtime001–003 and all control SQL remain immutable. No migration number beyond004 is reserved.
- No parent financial/metadata/target/snapshot writes; no activation/import/initial receipt mutation; no capture, CSV, application/dependency scheduling, reenrollment, source producer, evaluator expectation, model/provider, UI or HTTP behavior changes.
- Worker imports no evaluator, model SDK, source operator or control runtime service. Reuse `selectedProfile` and `validateSemantics` from `apps/worker/src/activation-validation.ts` **unchanged**, plus existing source-semantics client by injected observation port. Do not reimplement semantic equality or revalidate new-activation policy to pause/revoke.
- A head is durable authority, never a cache: no delete/reset, no epoch1 fallback over existing command history. Current head never replaces original ActivationStateV1.
- All epochs are positive safe integers. Real transitions increment once; no-ops leave state/epoch/changedAt unchanged. Revoked cannot pause/resume. Resume does not clear data holds or broaden pins.
- Database lease55441 belongs to root. This plan does not use it. Implementation tests require explicit exclusive lease scheduling; never start/stop another lane's cluster or run simultaneous suites against shared fixture databases.
- Passing this task does not establish reviewer HTTP authentication, a working financial writer, V5/V6, full ConnectionState or joint acceptance.

## Review focus

- Missing head with history fails closed even on a valid command retry; it must not project/recreate original active/epoch1.
- Exact result recovery precedes new resume preflight, but never precedes fresh caller authorization or persisted-history integrity checks.
- A same-reviewer retry in a new session returns original audit/result; changing reviewer or canonical command under an occupied account/key conflicts.
- Resume observes outside locks; concurrent epoch changes prevent using that observation against new state; source failure cannot prevent pause/revoke.
- Trusted composition is explicit and required; a structural actor object, mutated input or retained internal token must not bypass request-bound admission. Repository tests are not HTTP proof.

## Task 1: implement the narrow internal authority service

### Owned files

Create:

- `packages/contracts/src/current-authority.ts` and `packages/contracts/test/current-authority.test.ts` — DTOs/refinements.
- `apps/worker/src/sync/current-authority.ts` — service orchestration and private admission lifecycle.
- `apps/worker/src/sync/current-authority-store.ts` — consistent snapshots, current head locks, command persistence and future writer fence helper.
- `apps/worker/src/sync/current-authority-errors.ts` — fixed safe error vocabulary.
- `db/runtime/004_current_authority.sql` — root-reserved additive catalog.
- `tests/integration/current-authority.test.ts` — genuine A5, service/repository/permission/race tests.

Modify narrowly, with root shared-path release at dispatch:

- `packages/contracts/src/index.ts` — new leaf export only.
- `packages/evaluator/src/financial-attestation-build.ts`, `packages/evaluator/src/bootstrap-runner.ts` — add `current-authority` to both explicit contracts-source lists.
- `packages/evaluator/test/financial-attestation-build.test.ts`, `packages/evaluator/test/bootstrap-build.test.ts` — new leaf mutation case, retain recursive closure coverage.
- `tests/integration/parent-storage.test.ts` — add the two new FK-dependent tables to its existing privileged test-only reset TRUNCATE list; no changed financial assertions or production cascade.

No package export map, activation/source/parent/capture module, health/server/dev composition, runner or broader fixture refactor. Sequential migration auto-discovery already includes runtime004. Unexpected additional catalog assumptions must be reported with exact file/assertion before root reserves a repair.

### Exact schemas and refinements

Export the accepted design's six schemas and inferred types, naming schemas by appending `Schema`: `CommittedAuthorityIdentityV1`, `CurrentAuthorityV1`, `AuthorityStatusCommandV1`, `AuthorityStatusResultV1`, `AuthorityStatusResponseV1`, and internal audit `AuthorityResumeObservationV1` below. Existing Scope/Id/Hash/IsoInstant schemas and guarded `strict` objects apply recursively. Positive epoch schemas explicitly refine `Number.isSafeInteger`; use checked addition for increments. No optional unknown extension fields.

```ts
type CommittedAuthorityIdentityV1 = {scope:Scope; activationId:Id; bundleHash:Hash};
type CurrentAuthorityV1 = {
  schemaVersion:'1'; identity:CommittedAuthorityIdentityV1;
  sourceRef:Id; artifactHash:Hash; profileHash:Hash; manifestHash:Hash;
  status:'active'|'paused'|'revoked'; epoch:number; changedAt:IsoInstant;
};
type AuthorityStatusCommandV1 = {
  schemaVersion:'1'; identity:CommittedAuthorityIdentityV1;
  action:'pause'|'resume'|'revoke'; expectedEpoch:number; idempotencyKey:Id;
};
type AuthorityStatusResultV1 = {
  schemaVersion:'1'; identity:CommittedAuthorityIdentityV1; idempotencyKey:Id;
  action:'pause'|'resume'|'revoke'; beforeStatus:'active'|'paused'|'revoked';
  beforeEpoch:number; state:CurrentAuthorityV1; changed:boolean; committedAt:IsoInstant;
};
type AuthorityStatusResponseV1 = {result:AuthorityStatusResultV1; replayed:boolean};
type AuthorityResumeObservationV1 = {
  observation:SemanticPreflight; startedAt:IsoInstant; completedAt:IsoInstant;
};
```

Result refinements: full result.identity equals state.identity; action target is pause→paused, resume→active, revoke→revoked. Allowed changed pairs only active→paused, active→revoked, paused→active, paused→revoked; changed=true iff beforeStatus differs; changed requires state.epoch=beforeEpoch+1 and changedAt=committedAt. Unchanged requires beforeStatus=target status and state.epoch=beforeEpoch; preserve original changedAt (schema cannot prove prior timestamp; repository compares it). Revoked pause/resume cannot form successful result. Reject arithmetic overflow. Audit observation startedAt≤completedAt; source checkedAt is not a lease and need not equal runtime clock. There is no invented freshness TTL.

Repository cross-field checks additionally require result.idempotencyKey/action/identity equal command, beforeEpoch=command.expectedEpoch, state pins equal exact committed grant and command digest binding. Resume observation is nonnull iff successful changed paused→active; exact retries preserve original observation. Schema parsing alone cannot establish those persisted relationships.

Command binding digest is `hashCanonical({command,reviewerId})`, with exact parsed command; do not include sessionId. Audit stores original strict ReviewerContext separately with canonical digest. Same reviewer new authorized session can retry; original result/session remains unchanged. Key namespace `(accountId,idempotencyKey)` is distinct from activation receipt keys.

### Required trusted composition port and service API

Use a generic request context type `RequestContext` chosen by the trusted composition (future adapter may use a framework request; tests use opaque request handles). Production factory requires the dependency, with **no default or permissive fallback**:

```ts
type AuthorityAdmissionGrants = {
  reviewer: ReviewerContext;
  allowedAccountIds: Id[];
  allowedSourceRefs: Id[];
};
type TrustedAuthorityAdmission<RequestContext> = {
  authorize(request:RequestContext, mode:'read'|'mutation'):
    Promise<AuthorityAdmissionGrants>;
};
function createCurrentAuthority<RequestContext>(deps: {
  db:Pool; clock:Clock;
  admission:TrustedAuthorityAdmission<RequestContext>;
  observe:(sourceRef:Id)=>Promise<SemanticPreflight>;
}): {
  read(request:RequestContext, identity:CommittedAuthorityIdentityV1):Promise<CurrentAuthorityV1>;
  command(request:RequestContext, command:AuthorityStatusCommandV1):Promise<AuthorityStatusResponseV1>;
};
```

This is an explicit trusted composition capability, not an authentication implementation. It asserts server-managed session, account/source grants and mutation origin/CSRF checks as applicable. Future worker ingress must verify authenticated control channel before its adapter vouches for forwarded reviewer context. No adapter is created or mounted in this task, no control module imported into worker, and no public method accepts reviewer/grants as a separate argument. Document this trust assumption at the exported dependency type. A malicious composition could inject a lying authorizer; opaque tokens do not defend against the host/composition owner. Product tools receive neither this factory nor its configured instance. Merged GateJ/transport defects remain tracked by their owners; merge does not resolve them. Default composition still lacks a modelClient and does not invoke the new transport; this task neither modifies nor certifies those paths.

On every call use this exact sequence: required authorizer → strict detached grants → strict detached command/identity → check the parsed account grant → private committed-subject lookup → check its actual source grant. Malformed grants are AUTHORITY_FORBIDDEN; malformed input from an admitted caller is AUTHORITY_INPUT_INVALID400; a valid parsed forbidden account is403. Never inspect mutable unvalidated nested properties for authorization or use returned grants by reference. For an occupied command key, resolve the persisted association's genuine committed subject as specified below, not an eagerly rejected supplied activation/bundle/scope. Enforce allowedSourceRefs against that actual source before exposing replay, conflict or any association-derived result. No command JSON actor/grants accepted. Authorizer may throw `AuthorityError`401/403; any other failure maps503 AUTHORITY_UNAVAILABLE, not an allow.

Inside `current-authority.ts`, mint a plain frozen token stored in a **module-private WeakMap**, with request-call nonce, parsed frozen command/identity, canonical binding hash, detached reviewer and account/source authorization. Complete source binding only after exact committed grant resolution; before then no mutation helper may use token. Token type/constructor/map/consume function are not exported. Each invocation gets a separate token even when request object is reused. Internal operation verifies active map entry and exact canonical hash at use; `finally` deletes it after return/throw. All asynchronous work is awaited inside that lifetime. The token is never returned, passed to injected observer/authorizer, serialized, logged or stored. There is no exported arbitrary actor mint and no caller-provided token port. Store module is trusted transaction plumbing and never exposed as an authorized product API.

Before opening the mutation transaction, re-invoke the trusted authorizer with the same request and mutation mode, after any awaited observation. Revalidate both account and actual committed source grants and require the same reviewerId/sessionId as this request's original admission; otherwise return AUTHORITY_FORBIDDEN. Update only the private request authorization marker, never the detached command. Perform the same fresh admission check before returning a concurrent winner recovered after failed preflight. These calls are outside SQL locks. An exact replay found at entry already has this call's fresh admission. WeakMap presence proves only in-process request binding/lifetime, **not continuing session authority**. The remaining explicit trust assumption matches ordinary authenticated in-flight requests: after the final authorizer check, admission remains valid through that short transaction and its bounded SQL retries; out-of-band session changes are enforced on the next request, not atomically joined to runtime SQL. No product TTL, background capability lease or claimed atomic control-session/runtime transaction is introduced. If future ingress needs cancellation mid-transaction, that is a separate reviewed boundary.

Tests supply an explicit fake **trusted adapter** which recognizes only test-owned request identities and rejects forged JSON handles; label it an internal test trust fixture, not real HTTP session proof. Input/grants mutation across awaited authorizer/observer barriers must not alter admitted command/pins/actor. In practice detach command immediately after authorization and before subsequent await; test changes during source observation. Do not claim mutation before parsing is prevented from changing what the request asks—only that the parsed admitted request cannot change later.

### Repository ports and future lock consumer

`current-authority-store.ts` exports only the following internal repository ports; it accepts a checked-out connection for mutations and never calls a source/network/model port:

```ts
type AuthoritySnapshot = {
  stored:StoredActivation;
  state:CurrentAuthorityV1;
  command:StoredAuthorityCommand | null;
};
readAuthoritySnapshot(db:Pool, identity:CommittedAuthorityIdentityV1,
  key?:Id):Promise<AuthoritySnapshot>;
lockCurrentAuthority(client:PoolClient, identity:CommittedAuthorityIdentityV1,
  key?:Id):Promise<LockedCurrentAuthority>;
lookupAuthorityCommand(client:PoolClient, locked:LockedCurrentAuthority,
  command:AuthorityStatusCommandV1, reviewerId:Id):Promise<AuthorityStatusResultV1|null>;
commitAuthorityStatus(client:PoolClient, locked:LockedCurrentAuthority, input:{
  command:AuthorityStatusCommandV1; reviewer:ReviewerContext;
  resume:AuthorityResumeObservationV1|null; committedAt:IsoInstant;
}):Promise<AuthorityStatusResultV1>;
assertActiveAuthority(client:PoolClient, locked:LockedCurrentAuthority,
  expectedEpoch:number):CurrentAuthorityV1;
```

`StoredAuthorityCommand` contains parsed command, reviewer audit, bindingDigest, result and resume observation, plus verified canonical digests; it is internal, never a service DTO. `LockedCurrentAuthority` is an opaque branded token with readonly state/stored information; WeakMap binds token to exact client, scope and stored grant and rejects foreign/fabricated token. `lookupAuthorityCommand` verifies full command and reviewerId binding; it returns null only when absent, never silently ignores a conflicting record. `commitAuthorityStatus` computes state/result internally from locked state, validates input, and cannot accept arbitrary caller-built result/epoch. It rechecks exact existing command before new work. `assertActiveAuthority` validates same-client token and checked expected epoch, throws AUTHORITY_INACTIVE for paused/revoked or AUTHORITY_STALE for mismatch, and creates no financial state. It supplies a future writer fence primitive, not an apply service. Caller owns transaction and must hold locks through eventual commit. This task tests the prefix only; later writer must prove it actually consumes it.

Account/key precedence is part of both snapshot and lock ports. With no key (narrow read/future writer fence), resolve the supplied exact scope/activationId/bundleHash and return404 on mismatch. With a key (status command), query `(identity.scope.accountId,key)` first inside the same snapshot or under the scope lock. If occupied, use the persisted association's scoped original-import FK/command identity to call existing `readStoredActivation(client,persistedScope)` and verify the genuine grant, canonical association, head retention and all stored relationships. Return that verified actual subject in AuthoritySnapshot/LockedCurrentAuthority without comparing the incoming identity yet. The service checks its actual account/source grants and private capability binding, then lookupAuthorityCommand compares the entire incoming canonical command/reviewer binding; different activationId, bundleHash, or same-account company/seller scope is409 AUTHORITY_IDEMPOTENCY_CONFLICT. Corruption is503 before replay/conflict, never reclassified as missing. If the key is unused, use the supplied exact identity as for a narrow read, so mismatch is404. A status call always passes its key to both ports. No public lookup-by-key or parent API change is introduced. Under-lock appearance of an association is resolved the same way; service must verify its private authorization covers the locked actual subject before lookup/commit (no authorizer/network call under SQL locks). If the actual subject differs from the preflight-admitted one, fail authorization/staleness rather than using a capability for another subject. Existing unique-per-account immutable A5 imports ordinarily prevent such a legitimate subject change. No association result or canonical conflict is disclosed without grants for its actual stored subject.

Acquire a fresh `LockedCurrentAuthority` **inside every withTransaction callback attempt**. Never retain/reuse it after COMMIT/ROLLBACK, across SQL retries or across pool reuse; the same-client check is not proof of a live PostgreSQL lock. Its WeakMap rejects foreign/fabricated token identities but does not enforce PostgreSQL transaction lifetime. Synchronous assertActiveAuthority is valid only while the caller holds the live transaction/head lock; this is an explicit repository precondition. Do not claim automatic stale-token rejection after client reuse. The service scopes the token to its callback and acquires/reads afresh on every retry.

Implement read snapshots with one client and `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`, all `readStoredActivation` nested reads and head/history/command reads on that same client, COMMIT/ROLLBACK/release in try/finally. Do not use global pool queries within it or change shared withTransaction. Use existing decodeCanonical/readVersion helpers with explicit safe-integer refinement. Read compares persisted bundle/activation IDs, immutable head pins and all audit bindings; occupied-key mode validates against the persisted association identity first and defers incoming canonical conflict comparison until actual-subject authorization. No head plus any history for account/committed grant is AUTHORITY_STORAGE_INVALID, including an otherwise exact retry. No head and no history projects original active/epoch1/approvedAt without writes. A head tied to another grant is corruption; no fallback. Query histories account-wide to catch mismatched orphan history too.

### Reserved runtime004 DDL and retention

Create only `runtime_authority_heads` and `runtime_authority_commands` plus their narrow constraints/trigger functions. Existing parent import exposes scoped UNIQUE tuple `(account_id,company_id,seller_entity_id,idempotency_key,receipt_id)`. Use that tuple for enforced scoped FKs instead of weakening to an unbound activation ID. Names `initial_import_key`/`initial_receipt_id` refer to those original A5 columns. Activation ID/source/pins are validated against the referenced immutable import on every decode.

| Table | Columns and constraints |
| --- | --- |
| `runtime_authority_heads` | PK account_id; company_id,seller_entity_id,initial_import_key,initial_receipt_id; immutable `grant_canonical,grant_digest` encoding the initial CurrentAuthorityV1 (active1, approvedAt); mutable `status,epoch,changed_at`. UNIQUE on the five scoped original-import reference columns. Composite FK to runtime_activation_imports tuple, `ON UPDATE RESTRICT ON DELETE RESTRICT`. Valid Id/hash/canonical instant checks; epoch BIGINT1..MAX_SAFE; status fixed enum. Canonical initial state must match indexed scope and original initial identifiers through repository decode against import. No mutable full-state canonical column requiring extra UPDATE privilege. |
| `runtime_authority_commands` | PK(account_id,idempotency_key); full scope and initial_import_key/initial_receipt_id; `reviewer_id,binding_digest`; `command_canonical,command_digest,reviewer_canonical,reviewer_digest,result_canonical,result_digest`; `resume_canonical,resume_digest` both null or both present. Composite RESTRICT FKs to head's scoped tuple and original import tuple. Strict Id/hash/JSON-object checks with existing parent_index_projection; index command identity.scope/key, reviewer.reviewerId and result identity/key back to scalar columns; nullable resume only if changed paused→active. Canonical/digest verification and remaining cross-field relationships enforced by repository decoder. |

All digest fields lowercase64 hex; canonical TEXT with `IS JSON OBJECT`; use existing parent_index_projection for SQL scalar checks, preserve original canonical text for decoder. Exact hash is verified by code, never claimed authenticated by SQL. Check epoch/result/beforeEpoch and overflow using BIGINT constraints and safe decode. No sequence key is needed for command order: head epoch orders real transitions; no-op results are addressable by key.

Head grants SELECT/INSERT and UPDATE(status,epoch,changed_at) only; **no DELETE/TRUNCATE**, no update of immutable pins/scope/import references. A head DELETE trigger rejects even privileged ordinary deletion (test reset may TRUNCATE with migration-owner privilege). Head UPDATE trigger rejects changes to immutable columns, epoch regression/reset, status transitions outside table below, changed status without epoch+1, and same status with changed epoch/changed_at. INSERT validates epoch1/active/changedAt equals pinned grant approval time. Repository still verifies pinned grant against A5. No SQL trigger may invent an epoch1 reset or delete history.

Commands get SELECT/INSERT only and existing immutable-history UPDATE/DELETE rejection trigger. No cascade on any head/command/grant FK. The role has no TRUNCATE. Privileged isolated fixture reset must list dependent tables explicitly, not change production FKs to CASCADE. Missing-head/history corruption test can temporarily disable triggers/RI using disposable owner-controlled setup; restore in finally. This represents corruption unreachable by normal application privileges, and decoder must still fail closed.

### State table and transactional behavior

| Current | Action | Success |
| --- | --- | --- |
| active | pause | paused, epoch+1 |
| active | resume | unchanged active, no source call |
| active | revoke | revoked, epoch+1 |
| paused | pause | unchanged paused |
| paused | resume | active, epoch+1 with checked observation |
| paused | revoke | revoked, epoch+1 |
| revoked | revoke | unchanged revoked |
| revoked | pause/resume | AUTHORITY_REVOKED409 |

New commands check expectedEpoch even on no-op. Exact logged retry returns original result before stale/status/semantics checks, after authorization/integrity. Checked overflow on real transition is409 AUTHORITY_EPOCH_EXHAUSTED; no-op at maximum safe epoch succeeds. Failed commands consume no key. No-op gets immutable log with its own committedAt; state.changedAt remains original. Real change sets changedAt=committedAt. Runtime clock instant obtained once per successful transaction attempt, not preflight source time; rolled-back attempt timestamps have no authority.

Mutation runs inside existing withTransaction. `lockCurrentAuthority` acquires `canonicalJson(['parent-scope',accountId])` via lockParentKeys, resolves the subject using the key-aware precedence above, checks head/history and inserts original head only if both absent, then SELECT FOR UPDATE. No parent target/identity/capture locks; no network. Scope lock serializes original A5 and command namespace. A fresh locked token is local to this transaction callback attempt and is never reused after it completes or aborts. Check replay under lock, then epoch/table, then append result/head mutation and activity. Corruption cannot be treated as absence. Commit helper failure aborts whole callback including initial materialization.

Future writer lock order remains scope → head → target → one complete lockImportIdentities set → owned application progress/outcomes → activity. Do not acquire target/delivery locks now to pretend future integration is proven. The assertActiveAuthority helper requires head held; paused→resume increment ensures an old pre-pause epoch never matches. No command resets pins, target state or data holds.

### Resume preflight and recovery orchestration

1. Invoke authorizer, detach/validate grants, detach/validate command, check parsed account grant, then read key-aware consistent snapshot. Enforce its actual committed source grant and bind private token before comparing incoming command against any occupied association. Exact logged command returns original result/replayed=true; conflicting binding409. Integrity check comes before recovery. Missing policy/setup on disk does not matter.
2. If no association, reject stale epoch or revoked pause/resume using snapshot where possible. For paused→resume only, derive exact profile via exported selectedProfile(stored.bundle); observe(stored.bundle.manifest.sourceRef) outside any SQL transaction. Strictly parse result as SemanticPreflight; call unchanged exported validateSemantics(bundle,profile,observation). Record injected runtime startedAt/completedAt. Do not duplicate its wildcard/account/equality logic; other accounts' revisions remain independent.
3. Observation failure: reauthorize this request outside SQL locks as specified above, then re-read consistent snapshot/association and recheck source/account admission binding. Exact concurrent winner recovers; conflicting winner409; history corruption503; otherwise return original mapped observation failure. Missing/malformed/network failure503 AUTHORITY_SEMANTICS_UNAVAILABLE; validateSemantics mismatch maps409 AUTHORITY_SEMANTICS_MISMATCH. No failed command log or head mutation.
4. On success/no observation needed, perform the final admission recheck outside SQL locks, then withTransaction acquires a fresh head token using the command key on every callback attempt. Verify private admission against the locked actual subject, then recheck exact association; otherwise expected epoch/status. If a real paused→active transition is now required but there is no matching observation, abort without mutation and return stale (do not fetch under lock). Epoch CAS normally makes this case unreachable. Validate supplied observation against exact locked immutable grant using unchanged validateSemantics again (pure) before commit. bounded SQL transaction retries reuse this attempt's observation but recheck head/association; no fabricated TTL or source/runtime atomicity.
5. Pause/revoke/no-op/replay never call observe or new-activation policy verification. Persistence failure returns unavailable, not pending/success. Observer may not alter admission-bound command or receive its private token.

An observation records declared revisions only. No current schema/document coverage claim; future apply must check its own source declarations/holds. Do not add a source capability or model call to fill this later gate.

### Activity and errors

Real pause: `connection.paused`; real revoke: `connection.revoked`; real resume: existing `system.status`. Use `publishActivity(client,{stream:'runtime',phase:'run',scope,at:committedAt,type,payload:{status,artifactHash,profileHash,manifestHash}})` last in transaction. Existing sanitizer retains these fields. No sanitizer change, no epoch/key/session data silently dropped, no event on no-op/replay. Activity is invalidation/refetch signal, not a complete authority projection. Log sessionId only in internal immutable reviewer audit, never response/activity.

`AuthorityError(statusCode,code)` fixed safe messages: AUTHORITY_INPUT_INVALID400; AUTHORITY_UNAUTHORIZED401; AUTHORITY_FORBIDDEN403; AUTHORITY_NOT_FOUND404; AUTHORITY_IDEMPOTENCY_CONFLICT/AUTHORITY_STALE/AUTHORITY_REVOKED/AUTHORITY_EPOCH_EXHAUSTED/AUTHORITY_INACTIVE/AUTHORITY_SEMANTICS_MISMATCH409; AUTHORITY_SEMANTICS_UNAVAILABLE/AUTHORITY_STORAGE_INVALID/AUTHORITY_UNAVAILABLE503. Map known source observation failures to semantics unavailable; malformed decoded DB objects to storage invalid; unrelated pg/internal errors to unavailable. Do not catch a corruption and retry as no head. SQL40001/40P01 handled by shared bounded transaction helper. No raw SQL/headers/env/paths/stack returns; no HTTP status mapping code added outside the typed error.

### Execution steps and tests

- [ ] **1. Confirm reservation and write meaningful failing contract/storage/service tests.** Verify base/branch and owned paths. Root reserved runtime004 but all implementation waits plan approval. Add exact schema test cases (unsafe/negative/zero epoch, unknown keys, identity mismatch, impossible status/action pair, wrong increment, changedAt mismatch, invalid observation interval). Use minimal importable scaffolding to observe behavioral assertions fail, not only missing exports.
- [ ] **2. Implement DTOs, runtime004 and closure maintenance.** Add schema export and both evaluator leaf inventories; mutation of the leaf must change financial evaluator pin and bootstrap subject/evaluator pins, with recursive coverage retained. Add only the new tables to parent-storage test reset. Run focused contracts/build tests; no financial expectation changes or broad refactors.
- [ ] **3. Implement repository integrity/retention and consistent read.** Use existing canonical helpers and readStoredActivation. Tests use genuine A5 committed imports via issueActivationProofs/verifyOriginals and actual createWorkerActivation as in tests/integration/sync-capture.test.ts; build local helper in new test file rather than importing another suite or refactoring fixtures. At least one A and one B committed grant exercise key scope without source capture. Registry-only scope/notfound, wrong grant, corrupt bundle, read without writes, one head initialization and original ActivationStateV1/history unchanged. Test head/history absent projects1 only once; missing head with commands fails both read and mutation, even retry; no recreated head. Seed corruption only in disposable owner fixture. Inspect role privileges and pg_constraint delete/update actions; ordinary application DELETE/TRUNCATE/immutable-column update denied; command mutation denied. Attempt referenced deletion proves no cascade. Exact new-table SELECT/INSERT/columnlimited UPDATE grants, safe BIGINT and FKs tested.
- [ ] **4. Implement admission/service and transition table with audit recovery.** Test required authorizer invocation before data exposure, malformed grants, no account/source capability, forged test request handle, actor/grants keys in command, detached grants/command mutation across observer barrier. Test every state table cell, stale no-op, all success result refinements and stored canonical binding; no-op log but no activity or changedAt move. Same key+reviewer+new session replays original audit/result; different reviewer/action/epoch/identity conflicts. Separate tests change activationId, bundleHash and same-account company/seller scope at an occupied key: each yields409 only after actual stored-source authorization/integrity. Repeat each change at an unused key and in narrow read:404. Deny actual stored-source grant and ensure no replay/conflict result is exposed. Same key on separate account permitted with authorized grants. Replayed older paused result after revoke remains identical; read returns revoked. Private capability is not exported or returned; test success and failure do not leak retained tokens. Tests establish injected admission contract only, not HTTP/session/CSRF proof.
- [ ] **5. Implement resume using unchanged semantic functions and fail-safe recovery.** Test paused→active with real source.readCurrentSemantics behind injected observe; source mismatch/wildcard/missing approved account/changed revision denied; another known account's revision allowed. Instrument observer to assert no open runtime transaction/client locks; dependency graph excludes worker evaluator/model/source runtime imports. Source outage, missing current policy file and missing registry publication file do not prevent pause/revoke/replay from saved A5 data. Inject observer rejection while competing exact command commits; failing attempt recovers winner. If no winner, no command/head change. Input is bound to original grant; changing source result cannot authorize a different profile. Revoke the test request's source/account/session permission while observer waits: final authorizer recheck must deny before transaction and leave head/log unchanged. Repeat for concurrent-winner recovery after observer failure; no unauthenticated result leak. Assert the final authorizer and observer never run under runtime locks; document that later out-of-band session change within the admitted short SQL transaction is the explicit request-lifetime assumption, not a property proved by WeakMap validity. No schemas/source producer changes.
- [ ] **6. Add deterministic concurrency/rollback tests.** Barriers—not sleeps—control concurrent first command initialization, same key duplicate, same key conflicting request and two commands expectedEpoch1 (one winner, other stale). Pause initial grant, block resume observation, commit revoke, then release: resume cannot restore. Hold scope/head lock with a checked-out transaction; second command cannot commit until release. Capture original financial tables before/after all commands to prove zero writes. For future-consumer prefix only, lockCurrentAuthority/assertActiveAuthority on one client and race revoke: revoke-first rejects old epoch; simulated fence-first holds until transaction ends, then revoke succeeds. No fake money insertion or claim real apply race passed. Force activity insertion failure via isolated test-only DB trigger: head/log/activity rollback; remove trigger, retry then recreate service/pool and recover exact result. Additionally force one supported40001 or40P01 abort with a test-local one-shot DB trigger/barrier; prove the service's next withTransaction attempt reacquires scope/head and rereads current state with a fresh local token (including an intervening valid transition where feasible). Assert transaction-level outcome/epoch rather than claiming a stale token is intrinsically rejected on reused PoolClient. No production failpoint.
- [ ] **7. Test read snapshot, corruption and numeric edges.** Under a controlled read barrier, concurrent status change cannot make a read combine epochs/pins across SQL snapshots. Use same REPEATABLE READ client for nested import reads. Corrupt audit digest, grant pins, resume binding, result action/epoch and missing head produce storage invalid. Owner-only maximum-epoch fixture exercises exhaustion and no-op; do not add setter/reset API. Test transition trigger prevents epoch regression/reset and illegal SQL transition. Role/audit fixture restores triggers/constraints in finally. Activity keys exactly match allowlist with no token/session/raw observation; no events on replay/no-op.
- [ ] **8. Run bounded verification under root's exclusive DB lease, then commit/review.** Use Node24/PostgreSQL18 PATH. Run `npm run typecheck`; `npm run test:unit -- packages/contracts/test/current-authority.test.ts packages/evaluator/test/financial-attestation-build.test.ts packages/evaluator/test/bootstrap-build.test.ts`; `npm run test:integration -- tests/integration/current-authority.test.ts tests/integration/parent-storage.test.ts tests/integration/v3-activation.test.ts tests/integration/sync-capture.test.ts`. Expected all assigned cases execute/pass, no skipped mandatory cases. Inspect worker production import graph and git diff for unchanged parent/source/capture/activation code. Root must reserve a narrow fix if an unowned migration assumption fails. Stage only owned paths; proposed coherent subject `feat: add durable current authority fence`. Record base/candidate, migration004 hash, commands/counts, admission and future-apply limitations; send exact candidate for independent review. Do not run V5/V6 or label status UI/HTTP available.

## Integration limits and next gates

This service is implementable with a required trusted composition admission port and private capability; no exported arbitrary actor mint or permissive adapter is delivered. Its test-owned authorizer is explicitly not production authentication. A future separately reviewed control-to-worker adapter must establish real reviewer/session/origin/CSRF/service provenance before mounting any product status route. Future monetary application must consume the same locked head and prove epoch/status/semantic checks inside its own atomic writer. The current task does neither.

No missing financial/product decision blocks this bounded task. Runtime004 is reserved, other listed paths need normal root dispatch release. Capture remains unchanged and CSV refusal stays intact. Adding a new contracts leaf changes protected build pin identities through closure maintenance, not expected results or eligibility. Source observation preserves existing capability and limitations.
