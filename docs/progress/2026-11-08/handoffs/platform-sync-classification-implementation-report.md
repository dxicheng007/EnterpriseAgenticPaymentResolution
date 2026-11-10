# Batch classification implementation

## Candidate and provenance

- The repaired source and test candidate is `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6`. Its immediate base is `8b50c9cfb231ab3d64391cef877df75fe78c82b0`, the isolated adoption of the core from PR #34 at `7084466f5128a2fe1cdf1a1548e568eec799e9ab`. The prior review requested repairs and more verification. The two adopted smoke tests and all prior monetary expectations are unchanged.
- The approved implementation plan has SHA-256 `96a378d44a3876d0d6dd0c083d760d17ce0d1f3f8c57bc40bfcf27aec5af776f`. The accepted design has SHA-256 `c51dbd0813a6f55f316dc1a2ac3ead19ccfe9bec37f270cadb814d90dd5aee38`.
- The pre-change checkpoint is `b1883172024d5010e5e9dd173077c8ff44466473`. It captured outcomes at actual execution base `53c501f203903eb08054b84f1b6d93a11d763c64`, with legacy planner blob `70350f44c2d03ad9bda4b114e61c3eb36495a86a`. The planning base `9680b052765400ade5032b077893e7d4e472e147` has the same planner blob. A read-only Git diff showed no changes between the two bases in compiler, contracts, finance, parent, or the shared public fixture module `tests/fixtures/index.ts`.
- The frozen JSON SHA-256 is `95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b`. The fixture retains 180 complete public-development outcomes including 128 seeded permutations. The candidate leaves those bytes unchanged. The comparison checks canonical output equality for operations, lineage, hashes, balances, event IDs, diagnostics, hold content and array order.

## Repairs

- Restored the legacy parser iteration and recorded each original occurrence. Sparse positions retain their individual envelope holds and classification items. Checked, normalized repeated deliveries refer back to their first validated occurrence.
- Reused the actual source guard predicate and aggregate code for a single blocker with precisely the triggering original indexes. The legacy broad hold event set is unchanged.
- Enriched the prerequisite helper used by grouping and group validation with relation and economic identity. Classification projects its typed prerequisites from that same helper and distinguishes target, materialized candidate and missing presence.
- Kept the original group validation, comparison, plan ordering and finalization. The final `FinanceError` catch encloses the plan construction. Operation references use the sorted insertion indexes, and each candidate carries its representative input index through grouping. Acceptance and repeat metadata are published after successful finalization or for the existing no-insert path.
- The bootstrap subject and evaluator tests assert planner inventory membership and mutate planner bytes in a temporary copy to change both pins. The financial build test asserts direct membership and retains its mutation check. The recursive import checks passed with unchanged inventories.

## Partial machine evidence

Node `v24.22.2` and Vitest `5.1.0` were used. Before the capture checkpoint, the default sandbox prevented Vite from writing its temporary configuration in the worktree. Both legacy commands passed after scoped execution allowed that cache write.

| Execution point | Command | Observed result |
| --- | --- | --- |
| Unchanged legacy planner | `npm run test:unit -- packages/compiler/test/plan-batch.test.ts packages/compiler/test/classify-batch.test.ts` | Exit 0, 14 tests. Canonical equality for all 180 outcomes and two sparse envelope holds preserved. |
| Unchanged legacy planner | `npm run test:unit -- packages/compiler/test/classify-batch-final-failure.test.ts` | Exit 0, 1 test. The real `FinanceError` type is injected through the unit test's balance mock after group acceptance. The prior envelope hold and the final money-range hold are both present, with accepted deliveries in legacy order. |
| Adopted PR #34 source before repair | `npm run test:unit -- packages/compiler/test/classify-batch.test.ts packages/compiler/test/classify-batch-final-failure.test.ts` | Exit 1, 19 passed and 3 failed. Sparse input lost two holds. The mixed guard split causes `[0]` and `[1,3]` across two codes. A semantic event missing only seller reported `IDENTITY_SCOPE` despite the legacy `SEMANTIC_VERSION` hold. |
| Repaired candidate | `npm run test:unit -- packages/compiler/test` | Exit 0, 53 tests across 5 files. The three failing assertions turned green. |
| Repaired candidate | `npm run test:unit -- packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts` | Exit 0, 5 tests across 2 files. Planner mutation and recursive import coverage passed. |
| Repaired candidate | `npm run typecheck` | Exit 0. |
| Repaired candidate | `npm run test:unit -- packages/compiler/test packages/finance/test packages/evaluator/test` | Exit 0, 139 tests across 25 files. Zero skipped required tests. |

