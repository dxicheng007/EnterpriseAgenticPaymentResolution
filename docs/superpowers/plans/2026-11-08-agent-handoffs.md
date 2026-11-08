# Codex workstream handoffs

These are copy-ready task descriptions for the user's Codex agents. They do not create chats or start implementation automatically. All workstreams belong to the same user; product-agent roles are separate from these implementation assignments.

Read `prdv2.md`, the [implementation plan](2026-11-08-implementation-plan.md), [shared contracts](2026-11-08-shared-contracts.md), and [verification playbook](2026-11-08-verification-playbook.md). Repository-relative paths in each task are authoritative. Use worktrees for concurrent coding and separate PostgreSQL namespaces/ports. Do not share a writable runtime database between agent worktrees.

## Dispatch model and handoff

The [orchestration policy](2026-11-08-agent-orchestration.md) governs every dispatch. A, B, and C are `gpt-6-astra` leads. Each prepares bounded tasks for `gpt-6.1-sol` implementation workers, including fixes. Root assigns permits and schedules a fresh `gpt-6-astra` reviewer who neither built nor supervised the candidate. The dispatch descriptions below assign lane ownership. Use the policy's task envelope for the actual worker assignment.

Each brief must identify the producer and consumer of every interface crossing the task boundary. Pin the dependency SHAs and contract version/hash, name the exact module or endpoint and request/response types, and include concrete input/output and failure examples. Return the candidate commit and evidence to the lead and root. The reviewer receives that same brief and exact commit so the review tests the interface the consumer expects.

## Shared instructions for every builder

> Implement only the assigned task IDs. Read their dependencies and interface contracts before editing. Keep the unit of work small enough to review independently. Add the named behavioral tests, observe their intended failure, implement the minimal behavior, then run the relevant verification command. Do not change acceptance assertions or fixture truth to fit your output. Do not modify other owners' files, shared schemas, lockfiles, or server composition without coordinating with the integrator. If an interface needs to change, propose the exact schema diff, consumer impact, and example before using it. Return commit SHA, changed files, commands/results, evidence packet, open issues, and fixture-versus-live limitations. Never mark joint acceptance complete on the user's behalf.

All agents use the same supported-money rules and source identity strategy. No runtime LLM fallback, hidden approval bypass, mocked DB labeled integration, or precomputed artifact labeled agent-generated is acceptable.

## Initial dispatch

### First: B/integrator — T0.1 foundation and contract publication

> Own T0.1. Lead the preflight contract freeze with A and C and get independent Astra review on the exact baseline before dispatching Sol for the runnable foundation. Create the minimal runnable UI/control/worker/PostgreSQL setup and publish the shared contract types/examples. You own root dependencies/configuration, SQL migrations, and server composition. Use the shared-contract file as the required interface vocabulary. Deliver an isolated two-database health/persistence test and a browser health screen. Publish the verified contract version and hash before asking A and C to implement consumers. Do not build the full financial engine in this task.

While T0.1 is in progress, A may prepare a fixture/schema proposal and C a test/review-flow proposal without editing B's bootstrap files. These are preparatory artifacts, not completed feature slices.

### After contracts: A — T1.1 and T1.2 source/evidence slice

> Own the complete source/evidence behavior: deterministic synthetic source generation, immutable evidence, both mock legacy systems, upload/dossier routes, and Company B's multi-stream bootstrap manifest. Your APIs must match the published contracts. Coordinate the `sources/` UI with C through typed examples. Keep hidden truth outside served roots and product tools. Deliver G1 evidence showing exact citations, duplicate handling, identity separation, and no snapshot-to-live gap. Do not implement activation or parent writes.

### After contracts: B — T2.1 compiler and finance preview

> Implement the restricted connector compiler, pure preview planner, and financial primitives. Start against clearly labeled public dev connector fixtures so A's agent construction is not a blocker. Preserve source identities and field lineage. Do not implement arbitrary code execution. Own the exact cents, full-reversal, over-allocation, entity, and version tests. Coordinate independently with C's evaluator, which must not reuse your financial calculation implementation.

