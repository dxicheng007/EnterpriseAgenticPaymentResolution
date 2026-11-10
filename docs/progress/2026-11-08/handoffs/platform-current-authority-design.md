# Narrow current-authority and status-fence design

Status: design preparation only. No implementation, plan, route, migration reservation or approval. Requires fresh independent review and root reservations before dispatch. No tracked files, database state, tests or commits changed.

## Purpose and authoritative boundary

Provide one authoritative current execution fence for an already committed A5 customer grant, internal reviewer status commands, and a narrow current-authority read. This is not full ConnectionState or an application writer. There are no financial mutations, capture changes, scheduler, source producer changes, new model access, reenrollment, repair/version switching, or new approval rules.

Sources: PRD §§10–13/19; freeze F1/F3/F5/F7; shared-contracts current status/signatures and lock order (lines99–155); broader P3 design §§2–3 (still proposals where marked); actual `apps/worker/src/activation.ts`, `activation-validation.ts:77–84`, `source-semantics-client.ts`, `packages/parent/src/activation-store.ts:193,233,369`, `packages/parent/src/persistence.ts`, `packages/contracts/src/activation-authority.ts:77`, `db/runtime/002_parent_activation.sql`, and existing reviewer/service authentication boundaries.

Already specified: only explicit per-customer reviewer approval establishes standing authority; pause/resume/revoke operate on it; resume requires unchanged approved semantics; revoked authority cannot resume; original grant/receipt remain historical; future apply rechecks active epoch under the same lock as revoke; semantic observation happens outside runtime SQL locks; existing event-declared dependencies protect subsequently arriving changes. The specific DTOs, command retry namespace and epoch conventions below are technical proposals for review, not newly discovered product policy.

## 1. Identity and read shapes

All schemas strict, existing guarded Id/Scope/Hash/IsoInstant primitives, unknown/prototype keys rejected. Epochs are positive **safe** integers; arithmetic uses checked addition. No hash is authentication.

```ts
type CommittedAuthorityIdentityV1 = {
  scope: Scope;
  activationId: Id;
  bundleHash: Hash;
};
type CurrentAuthorityV1 = {
  schemaVersion: '1';
  identity: CommittedAuthorityIdentityV1;
  sourceRef: Id;
  artifactHash: Hash;
  profileHash: Hash;
  manifestHash: Hash;
  status: 'active' | 'paused' | 'revoked';
  epoch: number;
  changedAt: IsoInstant;
};
```

Resolve identity only through `readStoredActivation(client, identity.scope)`, then require activation.id and stored.bundleHash to match. Derive sourceRef/artifact/profile/manifest and the exact selected profile from the decoded committed bundle. An unregistered caller assertion, registry scope entry, existing capture lane, uploaded artifact, or balance is not authority. Missing/mismatched committed identity is404 `AUTHORITY_NOT_FOUND`; malformed/corrupt persisted bindings are503 `AUTHORITY_STORAGE_INVALID`.

The initial effective state is the committed activation's active/epoch1, changedAt=approvedAt. The mutable head, when materialized, must match that exact immutable grant identity and pins. There is no implicit grant beyond A5 and no current-head selection by latest registry artifact.

`readCurrentAuthority(identity):Promise<CurrentAuthorityV1>` is an internal read under an already authorized account/source boundary. It does not create a head. If no materialized head exists but genuine matching A5 import does, it projects the original state only when no prior status command history exists for that committed identity. If history exists without its head, return AUTHORITY_STORAGE_INVALID; check head absence and history in the same read snapshot, never project epoch1 over lost current authority. Do not return invented inactive/epoch0 state for an unknown identity; this narrow API requires a committed identity. A later connections list may represent inactive accounts separately under its own contract.

Read original import and current head in one consistent SQL snapshot (single statement or a short read-only REPEATABLE READ transaction). Verify canonical integrity before returning. The read can legitimately precede a concurrent transition; consumers use epoch, not request completion time, to order state.

`ActivationStateV1` and its existing parent/activation route remain unchanged: its activation and initial receipt must keep matching original epoch1. Current read does not return initial receipt, capture/application progress, balances, reconciliation, current target version, last sync receipt or runtime model counters. No public route is added by this design.

## 2. Commands and immutable results

