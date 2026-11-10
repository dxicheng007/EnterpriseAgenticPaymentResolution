# Atomic ongoing-apply design round1 repair

Status: design-only repair ready for fresh scoped review; no implementation or acceptance claim.

- Assigned file: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution/docs/progress/2026-11-08/handoffs/platform-sync-atomic-apply-design.md`
- Original SHA-256: `4358a74d5f4b5ebf3528a8cfd6a8ab3086ef04d9059f9d5abce1ba718a64114a`
- Repaired SHA-256: `4e07cae264aaae9bd4790240332061bc48d540de3eb99275ba1629dae45084ce`
- Original copy: `/private/tmp/platform-sync-atomic-apply-design-original.md`
- Exact unified diff: `/private/tmp/eapr-atomic-apply-design-fix.diff`
- Full input review read: `/private/tmp/eapr-atomic-apply-design-review.md`

## P2 coverage repair

Section5 now defines the actual authoritative coverage predicate and bounded evidence, rather than relying on fixture emptiness or current semantic equality:

- Exactly one initialized lane for the source, exact committed manifest/capture binding, exactly one api financial stream and one semantic stream; extra lanes/streams are unavailable for this deliberately narrow primitive.
- Every nonselected stream must remain at its exact approved baseline, with no post-baseline global positions/inbox/pages. Any captured semantic history, including change-then-return, remains unsupported rather than cleared by current-semantics equality.
- Check the complete source-global financial history since baseline, at most1,000 retained post-baseline events, with exact page chaining, inbox/delivery/position identity and canonical bindings. Detect global positions without matching inbox or beyond the checkpoint; never hide them behind an inner join or truncated page.
- Prior covered financial history requires actual successful outcomes/original receipt associations. The selected unit is the entire currently captured unapplied suffix and must be one complete accepted dependency group. Any capture incident makes this primitive's coverage unavailable without inventing an incident-resolution policy.
- Single SQL statement snapshots bind the evidence before preparation and again under authority/target locks. Explicit result bounds include overflow sentinels, LIMIT2 lane cardinality, at most three checkpoint rows and EXISTS for unexpected rows. Changed coverage rejects with zero apply effects; the attempt cannot silently adopt a new selection.
- The locked statement snapshot is the precise observation cut. Capture committed before it is included; capture committed afterward remains later durable input, outside this receipt/progress. The next new attempt must read a fresh witness and reject unsupported later history. This makes no atomic external-source observation claim and no capture-to-monetary-commit exclusion promise. A stronger source-wide capture/apply fence must receive its own review; none is implicitly added to capture/current-authority or the lock order.

Named future cases added: `coverage_blocker_outside_selection`, `coverage_changed_before_locked_cut`, and `capture_after_locked_cut`, with corruption/overflow/extra-lane/incident variants. These are required future tests, not tests run or acceptance evidence.

## Other requested corrections

- Pin independently accepted classifier `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6` and link its tracked exact-candidate review. PR36 remains unaccepted and unused as an assumed prerequisite.
- Remove the novel-replay-under-inactive-authority policy question. F5/PRD already require active authority for newly acknowledged input; exact saved receipt recovery remains read-only and available.
- Separate technical general hold/progress representation work from any genuinely new permission to resolve/ignore input. Only the latter remains a policy boundary for expanded scheduling.
- Retain the reviewer-confirmed original economic receipt versus mixed acknowledgment association contract unchanged.

## Verification and limits

The assigned file exactly matches the repaired temporary copy. Original/repaired hashes verified; all local Markdown links resolve; no trailing whitespace. Runtime001–004 hashes remain their recorded values, including004 `f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7`. Final status shows only the assigned design file modified by this work.

No source, test, migration, database, commit, path reservation, authority mount or subagent work occurred. No tests were run; root's active checks were untouched. Fresh scoped review should particularly decide whether the explicit statement-snapshot coverage cut is sufficient for the stated unmounted increment, and verify that the complete history predicate/bounds cannot silently omit existing durable blockers. No stronger commit-time capture fence or production synchronization claim is made.
