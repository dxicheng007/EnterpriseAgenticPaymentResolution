# Discovery PR 15 / Gate J exact-candidate integration review

Candidate: `7012a4d227cc73b6fba0121fedff6dbe68daed4b`.
Comparison target: `origin/main` = `aafe7aeec8529e080cc3caf3f38c9b51c894fe71`.
Candidate merge base: `4c91b217a34904ffd85667f18af28fbfa7049a63`.

**Specification verdict: FAIL — Gate J is not satisfied.**

**Engineering-quality verdict: FAIL — authorization/recovery defects and missing mandatory owner-fencing evidence block acceptance.**

Do not mount or advertise this candidate as an accepted Gate J implementation. This review neither reopens accepted Gate P nor authorizes generated-account grants, live configuration, repair/finish, activation, or V4 acceptance.

## Method and authority

Read-only review of the supplied `/private/tmp/eapr-discovery-gate-j-review.diff`, candidate-owned changes identified against its merge base, and exact candidate files using `git show 7012a4d:path`. All code line numbers below refer to that exact candidate, not the dirty workspace. The newer-main review-details files and normative documents absent from the candidate are branch divergence, not findings that this PR deletes them. Integration must preserve that newer main work.

Authority: `docs/progress/2026-11-08/handoffs/platform-discovery-verification-consumer-handoff.md`; accepted adapter design and its correction review; accepted Gate P producer review; repository and Discovery guidance. Also read **the normative interim capability freeze directly from origin/main**: `docs/superpowers/plans/2026-11-09-contract-freeze-discovery-verification-capability-interim.md`. Its absence from the candidate does not remove its requirements.

No checkout, source edits, database access, tests, process startup, external messages, or subagents. Only this report was written. This is source review, not independently executed machine evidence.

## Prioritized findings

### 1. [P1] Reauthenticate after the producer callback before committing a reservation or execution claim

**Candidate locations:** `packages/discovery/src/verification-tools.ts:176–179, 193–198, 247, 251–275`; `packages/discovery/src/supervisor.ts:247–256`.

`authorizeStep` calls `permits` once, before the SQL callback. All three gates then return the callback directly. The transaction runner checks only its connection-valid flag before COMMIT, never current grants. A current source/account revocation while producer SQL is awaiting a query therefore does not roll back admission or the queued-to-running claim. In particular, block the claim's job query/update, revoke `resolveAuthority`, then release it: the callback can commit `claimed`, and the accepted producer immediately launches saved execution. A later Discovery settlement denial cannot undo that launch. This contradicts the required current-authority check immediately before COMMIT, including recovery while paused.

The admission gate also omits the required repeat of accepted-dispatch/batch integrity, current task attempt/revision, capture and full-batch preflight after external preparation (`authorizeStep` only checks running task, running step and generation). The initial `loadStep` checks cannot stand in for the gate after preparation. Its Discovery step claim/activity commit separately at `supervisor.ts:1234–1244`, before producer admission, rather than in the reservation/mapping transaction.

**Required correction:** keep the actual owner client/queue, add SQL-only locked-record admission/historical validation and a final authority check after the producer callback; roll back all financial and Discovery claim effects on failure. Persist observed revocation separately under the owner fence. Exercise revoke-during-admission and revoke-during-claim barriers, not only a check before entering the tool.

### 2. [P1] Filter verification associations by current task/account authorization, including saved action responses

**Candidate location:** `packages/discovery/src/repository.ts:143–149`; related `:181–185, 232–238, 249–253`.

The new state projection selects every mapping with the run ID. `authorizeRun` verifies reviewer/source identity but ignores the returned account grants and task coverage. After successfully admitting account A, remove A from current `allowedAccountIds` while retaining the source capability: `readState` still returns A's proposal revision/job ID. A pause/resume response saved before revocation can also replay the same unauthorized references directly from `saved.response`.

This is reachable through the normal state and action APIs without corrupting storage. The interim freeze limits verify-related reads to already trusted current authority; the consumer handoff explicitly rejects a run-only join and requires saved-response reauthorization.

**Required correction:** same-snapshot validation of each original task/step/dispatch/proposal/assessment/subject/job association and saved/current account/source authority, with canonical safe projection; reauthorize or safely rebuild verification references on idempotent action replay.

### 3. [P1] Validate all remaining verification calls before any earlier batch effect

**Candidate location:** `packages/discovery/src/supervisor.ts:1116–1138`.

Although syntax parsing covers remaining calls, semantic request/read validation is guarded by `step.id === item.id`. A batch containing a valid source read or finding publication followed by a syntactically valid verification request for an absent/untrusted/uncompiled subject lets the earlier call commit; only execution of the later step discovers the invalid subject. Similarly a later unknown `jobId` does not prevent earlier success. Verification scope/read denials are per-step results rather than batch-preflight failures.