```ts
type AuthorityStatusCommandV1 = {
  schemaVersion: '1';
  identity: CommittedAuthorityIdentityV1;
  action: 'pause' | 'resume' | 'revoke';
  expectedEpoch: number;
  idempotencyKey: Id;
};
type AuthorityStatusResultV1 = {
  schemaVersion: '1';
  identity: CommittedAuthorityIdentityV1;
  idempotencyKey: Id;
  action: 'pause' | 'resume' | 'revoke';
  beforeStatus: 'active' | 'paused' | 'revoked';
  beforeEpoch: number;
  state: CurrentAuthorityV1;
  changed: boolean;
  committedAt: IsoInstant;
};
type AuthorityStatusResponseV1 = {
  result: AuthorityStatusResultV1;
  replayed: boolean;
};
```

Exact command result is immutable audit/recovery material, **not a monetary SyncReceipt**. Replay returns byte-identical result with replayed=true; it may describe a state subsequently changed by another command. Consumers refetch current authority; never label an old replay result as current by virtue of response time.

Idempotency key namespace is `(scope.accountId,idempotencyKey)`. Account IDs are globally unique under F1. Command binding includes full scope, original activationId and bundleHash, action, expectedEpoch, and authenticated reviewerId. Canonical preimage is exactly `{command:AuthorityStatusCommandV1,reviewerId:Id}`. Different canonical binding at an occupied key is409 `AUTHORITY_IDEMPOTENCY_CONFLICT`, including another reviewer or later activation. This is a status namespace, separate from A5 activation request keys; never query initial activation receipts using it.

Persist original complete ReviewerContext `{reviewerId,sessionId}` for audit, but exclude sessionId from command digest. The same authorized reviewer may retry the exact command from a new authenticated session; recovery still returns the original session's immutable audit result. Current session/account/source authorization is required on every retry. Another reviewer cannot retrieve that command through the mutation retry interface. No generic command-history enumeration is introduced.

Persist only successful transitions and successful same-state no-ops. Failed input, authorization, stale epoch, revoked resume, semantics or unavailable storage does not consume a key. A future attempt with the same key is compared against a committed winner if one exists; otherwise it remains a new attempt. Do not fabricate durable rejected-command authority.

## 3. Trustworthy reviewer admission

A body field named reviewerId/sessionId is not authentication. Do not expose `setStatus(command, actorFromJson)` to a product tool, public transport or untrusted callback.

The service consumes an **opaque, request-bound admission capability**, alongside the command. Its constructor is private to a future trusted ingress adapter; its binding is tracked in a WeakMap (or equivalent nonserializable checked identity), not accepted by structural TypeScript cast. Bound data: exact command canonical hash, authenticated reviewer context, accountId and sourceRef authorized by that ingress. Service verifies capability matches this request and the committed bundle's actual source/scope before any state lookup is exposed. Capability expires with the admitted request; recovery after restart requires fresh admission. No public mint function, JSON form or artifact embedding.

Trust path for a later browser integration, without implementing it here:

1. Control's existing `authorizeReviewer(request,{mutation:true})` obtains server-managed reviewer/session, enforces session/origin/CSRF, rejects task/service/operator credential masquerading, and supplies allowedAccountIds/allowedSourceRefs. The trusted control action checks both grants against the exact stored activation source/scope. The browser supplies only command intent/expected epoch/key; never actor or grants.
2. Worker ingress authenticates the trusted control service using the existing separate local-service capability pattern before parsing/using forwarded command or server-constructed actor. It also checks the exact command/source/account binding before creating the opaque admission. Any future forwarded reviewer assertion is accepted only over this authenticated control channel, not merely because it validates as ReviewerContext.
3. This is the existing local-demo trust assumption: the trusted control service asserts that it performed reviewer checks. Worker cannot independently query control's in-memory browser session. An opaque in-process object or bearer does not cryptographically prove a human click. A compromised trusted control process/host is outside this demo boundary. Do not claim otherwise.

The ingress adapter and capability mint are **not implemented/mounted by this design**. A future internal service test may receive a test-only adapter owned by the test harness; no production “allow all” adapter or freely exported actor mint. A reviewed service-only implementation must make construction of the trusted admission an explicit injected composition capability, unavailable to product agents, and verify object identity plus exact command binding. If implementers cannot provide that separation without opening an unverified actor port, stop at repository/internal transaction tests until the ingress contract is reviewed. No unsigned browser actor DTO is an acceptable shortcut.

