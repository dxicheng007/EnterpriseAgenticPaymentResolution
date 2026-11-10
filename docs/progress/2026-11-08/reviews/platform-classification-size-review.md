# PR40 size and complexity review

## Recommendation

No, 130,000 extra lines are not necessary. Deduplicate identical complete frozen outcomes, retain an explicit mapping for all 180 cases, and adapt only the fixture loader. This removes 121,319 fixture lines and 3,979,257 bytes without deleting a case, deriving an expected answer from production logic, or changing any financial behavior. Keep normal indented JSON and descriptive representative case IDs. Do not refactor production classification logic for this size task.

This is a read-only assessment and temporary prototype, not an implementation or approval. No tracked file, Git index, database, browser, or network was changed. The concurrent verification-script implementer committed during this assessment; final aggregate measurements are pinned to `6b8619ca0d0f8488024f22d1b32ba349782d359f` against `origin/main` at `722aaf70c7f8833e954d33fc273f6a4f48b27f78`. Compiler source blob is `934173685063dc5d7ae5765b9e0d46b23cafa682`; the frozen fixture retains the supplied original SHA-256.

## Where the size comes from

Counts are `git diff --numstat <base> <candidate>` and exact blob byte-length differences, excluding the unrelated untracked review note.

| Contributor | Files | Added lines | Deleted lines | Net bytes |
| --- | ---: | ---: | ---: | ---: |
| Frozen expected-outcome JSON | 1 | 129,560 | 0 | 4,234,825 |
| Other test and fixture code | 8 | 1,106 | 12 | 63,174 |
| Documents | 22 | 1,337 | 0 | 244,604 |
| Production source, scripts, and script guidance | 6 | 306 | 344 | -1,911 |
| Total | 37 | 132,309 | 356 | 4,540,692 |

The fixture accounts for 97.9% of added lines and 93.3% of net added bytes. Relative to current main, `packages/compiler/src/plan-batch.ts` itself changes 151 added / 171 deleted lines, a net reduction of 20 lines / 1,810 bytes. It is 555 lines total. Relative to the actual pre-classification capture base, it changes 250 added / 62 deleted lines, a net increase of 188 lines. The 130k number therefore does not describe 130k lines of executable complexity.

Principal new classification test code is 543 lines / 32,392 bytes in `classify-batch.test.ts`, 208 lines / 12,278 bytes in `fixtures/classification-cases.ts`, and 55 lines in the separately mocked final-failure test. These exercise required behavior and are not worthwhile size targets.

## Proven reduction

The 180 captured cases contain only 39 distinct complete outcomes. Four groups each contain their original named case and all 32 corresponding permutations, accounting for 128 repeated full copies alone. Other distinct scenarios also have identical complete outcomes. They remain distinct input/behavior coverage, so deleting their tests would be a coverage regression.

Use this ordinary JSON structure:

```json
{
  "baselineCommit": "53c501f203903eb08054b84f1b6d93a11d763c64",
  "plannerBlob": "70350f44c2d03ad9bda4b114e61c3eb36495a86a",
  "originalFixtureSha256": "95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b",
  "outcomes": {
    "a-baseline": "FULL UNMODIFIED OUTCOME OBJECT HERE"
  },
  "cases": {
    "a-baseline": "a-baseline",
    "a-baseline-permutation-01": "a-baseline"
  }
}
```

The sketch abbreviates objects only for explanation. The prototype stores each of the 39 complete original outcome objects once, with normal two-space JSON indentation; its `cases` map explicitly lists every original case in original order. Representative IDs are the first original case having that identical outcome. No hashes replace expected outputs and no expected field is omitted. Case IDs are nonnumeric strings, so JavaScript object iteration retains capture order.

| Representation | Lines | Bytes | Result |
| --- | ---: | ---: | --- |
| Original full copy per case | 129,560 | 4,234,825 | Current fixture |
| Grouped IDs beside full outcomes | 8,394 | 268,779 | Viable, but expansion changes original case order |
| Recommended named outcomes plus ordered case mapping | 8,241 | 255,568 | Exact original bytes recoverable |

The recommended representation saves 93.6% of fixture lines and 94.0% of fixture bytes. The measured PR would fall to approximately 10,990 added lines / 356 deleted lines and 561,435 net added bytes, before the small loader/provenance-test changes. This estimate includes all the unrelated already-present documentation and verification work in the branch.

Temporary prototype: `/private/tmp/eapr-pr40-deduplicated-prototype.json`.
Per-file measurements: `/private/tmp/eapr-pr40-size-measurements.json`.
An alternative grouped prototype is `/private/tmp/eapr-pr40-grouped-prototype.json`.

## Independence and immutable provenance