There is no projection of all prospective verification admissions against `verification_attempt_budgets`, nor use of preceding projected finding/proposal assessments for later verification. With two consumed attempts and two requests in the batch, the first can consume attempt three and start work before the second fails. Producer max-three SQL enforcement remains correct, but it does not provide the required all-batch no-earlier-success guarantee.

**Required correction:** resolve and validate every remaining request/read, projected assessment change and cumulative run/account attempt requirement before any successful effect; repeat relevant checks in `admit` after preparation. Include current registry/full-subject validation in that preflight. Add mixed-batch and last-attempt tests with zero earlier effects asserted.

### 4. [P1] Implement recovery independently of runnable/current-attempt scheduling and current proposal/registry reads

**Candidate locations:** `packages/discovery/src/supervisor.ts:336–355, 1118–1123, 1381–1383`; `packages/discovery/src/service.ts:53–67`; `packages/discovery/src/verification-tools.ts:70–79`.

The only acquisition reconciliation change marks older running verification steps interrupted. It never scans the admitted 009 mappings or invokes queued recovery. The service still schedules only queued/running runs and the current task attempt. Thus admission → owner loss before claim → pause/new task attempt leaves the original queued job unexecuted indefinitely. Paused verification revocation also receives no recovery observation: the only paused refencing call at acquisition handles source-read names. Restore authority and resume, and an unobserved abandoned verification step can succeed, contrary to sticky revoked-authority recovery requirements.

Even manually invoking a replacement's pending step does not implement historical recovery: `loadStep` requires current running task/attempt and its revision arithmetic; `loadVerificationSubject({historical:true})` still calls `loadCompileSubject`, which selects only the current proposal revision (`compilation.ts:124–131`) and still requires state `compiled`; `executeVerificationClaim` then reads the external candidate registry. Advancing the proposal head, invalidating the compiled state, changing task revision, or making the registry unavailable prevents recovery of already admitted immutable work. The final commit only relaxes assessment-clear checking; it does not reconstruct the original candidate from saved subject bytes.

**Required correction:** bounded admitted-mapping recovery on acquisition and ticks, independent of model/runnable/current-attempt scheduling; separately authenticated original subject/dispatch/assessment reconstruction; current source/account authorization; queued-only claim with no new budget/preparation; no current-success link for stale work. Cover terminal original steps, paused runs, new attempts, changed heads and missing current registry reads.

### 5. [P1] Classify COMMIT sent without acknowledgement as unknown

**Candidate location:** `packages/discovery/src/supervisor.ts:244–260`.

`committed` becomes true only after `await client.query('COMMIT')` resolves. If PostgreSQL commits admission or the queued-to-running update but the acknowledgement is lost and the owner is invalidated, the catch returns `owner_lost/not_committed`. A subsequent ROLLBACK cannot establish that the earlier COMMIT did not commit. This is exactly the ambiguity the owner outcome port exists to preserve.

The accepted producer currently throws on either owner-loss variant, so this finding does **not** claim this branch alone launches or duplicates work. It does make the actual gate's certainty contract false and prevents the required recovery proof. A COMMIT-query rejection while `valid` remains true also propagates as a generic exception instead of conservatively invalidating/recording unknown ownership.

**Required correction:** record COMMIT-attempted before sending; return unknown for unconfirmed COMMIT regardless of later rollback success, never publish callback values on loss, preserve ordinary SQL errors before ambiguous commit, and prove admission and claim ambiguity at the real owner's query boundary with durable database observations.

### 6. [P1] Prevent current tool success after pause and recheck the pinned capture at settlement

**Candidate location:** `packages/discovery/src/supervisor.ts:1440–1475`.

Current verification settlement verifies generation/task revision, grants and proposal assessment, but never checks `runnable(run)` or rechecks the pinned capture. `loadStep` itself does not reject paused runs. Use the existing `afterVerificationEnqueue` barrier to pause via the repository, then release it: the run is paused, task revision and clear proposal remain unchanged, and this code can still call `resolveStep` with success and publish the current tool result. The handoff explicitly permits financial completion to continue independently but forbids current Discovery success after pause.

Likewise capture changes during producer preparation/execution are not revalidated at settlement; the claim does not retain the capture facts used during initial preflight. Compare the replay settlement's explicit `recheck` at `:1502`.

**Required correction:** recheck current run execution state, pinned capture, exact compiled subject and current authority at current settlement and before commit. Preserve the historical job mapping/report when settlement is no longer allowed.

### 7. [P1] Route reads through validated original-subject history rather than raw job-table projection

**Candidate locations:** `packages/discovery/src/verification-tools.ts:281–319`; `packages/contracts/src/discovery-construction-tools.ts:226–251`.

