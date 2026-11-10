# D4b producer handoff: retry-safe attested Discovery verification

Design correction round 1 for fresh independent review, 2026-11-09. Supersedes the initial draft on recovery/admission and acceptance sequencing. No implementation, migrations, database operations, or tests performed. Inspected Platform checkout HEAD `a5596988e6b7bfe0744c46dc0efd5e184e65e12b` (root described main dbb3fa4 plus A4 checkpoint). Root must record the exact final implementation base and reserve paths before dispatch. This document is a proposed engineering realization of Blocker A, not V4 acceptance or authority to broaden product scope.

## Authority and correction to the older handoff

Read root, packages, evaluator, discovery, apps, db and tests AGENTS; D4 unblock Blocker A/B; orchestration V4d; discovery shapes freeze; F6; A1a/A1b/A1c financial-attestation handoff and current source. Blocker A and V4d describe the old `jobs.ts` implementation. Current product `composeVerification` calls `composeFinancialVerification`, which returns `createFinancialAttestationJobs`. Implement here, preserving the current exact-byte attested execution. Do not route Discovery through legacy `createVerificationJobs` or alter its behavior.

A1c reviewer HTTP remains unchanged: same authorization, routes, strict body, response/status, `enqueue(candidate, task?)`, `get(jobId)`, and `drain()`. A request key is an internal server capability association, never an HTTP/body/model-selected parameter. No new provider, customer capability policy, approval, parent writes, fixture choice, protected truth access, or bootstrap verification is included.

Older V4 text says bootstrap-bearing financial evidence support is always unavailable. Current evaluator AGENTS and accepted A1 implementation permit fresh financial verification of those exact profiles while explicitly withholding metadata/bootstrap authority. Preserve current A1 execution and mandatory coverage; do not restore old unconditional behavior, strip bootstrap, or claim financial eligibility proves combined readiness. Independent bootstrap and activation gates remain separate.

## Observed implementation constraints

* `financial-attestation-jobs.ts:enqueue` allocates UUID, re-resolves candidate, reads the complete registered capture, selects trusted fixture, probes protected bytes, checks build, constructs reservation/hash, calls registry.reserve, then starts an in-memory Promise. No request-key recovery exists.
* `financial-attestation-registry.ts:reserve` validates exact request and registered candidate, then owns a pool transaction containing max-three run/account budget upsert, queued job insert and immutable financial reservation insert. `start` atomically updates queued to running and reconstructs/validates saved canonical bytes, then resolves registered candidate outside its transaction. `complete` row-locks job; validates saved request plus sanitized completion; atomically writes report, attestation and completed summary. Exact duplicate completion succeeds; different completion conflicts. `fail` affects only queued/running attested jobs.
* Critically, existing jobs `run` catches **any start failure** and calls `fail`. Reusing it for competing resumptions can mark another claimant's running job failed. A new discovery execution claimant must distinguish not-claimed from failure-after-successful-claim.
* Discovery `supervisor.ts:transact` serializes BEGIN/COMMIT on its advisory-lock owner connection and invalidates on owner loss. Its claim/settle logic rechecks generation, dispatch, task revision, current and saved grants, run state and pinned capture. No ordinary-pool substitute is valid. Existing reconciliation only recognizes reads/compile/replay/compare; verification must be added explicitly by Discovery later. `repository.ts` currently emits `verificationJobs: []`.
* control008 is now present. Neither applied003/006/007 nor008 is available for this work.

## Proposed producer interfaces and ownership boundary

Keep the attested reviewer object structurally compatible. Add a separate safe export `@eapr/evaluator/discovery-verification` backed by the same attested jobs/registry primitives. Its trusted factory receives existing candidate/capture/launcher/selection/build dependencies and a **server-owned reservation gate** supplied by Discovery. No protected evaluator module becomes publicly exported.

```ts
// Internal server API; not a tool schema or HTTP input.
type EnqueueDiscoveryVerification = (input: {
  requestKey: string; // exact persisted server toolStepId
  candidate: CandidateRegistration;
  task: { runId: string; accountId: string };
}) => Promise<VerificationJob>;
```

