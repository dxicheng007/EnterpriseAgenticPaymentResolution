# Independent classification implementation-plan review

Reviewed candidate: `docs/superpowers/plans/2026-11-09-sync-classification.md`, SHA-256 `96a378d44a3876d0d6dd0c083d760d17ce0d1f3f8c57bc40bfcf27aec5af776f`.

Accepted design: `docs/progress/2026-11-08/handoffs/platform-sync-classification-design.md`, SHA-256 `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`. Both hashes were independently checked.

Read-only checkout: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`; observed HEAD `31d8a4aed415ca7a083e37e683c7eb51e1d97a00`. Planner blob remains `70350f44c2d03ad9bda4b114e61c3eb36495a86a`. The candidate plan is untracked. Existing unrelated WIP affects `scripts/verify-slice-evidence.ts`, `scripts/verify-slice.ts`, and `tests/integration/verify-slice-evidence.test.ts`; none was changed or assessed as part of this review.

## Verdict

- **Specification: reviewed / approved for the stated implementation scope.** The plan faithfully implements the accepted design and both design-review corrections. No missing product or financial requirement was found.
- **Quality and implementability: reviewed / approved with two nonblocking precision notes below.** The existing parser, materializer, validator and finalizer have the required information, and the plan places trace collection at those points without introducing a second financial interpreter.
- **Verification: not run.** This is a plan review, not an implementation pass, protected financial verification, slice completion, implementation authorization, or joint user acceptance.

## Nonblocking notes

### P3 — Resolve and record the actual capture base before generating compatibility evidence

Plan lines 37 and 86 record baseline commit `9680b052765400ade5032b077893e7d4e472e147`; the supplied review checkout is now `31d8a4aed415ca7a083e37e683c7eb51e1d97a00`. The planner blob still matches. Read-only `git diff 9680b052765400ade5032b077893e7d4e472e147..HEAD --stat` shows only unrelated live-build/verification changes, and the package manifest change only redirects `test:live`; there is no compiler/finance/contracts/parent/public-fixture change in that range.

The plan already instructs the implementer to recheck and resolve a different base with the owner, so this is an explicit precondition rather than a concealed technical blocker. Before Step 1, the owner should record the chosen actual execution base and reconcile the fixture's `baselineCommit` field with it. Preserve the planner blob guard and record the capture source identity; do not silently label execution at the newer checkout as execution at the historical commit. Do not clean or include unrelated WIP.

### P3 — Name the precise reversal rejection in Step 5

Plan line 125 says “funding at/after reversal remains held.” The actual planner rejects a **new allocation using the reversed funding at or after that funding's full reversal** (`plan-batch.ts` inside `validateGroup`), not arbitrary new funding merely because a reversal exists. Historical allocations remain preserved, and target validation intentionally permits an existing allocation whose active interval was removed by a backdated reversal (`finance/src/allocations.ts`).

Replace that phrase with the precise new-allocation rule when preparing the implementation handoff. The surrounding references to the existing reversal tests and unchanged financial rules already establish the right intended behavior; no financial-policy decision or implementation change is needed.

## Substantive review

**Single evaluator and compatibility.** The private evaluator plus two projections preserves the frozen four-argument interface. The plan correctly retains parser last-value behavior, event ordering, group ordering, insertion sorting, accepted event IDs, lineage and hold production. It does not reconstruct financial classifications from omitted plan/hold IDs. Enriching the existing prerequisite helper while preserving its legacy iteration order avoids changing diagnostic dependency behavior. The economics comparator still excludes only `sourceEventId` and `sourceRecordVersion`.

**Independent old-planner comparison.** Steps 1–2 capture complete canonical outcomes before editing production code, with a verified pre-change planner blob, stable case identities, deterministic permutations, fixture provenance and a recorded fixture hash. Comparing those immutable outcomes is materially stronger than asserting equality between two wrappers over the same modified evaluator. The specified corpus covers ordinary financial outcomes, mixed held/accepted groups, replay/coalescence, ordering-sensitive malformed inputs, normalization, both bad-hash/valid-delivery orderings, and the late delivery conflict that replaces earlier holds. The no-regeneration rule and preservation of existing monetary expectations are explicit. This is regression evidence, correctly not represented as an independent monetary oracle.

**Final failure.** The isolated `computeBalance` mock is technically viable: target validation and group validation do not call that export, while `resultPlan` does. Thus the proposed malformed + replay + independent-new case reaches finalization after earlier holds and accepted events. Testing first against the old planner pins its catch behavior. The later additive assertion removes all provisional items/groups, references the appended final hold, retains earlier holds, and separately verifies ordinary exceptions still propagate. This resolves the original design-review contradiction without a production fault-injection seam.

**Occurrence and cross-reference integrity.** The plan explicitly covers every bounded original input index, malformed occurrences with direct hold provenance, hash-invalid envelopes, backward repeat links, actual insertion producers, target replay originals, group partitions, and operation references. Repeated delivery equality uses schema-parsed/hash-validated events, including accepted timestamp normalization; it does not add raw-byte equality. Held group members, including replay-equivalent or provisionally coalesced members, cannot retain success references. All-replay accepted groups survive even when no plan exists.

**Exact typed prerequisites.** Relation/kind/source/seller/scope/record identity comes from successful materialization and the shared helper. Target presence takes precedence; candidate indexes identify only materialized selected-scope representatives, sorted and unique. Candidate presence deliberately remains distinct from financial validity. The tests exercise same raw IDs across kinds, foreign scope/providers, mapping failures, held providers, missing/released prerequisites, and existing allocation edges that couple capacity and reversal validation. No unallocated-funding-to-invoice relationship is invented.

**Source boundaries and bounded failure.** The proposed source blocker uses the actual guard predicate and aggregate code while retaining the broader legacy hold event set. It identifies triggering original occurrences, including validated repeats, and excludes ordinary source events and unrelated sources. Profile-local unknown identity is not turned into global unenrollment or a fabricated scope. Valid semantic observation requires the existing materializer's contract validation. Every fatal stop reason is covered; overlimit/nonarray responses cannot allocate per-input detail, and early returns must preserve their current precedence and hold replacement behavior.

**Build integrity and scope.** `bootstrap-runner.ts` already pins `plan-batch.ts` in both subject/evaluator inventories; `financial-attestation-build.ts` pins it directly. The proposed bootstrap mutation-family addition, membership assertions, existing financial mutation test and unchanged recursive closure checks cover the exact changed bytes without refreshing protected truth. The existing package subpath exports the source module, so additive named exports need no new transport/shared schema. No new source leaf means no inventory addition is necessary. If that architecture changes, the plan requires revised ownership and inventories before implementation. Runtime receipt association, authority, persistence, application and scheduling remain explicitly excluded.

## Review evidence and limitations

Read-only inspection included the candidate and accepted design; original and correction design reviews; applicable root/packages/compiler/evaluator guidance; frozen F1–F3/F5; implementation verification conventions, ownership and verification playbook; PRD thesis/process/sync/financial/acceptance boundaries; actual `plan-batch.ts`, `operations.ts`, finance validation/allocation/reversal/balance code, target snapshot hashing, existing planner tests, both protected build inventories and their mutation/closure tests. Commands were file reads, text searches, SHA-256 checks, `git status`, `git rev-parse`, `git hash-object`, and read-only Git diffs.

No source, test, plan, database, authority or repository file was edited. No tests, database operations, commits or subagents were run. Only this requested report was written. Exact-candidate implementation review and bounded machine evidence remain required after implementation; joint acceptance remains pending.

Final read-only observation: concurrent owner work advanced HEAD to `4392f9e244f17f545a064b4227b894a9367e30ce` and replaced the initial WIP status with untracked dispatch/review documents. The reviewed plan SHA-256 and planner blob remained exactly unchanged. This review does not claim review of that concurrent commit; the implementation handoff must record its eventual base as described above.