Transformation input must be the frozen capture from checkpoint `b1883172024d5010e5e9dd173077c8ff44466473`, with SHA-256 `95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b`. Preserve capture base `53c501f203903eb08054b84f1b6d93a11d763c64` and planner blob `70350f44c2d03ad9bda4b114e61c3eb36495a86a` (also the planner blob at planning base `9680b052765400ade5032b077893e7d4e472e147`). This is a lossless storage migration of previously captured expectations, not a new capture.

The temporary transformation used parsed existing JSON only. Deduplication selected canonically equal complete outcome objects. A separate Node `v24.22.2` check expanded the recommended representation using only object lookups, then verified:

1. Exactly 180 entries and 39 referenced outcomes, no missing or unused outcome reference.
2. Deep equality with the complete original parsed fixture.
3. `Buffer` equality of `JSON.stringify(expanded, null, 2) + '\n'` with the original 4,234,825-byte file.
4. SHA-256 of those restored original bytes equals `95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b`.

All four passed. No planner, compiler, production finance helper, or case generator was executed to obtain expectations. This byte roundtrip is stronger than just comparing canonical JSON, and also preserves object field and array order. The prototype has not been committed and the application/test suites were not run in this read-only review.

## One bounded implementation task

Owned paths, relative to `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`:

1. `packages/compiler/test/fixtures/plan-batch-before-classification.json`: replace only the redundant representation using the original pinned capture; preserve all IDs and complete values.
2. `packages/compiler/test/classify-batch.test.ts`: parse the new data, assert each reference exists, expand once into the existing `{ baselineCommit, plannerBlob, cases: [{id,outcome}] }` shape, and retain all existing test loops/assertions. Add the fixed original-fixture hash assertion using built-in `node:crypto`, against the expanded serialization. Assert the preserved baseline commit/planner blob, 180 cases, 39 distinct referenced outcomes, and exact existing compatibility-case ID coverage. Keep the original SHA as a hardcoded test expectation so merely editing a JSON metadata field cannot redefine provenance.
3. `docs/progress/2026-11-08/handoffs/platform-sync-classification-implementation-report.md`: append a concise storage-migration record with original hash/checkpoint, new file hash, unchanged expanded hash, before/after measurements, and bounded verification results. Preserve the historical capture command and historical claim that the earlier candidate left fixture bytes unchanged; label the new storage format as a later change.

No source, case generator, finance, protected expected truth, evaluator inventories, scripts, consumer, database, or unrelated documentation changes. Do not add a permanent fixture-regeneration script or generalized compression framework. The loader should remain a short straightforward local adapter; the existing `frozen.cases` consumers then need no behavioral rewrite. The coordinator must hand this to one implementer after the current writer completes.

Verification for that implementation:

- Before replacement, read the checkpoint blob and verify its pinned original SHA. Do not execute the current planner to fill expectations.
- Reconstruct and byte-compare against the checkpoint blob once during implementation; record original and new hashes. Keep the permanent expanded-serialization SHA assertion in the existing compatibility test.
- Run `npm run typecheck` and `npm run test:unit -- packages/compiler/test` with Node 24. This runs both public API compatibility paths, all 128 permutation executions, classification invariants, sparse-input regression, and separate finalization failure tests.
- Run `git diff --check`; verify exact owned-path scope and no changes to production source, input-case generator, old expected values, or old capture provenance. Have the coordinator obtain independent review of the exact commit. Report unit/typecheck results as partial machine evidence, not live/financial certification or joint user acceptance.
- No database, browser, model, integration, or slice execution is justified by a fixture-storage-only change. Production source bytes and therefore protected source build pins do not change.

## Why stop here

The current source already follows the simpler accepted architecture: one evaluation behind both public APIs, the same prerequisite helper for validation and metadata, representative indexes carried directly by candidates, and metadata emitted after successful finalization. It no longer uses the prior repeated candidate/group searches or duplicated typed-prerequisite builder visible in the upstream comparison. The distinct held/replay/coalesced/new/semantic/repeated cases and failure boundaries encode actual accepted behavior. Removing them, conflating them, or inferring metadata from absent plans would be a functional change.

Further extraction could shorten a function but would move rather than remove logic, create extra import leaves and protected-build maintenance, and increase this task's review risk for little size benefit. There is no demonstrated source simplification worth bundling with this reduction. Preserve the independent full-output compatibility tests plus classification assertions: identical expected financial outcomes across permutations do not make the varied inputs or per-index metadata checks redundant.

Whole-outcome deduplication adds only a named lookup and one expansion, with readable expected-output diffs and unchanged case-specific assertion diagnostics. Minifying the original JSON would disguise line count while retaining repeated bytes and make review worse. Gzip/binary fixtures require opaque decoding. Recursive subtree interning, delta patches, computed expected hashes, or generating expected lineage from production helpers would add machinery or weaken independence. Deleting permutations or replacing full outputs with checksums would reduce confidence. None is warranted after a 94% byte reduction.
