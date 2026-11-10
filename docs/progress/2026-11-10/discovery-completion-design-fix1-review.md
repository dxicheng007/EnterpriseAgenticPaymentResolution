# Discovery completion design fix1 — scoped independent re-review

Reviewed 2026-11-10. Worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Candidate: `docs/progress/2026-11-10/discovery-completion-contract.md`

Verified exact SHA-256: `b8e32ebad1c0a53aefa18ebda1e4fb6bc385c24d9d1e517f3960553d0c3acf98`.

Prior reviewed SHA-256: `67f776a0ae4521b1fcb2dbed71989c946ba9f6873559adabf80ac7691e2322af`.

Scope: the two findings in `/private/tmp/eapr-discovery-completion-design-review.md` and new breakage in the changed text shown by `/private/tmp/eapr-discovery-completion-contract-fix1.diff`. This was not a restart of the broader review.

## Verdicts

**Specification: PASS for the scoped fixes.** The revision implements the existing requirements for unresolved compiler diagnostics, current-input repair evidence, exact verification subject provenance and full opened-investigation coverage. It adds no parent-account grant, financial approval, sticky-finding resolution, provider authority or runtime behavior.

**Quality: PASS for the scoped fixes.** Both prior findings are addressed. No new actionable defect was identified in the changed text. The diagnostic rules now distinguish selection identity, admission order, historical assessment provenance, unresolved outcomes and nonterminal uncertainty sufficiently for the assigned consumer implementation.

**Verification: design review only; implementation evidence pending.** No repository edits, Git operations, DB operations, tests, provider calls or subagents. Only this temporary report was written. Design acceptance does not establish executable correctness, migration acceptance, live readiness or joint user acceptance.

## Findings disposition

### P1 — Full-scope settled compile diagnostics: ADDRESSED

New diagnostic-selection section, especially candidate lines 146 and 152–156, explicitly inventories `discovery_compile_steps.result`, including `linkCurrent:false`, across every relevant proposal and retained investigation union. Revised finish step 2 requires that inventory independently of current assessment contents and the existence of another compiled proposal.

This closes the concrete A-compiled/B-failed seam identified in the first review: B's failed result cannot disappear merely because current assessment rows are clear or B is omitted from citations/current compiled candidates. The required proofs now cover account/source-wide B, a replacement proposal identity, and a valid superseding success. Historical failures are selected from history rather than copied permanently into the sticky finding ledger.

### P2 — Exact grouping and supersession: ADDRESSED

Candidate lines 148–164 now specify:

- First committed admission activity sequence per exact run/step/tool, distinct from settlement or recovery order.
- Compile lineage `(runId, proposalId, complete pinned DiscoveryBinding)` and exact immutable input subkey, excluding assessment revision from supersession partitions.
- Current-input versus predecessor-input behavior, with carry-forward obligations confined to finish and predecessor diagnostics excluded from exact-current-input repair admission.
- Verification key `(runId, proposalId, proposalRevision, accountId, subjectHash)` plus byte-for-byte canonical subject equality; assessment revision is provenance rather than a partition.
- Current applicability and authority checks, valid-terminal outcome selection, nonterminal/unknown handling, invalid result rejection, incomplete coverage behavior and retained historical diagnostic references.

Checked the changed verification-subject description against `packages/evaluator/src/discovery-verification.ts:79`–`:87`: its existing subject includes canonical candidate bytes, profiles sorted by hash, full snapshot object hash and run/account identity. Checked the safe-job/summary fields against `packages/contracts/src/review.ts:11`–`:36` and the existing safe failed-job projection at `packages/discovery/src/verification-tools.ts:359`–`:370`. The design uses available safe summary/check diagnostics and existing `VERIFICATION_FAILED`; it does not require product tools to read protected report bytes.

The new consumer proofs exercise the previously ambiguous assessment advancement, later success/failure, pending/unknown attempts, distinct subjects, reversed settlement order and repeated recovery activity. The revised beginRepair paragraph consumes the common selector rather than retaining a competing rule.

## Changed-text boundary check

The new compile carry-forward obligation prevents a mere revision change from clearing an unresolved known compiler failure, while allowing a valid revalidated compile to supersede that failure. It preserves the separate requirement for at least one genuinely current compiled candidate. Verification remains repair evidence rather than a financial-eligibility finish gate. Sticky finding/capture/authorization blockers remain independent. No schema/grant/role/ownership change was introduced by fix1.

The two previous findings can be closed for this exact document hash. Producer and consumer implementation release, SQL/application-role proofs and exact-candidate executable review remain separate root-controlled steps.
