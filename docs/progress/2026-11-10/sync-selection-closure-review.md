### Spec Compliance

- ✅ Task 4 implementation is spec compliant for candidate `47aa1002b64fd8bb30ff14fc8babe89535e944dd` against `121f6719bb5e7a5d1736b3d0f4d0dd957f52ffcf`, including the reviewed dependency-witness supplement and actual-compiler-limit clarification. No blocking source defect found.
- ✅ `apps/worker/src/sync/selection.ts:505`, `:568`, `:725` validate exhaustive invocation/group references, index all mapped representatives, verify exact typed provider sets, and traverse whole compiler-owned groups. Missing observations retain the full mapped-index hash beside a null proposal; held/conflicting representatives cannot yield an accepted subset.
- ✅ `apps/worker/src/sync/selection.ts:642`, `:786`, `:806`, `:829` reclassify precisely the closure plus applicable semantics/repetitions against the same target/asOf, check operation and lineage correspondence, and return the selected compiler plan verbatim. Nonempty all-replay groups retain original receipts with a null plan; candidate coalescence does not invent an origin.
- ✅ `apps/worker/src/sync/selection.ts:442`, `:468`, `:629`, `:699` bind original receipts/outcome suppression, reject foreign economic ownership, and apply the stricter invocation cap without fabricating compiler diagnostics. The earlier guard implementation is unchanged in this package.
- ⚠️ Cannot verify from this two-file task: Task 7's canonical persisted delivery claims and original-history/read admission; Task 8's complete witness retention and global limit incompleteness; Task 9's genuine separate-feed/enrollment, database snapshot and zero-write evidence. The synthetic fixture and outcome seam explicitly preserve these boundaries at `apps/worker/test/sync-selection.test.ts:699` and `:932`. These remain external gates, not Task 4 proof.
- ⚠️ Cannot verify the provenance of the coupling assertion's expected-code correction from the supplied artifacts; see Minor finding below.

### Strengths

- `apps/worker/src/sync/selection.ts:505`, `:568`, `:616`, `:642`: validation, typed evidence construction, deterministic observation ordering and final-plan checks have separate helpers. The added implementation is substantial but stays within one selection responsibility; I found no duplicated financial interpreter, plan slicing, or verbatim repeated logic warranting a quality block.
- `apps/worker/test/sync-selection.test.ts:749`, `:800`, `:862`, `:890`, `:951`: real compiler cases establish the 700/500/900-cent scenario and 400-cent projection, exhaustive representative handling, coupled capacity/reversals, original replay associations, and occurrence-inclusive bounds. Independent full-corpus and selected balances exercise actual reclassification.
- `apps/worker/test/sync-selection.test.ts:1025`, `:1045`, `:1071`, `:1126`: defensive seam cases explicitly distinguish malformed compiler indexes/cycles from realizable DSL behavior and reject omitted providers and lost lineage.

### Issues

#### Critical (Must Fix)

- None found.

#### Important (Should Fix)

- None found.

#### Minor (Nice to Have)

- `apps/worker/test/sync-selection.test.ts:886`; `.superpowers/sdd/2026-11-10-sync-selection/task-4-red.log` (reported test line 869): the preserved RED expects `ALLOCATION_CAPACITY`, while the final assertion expects `FUNDING_OVERALLOCATION`. No supplied authoring evidence explains this correction. This does not invalidate the final passing case or establish a production bug, but the four failing RED assertions should not all be described as independently correct baseline expectations. Three recorded RED assertions directly establish the omitted dependency/blocker/replay behavior; the coupling case establishes only that the neutral scaffold returned no blocker until its expected-code provenance is documented. Preserve the original log and clarify the report or append the original explanation; do not regenerate RED retrospectively.

### Checks and Evidence

- Read the exact review package once, recovering only sections hidden by tool-output truncation. No changed source file was separately reread; line references were mapped from package hunks. No source, Git, database or protected-fixture mutation; no test reruns or subagents.
- Inspected supplied raw logs: 23 closure tests passed; 124 combined selector/compiler/finance tests passed across seven files; `tsc --noEmit` printed no diagnostics. No unexpected warning/noise appeared in the passing logs. RED contains four assertion failures with the limitation above.
- Verified the two current file SHA-256 values match the report's candidate hashes: source `cde61a45723ea4bfea4559c76cc2cc637c48c623cc347d2dd0b197ec7624a116`; tests `ada9a59f1621f94a1eb170eaf5831d9d019464e833e76262b782ddde459a751f`.
- Named dependency risk: explanatory ordering could accidentally require renumbered indexes or financial reinterpretation. Checked `apps/worker/src/sync/dependencies.ts:60`; `dependencyOrder` consumes trusted original indexes/providers and only computes explanatory order.
- Named dependency risk: final-plan correspondence could reject valid compiler ordering/coalescence or impose new financial semantics. Checked compiler types and production construction at `packages/compiler/src/plan-batch.ts:19`, `:140`, `:156`, `:460`; item, group, provider, operation and lineage conventions support the selector checks.
- Named dependency risk: a merely shaped origin might omit record membership or confuse receipt event IDs with historical delivery proof. Checked `packages/parent/src/sync-types.ts:21` and `packages/parent/src/sync-store.ts:228`; the shared origin schema binds record membership, while persisted exact-record/history validation belongs to the existing origin reader and Task 7 admission. The Task 4 assertions do not replace that gate.

### Assessment

**Task quality:** Approved, with one minor evidence-report clarification.

**Reasoning:** The change preserves compiler ownership and validates complete typed closure before producing one bounded, read-only proposal. The focused tests and recorded combined checks support Task 4's pure behavior; later persistence/composition/integration obligations remain explicitly unverified.