Also provide internal read-by-request-key using the exact expected subject, and the existing safe `get(jobId)` metadata shape. The adapter is not an authorization service: the server gate must authenticate the persisted step before even returning existing results. A TaskContext projection or UUID is not sufficient authorization.

Use a two-phase internal port, so candidate/capture/probe filesystem and child I/O never happen inside the owner transaction:

1. `prepare(candidate, jobId)` outside transaction: share current A1c validation/probe/reservation construction; return opaque prepared record containing canonical request bytes/hash and validated candidate identity. It grants no authority and creates no economic/report effect. Keep this object server-local and off model/results/activity.
2. `reservePreparedOn(client, prepared, task, requestBinding)` inside caller-owned transaction: SQL-only; no nested BEGIN, pool checkout, candidate filesystem read or child launch. Extract existing budget/job/reservation insert logic without changing canonical preimages. Reviewer `reserve` wraps the shared primitive with its existing validation and own transaction.
3. `readRequestOn(client, key, expectedSubject)` SQL-only validates immutable mapping, saved request/job association and canonical bytes, returning existing job or absent. Current candidate filesystem revalidation, if needed for execution, stays outside transaction.
4. `claimQueuedOn(client, binding)` is SQL-only and produces an explicit transaction-local `claimed` or `not_claimed` result. It atomically changes only queued→running and returns saved request bytes for a claimant. This local value is not proof that COMMIT succeeded. The owner gate must return confirmed `committed` before execution. Only then does the positively known claimant revalidate saved canonical bytes and registered candidate outside the transaction and execute persisted input. It may call fail for its own subsequent validation/execution error. A nonwinner or unknown-commit caller must never call fail or launch. Existing financial `start`, reviewer run/enqueue/get/drain semantics remain unchanged; do not quietly change those APIs to this new result type. No launch from caller-supplied prepared bytes after reservation.

`enqueueDiscoveryVerification` coordinates authorized historical lookup → optional preparation → new-admission gate → queued-recovery gate → external execution. Platform publishes the following concrete internal contract. Discovery implements it later using its actual private supervisor transaction machinery; no supervisor path is released in the producer assignment.

```ts
type RequestIdentity = Readonly<{
  requestKey: string; runId: string; taskId: string; accountId: string;
}>;
type PersistedBinding = Readonly<RequestIdentity & {
  dispatchId: string; admittedGeneration: number; admittedTaskRevision: number;
  proposalId: string; proposalRevision: number; assessmentRevision: number;
  subjectHash: string; subjectBytes: Uint8Array; jobId: string; requestHash: string;
}>;
type GateOutcome<T> =
  | { kind: 'committed'; value: T }
  | { kind: 'denied'; code: 'DISCOVERY_FORBIDDEN' | 'DISCOVERY_CONFLICT' |
      'VERIFICATION_SCOPE_REQUIRED' | 'DISCOVERY_PAUSED' }
  | { kind: 'owner_lost'; commit: 'not_committed' | 'unknown' };
type HistoricalLookup =
  | { kind: 'absent' }
  | { kind: 'existing'; binding: PersistedBinding; job: VerificationJob };
type AdmissionResult = { binding: PersistedBinding; job: VerificationJob };
type ClaimResult =
  | { kind: 'claimed'; binding: PersistedBinding; requestBytes: Uint8Array }
  | { kind: 'not_claimed'; binding: PersistedBinding; job: VerificationJob };
interface DiscoveryVerificationOwnerGate {
  lookup(input: RequestIdentity, sql: (
    client: PoolClient, identity: RequestIdentity
  ) => Promise<HistoricalLookup>): Promise<GateOutcome<HistoricalLookup>>;
  admit(input: RequestIdentity & { expectedSubjectHash: string }, sql: (
    client: PoolClient, original: Omit<PersistedBinding, 'jobId' | 'requestHash'>
  ) => Promise<AdmissionResult>): Promise<GateOutcome<AdmissionResult>>;
  recoverQueued(input: RequestIdentity, sql: (
    client: PoolClient, original: PersistedBinding
  ) => Promise<ClaimResult>): Promise<GateOutcome<ClaimResult>>;
}
```

