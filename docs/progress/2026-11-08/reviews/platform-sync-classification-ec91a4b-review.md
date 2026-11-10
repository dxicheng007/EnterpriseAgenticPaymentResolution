# Independent exact-candidate classification review

## Verdicts

- **Specification: approved for the bounded classification task.** The candidate satisfies the accepted additive in-process contract and resolves the prior PR #34 findings without changing the reviewed financial rules. No blocking specification finding remains.
- **Code quality: approved for this exact candidate.** The financial evaluator remains singular; occurrence, group, prerequisite and finalization metadata follow its actual decisions. No actionable correctness or maintainability finding was identified in the reviewed scope.
- **Machine evidence: partial, independently exercised.** Focused candidate tests and additional differential probes passed as detailed below. This review is separate from joint user acceptance and does not certify runtime synchronization or protected financial verification.

## Exact scope and provenance

Reviewed source/test candidate: `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6`; implementation report: `a2dc76b64e55356715b5dd5dd50fee8027dea5f2`. Task baseline: `53c501f203903eb08054b84f1b6d93a11d763c64`. The production source blob is `934173685063dc5d7ae5765b9e0d46b23cafa682`.

Read the task brief, accepted classification design, approved implementation plan and plan review, original PR #34 review, tracked implementation report, and relevant repository/compiler/evaluator guidance. Inspected every classification production/test change in the complete code review package, including the two adopted smoke tests. Inspected the large expected-outcome fixture mechanically, through its provenance, complete canonical comparisons and immutable Git identities; did not treat matching wrappers as an independent compatibility oracle.

The source was adopted at `8b50c9cfb231ab3d64391cef877df75fe78c82b0` and repaired, rather than implemented again independently. The repair modifies only the planner, two dedicated classification test files and two build test files. The frozen case module and JSON were not changed by the repair; the adopted `plan-batch.test.ts` smoke tests were also unchanged. Earlier monetary expectations were not rewritten. Unrelated V6 integration/e2e/fixture changes incorporated from upstream between the task baseline and candidate are outside this review and receive no approval from it.

Compatibility checkpoint `b1883172024d5010e5e9dd173077c8ff44466473` still contains the original production planner blob `70350f44c2d03ad9bda4b114e61c3eb36495a86a`. The historical planning base, actual execution base and checkpoint use that same planner. The compiler/contracts/finance/parent/public-fixture diff from planning base `9680b05` to actual base `53c501f` is empty. The frozen JSON at both checkpoint and candidate has SHA-256:

`95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b`

It contains 180 complete outcomes, including 128 stable seeded permutations. The fixture declares the actual capture base and exact old planner blob. I independently re-executed that immutable original planner against every current corpus input and reproduced every stored canonical outcome, then compared every candidate outcome against the original. This supports the fixture's compatibility provenance independently of the candidate's two shared-evaluator wrappers. It remains regression evidence, not an independent monetary oracle.

## Prioritized findings

**None.** No unresolved P1/P2/P3 finding is raised for the assigned classification deliverable.

The prior findings are resolved:

1. **Sparse occurrences:** the original `for...of` iteration semantics are restored with explicit input indexing. Holes retain independent envelope holds and exhaustive items. Dedicated candidate tests and an independent five-position sparse probe passed against the old planner.
2. **Source guard:** the same guard predicate and aggregate code produce a single blocker with the exact validated triggering occurrence indexes, including repeats. Ordinary events and unrelated sources remain excluded while the legacy broad hold event set stays unchanged. The semantic-missing-seller case and an independently constructed mixed financial/semantic repeated-source-guard case passed.
3. **Independent evidence:** the frozen corpus, bounded occurrence/reference assertions, negative paths, final failure injection and protected build mutation/membership checks are present and passing. Agreement between wrappers is no longer the sole compatibility assertion.
4. **Shared prerequisites:** the helper used by grouping and validation now carries typed relation and economic identity. Metadata projects that helper separately and sorts only its output. Legacy funding-before-invoice validation ordering and hold dependency semantics remain intact.

## Substantive assessment

The public types and six dispositions match the accepted design. Both wrappers invoke one private evaluator; `planBatch` projects only `outcome`. No new consumer, transport contract, production leaf or package export was introduced. Materialization, economic comparison, group construction, insertion ordering and final plan computation remain in their original module. Economics still excludes only source event and source record version.

