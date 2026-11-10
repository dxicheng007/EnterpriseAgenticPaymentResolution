# Independent proposed-scope grants design review

Reviewed design: `docs/progress/2026-11-10/proposed-scope-grants-design.md`, 175 lines, SHA-256 `cd50a229739ab9b5eee46a1c3c7fcb64f5dbad64182b0fdf228ec772a07e0f7a`.

Source baseline: `40a4fb800316137be824551d94633a5975f7487e` in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Root subsequently published the identical design in documentation-only commit `968074e`; this does not change the source baseline or scope. Source anchors below are repository-relative. The selector WIP was excluded. This is a read-only design review, performed without subagents, tests, DB activity, providers, browser activity, or source/Git mutations. Only this report was written.

## Strengths

- The authority is explicit and appropriately narrow. Design lines 71–82 require the real session/CSRF authorizer, an independently configured issuer identity, run ownership, current source policy and saved source ceilings. The actor and association are server-derived. This follows the recorded user decision without treating a generated ID or source membership as permission.
- Exact association identity is stronger than a bare account allowlist: reviewer/run/proposal, complete capture binding, full scope, parent-customer ID and the distinct source-account set all participate (40–55). Original provenance remains immutable. The grant is deliberately separate from the exact candidate admitted to protected verification.
- Parent access and financial authority remain separate (100–106). `parent-read-client.ts:19–27` still needs ordinary account permission and registered source/full-scope checks; `financial-attestation-jobs.ts:33–59` and `financial-verification-composition.ts:34–48` support candidate-only preparation without a parent reader. A colliding ID therefore need not trigger a cross-database absence check, fake empty baseline, or entitlement expansion.
- Historical authorization mode is explicitly retained (90–96, 119–127). Nullable grant provenance with a composite FK supplements the existing immutable mapping, while null legacy rows retain their original authorization path. Replays cannot silently acquire a different grant or change modes.
- The producer/consumer/UI release boundaries are honest (9–11, 139–175). Issuance needs neither a model nor financial eligibility; it does not advertise verification or start work. Producer SQL/HTTP evidence is expressly insufficient for actual-supervisor acceptance. The future cases cover race barriers, privilege denials, collisions, original history and uncertain commits rather than just successful examples.

## Severity-classified findings

### Critical

None found in this design.

### Important

None that blocks writing the narrow producer implementation plan. Consumer correctness remains a separate release gate; the dependencies below must not be mistaken for behavior already available at the source baseline.

### Minor — resolve in the implementation plan

1. **Include the actual issuance-activity seam in ownership and define its safe event.**
   - Design anchors: 131, 137, 141–150, 162. The design promises exactly one transactional issuance event but does not name its event representation or reserve the storage activity seam.
   - Source: `packages/storage/src/activity.ts:9–15,23–41,45–53` rejects any new event type and silently omits unallowlisted payload fields. There is presently no grant-issuance event type or grant-ID field. Reusing `publishDiscovery` does not bypass that validator (`packages/discovery/src/repository.ts:118–123`).
   - Effect: an invented event name rolls back every otherwise valid grant, while an invented payload field can disappear from the audit event. This is a concrete integration requirement, not a new product-policy choice.
   - Remedy: pin a semantically accurate event and minimal safe correlation fields, explicitly reserve the narrow `storage/src/activity.ts` change if needed, publish last on the same client, and test one event on first issuance and none on retry. The immutable ledger can retain detailed issuer/evidence provenance; do not duplicate it in activity.

2. **Give provenance and response envelopes their own explicit bounds.**
   - Design anchors: 53, 55, 81–90, 145. The only numeric bound is 65,536 bytes for the canonical association; the evidence-ID provenance and combined descriptor/response are only described as bounded.
   - Source: `proposal-evidence.ts:47–58` returns deduplicated direct proposal citations without an independent byte/count cap. Proposal input is bounded by `discovery-construction-tools.ts:76–95`, but persisted `DiscoveryProposalV2Schema` itself has no aggregate byte refinement (`contracts/src/discovery.ts:181–185`), and neither limit automatically describes the new combined response.
   - Effect: different implementations could enforce incompatible limits or accidentally send/store a larger envelope than the plan assumes. The existing bounded proposal path reduces the immediate risk; this is not evidence of an exploitable unbounded producer today.
   - Remedy: freeze the exact citation derivation and canonical UTF-8 byte/count limits for ledger provenance and each HTTP envelope, including a safe explicit oversize result. Use complete sorted IDs or fail; do not truncate. This is routine contract work already appropriately assigned to the plan, not a user question.