### After contracts: C — T2.2 evaluator plus bounded UI components

> Build the protected independent verifier and preview screen against published fake APIs first; wire real compiler/source data when available. Own the reference calculator and final holdout assertions; do not import `packages/finance` or leak expected outputs to product tools. Implement the health/sources UI components needed by B/A in separate feature files. Use registered fake examples with the same Zod schemas as the real APIs. Return a wrong-mapping rejection and an inspectable preview, not a frontend-only pass.

## Subsequent dispatch waves

| Wave | A | B | C | Exit |
|---|---|---|---|---|
| 1 | V1 source/evidence | V2 compiler/preview | Independent verifier + UI | Contracts stable, G1/G2 machine proof |
| 2 | T4.1 orchestration; T4.2 live build | T3.1 activation then T5.1 capture/apply | T3.2 review and T4.1 monitor UI | Explicit import + live generated artifact |
| 3 | Source injections/drift support | T6.1 recovery, T6.2 containment | T5.2 AI-off views, T6.2 controls | G5/G6 proof with actual generated artifact |
| 4 | Live failures in owned tools/prompts | Runtime failures in owned modules | T7.1 whole-product rehearsal | G7 joint acceptance |
| Optional | Agent repair | Version switch | Version diff and review | V8 only after required demo |

Each lane queues overlapping changes. The root permit ledger governs when independent workers can own disjoint modules/tests within the active slot limit. B integrates shared contracts and root changes. C owns demonstration coordination.

## Worktree and merge discipline

- Branch names: `codex/v0-foundation`, then task-specific names such as `codex/t1-1-evidence`, `codex/t2-1-preview`, and `codex/t3-2-review`. Start from the accepted dependency commit, not an unrelated stale base.
- Allocate database pairs and ports per worktree. Record them in ignored local env files; never repurpose the user's shell HOME variables.
- Update contracts first in a small reviewed commit, then consumers. No “fix” by accepting `any`, turning off schema validation, loosening money assertions, or swallowing conflicts.
- Root manifests and lockfile remain integrator-owned. Feature branches request dependency additions rather than silently generating conflicting lockfiles.
- Merge only reviewed task commits. Run the slice's real integration checks on the combined branch; a successful branch-local run is insufficient when its fake dependencies have been replaced.
- Do not push directly over other agents' work, force-push shared branches, or commit secrets/evidence dumps. Preserve unrelated user edits.

## Independent review prompt

> Review task [ID] at commit [SHA] against the PRD, implementation task, shared interfaces, and verification playbook. Inspect actual code and tests, not just the builder's summary. Verify at least one success path and the most consequential negative/concurrency path with fresh output. Check financial identities, authority, raw evidence, runtime model isolation, and truthful fixture/live labeling as applicable. Report concrete defects with reproduction and severity, missing acceptance coverage, or “no actionable findings” with checks performed. Do not approve the user's joint-review gate or silently fix defects in the builder's branch.

Use a fresh `gpt-6-astra` reviewer for every candidate SHA, including repairs. The reviewer must be separate from the builder and supervising lead. The independent financial evaluator remains separate from the builder's implementation.

## Builder return format

Attach the [candidate return envelope](2026-11-08-agent-orchestration.md#sol-to-lead-and-root-candidate-return) to this summary.

```text
Task and delivered behavior:
Commit / branch / dependency commit:
Files changed:
Tests executed (exact commands and results):
Intended negative cases observed:
Evidence packet:
Fixture/stub/live/AI-off boundaries:
Known blockers or tradeoffs:
Contract changes requested:
Ready for independent review: yes/no
Joint acceptance: pending
```

## Coordinator's responsibility

Maintain dependency and verification status, publish the next ready assignments, integrate reviewed changes, and bring a short runnable walkthrough to the user at each joint checkpoint. If a gate fails, identify the responsible task and allow unaffected lanes to continue. Never describe the complete product as working merely because all three agents report completion.