Original input occurrences are traced directly. Invalid-envelope/hash hold indexes do not depend on bare event-ID matching. Valid normalized repeats point backward to the earliest validated representative; conflicts preserve fatal legacy rejection. The optional checked reference for a bad-hash envelope is conservatively omitted (`event:null`), which is permitted. Sparse runtime inputs, ordinary malformed inputs and the 1,000/1,001 boundary are exercised.

Target binding uses the validated state, version and normalized explicit `asOf`, including `hashTargetSnapshot`; the tested path neither mutates frozen inputs nor reads the wall clock. New items point to final sorted operations; persisted replay references retain original delivery/version; coalesced items point to their actual inserted producer. Accepted all-replay groups survive with no plans. Held connected groups do not leak tentative replay/coalescence/new success references.

Prerequisites retain full kind/source/seller/scope identity and target IDs. Exact target presence takes precedence; candidate providers are sorted representative indexes from successful materialization, with repeats and foreign/mapping-invalid inputs excluded. Held providers remain identifiable as candidates without implying acceptance. Existing allocation edges still couple financial validation. Independent funds do not lower invoice balance; supported full reversals preserve originals; unsupported reversal/currency and changed-economic-content boundaries remain held according to existing behavior.

Fatal exits publish bounded `not_classified` details without fabricated per-input acceptance. The final `FinanceError` catch encloses plan construction and references the appended final hold while retaining earlier holds; ordinary exceptions propagate. Acceptance metadata is emitted only after finalization succeeds or the legitimate no-insert path. The test-only mock exercises that final catch without changing transaction bounds or introducing a production seam.

Bootstrap subject/evaluator and financial build inventories already cover the planner. Added direct assertions and planner-byte mutation checks establish that changing its bytes changes the relevant pins; existing recursive closure tests pass unchanged. No protected expected truth, approval, stored attestation or build inventory was refreshed to preserve an old proof.

## Independently executed checks

An immutable Git archive of `ec91a4b` was created at `/private/tmp/eapr-classification-ec91a4b-review-snapshot`. Third-party dependencies were linked from the existing checkout; `@eapr` links were redirected into the snapshot. The old planner and independent probe script exist only in this temporary snapshot. Node was `v24.22.2`; Vitest was `5.1.0`.

With `PATH=/opt/homebrew/opt/node@24/bin:$PATH`:

1. `npm run test:unit -- packages/compiler/test/classify-batch.test.ts packages/compiler/test/classify-batch-final-failure.test.ts packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts` — **PASS**, 27 tests across 4 files; exit 0. This includes positive financial classifications, high-risk rejection paths, final FinanceError/ordinary-error behavior, mutation checks and recursive closure checks.
2. `node --import tsx review-independent.mts` in that snapshot — **PASS**, exit 0. Independently reproduced all 180 frozen outcomes using the old planner and compared candidate results; exercised 256 deterministic additional mixed-input differential cases with bounded item/repeat/group/operation-reference checks; directly checked sparse positions and aggregate repeated source-guard causes.
3. Git provenance, fixture SHA-256/count/ID inspection and unchanged-fixture/adopted-smoke-test comparisons — **PASS**.
4. `git diff --check 53c501f ec91a4b -- packages/compiler packages/evaluator/test` — **PASS**, exit 0.

The implementation report additionally records exact-candidate typecheck and 139 compiler/finance/evaluator unit tests passing. Those broader commands were not independently rerun here; the independently executed evidence is the focused set above. The original finalization behavior is pinned by the pre-adoption test/checkpoint and visibly preserved in the immutable old planner; this review's finalization fault injection ran against the candidate.

## Proof limits

Approval applies only to the exact classification source/test candidate and bounded task, not to a later integration result with other upstream changes. A subsequent source repair requires fresh review. The review did not execute DB, integration, browser, provider/model, live, slice or full-repository commands; did not change repository source, commit, merge, send external messages, or refresh protected truth; and used no subagent.

The product neither issues invoices nor moves money. Classification/preview proposes zero parent writes and conveys no receipt, grant, enrollment, global uniqueness or authority. Runtime receipt association, locked-current-state reclassification, epoch fencing, scheduler progress, durable holds, activation and synchronization remain later gates. Changed planner bytes require the normal later protected re-verification of proofs tied to older builds. Machine results, this exact-candidate independent review and joint user acceptance remain distinct.