RequestIdentity.taskId is resolved by the trusted adapter/gate from the persisted toolStepId association; it is not a new argument to the public enqueue signature. These callbacks are trusted producer functions injected by composition, never model-provided code. They are SQL-only, run exactly once within one invocation on the actual owner client, must finish before COMMIT, must not retain that client, launch work, perform filesystem I/O, commit/rollback, or acquire another pool connection. The gate owns rollback and performs applicable authorization/ownership checks immediately before commit. No success value escapes on rollback, owner loss or uncertain COMMIT. Retry is a fresh gate invocation after authorized mapping lookup, not callback reuse with stale prepared state. `owner_lost.commit` is `not_committed` only when rollback/no-COMMIT is established; otherwise `unknown`. Current `transact` returning undefined cannot mean committed success.

`lookup` authenticates current reviewer/run/source/account authority and persisted step identity, including terminal/interrupted steps. It does not require current proposal head, current step generation/task revision or runnable state. The SQL callback loads the immutable mapping, and gate validates its original step/dispatch/run/task association against durable history. It allows authorized inspection while paused. For an absent key it returns absent, which is not permission to admit.

`admit` is exclusively for a presently runnable, properly fenced step. It validates current task revision/generation/dispatch, whole-batch preflight, one-profile current compiled subject, assessment and capture, and constructs original binding from persisted records. Callback rechecks mapping before budget work: a racing existing mapping returns only if its original subject agrees. Gate persists the Discovery claim/reference in the same transaction; all admission origin fields are retained immutably. Its caller-supplied hash is an equality assertion, not the authoritative subject.

`recoverQueued` requires an existing exact immutable binding and current source/account authority. It authenticates the replacement owner, but does not demand the old task revision/generation or that the old proposal is current. It can atomically claim already-admitted queued work **while paused**: pause blocks new admission, not execution admitted earlier. Stale proposal/assessment makes this historical execution only. Authority denial prevents claim. The callback validates binding/job association and performs queued-only claim; it never reserves budget or updates original binding/current-proposal links. It is also used for initial post-admission launch, avoiding a separate unsupervised claim path.

Only `committed` plus `claimed` authorizes post-claim candidate revalidation and launch. A COMMIT acknowledgement lost after the queued→running update produces unknown ownership; do not launch or fail it. A replacement reads the mapping: if still queued it can claim; if running it exposes uncertainty and never relaunches. Likewise unknown admission COMMIT never schedules from a temporary jobId; recover the mapping first. If mapping is absent, only a new fully checked `admit` may proceed. The same requestKey always recovers the original subject; never substitute the latest proposal candidate.

Root's sequence is producer-only SQL acceptance, then a separately dispatched mandatory joint gate against the actual supervisor. A test-owned transaction/advisory lock in the first phase proves SQL behavior only. No production permissive gate/default and no advertising or mounting requestVerification/readVerification before the joint gate passes.

This extraction is necessary: a preliminary Discovery claim followed by an unrelated pool `registry.reserve` transaction leaves a pause/owner-loss window in which stale work can burn budget. Reserve the Discovery step's verification claim/reference and the keyed attested job on the same owner transaction. External probe is preparation; the successful atomic reservation is the admission point. Pause committed first prevents admission; pause after admission does not revoke that already-admitted protected execution. Settlement still obeys current authority and fences.

## Immutable identity and transaction algorithm

Define a versioned safe canonical subject containing task `{runId,accountId}` plus the exact registered candidate: spec identity/hash, artifact identity/hash, full sorted profile hashes with scopes, manifest identity/hash/company/source, snapshot identity, snapshot object hash and content hash. Use existing canonical/hash helpers; include the entire canonical registered candidate bytes in the preimage (normalize only declared sets), making every registered-object difference detectable. Explicitly compare the caller-supplied spec canonically with the authoritative getCandidate result before deriving this subject: current requireFinancialCandidate checks artifact/manifest/snapshot/profiles but omits spec. Hashing an unchecked supplied spec is insufficient. Subject excludes generated jobId, current supervisor generation, mutable proposal head, selected fixture and current build. The first successful reservation freezes those latter execution inputs in the existing financial request; replays must not select fresh pins/build or create a replacement request. Equality uses canonical bytes, with stored digest checked, not digest alone.

