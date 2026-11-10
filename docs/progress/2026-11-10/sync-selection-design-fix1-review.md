# Independent scoped review: selection design fix round 1

Candidate: `docs/progress/2026-11-10/sync-selection-design.md` in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

Exact SHA-256 verified: `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`.

Prior reviewed SHA-256: `5782e22374db9cef23d8529a8d1785f21fec08046e1a712f62b7344fc74bac5c`.

Scope: disposition of the prior P1 finding, the nonblocking empty-enrollment clarification, and breakage introduced by changed text only. Compared the supplied fix-round diff to the current candidate and checked the stable compiler operations implementation/package export. This is not a review of the moving P1 writer.

Spec verdict: **PASS for this scoped design repair**.

Quality verdict: **PASS for this scoped design repair**.

Prior P1 finding: **ADDRESSED**.

The pre-routing guard at lines 90–103 now checks every applicable immutable event against each applicable approved source-contract binding, including unknown-account, paused/revoked and acknowledged post-baseline input. It uses the existing compiler-owned `validateSourcePayload` and `MappingError`, rather than relying on classifier `sourceBlockers` or duplicating payload/monetary interpretation. `packages/compiler/package.json` exports `./operations`, and `packages/compiler/src/operations.ts:18–20,29–66` supplies the stated validator/error seam. No compiler export or behavior change is required.

`SOURCE_SCHEMA` failures retain the actual compiler code/path and propagate to every applicable consumer of the failed exact binding. The guard therefore catches both previously identified counterexamples: renamed/missing fields for a known account and for a known-seller unknown account despite unchanged envelope schema. Separate unaffected approved mappings remain eligible; ordinary schema-valid unknown-account input does not acquire a guessed Scope or a blanket source blocker.

The fail-fast limitation is handled explicitly: money/date errors that may precede later structural checks produce `unexamined` and incomplete `source_contract_validation`, with zero proposals and no financial-rejection/quarantine claim. This is conservative inspection admission, not a new rule for resolving or applying finance. Successful and unsuccessful checks, exact contract/consumer references, and completeness status enter the witness or incomplete bounded facts. The new 8,000-observation ceiling and existing byte budget prevent an unbounded guard result.

The proof obligation at line 156 contains the four known/unknown renamed/missing-field cases, actual expected diagnostics, a valid-unknown positive control, a separate unaffected mapping positive control, no workaround through another resource of the affected subject, and the fail-fast-before-later-structural-error case. It also requires bounded deterministic witnesses and unchanged ordinary planner/classifier behavior. These are specified future proofs, not executed results.

Nonblocking empty-enrollment clarification: **ADDRESSED**. Line 31 now specifies `coverage.kind = incomplete`, reason `no_committed_subjects`, bounded catalog facts, and empty proposals/blockers/routes; line 54 includes the reason in the closed union. It makes no global source-completeness claim. Task 2 acceptance wording is also corrected while final P1 reconciliation remains explicit.

New changed-text breakage: **none found** within this scoped review. The repair preserves the read-only boundary, original earliest-group/typed-closure semantics, immutable P1 history, no writer/frontier/authority changes, no model/network/CSV work, and no new skip/resolve permission. No migration or source path is reserved.

Verification: read-only file inspection and candidate SHA-256 check only. No code or repository edit, Git operation, database operation, test execution, model/provider call or subagent. Only this temporary report was written. Final accepted P1 service/type reconciliation, implementation review, machine proof and joint acceptance remain separate required gates; this report authorizes none of them.
