# Explicit proposed-scope read/verification grants — design

Design for fresh independent review, November 10, 2026. Inspected Platform worktree HEAD `40a4fb800316137be824551d94633a5975f7487e`. This is a design, not an implementation plan, contract acceptance, source-path reservation, migration reservation, Gate J acceptance, or live/financial authorization. The concurrent selector writer's work is outside this review. No source, SQL, Git, database, provider, browser or test mutation/execution occurred in preparing this document; only this document was written.

## Decision and bounded outcome

The [recorded user decision](generated-scope-grant-user-decision.md) requires an **explicit trusted operator/reviewer grant for each proposed scope**. Separate explicit per-customer approval is still required before import or synchronization. A proposal, raw source tuple, successful compile, replay or financial report cannot issue its own grant.

The smallest useful increment is a control-owned, durable, run-bound grant producer and a transaction-bound authorization reader, followed by separately accepted Discovery consumers. A trusted reviewer explicitly selects the exact source/scope association from an existing persisted proposal. The server validates that selection, saves its provenance, and permits candidate verification and reads of its safe verification result. It does not append an account to general session/run/task `allowedAccountIds`, publish a runtime scope, read a parent baseline, clear a finding, or create activation authority.

The bounded reviewer ingress is part of the producer; a new browser screen is not. Preserve the current default-off `mountDiscoveryVerificationTools` gate until the separate consumer acceptance; issuing a grant alone does not advertise operational verification availability. Experience receives a small explicit-action/read contract for a later assigned UI change. Existing proposal inspection stays available under its existing source authorization even when verification capability is absent.

### Approaches

The user chose explicit trusted grants over automatic candidate grants. Preserve that choice. Of the engineering realizations:

- Updating session/run/task account arrays would reuse the current membership check but would lose exact source/scope provenance, conflict with immutable saved ceilings, and risk widening unrelated parent/reviewer reads. Reject it.
- A separate exact association grant, consumed only by Discovery verification admission and its result reads, fits the chosen policy without changing ordinary read authority. This is the proposed realization.
- A general entitlement service, bearer tokens, role-management UI, or grant on every artifact revision adds machinery or repeated policy choices beyond this task. Do not introduce it.

This is a modest cross-owner increment: one new control table, a focused control service/route, a small shared schema leaf, and one optional provenance field in the existing verification mapping/producer. Discovery integration touches several authorization checkpoints but must reuse one reader; it is not another scheduler or verifier.

## Authority already established

