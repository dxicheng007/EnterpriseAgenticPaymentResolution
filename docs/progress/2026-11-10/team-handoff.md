# Current team handoff and remaining tasks — November 10, 2026

**Active demo MVP path (fixture + AI-off, hardcoded connector, simulated inject):** [demo-mvp-path.md](demo-mvp-path.md). Land `codex/platform-company-a-demo-mount` @ `a945586` on `main`, disposable staging, on-stage contract script, joint user acceptance. Live construction stays deferred (T9).

For Platform checkpoints and delivered owner requests, read [Platform coordination](platform-coordination.md). For the shared high-level T0–T9 board, read [demo remaining work](../../superpowers/plans/2026-11-10-demo-remaining-work.md) (T3/T4/T8 delivered on the platform tip; not yet on `main`). Frozen T0 script and identities: [demo contract](../../demo/demo-contract.md). Experience delivery: [experience-mvp-completion.md](experience-mvp-completion.md).

The tables below are the **roadmap snapshot at main `0f0184e` / merged PR40** and remain historical evidence for older lane tasks. Prefer exact-candidate reviews over old completion summaries. This task list is not a source-path or migration reservation.

## Completed work to preserve

- Approval intents, first import and authoritative receipt recovery (PR9); durable synchronization capture (PR18); internal current-authority pause/resume/revoke and epoch fencing (PR23). Do not redispatch these completed bounded tasks. The current-authority service remains unmounted.
- Additive batch classification with the original financial behavior preserved; corrected V3 report validation, V4–V7 incomplete-proof gates and dependency helper validation. PR40 is merged, including its resolved script conflicts.
- Lossless fixture deduplication: 180 cases, including 128 permutations, reference 39 complete outcomes. The fixture is 8,241 lines / 255,568 bytes instead of 129,560 lines / 4,234,825 bytes. Expansion reproduces the original captured bytes and SHA-256; production code was unchanged by this storage migration.
- Discovery's supported association, proposal compilation/registration, sandbox replay/compare, monitor and offline provider helpers are implemented prerequisites. Gate P verification producer acceptance is retained. Merged Gate J consumer code is not accepted merely because it is on main.
- Experience's reviewer decision details, evidence controls, per-package recovery storage and same-package details retry are implemented. Remaining browser proof and narrower wording findings below do not reopen the superseded missing-controls defects.

See the [Platform integration handoff](../2026-11-08/handoffs/platform-classification-dispatch.md), [classification report](../2026-11-08/handoffs/platform-sync-classification-implementation-report.md) and [fixture review](../2026-11-08/reviews/platform-classification-fixture-review.md).

## Developer 0 — Platform and integration

| Task | Deliverable and completion boundary | Dependency |
| --- | --- | --- |
| P1 — Repair atomic synchronization application | Review a bounded repair plan for the inherited PR39 writer, then fix full source/event identity, original receipt associations for economic replay, captured-input provenance, governing-change coverage and atomic application progress. Obtain real transactional tests and fresh exact-candidate review before mounting. Remove accidental excluded duplicate tests within an explicitly assigned cleanup scope. | Start from the [PR39 findings](../2026-11-08/reviews/platform-pr39-722aaf7-review.md) and reconcile with the reviewed design; no new financial policy is needed for those findings. |
| P2 — Complete synchronization coordination | Implement dependency release, bounded capture/application scheduling, supported source catch-up, contiguous progress and visible gaps/quarantine. Prove independent-account progress, approval-window catch-up, Company B batch continuity and preserved cutover history. | Accepted apply behavior and concrete path/contracts reservation. Pure dependency helpers are already present. |
| P3 — Publish authority and operations APIs | Add authenticated control-to-worker pause/resume/revoke ingress and authoritative connection/receipt/progress reads. Publish exact schemas and transitions for Experience. | Existing internal authority service; accepted operations contract and runtime states. |
| P4 — Unblock remaining Discovery capabilities | Resolve the generated-account read/verify-only capability boundary; publish repair/finish semantics and additive grants; freeze product provider/model configuration and trusted composition wiring. Preserve separation from reviewer approval and activation. | Joint contract work with Discovery. Materially absent product/financial policy requires user clarification; routine implementation does not. |
| P5 — Complete V5/V6 proof | Prove genuine post-activation input with model access disabled for both source types, original receipt replay, crash/restart boundaries, apply/revoke serialization, changed-byte rejection and scoped drift containment. Connect the model-call trap to actual worker execution. | Accepted P1/P2 behavior. Existing capture/authority/browser harnesses remain partial. |

The [atomic-apply design](../2026-11-08/handoffs/platform-sync-atomic-apply-design.md) has a reviewed bounded coverage correction; SHA-256 `4e07cae264aaae9bd4790240332061bc48d540de3eb99275ba1629dae45084ce`. This is planning acceptance, not implementation acceptance or a migration reservation. Reconcile it with already merged PR39 before dispatch.

## Developer 1 — Discovery