The immutable mapping stores exact requestKey, subject bytes/hash, task/run/account, jobId and the reserved financial requestHash. A key is globally unique, bound to one persisted tool step and exactly one job. Same key/same subject returns the existing job in any state, including failed. Same key/different subject returns safe409 conflict without new job, probe, budget or result. Reusing native provider call IDs in distinct dispatches produces distinct toolStepIds and therefore distinct requests.

The three gate operations have separate preconditions; do not implement a generic “repeat all checks” before every lookup:

1. **Historical lookup first.** Authenticate current run/source/account authority and original persisted step/request association, then read mapping. Compare supplied candidate/task against its original immutable canonical subject, not today's proposal head. Existing mapping returns its original job in every state, with zero budget/probe, even if task revision advanced or replacement changed step generation. No current-link publication occurs.
2. **New admission only if absent.** Validate runnable current step, role, task revision/dispatch/generation, batch preflight, saved/current grants and current exact one-profile compiled subject/assessment. Account must already be in trusted allowedAccountIds; no proposal capability or multi-profile splitting. Prepare externally, then `admit` repeats these new-admission checks and mapping lookup. Atomically insert existing max3 budget increment, queued job, financial reservation, mapping and Discovery claim/reference. Preserve original dispatch, admitted task/generation, proposal and assessment revisions in the mapping for historical interpretation. Unique conflict rolls back then fresh authorized lookup; no loser's UUID escapes.
3. **Execution of admitted work.** Only after confirmed admission or successful historical lookup use `recoverQueued` with the original mapping. Its confirmed claim enables external execution, including paused historical work; nonwinner observes, unknown outcome recovers by mapping. Never re-probe or update pins/build on recovery.
4. **Current settlement is separate.** Recheck current generation/dispatch/revision/authority/capture/proposal assessment before associating verification with current success. Old exact reports remain historical after proposal/finding/task changes. Do not delete/retarget binding to make stale work current.

Lock order is owner/run/task/step, then keyed mapping, budget, job/reservation, and activity last. For absent rows the step lock serializes same-key writers; PK remains the backstop. Different-key same-account writers serialize on existing budget upsert. Concurrent third-attempt requests permit exactly one reservation, even if repair orchestration is not yet mounted. No schema/grant changes for repair or finish belong here.

## Recovery and execution uncertainty

* Crash before reservation commit: no mapping/job/budget survives; authorized same-step retry may prepare anew.
* Crash after commit while job is queued: mapping recovers original job and exact saved input. The authorized recoverQueued gate may claim even while paused; only a confirmed committed claimant may launch, using the original subject regardless of later proposal/task revisions. No extra attempt is consumed. This is an explicit bounded extension of A1's original no-autonomous-retry behavior for keyed Discovery jobs only, justified by V4d recovery; legacy/reviewer recovery semantics remain unchanged.
* Running job: launcher may already have executed. Replay returns running with safe status; never launch again, reset to queued or allocate another job. Existing process may complete it. Restart does not infer completion or failure from Promise absence. Keep uncertain running non-success. On replacement discovery of running work without a positively known in-process execution owner, expose a fixed `VERIFICATION_INTERRUPTED` lifecycle diagnostic on the authorized Discovery request/tool observation and run diagnostic projection. Its fixed safe message says execution outcome is uncertain and automatic relaunch is unavailable; it records an execution observation, not a new financial eligibility or sticky-blocker policy; include only requestKey/jobId associations already authorized. This diagnostic does not change the financial VerificationJob wire or its running state, invent failure/completion, or authorize repair. If a later confirmed report is observed, show its actual state while retaining the interruption in lifecycle history. Final consumer schema publication belongs to the contracts/Discovery joint task. No lease timeout or automatic failure policy is invented. An explicit abandoned-job terminalization policy is outside this producer assignment.
* Crash after report commit/before tool settlement: replay returns the same completed job/summary. Preserve complete's exact duplicate and mismatch semantics and atomic report/attestation writes.
* Fail after a successful execution claim: current safe failed state; same key stays bound to failed job. A subsequent *distinct* legitimate repair step can use remaining budget; automatic repair policy/tool is not added.
* Owner loss after atomic reservation: no stale Discovery settlement; the admitted attested execution may finish historically. Owner loss before commit cannot be rescued through healthy ordinary pool. Mapping is visible in authorized run state even if step settlement was interrupted.

