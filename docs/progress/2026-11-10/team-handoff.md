# Current team handoff and remaining tasks — November 10, 2026

This is the current coordination snapshot at main `0f0184e13d63df435aedda17810b07a08e9fcedc`, which merged [PR40](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/40). Earlier progress reports and the original team-expansion plan remain historical evidence; use their exact-candidate reviews rather than their old completion summaries. No open PRs were observed when preparing this handoff. This task list is not a source-path or migration reservation.

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