For reads the analogous trusted adapter checks read-session/account/source grants (no CSRF mutation requirement), and private worker service capability. Repository internals may accept scope for SQL access, but they are not public authorized APIs. No task context is interchangeable with reviewer admission.

## 4. Transition table and epoch rules

All non-replay commands first require expectedEpoch=current epoch, including same-state requests. There is no wildcard epoch or bulk customer action.

| Current | Action | Result |
| --- | --- | --- |
| active | pause | paused, epoch+1, changed=true |
| active | resume | active, same epoch, changed=false |
| active | revoke | revoked, epoch+1, changed=true |
| paused | pause | paused, same epoch, changed=false |
| paused | resume | active, epoch+1, changed=true, requires semantics preflight |
| paused | revoke | revoked, epoch+1, changed=true |
| revoked | revoke | revoked, same epoch, changed=false |
| revoked | pause or resume |409 AUTHORITY_REVOKED; no mutation |

A real transition's changedAt equals its committedAt from one injected runtime clock reading for the successful transaction. Same-state no-op leaves state.changedAt intact but logs its own committedAt. Epoch increment beyond MAX_SAFE_INTEGER fails409 `AUTHORITY_EPOCH_EXHAUSTED`; no wrap or partial log. A no-op at maximum epoch remains possible. Replayed result keeps original timestamps.

Resume means only paused→active for the exact existing pins. Active→resume no-op requires current authorization/epoch but no network preflight because it does not restore or broaden authority. Pause/revoke/no-op/replay do not depend on source availability, current operator activation policy files, evaluator artifacts on disk, or newly issued verification. The committed grant and saved immutable bundle are the provenance. Corrupt saved authority still fails closed; missing new-activation setup must not trap a customer in active status.

No command changes grant pins, baseline cursors, allowed kinds, limits, reviewer approval history or target records. No command clears source/data/dependency holds. Status active means the standing grant is enabled, not that any input is valid or fully reconciled. Reenrollment after revoke remains unsupported by this gate; runtime002's immutable unique-per-account import is preserved.

## 5. Resume semantics preflight and recovery

Use the existing injected `observe(sourceRef):Promise<SemanticPreflight>` backed by `createSourceSemanticsClient`. Preserve fixed allowlisted loopback origin, separate source-read token, redirects denied, 2-second timeout and 256KiB response cap. No new source client or producer is introduced. Never accept an observation supplied in command JSON.

For a potential paused→active transition:

1. After fresh reviewer admission, look up committed status-command association first. An exact result returns immediately even if source service is down, state later revoked, or the expected epoch is now old. Conflicting key returns409. This ordering never bypasses current authorization.
2. Resolve exact immutable A5 identity and read effective current head. Reject stale/revoked input before network I/O where possible. Select the exact committed profile; never use latest registry profile.
3. Outside runtime transaction obtain observation and apply the **same semantic equality rules as `validateSemantics`**: exact sourceRef, no `*` in observation or baseline manifest, every approved source account has its `seller/sourceAccount` entry in both manifest and observation, both equal profile.semanticVersion. Other known customer revisions do not invalidate this account. Revision IDs are opaque; no lexical ordering.
4. Missing/malformed/unavailable observation fails503 `AUTHORITY_SEMANTICS_UNAVAILABLE`; declared mismatch fails409 `AUTHORITY_SEMANTICS_MISMATCH`. Before returning a preflight failure, recheck whether the exact concurrent command committed; if so recover that result. A conflicting winner remains409. This mirrors A5 lost-response recovery without accepting new work.
5. Open the short runtime transaction, lock/recheck head and expected epoch. Observation must be the worker-acquired one bound to the same original source/profile/manifest and this attempted command, not a previously persisted preflight reused for a different command. Recheck committed command association under lock before applying. If the head changed while observing, return stale or exact replay; do not silently target a new epoch.

Persist successful resume observation canonical bytes/digest, worker observation-start/completion instants and binding to command in the immutable command log. Source checkedAt is evidence, not authorization or a lease. No new wall-clock TTL is invented; the worker performs observation for this attempt, and expected-epoch CAS prevents local transition races. Existing bounded transaction retries may reuse that attempt's observation after rechecking head; they do not create a claim of atomic source/runtime time.

