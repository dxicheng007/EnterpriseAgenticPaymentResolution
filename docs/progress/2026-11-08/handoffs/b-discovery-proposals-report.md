# C2 implementation report

Status: ready for independent exact-candidate review. Machine evidence is focused and partial.

- Handoff SHA-256: `95abfbb92a2c47bd64dbc2b6b493a51484678fd25e5da4a168d210511a3a5f71`
- Base: `4f2b50da39e4f8d91c206935e21f6670a633ffbf`
- Candidate: `6a8e24fcef1f8b9e0a0118246d6bfea3a1a10eb4`
- Branch: `codex/discovery-proposals` in `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`
- Commit: `feat: persist discovery proposals and server assessments`. Candidate worktree clean.

## Paths

- `packages/contracts/src/discovery-construction-tools.ts`
- `packages/contracts/test/discovery-construction-tools.test.ts`
- `packages/discovery/src/assessments.ts`
- `packages/discovery/src/proposal-evidence.ts`
- `packages/discovery/src/proposals.ts`
- `packages/discovery/src/repository.ts`
- `packages/discovery/src/roles.ts`
- `packages/discovery/src/supervisor.ts`
- `packages/discovery/test/proposals.test.ts`
- `packages/discovery/test/read-tools.test.ts` (narrow controller-authorized connector descriptor expectation)
- `tests/integration/v4-discovery-proposals.test.ts`

## Behavior

The connector's draft and revise tools persist the parsed input and immutable server payload using installed control007. Spec and profile namespaces preserve submitted financial identity, mapping, terms, bootstrap IDs, and pending v1 findings. The tool returns the exact stored profile hash and the server assessment.

Pinned source-read preparation validates described contracts and streams, readable citation IDs, and source-account event associations. Account applicability that cannot be established stays blocked. Revising from a different task reauthorizes prior direct citations under the current grant against an immutable history signature. It also checks the stable investigation union and reauthorizes historical finding derivation closures through the existing readFinding gate. The prior task's source-wide permission alone neither authorizes nor denies a revision.

Full ordered batch projection checks proposal CAS, finding freshness, canonical submitted spec identity, aliases, and available investigations before the first effect. Delegation and proposal publication belong to disjoint roles. Both role projections count all already committed investigations regardless of creator. Proposal-only investigations use installed defaults of zero specialists and repairs. Budget denial retains the run's INVESTIGATION_LIMIT diagnostic and uses the existing safe tool conflict code.

Proposal publication, assessment, activity, and step resolution share the owner transaction. Finding publication refreshes all current proposals in that transaction using the stable investigation union, preserves blocker origins, detects stale consumed findings, and clears only the current compile link. Immutable historical payloads, assessments, and compile rows remain readable. Exact replay uses the accepted dispatch and recorded result before any evidence I/O.

The model descriptors use compact local JSON Schema definitions derived from the actual connector and profile schemas. The runtime draft parser remains authoritative for cross-field validation and canonical UTF-8 limits.

## Verification

Node 24 and PostgreSQL 18 on the assigned isolated lease, with PostgreSQL port 55438, test namespace prefix eapr_test_review_t2, demo namespace eapr_review_t2, and app ports 3601, 3602, and 5179.

- Red contract test observed a missing draft parser. Red scripted integration observed the missing draft publication path. The final tests cover both actual captured sources and persisted submitted mapping and amount changes.
- `npm run typecheck` passed.
- `npm run test:unit -- packages/contracts/test/discovery-construction-tools.test.ts packages/discovery/test` passed, 7 tests across 5 files.
- `npm run test:integration -- tests/integration/v4-discovery-proposals.test.ts tests/integration/v4-discovery-findings.test.ts tests/integration/v4-discovery-evidence-tools.test.ts tests/integration/v4-lifecycle.test.ts tests/integration/v4-lifecycle-http.test.ts tests/integration/v4-activity-read.test.ts` passed, 113 tests across 6 files, including 33 C2 cases.
- `git diff --check` and `git diff --cached --check` passed before commit.

