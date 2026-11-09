# C2 independent exact-candidate review

Reviewed candidate `6a8e24fcef1f8b9e0a0118246d6bfea3a1a10eb4` against base `4f2b50da39e4f8d91c206935e21f6670a633ffbf` in the acquisition-verification-startup worktree. HEAD matched the candidate and its working tree was clean. Scope: C2 brief, construction handoff, discovery shapes and repository invariants; actual source, tests and candidate diff.

**Spec verdict: changes requested. Quality verdict: changes requested.** One result-boundary finding remains. No authority, parent-write, financial identity rewriting, or evidence promotion defect was found in the reviewed paths.

## Finding

### [P2] Apply the result ceiling to finding-driven reassessment before publication

Location: `packages/discovery/src/assessments.ts:87–93` (especially line 93), with ordered preflight integration in `packages/discovery/src/supervisor.ts:768–793` and refresh invocation at lines 867–868.

`validateProposalPublication` checks the complete successful result through `DraftConnectorResultSchema`, but `refreshProposalAssessments` calls `assessProposal` (only `ProposalResultSchema` validation) and immediately persists it. Consequently an existing proposal can acquire a result larger than the explicitly required 65,536 canonical UTF-8 bytes as sticky finding origins accumulate. The finding call still succeeds and stores both the oversized assessment and current result. The construction handoff requires each result to be bounded and rejected before mutation; the C2 brief explicitly requires validating the entire result before any publication and returning `TOOL_RESULT_LIMIT`, without truncating blockers.

Independent focused proof used Node 24 and the actual `proposalPayload`, `assessProposal`, and `refreshProposalAssessments` functions with fixture-derived valid content and a recording SQL client. Supplying 800 blocker origins (80 distinct identities with ten revisions each, within the per-investigation identity/revision ceilings) made refresh issue both writes. The saved successful result envelope was **84,386 bytes** and `DraftConnectorResultSchema.safeParse({ok:true,result:stored}).success` was **false**. This proof exercises production assessment logic but is not a PostgreSQL end-to-end result.

Required correction: validate reassessed results before persistence and include the projected reassessment consequences of every finding in ordered whole-batch preflight. Checking only at the selected finding's commit would leave a later oversize finding able to fail after an earlier batch step has committed. Preserve all blocker origins; return the explicit safe limit failure. Add focused regression coverage around crossing the limit, including a valid earlier step followed by the overflow-producing finding and recovered preflight.

## Reviewed behavior otherwise consistent with C2

- Strict actual spec/profile inputs and pending-only findings; submitted content and immutable server payload remain distinct. Representation namespace rewriting preserves proposed financial and parent identity fields.
- Exact pinned source contracts/streams, complete capture-fact equality, readable direct and nested citations, exact seller/account associations, and conservative unresolved document applicability.
- Current task grant checks cover retained alias union, historical direct citations, and finding derivation closures. Proposal creation adds no parent grants.
- Run-locked CAS, submitted spec ID/version consistency, current parent-account/alias collisions, projected investigation capacity, and zero-specialist proposal investigations.
- Immutable proposal history and append-only investigation/blocker provenance; finding changes refresh current assessments, preserve prior diagnostics and compile history, and clear current compile linkage.
- Connector-only dispatch/descriptors, accepted-dispatch integrity, replay before evidence I/O, capture rechecks, final authority guard, and no runtime/registry/compiler/provider/verification expansion.
- Existing focused tests cover both captured sources and meaningful authorization, concurrency, rollback, invalidation, replay and runtime-isolation cases. The missing large-ledger refresh regression is material to the finding above.

## Evidence and limits

The implementer's reported passing typecheck, seven focused unit tests and 113 PostgreSQL integration tests were reviewed as reported machine evidence, not rerun or relabeled as independent execution. Independent execution was limited to the concrete assessment-boundary reproduction above and candidate/worktree identity checks. No source edits, commits, subagents, migrations, provider calls, or broad DB runs were performed. The reproduction did not use the database lease. This review does not establish compilation, live discovery competence, financial readiness, activation/sync, or joint user acceptance.
