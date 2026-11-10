# Scoped selection closure interface clarification review

Verdict: **PASS**. No blocking findings in the proposed bounded technical supplement.

Reviewed document: `docs/progress/2026-11-10/sync-selection-closure-interface-clarification.md`

SHA-256: `40fb3ee45cfde69d73744964ef48d4a90ded10ae880b52d4fcaad537810e2d42`

Reviewed base: Task 3 source `9aeeb981e2d9ec0a6c54ed7008ee06652e631301`; accepted design SHA-256 `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`; accepted plan SHA-256 `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`.

## Findings within scope

- The gap is real: the accepted design requires a missing `DependencyWitness` with a complete mapped-index hash, while the plan places dependency witnesses only inside a proposal that must be null for this hold. Adding `dependencies` to the Task 4 result and Task 8 classification entry preserves that evidence without permitting a missing prerequisite in an eligible proposal. Retaining existing `proposal.dependencies` preserves successful selected-closure proof. Empty observations on earlier paths assert no absence; structural incompleteness still prevents a complete witness and all proposals.
- The explicit hash preimage is consistent with the actual compiler. `BatchClassificationV1.details.binding` and mapped `InputClassification` items provide every projected field. Mapped held/new/replay/coalesced representatives have the relevant event, mapped key and group association; semantic observations, exact delivery repeats, and unmapped holds have no mapped metadata. Including every mapped representative after exhaustive reference/group validation, ordered by the original deterministic input index, makes this a complete lookup-index commitment. It does not require recomputing financial mappings. The full classification retained alongside it supplies the remaining prerequisites/dispositions/group evidence. `hashCanonical` preserves array order and canonicalizes object keys, matching the prescribed construction.
- The complete typed lookup key, original-receipt checks, whole-group membership, and consistency rejection for contradictory compiler missing edges remain intact. Sorting observations by full canonical consumer reference and prerequisite, deduplicating equality and rejecting contradictory resolutions is compatible with deterministic witness construction. The specified permutation test must normalize invocation ordering first, as the supplement explicitly requires.
- The required held-case assertion independently reconstructs the index hash and verifies it survives `proposal: null`; the successful continuation preserves the real 700-cent funding, 500-cent allocation and 900-cent invoice scenario. Task 8 explicitly retains blocked-subject observations in the witness hash and existing output bounds. These requirements close the representation gap without a new financial rule, authority, persistence path, writer input, or external contract.
- The frozen limit clarification matches `packages/contracts/src/runtime.ts`, `review-details.ts`, and `connector.ts`: all use literal `maxRecordsPerCycle: 1000`. A smaller detached limit is therefore correctly labeled defensive only. It does not establish a realizable grant or authorize schema changes. Actual input-limit incompleteness remains global at Task 8.
- `compareInbox` sorts stream ID, numeric sequence, then event ID. Consequently `a-invoices` precedes `a-ledger`; allowing the invoice to become the seed implements the accepted order while preserving the required coupled group and projection.
- The Task 7 delivery-claim clarification preserves the accepted plan's complete canonical delivery/history admission obligations. The existing `GlobalClaim` shape is an economic original plus scope/record/origin, not a catalog of historical replay/coalescence deliveries. Keeping canonical delivery validation in read admission before a ready cut is consistent with that shape and does not waive claims or substitute receipt event IDs for canonical delivery proof.

## Review limits and downstream obligations

This is a scoped design/plan clarification verdict, not verification of unimplemented Task 4/8 code or acceptance of the whole selector. Task 4 must demonstrate the specified missing-witness, full-index, deterministic-order and held-provider assertions. Task 8 must prove retained blocked-subject evidence affects the complete witness hash and is included in bounded output handling. Existing source-release, source review, integration and joint-acceptance gates remain separate.

Review used file reads and read-only Git inspection. No tests, database operations, source changes, repository edits, Git mutations, or subagents were performed. The only written artifact is this review in `/private/tmp`.