## Source-grounded feasibility and dependent requirements

### Policy and revision semantics

The recorded decision requires a trusted explicit grant for each proposed scope and separately preserves financial approval and existing parent access. I found no requirement that capability must be reissued for every financial artifact revision. The same-association repair retention at design 61–67 is a reasonable engineering realization: `proposals.ts:112–120` fixes full scope, source and parent-customer ID across revisions; aliases can change, and the design correctly makes an alias-set change require a different grant. New verification still validates the new exact candidate, current assessment and unchanged attempt budget. This does not approve repaired financial content.

L2 really does distinguish immutable ceilings from current authority (`b-discovery-l2.md:23–31`), prohibits an invented session expiry, and directs revocation tests to a trusted policy closure rather than a policy-edit HTTP API. `local-session.ts:63–68,96–119` has process-local sessions and no TTL. The orchestration contract's session discussion likewise describes restart/401, not expiry. Those authorities do **not** prescribe a new grant's own expiry or a per-grant revoke API. Omitting those new workflows is supported as bounded scope, rather than falsely claiming L2 expressly forbids all future per-grant revocation. Removal of current source authority denies use; selective revocation of one grant is intentionally unavailable in this increment. No additional material user-policy decision is required for the proposed narrow producer.

Preserve the actual existing `permits` semantics (`supervisor.ts:281–284` and `repository.ts:80–88`), including saved task/run coverage and current task grants. The proposed grant is only an alternate verification association check; it must not turn unrelated saved/current permission failures into success.

### Reuse and dependency direction

The named evidence seams exist: `prepareProposalEvidence({binding,sourceRead,input,retainedEvidenceIds?}, tools)` returns capture facts, source contracts/streams, account subjects and diagnostic codes (`proposal-evidence.ts:61–66,97–115,170–190`). It validates captured tuples and citations and can return unresolved applicability diagnostics. It does not prove parent identity, matching the design's caveat. `profileSubjects` and `proposalCitationIds` are exported. `recheckDiscoveryCapture(client,facts)` is exported and SQL-only; it uses the actual passed client and locks the mutable dossier (`discovery-composition.ts:27–115`).

A persisted `DiscoveryProposalV2` is not directly a `ProposalInput`: the latter is a submitted draft/revise input, and published profiles have server-generated IDs/version/hash (`proposals.ts:55–65`). The implementation must load and validate the persisted submitted input with its corresponding revision schema and verify its relationship to the published payload, or release a small typed evidence-input helper. Do not use a cast or reconstruct financial contents arbitrarily. Design 149 already allows a focused Discovery extraction; the plan should choose this precisely.

Control already imports Discovery source modules directly (`discovery-composition.ts:9–18`), so this reuse does not require inventing a package export. Inject `recheckCapture`, the synchronous current-policy resolver and read tools from composition into the focused service. Do not make the service import its composing module and then import the service back from that module. The Discovery/evaluator consumer must receive the narrow read-only function, not import `apps/control` or the issuance writer. No general entitlement framework or new scheduler is justified.

### Immutable storage and producer mapping

The proposed revision FK is feasible: `db/control/007_discovery_construction.sql:62–74` has the exact `(run_id,proposal_id,revision)` immutable key and persists payload/hash and original tool association. The added grant tuple can support the mapping FK without replacing the existing assessment, dispatch, step and financial-request FKs (`009_discovery_verification_requests.sql:16–20`). MATCH SIMPLE with a null grant ID preserves old rows as described. The app's existing mapping grant is table-level SELECT/INSERT (009:25), so check actual privileges after the additive migration; do not gratuitously broaden them.

The canonical association/account projection and full candidate association must be validated independently of the FK. The FK alone proves run/proposal/account ownership, not capture/profile/source-set equality. At each existing-mapping read, carry and compare the original grant ID in the producer's row parser and `requireBinding` (`evaluator/src/discovery-verification.ts:99–139`) and all Discovery mapping readers. For a new admission, pick legacy versus grant mode once; an existing mapping wins with its original mode. The design states these requirements correctly.

### Historical subjects, final admission and lock order

These are **dependent Discovery requirements**, not a new reopening of unrelated Gate J work:

