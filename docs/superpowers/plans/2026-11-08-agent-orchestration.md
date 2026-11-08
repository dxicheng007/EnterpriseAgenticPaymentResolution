# Codex implementation orchestration

This policy governs the implementation team in the [implementation plan](2026-11-08-implementation-plan.md). The lanes and model assignments apply to Codex development work. Product-agent personnel remain defined by [PRD v2](../../../prdv2.md). All tasks and evidence gates are pending.

## Roles and permissions

| Role | Model | Responsibility and access |
|---|---|---|
| Root coordinator | Existing session | Owns the dependency queue, active-slot permits, worktree and service leases, and integration checkpoints. Schedules implementation and independent review, records results, and brings joint gates to the user. |
| A lead | `gpt-6-astra` | Owns source adapters, source identity, evidence, fixtures, and discovery. Defines interfaces and prepares bounded implementation and test briefs. |
| B lead and integrator | `gpt-6-astra` | Owns the foundation, shared contracts, root manifests, storage, compiler, finance, runtime, and combined integration. Assigns changes to shared files explicitly and serializes integration. |
| C lead | `gpt-6-astra` | Owns the independent product evaluator, UI and typed client, and end-to-end rehearsal. Preserves evaluator separation from compiler and finance code. |
| Implementation worker | `gpt-6.1-sol` | Writes code and tests or fixes defects in one permitted worktree and path set. Runs assigned checks and returns the exact candidate commit and evidence. |
| Independent reviewer | `gpt-6-astra` | Starts in a fresh context separate from the builder and supervising lead. Reads the canonical brief and inspects the candidate commit in a separate checkout. Runs independent checks and returns a verdict without changing the candidate. |

The three leads are logical owners and can be resumed as their lanes become ready. A lead may delegate implementation within its ownership boundary via a scoped worker permit. A worker acquires any additional shared-file capability through B and the root coordinator before editing. Owning the product evaluator gives C no reviewer exception for work it supervised. The root coordinator records machine, review, and user decisions separately.

Use Astra for architecture, task boundaries, and independent review. Use Sol for the bounded implementation and repair loops to keep routine execution on the lower-cost model. Report measured calls, tokens, and timing where available.

## Scheduling and isolation

The session has four active slots including root. A normal build window is root, one Astra lead, and up to two Sol workers on disjoint tasks. A review window is root, one Astra lead, one Sol worker, and one fresh Astra reviewer. Pair concurrent work only when its dependencies and leases allow it. The supervising lead and builder of the candidate under review remain separate from the reviewer, even if their slots are free.

1. Root maintains a permit ledger with slot ID, agent/session ID, model, role, task ID and attempt, owner lead, capabilities, status, and resource leases. Reserve a slot before dispatch and release it after the agent returns. If a permit or its resources are unavailable, leave the task queued.
2. A lead can request a nested Sol worker only with a root-issued permit for that task and attempt. Workers return requests for further decomposition to the lead. When nesting is unavailable, root dispatches the prepared brief with the same ownership and permission limits.
3. Leads return self-contained briefs and yield their active slots while implementation is underway. Resume them when a dependency, contract decision, or review finding requires their judgment. Confirm a slot is free in the active-agent inventory before allocating it again.
4. Give each writer a task branch/worktree from the accepted dependency commits and a leased web/control/worker port set and PostgreSQL database pair with scoped roles. Give independent review its own checkout and test leases. Record lease identifiers in the permit and use ignored local environment files for credentials. Release or renew leases explicitly before reuse. Destructive tests use the existing test-namespace guard.
5. Queue tasks with overlapping writes, unavailable test resources, unverified dependencies, or contract drift. Prioritize verification and repairs that unblock consumers. If pending reviews exceed review capacity, pause new builds on that dependency chain and finish existing candidates first. Unaffected lanes may continue. Recheck the permit ledger and dependency SHAs at each handoff.

## Handoff envelopes

Keep these fields in the root ledger and attach them to dispatches. Use repository-relative paths for file capabilities and absolute paths or scoped artifact references for the leased workspace and evidence. Reference the applicable [workstream handoff](2026-11-08-agent-handoffs.md) and spell out the task-specific input and output so the next agent can work from the envelope.

### Lead to Sol task request

```yaml
schemaVersion: 1
taskId: <implementation task ID>
attempt: <positive integer>
ownerLead: <A | B | C and Astra session ID>
dependencyShas: <named prerequisite commits with full SHAs, including base>
contract: {version: <frozen version>, hash: <SHA-256>}
worktree: <absolute path>
branch: <task branch>
allowedPaths: <explicit edit paths or globs>
forbiddenPaths: <protected or other-owner paths>
leases: <permit ID, port set, control/runtime DB identifiers and roles>
interfaces: <exact input and output types, module or route, and error semantics>
examples: <concrete input and expected output including a blocking case>
testCommands: <exact commands and required outcomes>
invariants: <financial, isolation, source, and acceptance invariants that apply>
budget: <bounded time or token budget and retry limit>
evidenceTarget: <scoped path and required artifacts>
blockers: <known issues and conditions that require returning to the lead>
```

The exact interfaces and examples connect producer and consumer tasks. A missing or conflicting prerequisite goes back to the owning lead with the proposed schema change, affected consumers, and a concrete before/after example.

### Sol to lead and root candidate return

