# S2 protected bootstrap descriptor and independent oracle

- Branch `codex/bootstrap-oracle`
- Worktree `/Users/devincheng/.codex/worktrees/acquisition-sources/EnterpriseAgenticPaymentResolution`
- Base `83f64f3b5b15061bca2ef0f7f8102fd4a5f7adb4`
- Head `e212cbd1e2a3b32bef65e3c44e3aa626272ab04c`
- Accepted proposal SHA-256 `dbd085abf914a0433e0f15423895a5082988acc4a05a7ce064fb825a319f1fa7`

The clean candidate changes only the eight S2-assigned files. The protected operator API resolves the immutable candidate and capture through the existing registry and source service before publishing a sidecar. The sidecar reader checks both the registered whole-object digest and the protected capture content hash, re-decodes the referenced immutable evidence v2 bundle, and matches the descriptor's reviewed IDs and citations to independently validated producer facts. The sidecar is published by no-replace link. The reader checks private file and directory permissions and rejects symlinks and served-root overlap.

The independent oracle derives metadata and its leaf lineage, financial records and checked balance from pinned truth, a separate A/B mapping and path table, and rank plus capture delivery order. Case recipes provide expected complete plan and hold identities for all ten frozen probes. The production expectation path has no compiler, parent, finance, product candidate, subject runner or public-test-truth dependency. Integration invokes the actual S1 planner solely to compare its output against already-derived expectations.

## Verification

- `npm run typecheck` passed.
- `npm run test:unit -- packages/evaluator/test/bootstrap-fixtures.test.ts packages/evaluator/test/bootstrap-reference.test.ts packages/evaluator/test/bootstrap-cases.test.ts` passed, 6 tests across 3 files.
- `npm run test:unit` passed, 259 tests across 34 files.
- `npm run test:integration -- tests/integration/bootstrap-fixture-setup.test.ts` passed repeatedly, 1 integration test exercising both captured companies and all 10 actual planner cases per company. The integration uses a fresh temp root, PostgreSQL lease 55434, control 3201, worker 3202, web 5175, and test prefix `eapr_test_review_t1`. It uses Node 24 and PostgreSQL 18. The main demo and pins were untouched.
- `git diff --cached --check` passed before commit. Post-commit status was clean.
- Assertion-red runs observed the missing descriptor decode, leaf pointers, and frozen case order before implementation. The initial integration wiring rejected the seed at the local demo loader's intentional `local-demo-v1` pin. The final test uses the existing upload, manifest publication, capture and evidence assembly services for `bootstrap-v1`. A sandboxed full-unit attempt could not write Vite's worktree cache. The scoped rerun passed.

Repeated fresh-root runs at seed `bootstrap-v1` and as-of `2026-10-01T00:00:00.000Z` emitted these digests.

| Company | Sidecar SHA-256 | Capture content SHA-256 |
| --- | --- | --- |
| A | `9d0bf5ddb261ae338e6e50d9adce00938fba04fb4c51ce472062d54856f0f95b` | `77797c58755c66ce90deba56726732a47410a8dbcccc6e3dc6ec49cac6266148` |
| B | `3845ad5089d771707adf5d02730471a8eb345a72e0282559d2e8918d1b758c95` | `bd58b7b5360313ceb820f5e2907d6833b609f30e959229b30e691a4832f56c0c` |

The suite preserves original v2 pin bytes, proves B's zero balance with a nonempty financial plan, tests alternate rebuilt candidate hashes for wrong name, fee, configuration ID and scope, and rejects wrong fact/citation/profile/v2 pins. It rejects a rehashed sidecar with the registry digest substituted as capture hash, and rejects snapshots with changed exact bytes against the original registration. An otherwise valid revised expectation fails under the old version and publishes under a new version. The captured A amendment checks inherited support, explicit amendment end provenance and a derived terminal null. A public two-term vector reverses term/configuration ID ordering.

## Handoff and limits

- `readBootstrapExpectation(pin, capture, roots?)` takes trusted capture registration metadata `{artifactHash, manifestHash, snapshotId, snapshotObjectHash}` obtained at the immutable registry boundary. `capture` also supplies artifact, complete profiles, manifest, snapshot and events. The returned context feeds `buildBootstrapReference(context, selectedProfileHash, target)` or `buildBootstrapCases(context, selectedProfileHash, target)`. Unavailable recipe inputs return undefined. The separate S3 runner compares actual plans and hold identities and records execution/coverage.
- Construction recipe supports the designated single-account A/B financial baseline with empty financial target and compatible reviewed metadata. A compatible reuse target retains existing record order and receives missing expected metadata. Unsupported mappings or missing complete probes cannot produce a complete case matrix. Existing financial target cases, trusted result registry, subprocess protocol, product mounting, activation and later scope are separate work.
- No API key, provider, merge or push. These are partial machine checks for S2. Independent review of the exact candidate and joint acceptance remain separate.