- `loadVerificationSubject(...,{historical:true})` is not a general history loader. Its flag only bypasses clear assessment; it calls `loadCompileSubject`, whose join requires the current head (`verification-tools.ts:70–93`; `compilation.ts:118–131`). Do not use it to authorize old grant-backed mappings after head advancement. Reconstruct the original verified candidate/association from immutable mapping subject bytes and exact historical proposal/assessment records, then use the shared reader with the original grant ID.
- The independently scheduled recovery already reconstructs a candidate from saved subject bytes (`supervisor.ts:359–407`), but its current account-only prefilter and all subsequent gate reads must be adapted. Likewise `bindReadVerificationJob` and the coherent state projection currently have account-only checks (`verification-tools.ts:336–379`; `repository.ts:143–168`). Saved transcript replay and current settlement must not bypass the new association reader. The design enumerates these checkpoints correctly; a producer-only change cannot claim them complete.
- The accepted producer design specifies run/task/step before mapping/budget/job and activity last (adapter design:106). The stable gate currently locks the step before the run (`verification-tools.ts:179–194`). Design 131 is a requirement to enforce in the separately accepted consumer, not an accurate statement that every existing code path already follows it. Issuance should take run then proposal/dossier locks and never acquire another run after publishing activity. Check the actual accepted Gate J candidate before consumer integration.
- Maintain the post-SQL/pre-COMMIT current-policy check, sticky observed denial across external preparation, exact owner/generation/dispatch fencing, no file I/O under locks, and acknowledged-commit-only launch. Existing producer admission/recovery seams allow this without another scheduler (`evaluator/src/discovery-verification.ts:37–45,171–177,194–205,235–261`). Null versus non-null authorization mode needs explicit types at every recovery boundary; optional/default behavior must not become a legacy fallback.

### Protected build, ownership, and mounting

`financial-attestation-build.ts:5–23` already pins both `contracts/src/index.ts` and `evaluator/src/discovery-verification.ts`. Changing the producer changes the build hash even without a new contracts export. Adding a root export for the new schema requires adding its entire local dependency closure to the inventory; the closure test checks imports/exports recursively (`financial-attestation-build.test.ts:13–30`). Reserve that narrow inventory/test seam if the plan chooses a root export, or use an existing direct-leaf import convention. Never omit a dependency, rewrite old attestations or silently repin operator fixtures to preserve availability.

Keep `mountDiscoveryVerificationTools` default off (`verification-composition.ts:66–75,107–110`). A usable grant producer may be mounted independently of model/protected verifier configuration, but missing grant storage must fail unavailable rather than abort existing source/proposal inspection. Existing HTTP proposal visibility at this baseline is chiefly the state summary (`routes/discovery.ts:63–64`, `repository.ts:139–142,188`); a complete new proposal-detail screen is not implied. The planned descriptor gives Experience the narrow explicit selection surface; any richer proposal/job inspection belongs to its separately reserved consumer/UI work.

The one-table/one-provenance-column shape and focused service are proportionate. The few-hundred-lines estimate is plausible for production logic, but should not be used to omit historical authorization glue, activity/inventory updates, real privilege tests or recovery cases. Control010 is already present; the design correctly reserves no migration number.

## Declined to judge

- Concurrent Task5 worker selector implementation and tests: excluded by root; inspected status only to identify WIP boundaries.
- Acceptance or repair of existing unrelated Gate J defects: separate owner/candidate; only dependencies introduced or consumed by this grant design are stated above.
- Financial rule correctness, identity approval, activation, sync, runtime parent writes, and live-provider readiness: explicitly outside this producer design.
- Actual SQL constraint syntax, runtime behavior, tests, migration execution and resource cleanup implementation: no implementation candidate exists for this document gate.
- New UI quality or joint user acceptance: Experience is a later separate release and no browser proof was requested.
- Selective per-grant revocation, expiry, cross-reviewer transfer, or distinct operator authentication: intentionally excluded and not required by the recorded choice; no policy silently supplied for them.

## Explicit verdicts and readiness

**Specification-compliance verdict: PASS.** The design implements the recorded explicit trusted-grant choice without expanding parent-read, financial, source, or model authority. Same-association repair retention and omitted new revoke/expiry workflows are defensible bounded engineering choices. I found no material unspecified policy requiring another user decision.

**Design/implementation-feasibility and quality verdict: PASS WITH MINOR PLAN REQUIREMENTS.** The core separation, immutable provenance and transaction model are sound and have real reusable seams. Pin the two minor findings and the concrete helper/history/build dependencies above in the implementation plan. No redesign or new policy consultation is needed.

**Ready for the narrow producer implementation plan: YES.** This authorizes no source-path release, migration reservation, consumer mount, implementation completion, test-pass claim, Gate J acceptance, live/financial readiness, or joint acceptance. Discovery integration still needs its own exact-candidate review and tests after the accepted producer contract exists.
