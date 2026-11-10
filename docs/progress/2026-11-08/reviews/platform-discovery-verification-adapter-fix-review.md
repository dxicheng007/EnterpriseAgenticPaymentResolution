# Discovery verification adapter design correction re-review

Candidate: `bd3907959be6c3f0be191ba185ff60bde63cc30c` in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Scope: fresh review of correction round 1 against `/private/tmp/eapr-discovery-verification-adapter-design-review.md`, the supplied correction diff, and the full tracked `docs/progress/2026-11-08/handoffs/platform-discovery-verification-adapter-design.md`. Verified candidate HEAD and inspected current supervisor `transact` and `loadStep` to check the corrected API assumptions. No code changes, database operations, tests, or subagents. This is design acceptance only.

**Specification verdict: pass for the scoped correction.** Both original blocking findings are addressed. The correction keeps historical execution distinct from current eligibility, preserves current authorization, and does not introduce generated-account capabilities or live-provider authority.

**Engineering-quality verdict: pass for the scoped correction and staged implementation design.** No new blocking breakage found in the correction. This is not implementation acceptance or permission to mount tools. Root must still reserve the producer/migration/catalog paths, and actual lifecycle integration must pass Gate J before mounting or advertisement.

## Original blocking findings

1. **Historical recovery versus current-subject admission — addressed.** The contract now separates `lookup`, `admit`, and `recoverQueued`. Historical lookup authenticates current authority and the persisted original association without requiring current proposal head, task revision, or step generation. Admission alone requires current runnable/fenced state and current compiled subject. Queued recovery claims only an existing immutable request, including already-admitted work while paused; stale proposal or assessment produces historical execution without a current-success link. The immutable binding retains original dispatch, admitted generation/task revision, proposal/assessment revisions, and exact subject bytes. The added reserve → revision/assessment change → restart barrier directly covers the original contradiction. This separation is necessary given the existing `loadStep` distinction between replay and runnable contexts; the design no longer assumes one generic current-state gate can serve both.

2. **Producer/consumer acceptance cycle and concrete gate contract — addressed.** Gate P explicitly proves producer SQL/attested execution only, using test-owned transactions. Gate J is separately assigned and must use the actual supervisor owner connection, lifecycle checks, and replacement behavior. Neither a synthetic advisory lock nor Gate P permits tool mounting. The published typed contract includes immutable binding, callback lifetime restrictions, confirmed commit, denial, and owner-loss outcomes. It explicitly refuses to translate current `transact` returning `undefined` into success. Unknown admission or claim commit outcomes recover by mapping; they do not schedule or fail from an unconfirmed local result. This resolves the ownership cycle consistently with root's selected sequence, without assigning supervisor changes to the producer.

## Other original implementation cautions

- **Claim ownership split — addressed.** `claimQueuedOn` returns a transaction-local winner/nonwinner result; only confirmed commit plus claimed permits revalidation/execution and failure of that claimant's job. Nonwinners and uncertain commit outcomes cannot fail or launch. Reviewer APIs retain their existing result shape and semantics.
- **Interrupted-running diagnostics — addressed at design level.** The correction assigns a safe `VERIFICATION_INTERRUPTED` observation to Discovery lifecycle projections, preserves the financial running state, and requires actual subsequent reports to replace uncertainty in the current view while retaining history. Consumer schema publication remains explicitly assigned to the later joint task.
- **Relational association enforcement — addressed.** The proposed additive migration adds the missing composite tool-step uniqueness and matching mapping foreign key, retains the existing reservation association, and preserves applied SQL. Migration 009 remains provisional.
- **Canonical registered spec equality — addressed.** The document explicitly requires comparing caller-supplied spec with authoritative candidate spec before deriving the full canonical subject; hashing unchecked supplied spec is expressly insufficient.

## Remaining concrete gates, not unresolved design blockers

Root must reserve the migration number and exact producer/catalog/test-fixture paths before implementation. Gate P must publish and independently review the implemented typed ports, exact migration/candidate, permission constraints, attested execution regressions, and source-build closure. The later Discovery/contracts task must implement historical authorization and immutable association checks, current admission fencing, conservative commit-outcome classification, and safe interruption projections. Gate J must prove those behaviors using actual supervisor transactions and replacement, including paused historical recovery and unknown COMMIT outcomes. These are explicit acceptance obligations in the corrected design; none is claimed complete by this review.

No V4 completion, live-provider capability, migration approval, generated-account capability, automatic abandoned-running terminalization, or user acceptance is implied.
