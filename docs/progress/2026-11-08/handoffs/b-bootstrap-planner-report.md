# S1 pure bootstrap planner and projection

- Branch `codex/bootstrap-planner`
- Base `210bc98c5d603aad53e2d842ef95b1461dc39b1c`
- Candidate `c4f862ae86805d081d4c8ec78a31e750c5fff177`
- Authority: section 2 of `v3-bootstrap-verification-proposal.md`, SHA-256 `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`, and the executable V3 bootstrap freeze. Lead confirmed diagnostic precedence and the empty-array test boundary.

The compiler's `./plan-bootstrap` subpath provides the four-argument pure planner. It calls the existing financial planner on the supplied inputs and preserves its successful suffix and original holds. It prepares canonical metadata ensures, adds leaf lineage, shifts financial lineage indices and computes the complete plan hash. The parent's `./bootstrap` subpath validates schema, record scope and duplicate metadata IDs. It delegates financial projection, copies the target arrays and preserves existing metadata on canonical equality. The commit contains only the two modules, two tests and two explicit subpath exports.

## Diagnostics

- `BOOTSTRAP_METADATA_UNAVAILABLE` identifies missing or invalid reviewed profile bootstrap metadata.
- `BOOTSTRAP_BASELINE_BLOCKED` takes precedence for invalid inputs or blocking holds. Original financial diagnostics, including `ARTIFACT_BINDING`, `TARGET_SCOPE` and `TARGET_STATE_INVALID`, are preserved where emitted. Duplicate metadata IDs are bootstrap target invalidity.
- `BOOTSTRAP_BASELINE_REQUIRED` covers an otherwise valid empty, replay-only or missing nonempty single financial baseline.
- `BOOTSTRAP_METADATA_CONFLICT` identifies canonical disagreement with an existing scoped metadata record.

A routing exclusion can pass through only when its IDs identify complete, uniquely resolved, schema-valid and content-hash-valid envelopes outside the reviewed routing tuple. This validation uses the existing pre-routing envelope boundary. Foreign source payload contracts are outside this planner's inputs.

## Machine evidence (partial)

- Initial focused red after subpath and minimal stubs: 13 assertions failed in two files. Before recording that red, the lineage setup was corrected because the existing compiler rejects empty term citation arrays.
- The later target-diagnostic regression also failed at the intended assertion before the confirmed diagnostic mapping was applied.
- Node 24 `npm run typecheck` passed.
- Node 24 `npm run test:unit -- packages/compiler/test packages/parent/test packages/finance/test` passed, 39 tests in 5 files.
- `git diff --cached --check` passed before commit. The assigned worktree is clean.

Coverage includes public A's three ensures, five financial operations and 80000-cent balance, and a public B variant with a rehashed 220000-cent invoice that reconciles to zero with five financial operations. No public fixture file changed. Tests cover reversed configuration/term ordering, exact lineage including null, declared set permutations, canonical reuse versus record conflicts, invalid scopes and duplicate metadata IDs, selected and source-wide blockers, missing and ambiguous capture IDs, replay, empty input and a visible nonblocking unrelated routing exclusion.

Accepted profiles require nonempty customer evidence, source-account IDs and term evidence, so current accepted record shapes cannot reach an empty-array leaf. A direct test of the internal traversal covers that case, null and RFC 6901 escapes. The planner checks shape, subject binding and financial planning, while factual citation support and manifest binding belong to separate verification steps. No independent candidate review, slice run or joint acceptance is claimed here.