As in F5, a semantic change may arrive after observation. Future application must independently enforce event schema/semantic dependencies and source-wide/scoped holds before money commits. This status gate alone cannot prove full drift safety or observe unnotified document changes. The existing semantics API supplies revisions, not comprehensive current schema/document bytes: do not claim this resume response attests independently to current source-schema identity or completed governing-document feed coverage. Pinned artifact/profile remain unchanged; any separately observed data/schema holds remain untouched.

## 6. Persistence and shared transaction fence

No migration number or paths reserved. Conceptually add only a current authority head and immutable status-command log; no ongoing receipt/outcome or application checkpoint tables.

Head: one row per account, exact full scope and original activation FK, bundle/artifact/profile/manifest/source pins, current status/epoch/changedAt. A materialized head is never deleted or reset. Runtime app-role privileges are SELECT/INSERT and column-limited UPDATE(status, epoch, changedAt) only, with no DELETE/TRUNCATE. Mutable columns are limited to status/epoch/changedAt. Initial head derived from matching committed import, active/epoch1/approvedAt. Scoped FKs/checks and canonical read validation prevent an account row from claiming another activation. Existing original import/receipt and parent snapshot triggers remain unchanged.

Command log: PK(accountId,idempotencyKey), exact canonical command/hash, canonical original reviewer audit/hash, immutable result/hash, optional resume observation/binding/hash only for successful paused→active. Exactly match head/grant scope and immutable activation identity through enforced, noncascading FKs. Command-to-head, command-to-grant and head-to-grant references must not cascade deletion; deleting a referenced head/grant fails rather than erasing authority history. Application roles insert/select log only, cannot update/delete. No raw session cookie/CSRF token, service/source token, environment, source document or protected truth. SessionId is an existing audit identifier, not an authentication secret; it stays internal to audit storage and is omitted from read/result/activity DTOs.

Transaction sequence for status mutation:

- Use existing `withTransaction` bounded40001/40P01 retry policy with one checked-out connection. Network observes only before it.
- Acquire existing `parent-scope` advisory key with `lockParentKeys`; resolve/decode committed identity and check head absence together with prior command history under this scope lock. If history exists without its head, fail AUTHORITY_STORAGE_INVALID; materialize an absent head at epoch1 only when no prior status command history exists. Lock head FOR UPDATE. Existing A5 first-import scope/import-key/target ordering remains unchanged. No command can create authority without its committed import.
- Under head lock, recover exact command or reject conflicting binding; otherwise require expected epoch and evaluate table. New key inserts/no-op log are serialized by the account lock, no extra reverse-order command lock required.
- Apply checked status/epoch change and append immutable result/actor/preflight log. Publish safe runtime activity last for a real transition. Commit then return. Failure rolls back head/log/activity together; a no-op may materialize equivalent initial head and append a command but never changes effective authority.

Status does **not** lock a target or economic/delivery keys because it changes no financial records. It holds the prefix of the future apply lock order. Future `applyBatch` must hold parent-scope → head → target → one complete `lockImportIdentities` set → application outcome/progress locks → activity, check exact grant and active expectedEpoch under head lock, and retain it until the monetary transaction commits. No capture call or checkpoint lock while holding these locks. Capture only uses its accepted capture/global identity path; it must never acquire an authority head in reverse.

Future barrier semantics: if revoke owns/commits the head first, a prepared old-epoch plan cannot commit; if apply holds head and commits first, revoke waits and then commits—earlier financial effects remain valid and recoverable. There is no promise to undo committed records or instantaneous cancellation of a transaction that won the lock. Pause similarly fences old prepared work; subsequent resume increments again, preventing an old pre-pause plan from matching renewed active state. Exact monetary receipt recovery later may return an existing receipt after revoke without creating new writes.

Current-head-only tests cannot prove future apply obeys this protocol. The writer's independent gate must implement and test this consumer contract before claiming revocation-race acceptance.

## 7. Safe activity and failure responses

