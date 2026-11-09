# Document applicability handoff — round 1 fix review

Reviewed `b-document-applicability-handoff.md`, SHA-256 `a37939ce8dc92998f3254dbdc46bee7311b897afd4f6c582ab7ecc6d7fded647`, against the three findings in `b-document-applicability-handoff-independent-review.md`. Scope is those corrections and new breakage introduced by the revised design, not implementation acceptance. Local HEAD inspected: `67d0369e5933256e07ab44fcab7d7dc51c896ea5`. Independently inspected C2's actual `proposal-evidence.ts` at `6a8e24fcef1f8b9e0a0118246d6bfea3a1a10eb4` in the verification-startup worktree; that candidate remains unaccepted by this review.

**Specification verdict: PASS for this scoped design correction.**

**Quality verdict: PASS for this scoped design correction.** No new blocking design defect found in the revisions.

## Original findings

1. **ADDRESSED — pause ordering.** Handoff lines 95 and 127 explicitly prevent new claims after pause commits and permit already claimed work to settle under existing lifecycle semantics. Both orderings have required barrier tests. Grant revocation, owner replacement and stale revisions retain separate rejection checks; pause is no longer treated as cancellation. This matches the accepted orchestration proposal's pause paragraph (`v4-orchestration-contract-proposal.md:185`) and preserves existing authority, generation, capture and revision fences.

2. **ADDRESSED — C1 and C2 batching, including late failure.** Lines 73 and 128 require the complete sorted, deduplicated citation union, bounded batches of at most 50, per-batch binding/facts equality and complete result-partition validation. The stated C1 maximum of 550 follows the actual public schema's 50 main refs plus ten alternatives of 50 refs, and `construction-evidence.ts` unions those citations. Required tests cover more than 50 distinct C1 refs, duplicates across alternatives, unresolved final-batch references, malformed/wrong-binding/failed later batches and the same shared path for C2. Earlier batches cannot confer partial success or settlement. Public limits remain unchanged.

3. **ADDRESSED — precise C2 matrix and accepted-candidate dependency.** Lines 81–93 name the actual module and exports and preserve the inspected implementation's distinct quantifiers: all selected/retained refs require readability and exact capture membership; profile-bound refs resolve across at least one validated profile tuple; each tuple needs at least one qualifying parent-account lookup entry whose every ref associates to that exact tuple. Retained-only/spec-only and other lookup refs do not acquire blanket account-applicability requirements. The alias test at line 129 distinguishes profile-wide support from exact lookup-entry support. The matrix matches inspected candidate `6a8e24f`; the handoff explicitly requires root confirmation or revision against accepted C2 before consumer dispatch, including the final private-interface transition. C2's result-size correction remains C2-owned.

## Dispatch checkpoint

**Source producer: design-ready for dispatch.** Root/source owner can dispatch the bounded producer ownership in lines 101–102 independently of C2. The producer still requires its specified implementation checks and independent review of the exact candidate before consumers rely on it. This verdict does not grant implementation acceptance or change ownership boundaries.

**C1/C2 consumer integration: not yet dispatch-ready.** Wait for accepted C2, root confirmation/update of the matrix against that exact accepted candidate, the reviewed producer, the explicit final private-interface transition and serialized ownership of the consumer files. Adapt C1 and C2 together; do not interpret this design pass as C2 acceptance.

The revisions preserve the narrow derived-association meaning, source-wide-only access, unknown file exposure coverage, capture binding, no value/authenticity assertion and sticky historical blockers. No complete V4, financial, activation or joint acceptance claim follows.

Verification consisted of document/hash inspection and read-only comparison with the actual C1 schema/helper, C2 module and accepted pause specification. No tests, implementation changes, subagents or commits were performed. Only this review report was written.
