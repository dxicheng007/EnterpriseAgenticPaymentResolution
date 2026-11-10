# Independent Discovery D configuration design review

Candidate: `docs/progress/2026-11-10/discovery-model-configuration-contract.md`

Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`

Verified SHA-256: `8dd506cb483242069c8b140c83c2598de11110452225e352f2c5548271fa76d9`

Date: 2026-11-10

**Spec: PASS for the stated offline design and coordinated consumer handoff. Quality: PASS. No blocking design findings.** This does not approve implementation, select a provider/model, authorize credential access, mount transport, or close Blocker D, Gate J, V4, or joint acceptance.

## Basis

Read the candidate in full; section D of `discovery-unblock-policy-audit.md`; the current transport correction matrix and owner requests in `discovery-pr43-pr46-review.md`; repository/apps/packages/Discovery AGENTS; PRD local process/agent boundaries and acceptance criteria; accepted orchestration model, limits, pause and supervisor rules; Discovery shape freeze consumer obligations; implementation T4.2; shared ownership and verification conventions. Inspected actual `model.ts`, `live-model-transport.ts`, `budgets.ts`, `repository.ts`, `service.ts`, `supervisor.ts`, control composition, strict ModelTurn/ModelResult schemas, and control004 storage.

This was a read-only design/source review. No Git operations, tests, database operations, provider calls, environment-key inspection, credential retrieval, source edits, or subagents were used. The sole output mutation is this requested report. Machine verification remains not run by instruction.

## Findings supporting the verdict

- **Actual-input enforcement is substantive, not a renamed estimate.** Lines 110–122 require one instance-owned immutable request body, exact byte hash, pinned routing/protocol semantics, a meter over that same prepared handle, privately retained measurement provenance, and send-time equality checks. All provider framing/tool/special-token accounting must be supported; unavailable accounting fails before I/O. The existing abstract-turn meter and serialized bytes/4 are explicitly excluded. Fake-meter tests are correctly limited to seam proof; provider tokenization remains separate evidence.
- **Policy binding covers the actual dependencies.** Lines 42–57, 73, 114 and 126–140 pin exact provider/model, adapter/meter versions, rules evidence, endpoint reference and ceilings. Saved policy hash is checked at reservation and dispatch; model ID/mode alone is insufficient. Historical scripted rows and authorized replay remain separate; old unbound live rows cannot silently acquire new authority. Existing JSONB can hold this representation without DDL.
- **Usage/error truth has a viable consumer path.** Lines 151–179 distinguish independently known usage, proven no-send, and unknown outcomes. The bounded private failure carrier solves the real `catch -> accept(undefined,true)` information-loss boundary when a valid provider response ID is absent. It does not fabricate IDs or results and explicitly requires real-supervisor integration before release. It keeps known usage separate from permission to execute tools.
- **Cancellation promises remain honest.** Lines 179–181 preserve ownership fences and unknown terminal accounting, forbid late ordinary-pool rewrites, retain the unsettled permit until underlying settlement, and avoid treating local abort as proof of remote cancellation or no charge. Process-death and provider reconciliation remain evidence obligations.
- **D0 is feasible and bounded.** The audit explicitly permits an offline disabled parser/composition seam. A strict reusable policy representation, canonical hash and always-unavailable resolver can be implemented without SDK, key, registry/network I/O, provider choice, or Discovery edits. D1 owns actual enforcement in the existing transport/scheduler. D0 does not build a duplicate adapter, scheduler, generic configuration service, audit table, or speculative provider registry.
- **Isolation and ownership are explicit.** Credentials remain in trusted control, excluded from hashes and persisted policy; worker/browser receive no model execution or provider configuration. Discovery retains transport corrections T2/T3/T5, prepared-input enforcement and lifecycle accounting. Platform retains trusted configuration and eventual dependency injection. Path release and live mounting are distinct later decisions.

## Nonblocking implementation handoff notes

1. **Project stored policy into strict turn limits.** Candidate lines 126–140 introduce `schemaVersion` and `binding` in `run.policy`. Actual `supervisor.ts:558` currently passes the whole object as `limits`, while `packages/contracts/src/discovery.ts:130–132` rejects unknown keys. The D1 brief should explicitly require projecting the three ceiling fields into ModelTurnV2, retaining the full policy privately for dispatch checks. This is a concrete integration detail within the already assigned D1 changes, not a reason to expand public wire schemas or change D0.
2. **Preserve ordinary pause settlement semantics.** Interpret “pause interruption” at candidate line 154 as an actual interrupted invocation, not a blanket rejection of every response after reviewer pause. Accepted orchestration allows already-claimed work to settle and stores validated output as pending steps, with no tool claims until resume. The cancellation tests should distinguish ordinary pause from timeout/owner-loss interruption.
3. **Keep D0 composition work genuinely narrow.** Existing composition already omits a model client by default. Do not add an unused factory/registry or a second policy validator just to exercise the always-disabled resolver. A shared parser/hash implementation and the smallest real configuration entry point are enough; the candidate already makes composition edits conditional. Freeze/reuse that representation when D1 consumes it rather than copy its validation into a parallel policy stack.

These notes are implementation guardrails, not defects requiring a revised design candidate. Fresh exact-candidate source review and the prescribed offline/leased integration evidence are still required for implementation. Provider-specific metering feasibility is deliberately unresolved and cannot be inferred from this design approval.