Real transitions publish existing allowlisted types: pause→`connection.paused`; revoke→`connection.revoked`. For resume use existing `system.status` with phase run and status active, avoiding an unreviewed new activity type or sanitizer edit. All three use scope, injected committedAt and payload exactly `{status,artifactHash,profileHash,manifestHash}`. Epoch/action key are deliberately absent because current payload allowlist does not retain them; activity invalidates/refetches current authority. Do not claim that event payload alone reconstructs current epoch.

No new activity on command replay or no-op; durable command log is audit. Persist activity/counter in the same runtime transaction, and emit only after commit through existing eventual infrastructure. No routes/emitter/composition added here. Source or preflight failures do not emit successful status activity.

Safe typed errors: malformed command400; missing/invalid ingress401/403; missing exact committed authority404; key conflict/stale epoch/revoked/semantic mismatch/epoch exhaustion409; source observation unavailable503; persisted-state corruption503; other storage failures503. Safe codes/fixed messages and correlation ID only at a future transport boundary, no raw exception text or SQL. Failures do not return a “pending” committed authority result. Lost response is resolved by authorized retry of exact command; no unauthenticated key lookup.

## 8. Required review/test scenarios (not tests run)

- Genuine A5 import initializes/projected head; registry-only scope, fake actor object and mismatched identity never establish authority. Original activation, initial receipt and every parent record/snapshot remain byte-identical.
- First read has no writes; concurrent first command initializes one head. Current read uses a consistent snapshot and cannot pair pins from one grant with another state.
- Every transition/no-op in table; expected-epoch mismatch on no-op; max-safe epoch increment rejection; revoked resume/pause rejection; no-op retains changedAt; status never clears data holds.
- Exact retry returns original result after later state transitions; new session of same authorized reviewer recovers; another reviewer or changed action/identity/expectedEpoch at same key conflicts. Different accounts can reuse a key without exposing another result.
- Admission is bound to exact command/source/account and generated only by trusted ingress; forged JSON grants/actor, product-task caller, wrong service capability, expired/missing session or CSRF and insufficient account/source grant are rejected by eventual adapter tests. Repository tests alone do not establish this boundary.
- Pause/revoke succeed with source observation unavailable and absent new-activation policy files. Resume mismatch/unknown semantic key/wildcard holds; another known account's revision does not block this account. No source/model calls occur under SQL locks.
- Barrier: resume observes, another command changes epoch, resume cannot commit to new epoch. Barrier: same key concurrent winner commits while loser preflight fails, loser recovers exact result. Observation failure with no winner leaves no log/transition. Post-observation semantic changes remain explicitly an apply gate.
- Assert head app-role SELECT/INSERT and column-limited status/epoch/changedAt UPDATE only; DELETE/TRUNCATE and updates to immutable identity/pins are denied. Assert command/head/grant FKs are noncascading and referenced-head/grant deletion cannot erase history. A missing-head-with-command-history corruption fixture must make both consistent reads and scope-locked mutations fail AUTHORITY_STORAGE_INVALID without projecting or recreating epoch1, even if ordinary application SQL cannot create this corruption.
- Transaction failure after head update before command/activity rolls back all; failure after commit/lost response recovers same result. Command log/app-role immutability and FKs; corrupt canonical head/log/bundle fails closed.
- Existing activity sanitizer preserves exact chosen payload; no secret/raw source/audit session data leaks; per-stream sequence rollback/replay remains F7.
- Later integration only: prepared apply/revoke and apply/pause/resume barriers verify the future writer actually shares head fence. No financial property is declared passed here.

## Open issues and limits

No absent financial/product rule was found that blocks this narrow design. Epoch/no-op/idempotency/session-retry conventions are explicit technical choices for independent review. Read current state and mutate status do not imply permission to reinterpret or apply financial input.

Two concrete integration dependencies remain: a separately reviewed trusted reviewer-to-worker admission adapter before any product mutation surface is mounted; and future apply's current-head/semantic-dependency enforcement before revocation or resume can be claimed safe end to end. Existing source-semantics capability is preserved, but complete governing-document/schema notification remains an independently identified source-producer coverage gate. Reenrollment/version switching and full ConnectionState remain excluded.

No path, table name, migration number, route or implementation ownership is reserved by this preparation. New contract exports will require normal protected-build closure maintenance if/when accepted; this design makes no evaluator or expectation change.
