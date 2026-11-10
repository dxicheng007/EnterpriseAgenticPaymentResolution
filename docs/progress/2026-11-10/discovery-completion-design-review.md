# Independent discovery completion design review

Reviewed 2026-11-10. Review scope: documentation and relevant existing source only. Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Candidate: `docs/progress/2026-11-10/discovery-completion-contract.md`

Exact candidate SHA-256: `67f776a0ae4521b1fcb2dbed71989c946ba9f6873559adabf80ac7691e2322af`.

Accepted authority: `docs/progress/2026-11-08/handoffs/v4-orchestration-contract-proposal.md`, verified SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`, matching the discovery-shapes freeze. Also inspected repository/package/discovery/database guidance, lifecycle handoff, discovery freeze, policy audit, control004/007/009, and current supervisor/repository/task/assessment/compile seams.

## Verdicts

**Specification: aligned on material policy, but changes requested before exact design acceptance.** The three tools are already authorized by the accepted orchestration contract. This candidate does not invent automatic parent-account capability, financial approval, contradiction resolution, provider authority, or automatic runtime-break investigation. B remains open and does not block C. The findings below concern faithful operationalization of existing diagnostic/blocker requirements, not new user policy.

**Quality: changes requested.** Request storage, application grants, round quiescence and terminal coordinator completion are generally implementable in the existing supervisor. The finish diagnostic source inventory and repair supersession selector need to be explicit enough that a consumer cannot accidentally treat omitted persisted diagnostics as clear.

**Verification: read-only design review only.** No repository edits, Git operations, database operations, tests, provider calls, or subagents. The temporary report is the only file written. No implementation, migration, live readiness, or joint acceptance is established.

## Findings

### [P1] Include unresolved settled compile diagnostics in the finish assessment inventory

Candidate lines 165–167 enumerate sticky origins, current findings, capture/authorization diagnostics and current server assessments, then require one current compiled proposal. That inventory misses a real persistence seam: unsuccessful compile results are stored in `discovery_compile_steps.result` without updating `discovery_proposal_current` or appending the failed result's compiler codes to the persisted assessment. See `packages/discovery/src/supervisor.ts:1751`, `:1759`–`:1763`, and `packages/discovery/src/compilation.ts:254`–`:281`; `linkCurrent:false` leaves the current assessment unchanged. `packages/discovery/src/assessments.ts:23`–`:61` does not query settled compile results either.

Concrete case: proposal A is current/compiled; proposal B in another opened investigation has a settled structural compile failure and otherwise clear findings/assessment; all specialist tasks finish. The listed finish queries find A and no assessment blocker for B, even though B's current compile diagnostic is durable and unresolved. Accepted orchestration lines 130 and 162 require known compiler diagnostics to remain blockers and completion to cover every opened investigation. The broad instruction at candidate line 167 to reject every blocker is correct, but the proposed concrete query inventory is insufficient to implement it against actual storage.

**Required change:** explicitly require finish to inspect applicable persisted compile outcomes for the full opened scope, with exact current/historical binding and supersession rules, rather than assuming compiler failures appear in current assessment rows. Reuse a shared diagnostic-selection helper if appropriate; no new blocker-resolution authority or automatic permanent copying of all historical failures is needed. Add a mandatory consumer proof with compiled A plus unresolved failed B, including B omitted from citations/current compiled candidates; finish must remain incomplete. Include the positive case in which a genuinely superseding valid result no longer leaves an obsolete compiler failure blocking.

### [P2] Define the diagnostic selector's grouping key and cross-assessment supersession

Candidate line 148 says both “exact current proposal revision” and “greatest ... first-admission sequence for each tool kind and exact binding.” It describes compile bindings as proposal/assessment and verification bindings as proposal/profile/artifact/manifest (with parent authorization). It does not specify whether assessment revision is part of each chronology partition, whether only the current assessment is eligible, or how a later applicable result supersedes an earlier binding when assessment changes while the proposal revision remains the same. This matters because finding publication advances assessment revisions without necessarily advancing proposal content (`packages/discovery/src/assessments.ts:99`–`:119`), and control007/control009 retain older exact bindings.

An implementation partitioning strictly by every stored assessment binding can retain the latest failed result of an obsolete assessment even after a newer applicable successful result; one partitioning only by proposal can conflate materially different verification subjects. The sentence prohibiting older superseded failures states the desired outcome but does not define a unique selector. The new diagnosticRefs shape can faithfully preserve either selection, so schema tests cannot settle this ambiguity.

**Required change:** enumerate the complete selection key for each tool kind, identify which candidates remain applicable to the locked current proposal/assessment and authorized verification subject, then define the ordering/supersession rule separately from the historical provenance retained in the result. Keep the first committed activity sequence as chronology and continue rejecting missing chronology. Add cases for multiple assessments of one proposal revision, later success versus old failure, a later pending/unknown attempt, and distinct verification subjects. This is a technical binding clarification under the existing unresolved-diagnostic requirement, not a request for new financial policy.

## Reviewed areas without additional findings

- Request ID equals server toolStepId; control007 already supplies the referenced `(run_id,task_id,id)` uniqueness. Request findings bind exact immutable revisions, and consumption binds one same-run delegation step and one child. Application-only tool name/role/subject/grant/capacity checks are correctly distinguished from FK enforcement.
- The three request tables have SELECT/INSERT only, with no UPDATE/DELETE/TRUNCATE or cascades. Only the two bounded repair columns gain UPDATE. Completed status uses the existing run status grant. No runtime006 work or cross-database privilege is proposed; root's control010 reservation remains an implementation prerequisite.
- Pending/delegated derivation, optional request linkage and no request-driven grant/task creation are reasonable representations. The accepted contract does not require zero pending requests at finish, so adding that prerequisite would itself broaden policy.
- Quiescent round rebinding preserves counters and historical succeeded/failed/interrupted tasks. The special case for the active coordinator avoids breaking its dispatch/ordinal revision fence. Required lock-set planning addresses the current loadStep/lockTask ordering and must be implemented, not merely documented.
- Singleton finish and atomic coordinator/step/run completion solve the real generic resolveStep requeue problem. Assistant done remains insufficient. Every other task must succeed and blockers cover all opened investigations; financial eligibility is kept separate.
- Owner connection/generation, authorized replay, pause races, complete remaining-batch preflight and immutable evidence boundaries are preserved. Releasing the producer first and the consumer only after accepted Gate J corrections avoids concurrent ownership collisions.

No other material policy contradiction was identified. Resolve the two diagnostic-selection details in the document and obtain a fresh hash-specific review; do not ask the user to decide these routine storage/selection mechanics.
