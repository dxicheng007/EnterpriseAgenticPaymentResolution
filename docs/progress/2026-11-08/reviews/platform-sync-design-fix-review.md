# Scoped P3 design correction review

Candidate: `docs/progress/2026-11-08/handoffs/platform-sync-design.md`, SHA-256 `66bb5f10bbc8521ce62f0536dc2558dda8baf450d41cafcbdc97377dc6add9d2` (verified).

## Verdicts

**Specification: PASS for the two scoped corrections.** Both prior P2 findings are resolved. No new specification defect identified in the supplied correction diff.

**Engineering quality: PASS for the scoped correction diff.** The transaction ordering and required concurrency cases now distinguish conflicting stale input from ordinary feed growth. The CSV descriptor now agrees with the accepted nonempty producer. No new engineering defect identified in the diff. This is design review, not implementation authorization or proof.

## Finding status

1. **P2 stale concurrent identity conflict — RESOLVED.** Lines 91–92 require accepted delivery and position checks before stale discard/refetch or exact-page replay return. Canonical identity explicitly includes observedAt; recomputing a hash cannot legitimize changed content. Conflicts roll back the attempted page and record an incident separately. Benign longer stale input neither inserts a suffix nor advances the winner's checkpoint. Line 162 requires both the winning-commit-before-loser-lock conflict case and harmless longer-page/refetch case. These changes satisfy the prior finding and preserve frozen F1/F4 identity/page rules.

2. **P2 unsupported empty CSV acceptance — RESOLVED.** Line 61 requires positive byte length and event count, nonnull positive sequence bounds, and checked range arithmetic. It explicitly rejects empty batches with SOURCE_CONTENT_INVALID and defers any future acceptance to a separate source-owner contract and parser/upload/transport/replay/checkpoint tests. This agrees with `packages/sources/src/company-b.ts:73–76`, which rejects zero-row CSV documents. Existing VersionSchema supplies the positive-integer vocabulary; the surrounding design continues to require safe-integer checks and bounded transport sizes.

## Scope and limits

Reviewed the prior findings, author report, supplied fix diff, exact candidate, pertinent F1/F4 frozen rules, CSV decoder and numeric contract definition. A read-only text comparison confirmed the supplied diff exactly matches the before snapshot to this candidate; no trailing whitespace was found. Only the requested temporary report was written. No product code, SQL, tests, dependencies or git state changed; no tests, database operations or subagents were run.

This review covers the two corrections and new breakage introduced by that diff only. It does not reopen or certify unchanged design sections. Catalog/shared-file reservations and source-producer gates remain. Later application/dependency and status/control contracts remain separate unapproved stages. This is not a machine pass, complete P3 approval, implementation correctness claim, live generation evidence, V5/V6 acceptance or joint user acceptance.
