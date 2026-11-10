# Selection closure witness interface clarification

Proposed bounded technical supplement to accepted selection design0f01668b and plan89b4004b, 2026-11-10. Task3 source9aeeb98 is accepted with no findings. Task4 preflight identified an internal representation gap; no source change or financial-policy change is authorized until this supplement is reviewed.

## Missing dependency observations must survive a hold

The accepted design requires an explicit no-match over a complete mapped-index hash (design line133). The plan defines that DependencyWitness variant, but stores dependencies only inside a non-null ProposedGroup. A missing prerequisite must prevent a proposal, so the planned shape loses that explicit observation. Keeping only a TypedPrerequisite and a recomputable classification would not implement the stated witness.

The smallest correction is additive to not-yet-implemented Task4/8 interfaces:

```ts
selectSubjectGroup(cut, identity, routed): {
  proposal: Omit<ProposedGroup, 'witnessHash'> | null;
  blockers: SelectionBlocker[];
  full: BatchClassificationV1 | null;
  selected: BatchClassificationV1 | null;
  dependencies: DependencyWitness[];
}
```

Task8's SelectionWitnessPreimage.classifications entry becomes `{identity, full, selected, dependencies}`. The existing proposal.dependencies remains its accepted successful selected-closure proof. A held complete cut retains the inspected earliest closure's dependency observations in the classification entry even though proposal is null. Do not attach a missing dependency to an otherwise eligible proposal. Earlier source/mapping/inactive or structural stop paths may have an empty list because no dependency walk occurred; they make no no-match assertion. Structural incompleteness still produces zero proposals globally and no complete witness.

For each full `classified` unfinished-corpus result, validate exhaustive input indexes/event references and group references first. Its complete mapped-index hash is:

```ts
hashCanonical({
  binding: full.details.binding,
  entries: /* every item with non-null mapped metadata, ordered by inputIndex */
    [{inputIndex, event, scope, identity, targetRecordId, groupIndex}],
})
```

The values are projections of the accepted compiler item/event/mapped metadata, never freshly mapped financial interpretations. Retain every mapped representative including held and coalesced ones; omit only items without mapped metadata. The exact typed lookup key remains canonical Scope + EconomicIdentity + targetRecordId. Input indexes refer to the deterministic complete invocation input order; preserve the full classifier in the same witness. Do not compute a no-match hash from only selected groups, successful inputs, bounded prefixes or arbitrary event IDs. A compiler missing edge contradicted by this full index is storage/consistency failure, not permission to override it. Target/provider resolutions keep the accepted original-receipt/group checks. Dependency observations sort by canonical full consumer EventRef, then canonical TypedPrerequisite; equal observations deduplicate, contradictory resolutions fail consistency.

Task4 tests must assert: the initial 500-cent allocation waiting for its 900-cent invoice has no proposal and retains an exact missing edge with the independently recomputed full index hash; adding the invoice replaces that absence with candidate group evidence, includes the complete coupled group and yields the accepted400-cent projection using real700-cent funding. Deterministic permutations preserve observations and hash after invocation ordering. Wrong-kind/foreign/held/conflicting representatives do not become eligible providers. Task8 must retain blocked-subject dependencies in the complete witness hash and account for their values within existing bounded output handling. No additional production path, persistence, writer input or public contract is introduced.

## Two preflight wording clarifications

The current CustomerActivation/connector schemas both admit only literal maxRecordsPerCycle1000. The plan's smaller-approved-limit test is therefore a clearly labeled defensive detached activation-limit seam test with a real valid compiler artifact; it is not a realizable reviewed grant or permission to change frozen schemas. The actual1001-input case still proves the existing operational bound. Task4-only defensive overflow remains a group_limit blocker with actual compiler input_limit; Task8 must preserve global limit incompleteness rather than use another group.

The scenario's `a-invoices` stream sorts before `a-ledger` in compareInbox. Once the missing invoice is captured, it may become the seed; the required complete invoice/allocation group, prior funding receipt and400-cent projection remain unchanged. Tests must use the accepted deterministic order instead of forcing an illustrative seed identity.

Exact cross-subject canonical delivery claims, including historical replay/coalescence associations, are read-admission obligations of Task7 before a ready cut. GlobalClaim represents validated financial originals/economic ownership, not a new delivery-claim DTO. Task4 checks its exact typed economic/global original keys and accepted outcomes; receipt.eventIds alone is not delivery-history proof. No claim is waived by this representation decision.

These are proposed internal representation/test corrections under existing behavior. Cost if wrong: incomplete or nondeterministic held-dependency evidence, or overstated synthetic proof. Fresh scoped review plus Task4/8 explicit assertions are required before acceptance.