| Requirement | Authority and concrete seam |
| --- | --- |
| Source observations are not parent identity decisions; agents cannot grant access | [Orchestration §§2, 5, 8.1](../2026-11-08/handoffs/v4-orchestration-contract-proposal.md), particularly lines 51–53, 189, 214–220, 350; [PRD §§7–8, 19](../../../prdv2.md) |
| Saved ceilings and current policy are distinct; reauthorize before saved replay | [Discovery L2](../2026-11-08/handoffs/b-discovery-l2.md), lines 23–31; `packages/discovery/src/repository.ts:coversGrant/authorizeRun`, `supervisor.ts:permits` |
| Every profile must be trusted; denial precedes enqueue/attempt consumption; denied proposals remain inspectable | [Interim capability freeze](../../superpowers/plans/2026-11-09-contract-freeze-discovery-verification-capability-interim.md), Allow/Deny/Failure; [policy audit B](discovery-unblock-policy-audit.md#b--generated-account-readverify-capability) |
| Local reviewer authentication, mutation CSRF and source authorization; durable ownership is reviewer ID, not session credential | `apps/control/src/local-session.ts:authorizeReviewer`; orchestration line 179; L2 lines 29–31 |
| No invented session expiry or policy-edit HTTP API | L2 lines 29–31; orchestration line 283. Current local sessions have no TTL and disappear on process restart. |
| Existing parent access remains separately authorized | [Parent read handoff](../2026-11-08/handoffs/b-parent-reads-handoff.md), lines 51–69; `apps/control/src/parent-read-client.ts:resolve`; [parent setup](../../demo/parent-read-setup.md). Runtime scope publication is explicitly not a Discovery verify grant in the interim freeze. |
| Exact candidate, immutable request/job mapping, atomic attempt reservation and historical recovery | [Accepted producer design](../2026-11-08/handoffs/platform-discovery-verification-adapter-design.md), admission/recovery sections; `packages/evaluator/src/discovery-verification.ts`; control009 |
| Import/sync authority is a different explicit decision | User decision; [PRD §10](../../../prdv2.md#10-explicit-customer-approval-and-activation); activation-authority freeze. No dependency from grant issuance to an approval intent, activation policy, eligible report or runtime activation. |

The interim freeze is extended only by the explicit grant alternative described here. Its legacy allowlist path, source constraints and deny behavior remain. Its statement that Discovery tools must not mint grant rows remains true: issuance belongs to authenticated trusted control ingress.

## Exact scope, source association and provenance

Use the existing strict `DiscoveryBinding` (company/source/manifest/hash/snapshot/hash), full `Scope` (company/seller/account), and profile source-account set. An exact association is the canonical value:

```ts
{
  schemaVersion: 'proposed-scope-grant-1',
  reviewerId, runId, proposalId,
  binding: DiscoveryBinding,
  scope: Scope,
  parentCustomerId,
  sourceAccountIds: /* sorted distinct IDs */
}
```

`sourceRef` is supplied by the full binding and must equal the profile's source. Every source account expands to the exact tuple `(binding.sourceRef, scope.sellerEntityId, sourceAccountId)`. No bare account ID, buyer name, company-only match, wildcard, empty tuple set, or hash-only match is sufficient. Compare canonical bytes as well as their stored hash; reuse canonical/hash helpers and existing schemas. Cap the canonical grant payload at 65,536 bytes as a technical envelope consistent with bounded construction results; fail explicitly rather than truncate.

Persist the issuer reviewer ID and issue time plus issuance provenance: proposal revision, proposal payload hash, selected profile hash, and the sorted source citation IDs used by that persisted proposal. These are audit origins, not a new evidence truth claim. Persist no cookie, CSRF token, session ID, service credential, protected pin, fixture path or expected outcome. The immutable proposal revision and its existing finding/evidence references retain the detailed context; do not copy full profiles, findings or original documents into the ledger.

For issuance, load the actual persisted one-profile proposal and exact run binding. Reuse `prepareProposalEvidence` and the actual pinned source read adapter outside the transaction to establish captured raw tuple membership, authorized citations and source-owned document associations. Its result proves only the existing association checks: do not reinterpret it as parent identity approval. Preserve its diagnostic/blocker results. In the short issuance transaction, lock the run, re-read the current proposal/hash, and run `recheckDiscoveryCapture` on the same client. Source file I/O remains outside that transaction.

A structurally valid proposal may still have unresolved construction/financial blockers. Grant issuance does not remove them or require an eligible financial report. `loadVerificationSubject` and the existing clear-current-assessment checks still determine whether new verification can proceed. A grant response must never label the candidate verified, ready or approved.

### Revision behavior: conservative implementation choice, not a new user decision

Permission belongs to the exact association above, not to the financial content of an artifact. Within the same run/proposal and unchanged capture, scope, parent-customer ID and exact source-account set, a term/mapping repair can continue using the grant; each verification still binds the new exact registered candidate and current assessment. Issuance revision/profile hash remain immutable provenance.

This choice is supported by the separation of capability from candidate verification in F6 and the orchestration contract, and by `validateProposalPublication` in `packages/discovery/src/proposals.ts`, which already fixes scope/source/parentCustomerId across revisions while separately validating aliases and new contents. Those sources **do not explicitly prescribe grant persistence across repairs**. Retaining permission for an unchanged association is the proposed engineering choice, avoiding accidental approval semantics for financial revisions.

A new run/proposal, changed capture, changed scope/parentCustomerId, or changed source-account set fails exact membership and needs another explicit grant. That regrant rule is a conservative exact-binding implementation choice, not a claim that the user separately selected a grant lifetime or alias policy. Reordering a declared set is not a change. No new identity generation, alias consolidation or legal-entity mapping algorithm is introduced.

## Trusted issuance and minimal reviewer API

Use a small new control plugin, mounted only by trusted composition with a grant service and an explicit issuer authorizer. The production local authorizer:

1. Calls the real `authorizeReviewer(request, { mutation: true })` for issuance, including loopback origin, credential rejection and CSRF checks.
2. Requires the authenticated reviewer to equal the trusted configured grant issuer and the persisted run's reviewer. The initial local issuer is the already configured demo reviewer, explicitly injected at composition; a source reader is not implicitly an issuer.
3. Checks current configured company/source authority and the run's saved source ceiling. It validates every selected raw tuple against that ceiling. Recheck current issuer/source authority immediately before commit.

The service accepts a server-derived actor; its public input cannot supply reviewer ID, role, arbitrary scope, grants, sourceRef, TTL, target mode or approval flag. Product agents have no route/capability to call this action. Do not add it to their tool descriptors or accept model claims that a reviewer consented. Supporting a distinct operator principal later requires its own real authentication binding; no new token or operator impersonation path is necessary here.

Proposed additive routes, names being routine owner choices:

- `GET /api/discovery/runs/:runId/proposals/:proposalId/verification-scope`: authorize an ordinary current reviewer read, ownership and source access; return the current proposal revision/profile hash, exact association, its canonical hash, safe evidence IDs and whether an exact grant already exists. This read neither requires nor creates parent-account permission. Missing grant is an inspectable state, not a failed proposal read.
- `POST` to the same path: strict body `{ expectedProposalRevision, expectedProfileHash, expectedBindingHash }`. Authenticate issuer before parsing/lookup. Resolve all identity data server-side and require exact equality. Return HTTP 200 with the immutable grant ID, exact binding, issuance provenance and `permission: 'candidate-verification'`. It does not enqueue a job or resume a run.

GET returns only bounded descriptor/provenance data; it is not an alternate original-document endpoint. Original evidence still uses the authorized source service. Reuse existing API error envelope, no-store headers, query/unknown-key rejection and local-session errors. Malformed input is 400, unauthenticated 401, wrong issuer/run/source 403, absent authorized resource 404, stale/different selection 409, and missing/unavailable producer/capture storage 503. Do not leak another run's grant existence before authorization.

Use a deterministic grant ID derived from the canonical association, and a unique exact association key, rather than another general action-idempotency subsystem. An exact retry resolves the saved issuance and returns the same record after current authorization; no new grant/event or budget effect. A replay of the original issuance revision can use its immutable stored provenance after the proposal head advances; it cannot create a new grant from a stale head. A fresh issuance must select the current head. If a newer head has the identical association, a current explicit action returns the original grant with original provenance. Changed binding requires a fresh explicit selection and produces a different grant. Canonical comparison remains required if a digest matches.

## Durable and current semantics

Add a control-owned immutable `discovery_proposed_scope_grants` table, with no migration number reserved here. Minimum shape: grant ID; run/proposal foreign keys; reviewer ID; account ID as a checked projection of the canonical association; canonical association bytes/hash; issued proposal revision/payload hash/profile hash; bounded evidence-ID provenance; issue timestamp. Reference the existing immutable proposal revision with a composite FK; validate reviewer/run and profile/capture equality in the service. Unique `(run_id, proposal_id, binding_hash)` plus canonical equality gives one grant for an exact association. Index bounded lookups by run/proposal. Grant the app only SELECT/INSERT; no UPDATE, DELETE or TRUNCATE. Root must inspect accepted/in-flight catalogs before reserving DDL and readiness pins.

Add nullable `proposed_scope_grant_id` to `discovery_verification_requests`, keeping historical rows null. The ledger exposes a unique `(grant_id, run_id, proposal_id, account_id)` key; the mapping references that full tuple with a restrictive composite FK. The null grant ID preserves legacy rows under ordinary MATCH SIMPLE semantics. The scalar ledger projection must equal the parsed canonical association. Null means the original legacy capability path; non-null records the actual new grant used at admission. Persist it atomically with the existing mapping/attempt/job/claim. Extend the internal producer binding equality and SQL reader/writer once. No backfill invents grants for old jobs, and no stored request can switch authorization modes on replay. The producer requires the referenced grant to match run/proposal/account; the gate proves the complete association. Add only constraints and column INSERT permission needed by the existing immutable mapping privileges.

The ledger is a saved capability ceiling, not current authority. Every use still requires current authenticated reviewer/run source policy, saved run/task source coverage, exact association and current task/step rules. A restart retains the grant but requires a new valid local session for reviewer HTTP; durable ownership uses reviewer ID. The supervisor uses trusted current policy, never a browser cookie. Granting does not alter task grants, task budgets, run state, pause state or source permissions.

No timer, invented expiry timestamp, standalone per-grant revocation endpoint, policy editor or automatic renewal is introduced. Existing current-policy removal denies use; historical grants/results remain stored. Observed forbidden in-flight steps remain sticky across restoration/resume as required by the existing lifecycle. Restoration does not resurrect a denied step or create a new verification attempt automatically. Previously admitted protected execution follows the existing producer boundary: it may finish internally, but result exposure and current settlement still require authority. Do not delete or rewrite its attestation.

An independent per-grant revoke/expiry product workflow is not specified by the cited authorities and is not needed for this bounded implementation. If later requested, its lifecycle requires a separate narrow contract; do not import the runtime activation epoch or pause/revoke semantics into Discovery grants. Current Discovery authorization is not financial activation authority.

## Existing-parent collision and read separation

A proposed `accountId` or `parentCustomerId` can equal an existing parent identifier without becoming authorized to read that account. Candidate verification consumes the registered source capture and protected evaluator inputs (`createFinancialPreparation` / `composeFinancialVerification`); it has no parent reader dependency. The new grant authorizes that candidate-only path and its safe result, even if the identifier collides. It does not establish that the existing parent belongs to the proposed source customer.

Therefore do not query runtime merely to issue a grant, do not publish/reserve a parent ID, and do not return an empty parent baseline when unauthorized/unavailable. Keep `parent-read-client.ts:resolve` and reviewer Preview/parent/activation/connection authorization unchanged. An actual parent read still needs its existing ordinary account and source permission, registered scope resolution and full-scope equality. Successful financial verification is not evidence of an empty or accessible parent. A proposal with a collision may remain blocked later by independent identity/activation checks.

This removes a cross-database absence-check race: no nonexistent-parent assertion is used as authority. Test collisions against both the same full scope and another seller/company; the grant must never invoke the parent reader or expose parent state. No new reviewer `/api/connectors/:id/verify` fallback is added: the new capability is run/proposal bound and must flow through Discovery's admitted job path. Experience reads its safe grant/job state through the scoped Discovery surface, not by broadening the legacy job GET allowlist.

## Producer/consumer boundary and races

Platform supplies a transaction-bound reader from the grant service, injected into Discovery by composition. Suggested narrow port:

```ts
authorizeProposedVerificationOn(client, {
  runId, reviewerId, proposalId, candidateProfile, binding,
  taskSourceRead, expectedGrantId?: string
}): Promise<{ grantId: string } | undefined>
```

All inputs are server-loaded persisted values, not accepted tool context. The reader is constructed with the existing synchronous trusted current-policy resolver. On every invocation it checks exact canonical association, run/proposal ownership, source tuples covered by the persisted task source grant and current resolved source capability, and the stored grant. The caller must also preserve the existing saved run/task ceiling checks; passing a fabricated task grant is not an authorization path. It performs SQL only. For an existing mapping, `expectedGrantId` pins the originally admitted grant; missing/mismatched provenance denies. The implementation plan must give this port a strict server-only input type and keep the issuer writer out of the injected consumer object.

Discovery retains the legacy current/saved account membership path. If that path is absent for a new admission, it may use the explicit grant only for the exact one-profile subject after current source/task authorization. Do not union the grant's account into `Grants.allowedAccountIds` or `TaskContext`. A legacy mapping remains legacy on replay; a new-grant mapping remains pinned to its grant even if general account permission later changes. Source/task loss still denies either mode. More than one profile remains unsupported in the bounded tool; never drop untrusted profiles to create a successful partial subject.

Consumer checkpoints requiring the shared reader, not copied queries:

- Whole-batch preflight before the first effect, new request preparation, and the final owner `admit` transaction before any attempt/job reservation.
- Historical lookup, independently scheduled queued recovery and original-subject `readVerification`, using immutable original association/provenance rather than the current proposal head.
- Saved response/transcript replay, current settlement, and coherent reviewer `verificationJobs` projection. A blocked profile remains in proposal state, but a grant must not expose another job or revive stale current success.

Existing `permits`, owner/generation/dispatch/task fences, capture recheck, current assessment and original-subject validation remain mandatory. A grant is necessary for the otherwise untrusted scope, never sufficient to bypass them. Missing exact grant yields `VERIFICATION_SCOPE_REQUIRED` with zero new job, attempt, current-success link or launcher execution. When a request needs the new grant mode, missing infrastructure yields unavailable, not implicit denial-as-empty or a fabricated legacy fallback. An independently authorized legacy request retains its existing behavior.

Serialize issuance with the existing run lock, then current proposal locks; no activity lock before another run/proposal lock. Consumer operations keep the accepted run → investigation/task → step → mapping/budget/job order and publish activity last. The immutable grant lookup needs no new mutable lock hierarchy. If issuance commits first, admission can see it; if admission observes absence first, it returns the normal denial without consuming budget. Discovery does not automatically retry a saved denied step; a later legitimate request uses its ordinary lifecycle and unchanged run/account allowance.

A revision/capture invalidation between preparation and issuance causes recheck/conflict and no grant. Owner loss or pause before admission prevents the existing atomic reservation. A grant does not countermand pause. Current-policy loss during producer SQL or consumer settlement is checked before commit; transaction denial rolls back attempts/jobs/claims. A saved grant alone cannot satisfy a stale policy snapshot. Preserve sticky observed revocation during external preparation. No external I/O under SQL locks.

Ambiguous grant COMMIT is recovered through an authorized lookup of the deterministic exact association; return the existing grant if committed, otherwise retry the same explicit request with fresh current checks. No success response precedes acknowledged commit. Ambiguous verification COMMIT uses the existing immutable request-key recovery; do not allocate a replacement job, consume a fourth attempt, reprobe a historical request or relaunch an uncertain running job. Successful issuance does not require model configuration and does not start provider calls.

Preparation failures release owned clients and leave no grant or issuance event; SQL failure rolls back both. There is no new file staging or protected-evaluator cleanup protocol. On shutdown, stop accepting new issuance and drain/close only resources owned by this service; do not shut down the shared supervisor or another lane's database. Immutable grants and mappings are audit history, not cleanup targets. Future test fixtures use `finally` to close their servers/pools and drop only their own provisioned namespaces, retaining the required safe evidence before disposal.

## Source-grounded reuse, size and ownership

| Owner / proposed paths | Reuse and bounded change |
| --- | --- |
| Platform: new `apps/control/src/proposed-scope-grants.ts`, `routes/proposed-scope-grants.ts` | Focused issuer/reader and HTTP adapter. Reuse local-session authentication and strict route/error conventions; no duplicate session/token service. |
| Platform: `apps/control/src/discovery-composition.ts`, `composition.ts` | Construct trusted issuer closure; inject the read-only transaction port and mount reviewer plugin. Keep the synchronous `resolveAuthority` contract; do not turn it into a cached async grant lookup. |
| Contracts owner: new `packages/contracts/src/discovery-scope-grants.ts`, necessary exports | Reuse `DiscoveryBindingSchema`, `ScopeSchema`, ID/hash/version and canonical helpers. Freeze exact descriptor/request/response shapes at plan time. Audit protected recursive build closure before changing root exports. |
| Platform DB owner: one separately reserved additive control migration | One immutable ledger plus nullable mapping provenance FK. No runtime DDL, legacy grant mutation, grant/revoke framework or migration renumbering. |
| Platform producer owner: `packages/evaluator/src/discovery-verification.ts` | Preserve existing producer/gate/subject bytes. Add original grant-reference persistence/equality to its binding; do not fork the producer or protected evaluator. |
| Discovery, separately released: `verification-tools.ts`, `supervisor.ts`, `repository.ts`, narrow `service.ts` plumbing | Consume one injected reader at all listed checkpoints. Reuse `loadVerificationSubject`, `discoveryVerificationSubject`, existing owner transactions and recovery. No issuer write dependency and no copying of Platform SQL into handlers. |
| Discovery evidence seam | Reuse `prepareProposalEvidence`, `profileSubjects`, `proposalCitationIds`, actual read tools and existing capture recheck; no alternate applicability parser or manufactured parent mapping. If safe subject loading needs extraction, release that focused helper through Discovery rather than duplicating its join/validation code. |
| Experience, later separate release: `packages/client/src/discovery.ts`, existing discovery feature and focused browser test | Read descriptor; explicit “Grant verification access” action; show grant/provenance separately from verified/approved/active. No automatic effect on source/proposal selection, page load, compile, grant read, or approval. No browser source paths assigned by this design. |

At inspection `supervisor.ts` is 1,830 lines, `verification-tools.ts` 385, `repository.ts` 352, and the producer 285. Keep new authorization logic in the focused service/reader and small adapters. Do not grow the supervisor with duplicated ledger SQL or refactor unrelated scheduling. If a small dedicated Discovery capability adapter is needed, reserve it rather than scattering membership formulas. Expected added production logic is a few hundred lines plus strict contracts and integration glue; substantially more should trigger a scope/reuse review. Tests will be larger because the risk lies in real authorization and transaction boundaries.

All proposed paths are **candidate reservations only**. Root serializes source/SQL work after the active Task5 selector writer, coordinates Discovery Gate J ownership, and checks catalogs before releasing any migration. No selector files, runtime selector migration, capture/history readers, provider transport, repair/finish implementation, financial logic or UI redesign belong here.

## Concrete verification and acceptance handoff

Use Node 24 and real isolated PostgreSQL/application roles on a separately allocated lease. These are required future cases, not checks run for this design.

1. **Grant producer HTTP + storage** — new `tests/integration/discovery-scope-grants.test.ts`: actual local-session cookie/origin/CSRF; untrusted caller, wrong reviewer/run/source, forged actor/body/scope/unknown fields fail with zero ledger/activity changes. Empty general account allowlist plus authorized source can explicitly grant the persisted proposed scope. Grant action needs no model, approval intent, activation policy or report. GET alone writes nothing.
2. **Binding and provenance** — captured Company A and B proposals, same raw ID under different sellers, absent raw tuple, wrong manifest/snapshot/hash, unreadable citation and stale proposal selected after preparation. Assert exact binding/provenance and preserved blockers. Same association with changed term/profile revision keeps permission but requires a new exact verification subject; changed aliases/capture/run/proposal/scope denies until explicitly granted. Set permutation is equivalent. No implicit identity confirmation.
3. **Idempotency/concurrency** — two app-role HTTP requests for the same selection yield one grant and one issuance event; changed input under stale selection conflicts. Lost response/restart returns the same grant without another event. Deterministic barriers prove proposal advance/capture invalidation/policy removal before commit leave no grant. Rollback leaves no partial audit activity.
4. **DDL/role proof** — fresh migration and populated upgrade preserve previous migration hashes and historical null-mode verification mappings. Real app role can SELECT/INSERT only; actual UPDATE/DELETE/TRUNCATE, DDL and cross-database attempts fail for privileges, not absent fixtures. Invalid FKs, duplicate association and mismatched mapping provenance fail. No runtime migration or runtime row changes.
5. **Real supervisor admission** — extend the existing `tests/integration/v4-verification-owner-fencing.test.ts`, `v4-verification-owner-fencing-edges.test.ts`, and `v4-verification-idempotency.test.ts` only in Discovery's release. Before grant: real compiled candidate returns `VERIFICATION_SCOPE_REQUIRED`, zero attempt/job/mapping/launcher. After explicit grant: the real owner gate reserves once with grant provenance. Mixed valid/denied batch has no earlier successful effects. Regrant/revision never resets the max-three run/account allowance.
6. **Saved reads and recovery** — queued original job survives restart/head advancement and recovers once under its exact original grant; current policy loss denies lookup/replay/state exposure/recovery; restoration cannot clear a sticky denied step. A later same-account grant in another run/proposal cannot authorize it. Legacy null-mode jobs cannot silently switch modes. Current-success settlement remains stale if assessment/revision advanced. Ambiguous COMMIT and running uncertainty preserve existing behavior.
7. **Parent separation** — real registered existing parent rows and colliding account/customer IDs; unchanged legacy `parent-reads.test.ts` and `parent-read-composition.test.ts` behavior. Grant alone fails ordinary parent/activation/connection/preview access; verification invokes no parent reader; runtime state/receipts/activity fingerprints unchanged. Existing separately authorized baseline reads still work. Runtime scope publication alone still cannot verify an ungranted proposal.
8. **Boundaries/privacy** — missing ledger dependency fails closed without breaking source/proposal inspection. Product tool registry cannot issue grants. Descriptor, grant response, job summary, activity and logs contain no session/service credential, protected truth/path or hidden expected result. Legacy reviewer verification behavior remains unchanged.

Run focused unit contract tests and typecheck, then the above isolated integration suites; label them partial. Follow with a fresh exact-candidate producer review, then a separate Discovery consumer review against the actual accepted Gate J candidate. The producer's passing HTTP/SQL tests do not prove supervisor integration. Experience's later browser proof must show a denied proposal remains inspectable, one explicit grant action enables only the scoped capability, stale selection is safe, repeated action is idempotent and approval remains separate. No full V4/live/financial/sync acceptance or joint user acceptance follows from these checks.

## Design disposition

The user grantor choice and existing source/current-authority rules are sufficient for this narrow producer. No further product decision blocks it. The grant association schema, deterministic identity, same-association repair retention, stricter changed-binding regrant, route naming and storage layout are explicit engineering proposals for review, not claims about additional user choices.

Standalone grant expiry/revocation administration, cross-reviewer transfer, new operator authentication, ordinary parent access expansion, and financial identity/activation decisions are outside this increment. If any becomes necessary, raise that exact requirement instead of silently broadening this contract. Next action is root's fresh independent design review; only afterward write a separately scoped implementation plan and reserve paths/migrations.
