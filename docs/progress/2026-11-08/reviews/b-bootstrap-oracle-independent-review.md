# Spec compliance

- ✅ S2 spec compliant. Reviewed base `83f64f3b5b15061bca2ef0f7f8102fd4a5f7adb4` → head `e212cbd1e2a3b32bef65e3c44e3aa626272ab04c` through the supplied complete diff. All eight assigned files are additions; existing v2 parser/store/pin implementation, product exports, compiler, finance, and parent code are untouched.
- ✅ Accepted proposal digest checked: `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`. Review covers its S2 descriptor, independent expectations, and ten-case input recipe, not later S3 result/runner/registry obligations.

# Strengths and evidence

- Exact snapshot identity and content hash are distinct checks: `packages/evaluator/src/bootstrap-fixtures.ts:226` checks the registered whole-object digest and artifact/manifest/snapshot IDs; `:246` binds the sidecar to `snapshot.contentHash`. The operator obtains its object from the immutable registry before computing registration metadata (`scripts/prepare-bootstrap-verification.ts:26`). It does not hash an arbitrary caller-supplied snapshot as registration authority.
- Protected reads check root disjointness, physical paths, ownership, permissions, bounded UTF-8 input, and no-follow file opening (`packages/evaluator/src/bootstrap-fixtures.ts:111`, `:129`). Publication validates evidence first and uses a no-replace link with exact existing-byte comparison (`:274`). Referenced v2 evidence is decoded on publication and reads (`:226`); no v2 mutation path was added.
- Expected customer identity/name, term values, citations, and account binding come from validated producer facts; full support tuples are checked, historical amendment ends remain observed, and terminal null is explicitly derived (`packages/evaluator/src/bootstrap-fixtures.ts:155`, `:162`). Exact profile and reviewed configuration/term correspondence is checked independently (`:201`).
- Metadata records and recursive leaf lineage are built independently; financial records and checked balance use the existing independent reference model, with an independent mapping table and rank/delivery ordering (`packages/evaluator/src/bootstrap-reference.ts:119`, `:152`, `:171`, `:184`, `:198`). Unsupported mappings and incomplete recipe prerequisites return unavailable rather than manufacturing a pass (`packages/evaluator/src/bootstrap-cases.ts:17`).
- All ten frozen cases are constructed, including explicit reused ensures, metadata conflicts, replay/no-baseline cases, selected and source-wide blockers, and unrelated-account exclusion (`packages/evaluator/src/bootstrap-cases.ts:79`). Integration compares actual S1 output to separately derived expected plans and hold identities for A and B (`tests/integration/bootstrap-fixture-setup.test.ts:136`); B's nonempty baseline permits zero balance (`:144`).
- Tests cover content/object-hash substitution, exact-object changes, unchanged v2 bytes, rehashed wrong names/fees/configurations/scopes, new-version publication, inherited amendment support, terminal provenance, reversed term/configuration ordering, unsupported mappings, leaf escaping, and forbidden oracle dependencies (`tests/integration/bootstrap-fixture-setup.test.ts:156`, `:222`, `:239`; `packages/evaluator/test/bootstrap-cases.test.ts:112`, `:125`; `packages/evaluator/test/bootstrap-reference.test.ts:5`, `:11`).

# Issues

- Critical: none found.
- Important: none found.
- Minor: none found.

# Focused checks outside the diff

- Risk: caller-recomputed snapshot digests could substitute for registration authority. Checked existing `packages/evaluator/src/registry.ts:91` and `:148`: `getCandidate` resolves the artifact/capture association and verifies stored byte hashes, schema/object identity, and whole-object hash before returning the snapshot. The new operator's recomputation occurs after this verified read, so it preserves that boundary.
- Risk: `.some()` configuration matching might allow additional or duplicate bindings. Checked `packages/contracts/src/connector.ts:88`: the parsed profile schema enforces unique term/configuration IDs and exact coverage of profile terms, complementing the new equality checks.
- Risk: declared support arrays might omit name/party fields or invent terminal intervals. Checked `packages/evaluator/src/evidence-fixtures.ts:103`, `:276`, `:302`: existing decoding requires identity/term support fields, validates interval chains, resolves cited original ranges, and revalidates originals and capture membership. The new support check is at least as strong as `packages/evaluator/src/evidence-support.ts:48` for applicable terms and additionally matches complete support tuples.
- Risk: financial expectations could depend on subject execution or unchecked arithmetic. Checked `packages/evaluator/src/fixtures.ts:117` and `packages/evaluator/src/reference-model.ts:14`, `:35`: protected truth is projected independently, checked against anchors, and evaluated with checked integer addition and scoped allocation/reversal logic.

# Assessment and limits

**Task quality: Approved.** No S2 correctness or scope blocker found. The implementation preserves the distinction between trusted registration, protected source truth, reviewed identifiers, and independently constructed expectations.

- Read the diff once in bounded sections; recovered a truncated tool-output section without rereading changed files. No candidate edits, index/HEAD changes, database operations, or test reruns were performed. Only this requested review report was written in the controller worktree.
- Builder reports typecheck, 6 focused unit tests, 259 full unit tests, and repeated isolated real-PostgreSQL A/B ten-case integration passes. Those are reported machine results, not fresh execution by this reviewer; the test implementation was independently inspected. No unresolved code doubt warranted another run.
- Internal `readBootstrapExpectation`/`pinBootstrapExpectation` registration metadata must continue to originate at the trusted immutable registry boundary; caller-provided rehashed substitutes are not authority. The operator establishes that boundary here. S3 must preserve it when wiring protected runs.
- Comparator mutation coverage, result assertions/coverage accounting, runner framing/build closure, persisted job/result authority, product mounting, and joint user acceptance remain separate later work. This approval makes no readiness, activation, sync, or live-financial claim.
