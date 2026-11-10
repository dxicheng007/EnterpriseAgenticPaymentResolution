# Contract freeze · Discovery verification capability (interim T4.1)

This freeze records the **interim trusted-scope allow-list** for Discovery verification tools. It does **not** implement tools, widen activation authority, install grants, or close full Blocker B (how newly proposed parent/account IDs ever become trusted for verify).

**Authority:** [D4 unblock handoff · Blocker B](../../progress/2026-11-08/handoffs/d4-discovery-unblock-handoff.md) interim T4.1 rule; [V4 orchestration proposal §8.1](../../progress/2026-11-08/handoffs/v4-orchestration-contract-proposal.md); adapter design trusted-scope admission in [platform-discovery-verification-adapter-design.md](../../progress/2026-11-08/handoffs/platform-discovery-verification-adapter-design.md). Draft source promoted from local scoping notes (2026-11-09).

**Related:** Blocker A retry-safe producer is merged (PR #12 / Gate P). Mounting `requestVerification` / `readVerification` still requires Gate J against the actual Discovery supervisor. Full generated-account capability policy remains an open Platform + Discovery (+ user) decision.

Activation standing authority remains under the separate [activation authority freeze](2026-11-08-contract-freeze-v4-activation-authority.md). Operator-published parent scopes ([parent-read setup](../../demo/parent-read-setup.md)) are not Discovery verify grants.

---

## Discovery verification capability — interim T4.1 allow-list

**Status:** Interim only. Does not authorize generated-account self-grants, identity approval, customer approval, or activation. Superseded when Platform + Discovery (+ user) accept a full generated-account verify/read policy (Blocker B).

**Purpose:** Bound `requestVerification` / protected preview-adjacent verify reads so Discovery may exercise the retry-safe adapter (Blocker A) without inventing capability from proposal text.

### Allow (verify / read-verify only)

1. Account IDs already present on the authenticated reviewer session capability as `allowedAccountIds` for this control process/session, **or**
2. Account IDs explicitly granted to the discovery run/task by the existing server-owned source-read / task grant machinery (exact captured tuples already authorized for that task — never model-supplied grant lists).

Intersection with the candidate subject is required: every `profile.scope.accountId` on the verification subject must be in that trusted allow-list. Source refs on the subject must already be in the run's pinned capture / `allowedSourceRefs` as applicable.

### Deny

1. Any account ID that appears only because a proposal, finding, or tool argument named it.
2. Any widening of `allowedAccountIds`, activation authority, approval, or parent-write capability as a side effect of draft/revise/compile/replay/compare/verify.
3. Treating a successful sandbox replay, compile, or verification summary as identity resolution or approval.

### Failure

Subjects outside the allow-list remain inspectable in construction UI/state but verification tools fail closed with `VERIFICATION_SCOPE_REQUIRED` (no enqueue, no attempt-budget consume for the denied subject). Do not partially verify a multi-account subject by silently dropping untrusted accounts.

### Audit

Grant membership is whatever the session/run already recorded; Discovery tools must not mint new grant rows. Naming an ID in a proposal is evidence of agent intent only.

### Out of scope for this interim freeze

- How newly proposed parent/account IDs ever become trusted for verify (full Blocker B)
- Live model env (Blocker D)
- Repair / finish (Blocker C)
- Advertising or mounting verification tools before Gate J passes
- Changes to activation policy install, publish-scopes, or parent-write capability

---

## Acceptance

Platform (and user if material) may treat this file as **normative for trusted-scope-only verify** once merged. Discovery Gate J consumers and the producer admission path enforce this allow/deny table without inventing grants. Full Blocker B remains open escalation.
