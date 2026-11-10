# Task 5 exact-candidate handoff

Released source BASE `d227bc4bcb57f36247b5f0eba717dbc3dd4a6b4f`. Candidate `74cd969c2a51b67d0caeae18089585400beb3f2b` on parent `7284146beb10b9d4feb9e7f0224dcb838310b5e2`. Intervening root commits were documentation only. Commit subject is `feat: bound sync selection catalog and target reads`.

## Implemented

The internal caller-client catalog uses one required SelectionReadContext. It reads the indexed source/account enrollment sentinel, admits import column lengths in lexical order, then observes exact authority and target pointer/snapshot keys and bounded metadata/financial rows. It completes the scalar/length pass for the entire source before scalar array-cardinality checks, and completes that structural pass before any accepted body reader. The same scoped approved/current snapshot is decoded and charged once. An evolved current target is read by its exact admitted hash. The catalog validates selecting request/profile/artifact and manifest pins, retains each approved baseline vector and target, and compares both relational key sets, association scalars, canonical bytes and digests against the current target. Unsupported transport and admission limits return only an incomplete catalog with cumulative observed facts. Strict persisted inconsistencies use the fixed selection storage error. A same-lease forwarding wrapper preserves original query errors through the accepted decoders for the later transaction owner.

The ledger distinguishes physical table/PK/column admission from logical roots. The closed family-domain tags are the corresponding physical table names and logical_receipts for the shared initial/ongoing receipt domain. The latter uses [initial, importKey, receiptId] or [sync, receiptId]. Initial aliases consume a logical slot with no new physical row or byte charge. Count domains and embedded target cardinality keep their separate units. The required SelectionCut.admission field and summary/result types are type-only staging. The existing synthetic pure constructor supplies explicit zero physical reads.

## Machine evidence

| Run | Result | Evidence file |
| --- | --- | --- |
| Full RED catalog selection | Exit 1. Of 14 selected cases, nine failed for the missing behavior, two baseline/bundle controls passed, and three were interrupted or failed setup. Seven unrelated existing tests were filtered out. | red.log |
| Three-case RED repeat | Exit 1. All three reached the real reader and failed for the missing admission behavior, 62.31s. | red-rerun.log and red-rerun-check.txt |
| First new-reader smoke | Exit 0. One selected A catalog case passed, 21.04s. | green-smoke.log |
| Full GREEN catalog selection | Exit 0. 14/14 selected passed, 358.59s. Seven unrelated existing cases were filtered out. | green-integration.log |
| Existing selector unit regression | Exit 0. 65/65 passed, 1.09s. | green-unit.log |
| Final affected integration selection | Exit 0. 3/3 selected passed in 63.86s after refining only the test setup. Eighteen unrelated cases were filtered out. | final-target-controls.log |
| Typecheck | Exit 0 for the full GREEN source and the final source. | green-typecheck.log and final-typecheck.log |

Full command was npm run test:integration -- tests/integration/sync-selection.test.ts -t 'catalog_'. Final affected command used -t 'catalog_(extra metadata|target record|aggregate)'. The unit command was npm run test:unit -- apps/worker/test/sync-selection.test.ts. Green-to-final changed only the integration test file and reran all three consumers of its changed seeding helper. The production reader, staged types and pure fixture hashes are identical to the full GREEN source.

The RED baseline selected actual source rows and invoked the genuine authority and target readers, without bounded admission. It returned the genuine nine subjects and genuine CSV B enrollment as usable, observed zero physical bytes, admitted orphan metadata, and exposed the authority helper's storage error for forged bindings. The initial target and per-value runs timed out while the host was asleep and have no inner stage evidence. The initial aggregate run stopped in the unchanged financial launcher during issueActivationProofs. The allowlisted host sleep/wake timestamps correlate with all three disruptions. With identical RED source and unchanged fixture/producer deadlines, the rerun returned admitted catalogs for the 10,001st observed relational row and aggregate byte cases. The oversized individual column incorrectly reached the authority decoder. A process-scoped idle assertion was used for the rerun and GREEN. It did not change global settings or establish protection against user/lid sleep.