| Task | Deliverable and completion boundary | Dependency |
| --- | --- | --- |
| D1 — Correct Gate J verification consumers | Fix final authorization/atomic admission, current scoped state and saved-response authorization, complete-batch semantic/budget checks, independently scheduled historical recovery, ambiguous COMMIT handling, current settlement/capture checks, authenticated original-subject reads and temporary uncertainty projection. Correct premature production advertisement and overstated acceptance documentation. | Existing accepted Gate P producer; [Gate J findings](../2026-11-08/reviews/platform-discovery-gate-j-7012a4d-review.md). The [50481ad correction review](../2026-11-08/reviews/platform-discovery-gate-j-50481ad-review.md) did not close those findings. |
| D2 — Correct the live provider transport | Preserve tool calls/results, distinguish missing usage from zero, validate completion state, require valid input-budget preflight and bound/sanitize response parsing. Verify timeout/cancellation and truthful accounting under the accepted contract. | [Transport review](../2026-11-08/reviews/platform-live-transport-8f14539-review.md). The merged token heuristic is an offline approximation, not accepted provider-budget enforcement. |
| D3 — Complete remaining construction tools | Implement repair/finish and any separately assigned investigation behavior against accepted semantics, storage and grants. Apply generated-account capability rules without allowing a proposed ID to grant itself authority. | Platform P4. Current contracts-only/unavailable tools must not be advertised as implemented. |
| D4 — Genuine live construction and holdouts | After transport and composition acceptance, produce real provider-generated A/B candidates, independent verification, changed-input holdouts and truthful unsuccessful/abstained outcomes; complete V4 proof. | D1–D3 as required by the bounded workflow, Platform P4, and user-configured provider access. No provider or secret setup is authorized by this handoff. |

The [Discovery unblock inventory](../2026-11-08/handoffs/d4-discovery-unblock-handoff.md) remains useful for capability, grants and configuration dependencies. Its Gate J completion wording is superseded by the independent review findings and this handoff.

## Developer 2 — Experience

| Task | Deliverable and completion boundary | Dependency |
| --- | --- | --- |
| E1 — Finish reviewer browser proof | Exercise field/identity evidence and originals before approval; real earlier-intent/receipt recovery after head advancement; duplicate submission/lost-response handling; delayed/mismatched details; unsupported material terms blocking approval. Correct the explanation of expected parent version as an import prerequisite. | Existing reviewer APIs and controls. Follow the [latest V3/Experience review](../2026-11-08/reviews/platform-v3-v4-9680b05-review.md), retaining its supersession of older source defects. |
| E2 — Complete discovery and operations presentation | Finish bounded discovery detail inspection. Consume authoritative connection states, receipt history, captured/applied/pending/quarantined counts, lag/gaps and versions; wire scoped pause/resume/revoke controls and honest pending/error states. | Discovery's accepted safe reads; Platform P3 for operations. UI must not infer authority or invent backend transitions. |
| E3 — Reviewer correction/unresolved workflow | Implement the agreed evidence-backed correction experience and verification invalidation rules. Preserve unresolved state while authority semantics are absent; the current deny endpoint is not a complete correction service. | Joint Platform/Discovery/Experience contract work. No unsupported monetary value becomes a fact through review. |
| E4 — Final walkthrough and rehearsals | Coordinate the complete two-company workflow, before/after financial and receipt observations, AI-off fresh inputs, replay/restart and drift containment; execute three full rehearsals and obtain clarity/workflow feedback. | Accepted V3–V6 behavior and genuine live A/B artifacts. Full V7 remains unavailable until its real proof exists. |

## Shared verification and release work

- Experience supplies run-bound public browser/activation observations and safe screenshots; Platform integrates strict schema/allowlist validation and retention in evidence packets. Actual bindings, counts, cents and receipt identities must survive disposal of test databases. Passing test names alone are insufficient. See the [V3 packet finding](../2026-11-08/reviews/platform-v3-v4-9680b05-review.md).
- Platform integrates accepted owner changes and obtains exact-candidate independent review. Machine checks, independent review, full slice acceptance and joint user acceptance remain separate.
- CI requires account/operator follow-up. Latest observed PR40 workflow `42777912197` at `ae350c0` ended `startup_failure`; the earlier inspected workflow `42777441189` had zero jobs. No CI pass is claimed, and no billing/settings change has been made. Recheck current runs before making a later status claim.
- User-provided live access is needed only after the offline transport/configuration boundaries are ready. Optional V8 repair/version switching is a later assignment, not a prerequisite silently added to mandatory V0–V7.

## Next execution order

1. Platform prepares the bounded PR39 repair plan. Discovery can correct Gate J and transport independently. Experience can close existing reviewer browser/wording gaps.
2. Platform publishes remaining capability/grant and operations contracts; consumers implement only the released scope. Continue capture/application scheduling after accepted atomic application.
3. Run genuine construction and AI-off synchronization, then the complete crash/replay/revocation/drift matrix.
4. Complete V7 rehearsals, independent final review and joint acceptance.

## Recorded evidence and continuation safeguards

- Post-merge unit suite: 555 tests / 79 files passed. Fixture storage candidate `62a76be9375a1e8875424ff50287eddb94f5a8ec`: 53 compiler tests and typecheck passed in both implementation and independent review. These are recorded checks, not fresh tests performed for this documentation update.
- Actual V6 at documentation commit `b12c6fa` with an untracked review note: all eight prerequisite commands / 30 cases passed; full result correctly failed with `application-recovery-proof-unavailable`. Exact packet location and prior clean V3 evidence are in the [Platform handoff](../2026-11-08/handoffs/platform-classification-dispatch.md). Full V4/V5/V6/V7 acceptance is not established.
- Runtime001–005 are immutable. Runtime004 SHA-256: `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7`; runtime005: `7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96`. Check accepted and in-flight catalogs before reserving additive DDL.
- Continue in the isolated Platform worktree `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`; preserve the original demo and other developers' worktrees. Fetch while writers/tests are active; integrate main at clean checkpoints. Check current ownership before any new source writer.
- Use one Sol source implementer at a time and fresh Astra design/exact-candidate reviews under the existing team protocol. A task listed above does not authorize taking another owner's files. Preserve durable coordination in `.superpowers/sdd/2026-11-08-team-expansion-handoff/progress.md`.
- Previous Platform test lease: PostgreSQL55441, control3241, worker3242, web5182, prefix `eapr_test_review_t2`, namespace `eapr_review_t2`. Reconfirm ownership and availability before reuse. Do not stop another lane's processes or database.