`readVerification` accepts only `jobId`, finds a same-run/same-task mapping, and reads `verification_jobs` directly. It never validates the original accepted dispatch/tool-call integrity, canonical subject bytes/hash, historical proposal/assessment/compile association, or saved financial reservation binding; it never calls the producer's authorized `readByRequestKey`. Those checks are the required historical trust boundary, not supplied by the mapping FK alone. The current implementation does enforce same run, task and saved trusted account, so this finding does not claim that an arbitrary foreign-run ID succeeds; it identifies the missing mandatory original-subject integrity verification.

The published shape also drops the handoff's proposal ID/revision on reads/results and adds model-supplied `profileHash` on requests. Consequently the intended wrong-proposal/job-pair rejection cannot be expressed by the input. A replacement reading a running job through this path sees no `executionUncertain` observation at all.

**Required correction:** resolve the exact requested same-run proposal revision/job association, reconstruct and validate immutable original candidate/dispatch/assessment records, then use scoped producer historical lookup. Preserve current read-call fences independently from historical target authorization; return the accepted bounded safe schema and uncertainty observation.

### 8. [P2] Keep execution uncertainty out of permanent run blockers and clear the current observation after completion

**Candidate locations:** `packages/discovery/src/repository.ts:73–77`; `packages/discovery/src/supervisor.ts:1468`; related `repository.ts:162–166, 257`.

The uncertainty path appends `VERIFICATION_INTERRUPTED` permanently to `run.diagnostics`. Existing resume chooses `blocked` whenever that array is nonempty. Thus despite the helper comment and warning severity, an otherwise healthy run that observes uncertain execution becomes blocked on pause/resume. No completion path removes the current diagnostic: state maps the saved array unconditionally, and `readVerification` only reads a job. A late real completion can therefore leave the UI indefinitely claiming uncertainty. The generic `tool.result` activity also does not record the successful uncertainty observation's diagnostic code, so the required separate lifecycle history is not implemented.

**Required correction:** persist a safe historical interruption observation, derive current uncertainty only for still-running authorized associations, and remove that current projection after confirmed completion without erasing history or changing financial state. Do not reuse permanent run-blocker membership for a nonterminal warning.

### 9. [P1 / release gate] Keep production injection disabled until actual Gate J acceptance

**Candidate locations:** `apps/control/src/composition.ts:241`; `apps/control/src/verification-composition.ts:102–105`; `packages/discovery/src/roles.ts:26`.

The production local composition now forwards the protected producer dependencies automatically when control009 exists; configured connectors advertise both tools as soon as the dependencies are present. Migration version is the only new gate. The handoff reserves production composition for root after machine evidence and exact-candidate acceptance, which this candidate does not meet. Default startup still has no model client, so this is not a claim that default startup suddenly makes model calls. It is premature production capability wiring for a configured Discovery composition.

**Required correction:** retain explicit test injection while the above defects and full joint evidence are resolved; activate production wiring only in the separately recorded accepted integration step. Preserve existing reviewer verification and no-model defaults.

## Evidence audit and positive boundaries

The new integration file has seven test declarations (`tests/integration/v4-verification-owner-fencing.test.ts:292, 311, 332, 387, 407, 429, 451`). Source assertions cover missing injection, untrusted account denial, real supervisor happy path and protected completion, pause before admission, terminal same-step replay, an absent job ID, and a current-assessment mutation after enqueue. It uses real application-role PostgreSQL and a protected launcher, and includes runtime fingerprint and activity-field checks. These are useful partial tests; **none was run in this review**.

Despite its filename, the suite contains no actual owner backend termination, supervisor replacement/generation assertion, lost COMMIT acknowledgement simulation, queued claim loss barrier, paused/stale service recovery, current-grant revocation/restoration barriers, concurrent claim/budget contention, mixed-batch no-effect test, scoped state/action-replay revocation test, or `createDiscoveryService` recovery test. Its same-step replay test returns an already settled tool result and does not exercise retry after interrupted admission. Its foreign-ID test uses an absent ID, not another real run/account's mapping. Its stale-assessment test checks final settlement rejection, not historical recovery. No exact-candidate full required regression command results were supplied to this reviewer. The four unit tests inspect descriptors, pure grant intersection, error mapping and warning shape, not owner callbacks or recovery.

Positive source boundaries: each acquired supervisor constructs a fresh producer instance with its own execution map; the same dedicated advisory-lock client and serial queue are used for gate callbacks; callbacks are SQL-only; producer budget/mapping/reservation primitives are reused rather than legacy enqueue; mapping migration is unchanged; no grant-row minting or account-list widening was found; ordinary single-call untrusted scope is denied before producer enqueue; model schemas are strict and byte-bounded; no worker/model/provider path is introduced. These do not compensate for the missing actual authority fences and lifecycle behavior.

Required evidence remains the complete handoff Gate J matrix and affected regressions on the root-assigned isolated lease after corrections. Machine results, this independent source review and joint user acceptance remain separate. No Gate J, live construction, V4, financial eligibility beyond the specific protected test assertions, or user-acceptance pass is established here.