Financial read responses expose only existing sanitized job/summary/diagnostics; the separate Discovery lifecycle projection carries the interruption diagnostic described above. readVerification must bind requested job to the current run and immutable request/proposal association, then check current source/account authority; knowledge of job ID is not permission. Never return reservation bytes, attestation policy, expected results, launcher pins, roots or raw child errors to the model. Discovery verificationJobs derives actual mappings/jobs rather than pretending completion; final consumer schemas and role advertisement remain Discovery's task after producer acceptance.

## Proposed path reservations (root confirmation required)

Platform/evaluator producer: new `packages/evaluator/src/discovery-verification.ts`; focused changes `financial-attestation-jobs.ts`, `financial-attestation-registry.ts` for shared prepare/SQL reservation/claim primitives; evaluator package.json safe export; `financial-attestation-build.ts` and matching build test for the complete changed source/import closure; new `packages/evaluator/test/discovery-verification.test.ts`; `tests/integration/v4-verification-idempotency.test.ts`.

Platform DB owner: new `db/control/009_discovery_verification_requests.sql` **provisional number only**, must be later than applied008 and uniquely reserved by root. Suggested immutable `discovery_verification_requests`: request_key PK/FK discovery_tool_steps(id), unique job_id, run_id/task_id/account_id, subject_bytes+subject_hash, request_hash. Composite FK `(job_id,request_hash)` to financial_verification_reservations; add UNIQUE(id, run_id, task_id) to discovery_tool_steps in this new migration and reference that tuple from the mapping; control004 does not yet have this composite key. Store original dispatch/admitted generation/task revision/proposal/assessment revision and exact subject bytes described above as immutable binding fields. Use existing text ID style, bounded canonical bytes, hash checks, nonempty fields; SELECT/INSERT grants only, no app UPDATE/DELETE. Indexed run/job reads. No backfill of older jobs or inferred request keys. Application revalidates association and bytes; constraints supplement it. Root owns migration catalog/readiness and expected hashes, scripts or test catalog changes not implicitly assigned.

Root composition only after the mandatory joint actual-supervisor gate passes: `financial-verification-composition.ts`, `verification-composition.ts`, `discovery-composition.ts`, `composition.ts`, only exposing/injecting attested safe ports and checking the new migration for Discovery availability. Preserve existing A1c reviewer mounting on its required catalog; missing new adapter/migration keeps Discovery tools unavailable, not silent legacy fallback. Root assigns these exact paths separately.

Discovery consumer after producer-only SQL acceptance, in a separate root dispatch (no supervisor paths released now): `packages/discovery/src/verification.ts` (new), supervisor/repository/service/role plumbing and scoped tests; strict contract schemas via contracts owner if absent. Implements actual owner gate and claim/settle/reconcile semantics, one-profile current subject selection, request/read tools and honest verificationJobs. No producer modifications to these paths without explicit cross-owner assignment. No D4c, generated capability policy or live-client work.

## Mandatory deterministic acceptance evidence for implementation

Use named barriers, isolated migrated PostgreSQL and real app-role permissions; no timing sleeps as proof. This design itself runs none.

**Gate P — producer-only SQL and attested execution acceptance:** Platform tests transactional mapping/budget/claim/completion and permission constraints with explicit test-owned transactions. Such a harness is not proof of supervisor fencing, current grants or lifecycle recovery. Complete items2/3/5/7/8 below plus producer crash/commit-uncertainty cases from item1 and producer redaction/binding portions of item6. Publish typed ports and independently review the exact producer candidate/migration. Gate P can unblock separate Discovery implementation, but cannot enable or advertise the tools.

**Gate J — mandatory joint actual-supervisor acceptance, later root dispatch:** Discovery implements this typed gate using actual supervisor transact/loadStep/reconciliation and original-history reads, with the producer. Complete item1 end-to-end and items4/6 plus all boundary cases below using the real lifecycle connection and replacement. Reserve later consumer paths and tests explicitly; root may assign a separate `tests/integration/v4-verification-owner-fencing.test.ts` rather than share the producer test file. Only passing Gate J plus root's exact-candidate acceptance permits composition/advertisement. No fake advisory-lock harness counts as Gate J.