The first implementation typecheck found heterogeneous metadata Map inference. The exact failing source and diagnostics are retained in pre-first-green-source.tar and first-typecheck.log. Explicit map typing corrected the inference before the green checks.

## Assertions observed on real storage

- Empty source returned no_committed_subjects after one scalar query. Genuine exact A enrollment reported every admitted physical byte from an independent SQL sum of eight import columns, present grant, distinct snapshot rows and relational canonicals. Equal recorded/planner bytes were charged separately. The shared current/approved snapshot was charged and decoded once. The first-import receipt alias added no physical receipt row. An accepted captured P1 apply then supplied distinct current and approved snapshot hashes, both individually charged and read by their exact hash.
- Genuine paused and revoked states remained present and their grant bytes were included. Two independent A imports retained their own approved manifests/vectors/targets, with both subjects' structural projections before any body. The genuine two-profile bundle yielded only its selecting request's subject.
- The genuine nine-import A source returned nine observed rows, zero admitted bytes, and only the ordered source LIMIT 9 query. The genuine CSV-bearing B source returned whole-catalog unsupported_transport.
- Disposable owner-only recorded snapshot hash and request digest corruption returned the fixed storage error. Extra relational metadata was refused against its genuine unchanged snapshot.
- The final relational sentinel cases distinguish a true persisted total of 10,001 from a larger total with exactly 10,000 metadata rows. In the latter, SQL still fetched one financial sentinel and the ledger counted only the 10,001 rows it observed. Both had zero canonical-body results.
- Per-value rejection observed a real 1,048,577-byte import column and retained zero admitted bytes. Aggregate rejection independently calculated the exact admitted prefix before the first value crossing 16 MiB. Neither reached canonical retrieval. The embedded two-array 10,000-record exact fit reached strict decoding and rejected the deliberately corrupted stored target. The 10,001-record case rejected before body retrieval without creating physical row counts.
- Catalog instrumentation used real query calls on the caller's single read-only repeatable-read client. It asserted SELECT-only statements, no locks, no lifecycle operations or pool checkout inside the reader, and no raw canonical result columns in sentinel paths. Positive paths observed actual canonical result columns. Durability comparisons covered import, authority, activity and target tables on the checked A paths.

## Scope and retained sources

Source delta is four paths. Exact line counts and SHA-256 inventory follow. Source archives preserve path layout. The original before map, RED archive and hash map, implementation typecheck failure archive, full GREEN pre/after maps, final pre/after maps and runtime logs are in task-5-evidence beside this report. Full GREEN and final source maps each match across their own test run. No fixture producer, protected input, package, migration or pure selector function changed. Disposable fixtures closed through their existing owner paths. The shared PostgreSQL cluster and original demo were preserved.

```text
643	0	apps/worker/src/sync/selection-read.ts
13	0	apps/worker/src/sync/selection.ts
2	0	apps/worker/test/sync-selection.test.ts
382	0	tests/integration/sync-selection.test.ts
1b7fd02f847c6c7eb22564d55409b317f064488fa1ef84244bf4b888f48a7307  apps/worker/src/sync/selection-read.ts
3445659a055ac61a4bea4704d08e06f7c75f3b88aec039da23cb7f0b44215147  apps/worker/src/sync/selection.ts
bf093605ccecce7f77ecbf4eb47350fdf71bbdfdffd1cd358c7e13fa202f2658  apps/worker/test/sync-selection.test.ts
9daff17e554347a41d648edac9c1f366f072b1fab8435ff5311d8e63fbd8e215  tests/integration/sync-selection.test.ts
```

Focused machine checks cover Task 5. Capture, history, the selector transaction/timeout/cleanup lifecycle, independent review and joint acceptance remain separate gates. Source and SQL lease are returned to root with this report.
