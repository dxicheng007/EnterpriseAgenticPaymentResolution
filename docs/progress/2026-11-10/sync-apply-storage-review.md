# Task 1 independent exact-candidate review

Candidate: `f861fc5843961d4573e585a46399e8da903260dd` (`fix: add constrained synchronization outcome storage`). Source base: `12dd1fffa0d9c3f7b776da4836f1c5503d61daf1`; intervening root documentation changes are excluded from the implementation verdict. Reviewed the supplied `/private/tmp/eapr-sync-apply-task1-f861fc5-review-package.diff` and candidate sources in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

**Specification verdict: changes required. Code-quality verdict: changes required.** One actionable blocking finding remains. This is a Task 1 storage/history verdict, not a judgment on the separately assigned coverage reader, writer, concurrency work, mounting, or full slice acceptance.

## Finding

### [P1] Resolve saved prior-history bindings during exact unit recovery

Location: `packages/parent/src/sync-store.ts:363–388`, especially the final call at line 388; related representation checks at `packages/parent/src/sync-types.ts:171–195`.

`readValidatedUnit` checks the saved baseline/lane and the current unit's suffix, then returns the audit. It never reads the units referenced by `coverage.historyUnits`, verifies their `auditDigest`/indexed endpoints/receipt references, or resolves `coverage.historyOrigins` and prefix `historyOutcomes` to their immutable original rows. `validCoverage` establishes only internal shape, counts and chain continuity. In particular, `historyUnits[].auditDigest` and `historyOrigins[].receiptDigest` are never consumed beyond their hash-shaped schemas. The sole store use of `historyOutcomes` is a lookup while iterating the current suffix, whose event IDs are distinct from the prefix under `validCoverage`; it does not validate the prefix.

For a later otherwise-valid unit, replace a saved prior unit's audit digest, a prior outcome digest, or a prior origin receipt ID/digest with other well-formed values, then recompute the cut hash, current unit hash and audit digest. Those changes do not affect the current suffix, receipt, snapshots, or baseline checks. Neither the SQL unit constraints nor this reader ties those prior references to actual history, so the reconstructed audit can be accepted as exact history despite contradictory or nonexistent original bindings. Likewise, corruption in an actual referenced prior unit is not detected while recovering its successor. This violates the required full bounded audit and exact immutable-key validation; a self-consistent hash proves the supplied bytes, not their association with the retained history.

Validate every bounded prior unit reference against its actual immutable row (canonical audit/digest, identity, stream, endpoints, snapshot bindings and receipt), and validate the retained prefix outcomes/origins against their exact stored canonical/index/original-receipt bindings. Keep reads independent of today's mutable capture/authority state. Avoid recursively re-expanding audits: validate each referenced immutable key once with bounded caching/iteration. Add a two-unit recovery fixture that rejects independently altered prior unit, outcome, and origin references (including rehashed outer audit), and rejects corruption of the referenced prior row while preserving successful historical recovery after later advancement.

## Other assessed boundaries

- Runtime006 is additive. It retains runtime005 monetary receipts and original economic outcomes, revokes legacy delivery INSERT, adds the scoped composite keys/FKs, and uses a shared origin primary key plus ordinary-privilege triggers for cross-domain exclusion. It does not infer units or progress during backfill.
- Unit/outcome scalar bindings, typed original receipt comparisons, immutable histories and application-head baseline/endpoint constraints are present. Original initial receipts are retained in mixed membership; new monetary receipts contain only new target IDs.
- Exact plan recovery validates canonical plan bytes/hash, activation/artifact/profile/scope, receipt indexes/epoch, ordered target IDs, projected snapshots and balances. It does not require the current authority epoch or source availability. The inherited unsafe writer is intentionally still staged for Task 3; its now-forbidden legacy INSERT is not reported as a new Task 1 finding.
- Compact saved pages are reconstructed from saved ordered deliveries/inbox membership and checked against their digests. Task 2 still must validate actual raw stored pages before projection, as the approved clarification requires.
- The focused tests exercise genuine A5, app-role origin competition, typed scope constraints, history privileges, first-unit/mixed-origin recovery, epoch corruption and recovery after pause. They do not exercise a second unit with nonempty historical reference collections, leaving the finding uncovered.

## Evidence and limits

Read the task brief/report, applicable repository/package/parent/database/test guidance, the atomic-apply design, Global Constraints and approved coverage clarification. Confirmed worktree HEAD is the exact candidate; observed unrelated documentation changes were not modified. Inspected the seven assigned implementation/test paths and supporting contracts/storage/capture code. A focused `git diff --check` for those paths passed.

The implementer's recorded PostgreSQL 18 results remain partial evidence: storage 11/11, parent-storage plus capture 48/48, parent/compiler/finance units 67/67, and typecheck passed. I did not rerun those suites, access PostgreSQL, modify sources, mutate Git, or spawn agents. The finding follows from the complete historical reader call path and missing immutable-reference lookups; no new machine failure is claimed. Only this temporary report was written.