```yaml
schemaVersion: 1
taskId: <same task ID>
attempt: <same attempt>
worker: <gpt-6.1-sol session ID>
baseSha: <full dependency base commit>
commitSha: <full candidate commit, or null when blocked before a candidate>
branch: <task branch>
contract: {version: <used version>, hash: <used SHA-256>}
diff: <exact base-to-candidate diff reference or pending diff for blocker>
files: <all changed paths>
testsExecuted: <exact commands, exit codes, and result/log paths>
failureEvidence: <intended red tests, remaining failures, and missing checks>
boundaries: <fixture, stub, live, and AI-off paths exercised>
evidence: <packet path and manifest or artifact hashes>
blockers: <dependency, scope, or verification gaps>
status: <awaiting Astra verification | blocked>
```

### Root to independent Astra review request

Send the original task envelope, frozen contract version and hash, exact base and candidate SHAs, changed paths, Sol return and evidence, and review checkout and leases. For a repair attempt, include the prior defects and reproduction commands. The reviewer checks out the candidate SHA, checks the actual diff and required coverage, and reruns at least a success path and the highest-risk negative or concurrency path applicable to the task.

### Independent Astra to root review return

```yaml
schemaVersion: 1
taskId: <same task ID>
attempt: <reviewed attempt>
reviewer: <gpt-6-astra session ID>
supervisingLead: <lead session ID>
builder: <Sol session ID>
baseSha: <full reviewed base commit>
reviewedSha: <full reviewed candidate commit>
contract: {version: <reviewed version>, hash: <reviewed SHA-256>}
spec: <pass | fail | blocked, with rationale>
quality: <pass | fail | blocked, with rationale>
verification: <pass | fail | blocked, with rationale and coverage gaps>
reproducibility: <checkout and configuration, exact commands, results, evidence paths>
defects: <severity, location, expected and actual behavior, reproduction>
status: <verified | fix_required | blocked>
jointAcceptance: pending
```

Record `planned → ready → building → awaiting Astra verification → verified → integrated → joint_accepted`. A defect leads from `awaiting Astra verification` to `fix_required` and then a new `building` attempt. A blocker pauses the transition and records its owner, evidence, and unblocking condition. Missing mandatory checks or live evidence stay pending or blocked. A Sol fix returns a new candidate SHA for fresh Astra review. Prior verdicts remain tied to their reviewed SHAs. B runs the slice integration checks on the combined revision and records that SHA separately. Only the user can grant `joint_accepted` after the joint checkpoint in the [verification playbook](2026-11-08-verification-playbook.md).

## Preflight contract decisions still to freeze

These are architecture decisions for the Astra leads before T0.1 implementation dispatch. The current [shared contracts](2026-11-08-shared-contracts.md) give the vocabulary. The responsible leads prepare exact schemas, examples, and observable tests. B consolidates them into a versioned, hash-pinned baseline and root queues independent Astra review before dispatching implementation. All rows remain open.

| Subject | Lead responsibility | Decision and proof to freeze |
|---|---|---|
| Unknown raw source identity | A proposes the source envelope, B owns hold and scope rules, C specifies rejection assertions | Define how an event carries a raw unknown source identity without requiring a guessed approved `Scope`. Specify when it can be matched and when a hold stays unscoped. |
| Executable connector and target schemas | B owns the schemas, A checks source adapter compatibility, C owns independent cases | Freeze concrete executable shapes for `normalizedPlan`, `ops`, `sourceContracts`, and `TargetState`. Include discriminants, field constraints, canonical encoding, and valid and invalid examples. |
| Upload, dossier, and evidence payloads | A owns the schemas and source semantics, C checks UI and exact-citation cases, B publishes contracts | Specify request and response payloads, partial and rejection cases, what each citation hash covers, and the encoding, offset unit, and boundary convention for excerpts. |
| Company B manifest snapshot | A owns the multi-stream semantics, B checks runtime bootstrap/resume consumption, C specifies gap tests | Define `captureSnapshot` against Company B's immutable manifest, including member pinning, missing-member behavior, and how snapshot membership and each resume cursor align with later publication. |
| Stored receipt and replay response | B owns runtime storage and response semantics, C checks UI and replay assertions | Freeze the distinction between the stored authoritative receipt and the replay marker on the response. Supply original, retry, and conflicting-key examples. |
| Activation trust boundary | B owns the private runtime consumer, C owns the control-side report/review inputs, A checks source provenance | Specify how control-owned inputs are transferred to runtime in a trusted immutable hash-bound activation bundle. Freeze authentication, the fields and hashes bound together, validation and stale/forged cases, and the transport with no cross-database access. |
| Health and artifact verification | B owns health and service contracts, C owns the independent verification protocol and report, A supplies manifest cases | Specify partial/unavailable health responses, verification inputs and invocation, required report coverage, and the report's binding to the exact artifact, profile set, and manifest. Include forged, stale, and missing-coverage rejection examples. |
| Source/UI event ordering | B owns sequence locking and persistence, A owns source injection, C owns UI replay assertions | Design a two-transaction case that separates transaction start from publication-lock acquisition. Prove cursor replay after reconnect with committed publication order. Commit reversal while both transactions hold the same exclusive sequence-row lock is impossible. |

V0 environment readiness also requires the plan's pinned Node 24 runtime and reachable PostgreSQL. A read-only shell check found Node v26.10.0, npm 11.19.1, and Homebrew at `/opt/homebrew/bin/brew`. Docker, `psql`, `pg_ctl`, `postgres`, Podman, and Colima were unavailable on that shell's PATH. Resolve the runtime and database setup during V0 readiness.