1. Crash at before-commit/after-commit/before-launch/after-start/after-completion/before-tool-settlement barriers. Assert exact counts of mapping, budget, queued/running/completed job, reservation, report and attestation; restart service for Gate P and actual supervisor for Gate J and recover same job without duplicated launch. Lose COMMIT acknowledgement after admission and after queued→running separately: never schedule from an unconfirmed local result; mapping lookup recovers original queued job or safely diagnoses uncertain running. Inject post-claim candidate revalidation failure separately from a losing claim: only a positively confirmed claimant may fail its job.
2. Same key concurrent exact calls: one budget and job, one launcher claim; losing start cannot fail winner. Same key altered artifact/profile/scope/manifest/snapshot/task rejects409; existing mapping lookup needs no fresh probe and remains same job across current build/pin changes.
3. Two different keys with attempts already2: exactly one becomes attempt3; other conflicts without orphan committed reservation. Failed/uncertain/completed same-key replays consume zero further attempts. New dispatch with reused native provider ID remains a distinct key.
4. Pause before admission, owner connection loss while ordinary pool remains healthy, generation replacement, task revision change, revoked current grants, wrong run/task/account/source/capture, multi-profile registration, stale proposal/assessment: fail before budget/launch or prevent current settlement according to the admission boundary. Revocation observation stays sticky across resume/policy restoration. Explicit barrier: reserve → change proposal/finding assessment or advance task revision → restart → historical lookup and queued recovery return original job with zero new budget and no current-success link. Exercise both paused lookup-only and paused queued recovery; running recovery emits VERIFICATION_INTERRUPTED without changing financial state.
5. Actual A1 exact-byte captured reservation/execute/completion path: real protected execution in focused integration, complete mandatory checks retained; forged eligible JSON, mutated reserved canonical bytes/hash/index, mismatch completion, missing mandatory coverage rejected. Completion/fail races and exact duplicate completion remain covered.
6. Reader cross-run/account denial and current authority before replay; safe result/transcript/activity contain no truth/root/pin/raw stderr. Foreign job cannot appear in verificationJobs. No parent/runtime writes.
7. Application cannot mutate/delete mapping or attestations; mapping/FK uniqueness and rollback validated. Existing reviewer route body/status/auth/attempt behavior, legacy historical reads without provenance, A1c and bootstrap regressions remain intact.
8. Build-closure verification includes every newly imported producer/registry module and confirms changed code invalidates build. Reissue financial reports/pins as required for subsequent evidence; do not claim prior installed policy matches changed source.

Run typecheck, focused evaluator units, idempotency integration plus affected financial-attestation registry/composition and reviewer route regressions on root's assigned DB lease. Report focused results as partial. Producer Gate P acceptance needs exact commit, migration identity/catalog integration, published export/signature, current source closure and independent exact-candidate review. Discovery implementation can consume after Gate P; product mounting/advertisement requires separate Gate J acceptance. V4/live/user acceptance remains unclaimed.

## Decisions and remaining gaps

Routine engineering proposals for review: separate immutable mapping table instead of modifying old jobs; shared SQL-only registry primitive; owner-transaction gate; canonical full candidate subject; queued-only recovery; uncertain running remains non-success. They implement existing retry/authority constraints without new financial rules.

Root has selected split Gate P/Gate J acceptance and no current Discovery supervisor path release. Root must still confirm migration number, producer/catalog/test-fixture path reservations and later joint gate dispatch. The V4d high-level function alone does not define an authenticated transaction gate; this document supplies that necessary engineering port for review. If owner integration cannot provide it, do not weaken fencing by pool-based reserve after claim.

Material policy remains outside scope: generated parent/account IDs obtaining read/verify capability (Blocker B); automated interrupted-running terminalization/retry policy; repair/finish (Blocker C); live provider configuration (Blocker D). Existing trusted-scope interim rule is sufficient for this producer. Surface untrusted proposals as blocked and retain safe uncertainty rather than inventing product rules.