C2 integration covers zero parent grants, role-specific scripted publication, exact replay without new evidence I/O or activity, restart persistence, cross-source/seller/alias conflicts, distinct sellers sharing an alias spelling, prior citation and retained-alias grants, direct/constant/lookup/bootstrap/derivation grant denial, contract pinning, unresolved documents, whole-batch fresh and recovered rollback, current finding invalidation, projected finding freshness and investigation capacity, concurrent proposal revision CAS, accepted-dispatch integrity, pause, owner loss, commit-time policy revocation, synthetic historical compile-link invalidation, and unchanged runtime table contents/activity. Existing C1 integration independently checks installed immutable007 permissions. The result byte ceiling is verified by the contract regression, without a synthetic large SQL blocker ledger. The focused set does not separately introduce a task-revision-only corruption injection. Stale task revision checks remain in the existing dispatcher.

This is scripted, focused persistence and authorization evidence. Separate independent review and joint user acceptance remain pending. Compilation, registry publication, replay evaluation, verification jobs, provider competence, activation, and automatic synchronization are outside this checkpoint.

## Fix round 1 and checkpoint handoff

- Original C2 base remains `4f2b50da39e4f8d91c206935e21f6670a633ffbf`. Independent review withheld `6a8e24fcef1f8b9e0a0118246d6bfea3a1a10eb4` with one P2. Finding-driven refresh could store an 84,386-byte success envelope, above the required 65,536-byte limit. A late finding in a mixed batch could cross the limit after earlier effects.
- Current checkpoint is `ced4a6a275f561fc56cb6cd2e55ae20d81442f0b` on `codex/discovery-proposals`, with a clean worktree. Fix commit `fix: bound finding-driven proposal reassessments` directly follows the withheld candidate. The branch is a review candidate.
- The fix applies the successful envelope limit in the shared assessment builder. Ordered preflight projects cumulative finding publications against durable and earlier projected proposals. Reassessment revisions and observed run revision advance in projected order. Refresh computes and validates all resulting assessments before writing them. Oversize produces the existing safe `TOOL_RESULT_LIMIT` with no discarded origins.
- Fix paths are `packages/discovery/src/assessments.ts`, `packages/discovery/src/proposals.ts`, `packages/discovery/src/supervisor.ts`, and `tests/integration/v4-discovery-proposals.test.ts`. There are no schema changes.
- Red on the withheld candidate: `npm run test:integration -- tests/integration/v4-discovery-proposals.test.ts -t 'later reassessment overflow'` failed both fresh and recovered cases. Each found two succeeded finding steps where both should have failed with `TOOL_RESULT_LIMIT`.
- Green on the fix working tree before commit: `npm run typecheck` passed. `npm run test:unit -- packages/contracts/test/discovery-construction-tools.test.ts packages/discovery/test` passed 7 tests across 5 files. `npm run test:integration -- tests/integration/v4-discovery-proposals.test.ts tests/integration/v4-discovery-findings.test.ts` passed 62 tests across 2 files, including 35 proposal tests and both new fresh/recovered cases. The tests assert unchanged current results, assessment count, blocker ledger count, and tool activity on rejection. `git diff --check` and staged diff check passed.
- Both tool sessions exited, including interrupted-turn test session 3773, which exited 0. C2 has no remaining running test session. The assigned lease was PostgreSQL port 55438, prefix `eapr_test_review_t2`, demo namespace `eapr_review_t2`, and app ports 3601/3602/5179. Test DBs were dropped by fixture cleanup. The shared cluster was left available for its lease owner.
- Next developer action is scoped independent review of `6a8e24f..ced4a6a` against `b-discovery-proposals-independent-review.md`, especially cumulative findings, earlier projected proposals, and persistence before write. The broader D2, lifecycle, HTTP, and activity checks passed on the withheld candidate. They were not rerun after this fix. Joint acceptance and C3 remain pending. No merge or push was performed by this implementer.