The finalization tests cover both public functions, retain earlier holds on `FinanceError`, and verify that ordinary exceptions propagate. The compiler assertions check all six dispositions, all stop reasons, exact target bindings, provider and group partitions, indexed holds and operations, financial boundary cases, and the 1,000-input cap. The source change adds no new import leaf. Scoped Git diff checks passed, and the frozen fixture hash and upstream smoke-test bytes were rechecked before committing.

The coordinating owner can request a fresh review of `ec91a4bae74ab22623ed5cdeaf55f4de07e085a6`. Exact-candidate independent review and joint acceptance are pending. This report records partial unit and typecheck evidence. Database, browser, integration, provider and slice commands were outside this assignment. Existing proofs tied to old planner bytes require their normal re-verification. Runtime receipt association, scheduling, authority and synchronization remain later gates.

## Reproducible pre-change capture

Run at the root of the actual capture base with the public case module from the compatibility checkpoint available. The inline command was never a tracked script.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
node --import tsx --input-type=module <<'NODE'
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { planBatch } from '@eapr/compiler/plan-batch';
import { compatibilityCases } from './packages/compiler/test/fixtures/classification-cases.ts';
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const baselineCommit = git(['rev-parse', 'HEAD']);
if (baselineCommit !== '53c501f203903eb08054b84f1b6d93a11d763c64') throw new Error('Unexpected capture base');
const plannerBlob = git(['hash-object', 'packages/compiler/src/plan-batch.ts']);
if (plannerBlob !== '70350f44c2d03ad9bda4b114e61c3eb36495a86a') throw new Error('Pre-change planner required');
writeFileSync('packages/compiler/test/fixtures/plan-batch-before-classification.json', JSON.stringify({
  baselineCommit, plannerBlob,
  cases: compatibilityCases.map(({ id, artifact, profile, inputs, target }) => ({ id, outcome: planBatch(artifact, profile, inputs, target) })),
}, null, 2) + '\n', { flag: 'wx' });
NODE
shasum -a256 packages/compiler/test/fixtures/plan-batch-before-classification.json
```

## Later fixture storage migration

Storage commit `62a76be9375a1e8875424ff50287eddb94f5a8ec` on base `b12c6fa9b7c862ed66f055b8108d239df3dcea16` stores 39 complete expected outcomes once and maps all 180 original case IDs to them, including the 128 deterministic permutations. The test-local loader expands them in original order and pins the expanded serialization to the original SHA-256.

| Fixture representation | Lines | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| Original capture and restored expansion | 129,560 | 4,234,825 | `95727d9ede9cf59c0f98945b64a4ff5be3fed50039ed2af0b78827aed26cb26b` |
| Deduplicated JSON | 8,241 | 255,568 | `b047ea63ef2adb6e56caf7611f3d0d0d03ec4fa55bce2c4779f27795412c1ff3` |

The migration removes 121,319 lines and 3,979,257 bytes from the fixture, a 94.0% byte reduction. Before replacement, the working fixture matched the Git blob at original checkpoint `b1883172024d5010e5e9dd173077c8ff44466473` and the original SHA-256. A separate Node check verified every reference and compared the expanded JSON byte-for-byte with that checkpoint. No planner produced new expectations. The capture base and planner blob above remain the original provenance.

On Node `v24.22.2`, running `npm run test:unit -- packages/compiler/test/classify-batch.test.ts` with the compact fixture and original loader exited 1. Six tests reached the expected array-method errors on the new case mapping, and 13 passed. With the adapter in place, `npm run test:unit -- packages/compiler/test` exited 0 with 53 passing tests across five files. `npm run typecheck` and `git diff --check` exited 0. Git confirmed the storage commit changes only the compiler test and its expected-outcome JSON. All prior test cases, production source, and protected build inputs retain their original bytes or assertions.

This is partial machine evidence for the fixture storage change. Fresh independent review is requested for the exact storage commit. Joint acceptance remains pending.
