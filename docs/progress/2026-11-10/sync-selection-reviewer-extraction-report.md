# C0 installed reviewer extraction report

**Status**: implementation and focused qualification complete. Ready for fresh exact-candidate specification and quality review. The source and exclusive PostgreSQL leases return to root with this report.

- Released base: `122b217f2048d66439b9e102734409871324685d`.
- Candidate: `620bf2de35fa42f014c9b23364c18962a7794af3` (`refactor: share installed sync fixture review execution`).
- Accepted original variants Task 1 source: `13c301a5a72121d1c5a248cac570d67251ed1dff`. Review: `docs/progress/2026-11-10/sync-selection-enrollment-extraction-review.md`.
- Catalog plan SHA-256 `51bdb43293e0d7a0745d0874798ac09ba10bb72cd7469d715d6f118b7d024260`. Normative design SHA-256 `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c`.
- Preflight SHA-256 `c9c1fe3708cf9ce6a35078e4efffa5356a15a79874038c76cf209dfb8b0481e3`. The brief and implemented signature have nine inputs. The preflight prose counted eight.

## Implementation and self-review

The new reviewer module loads the installed files via public loaders and binds each supplied proof to its full canonical installed selection entry, its unique matching policy entry, and the exact registered scope/profile/manifest. The financial registry's matcher accepts any matching policy entry. The executor follows the operator publisher's existing one-entry pattern for the registry proof read, computing the validation policy hash over exactly that loaded entry to bind the issuer, build/pin and registered candidate. This validation argument is in memory only. The worker receives the complete installed policy; the control composition receives the original installed paths. Only validated selected members contribute reviewer accounts and sources. Approval rechecks canonical entry and real report/attestation equality before preparing, then uses the installed entry and validated proof throughout. The real authenticated prepare/activate, committed intent, exact A5 key/bundle, stored receipt/target/proof and bootstrap checks live in one chain.

The executor owns the actual worker and control instances immediately, closes them in reverse order even if one close rejects, and preserves the primary initialization error. Its stop promise is memoized. The executor derives control pool and migration expectations from existing inputs and catalog, preserves the fixed worker/repository clock, and leaves source dependencies on their existing clock. The real launch and composition exports remain observable. Enrollment owns root, namespace, pools, scope/policy publication and private no-replace selection write. It registers executor cleanup immediately after successful return. Its signature and prove body are unchanged.

The fixed factory was the sole enrollment caller. Its only change adds the reviewer bytes to its generator hash inventory. Its public factory, literal financial facts and assertions, origins, capture and cleanup stay in place. The entire integration file is byte-identical to the released Git blob. Static comparison also verified one approval chain, unchanged enrollment signature and prove body, and no source-specific grant, publication or selection write in the executor. The C0 commit contains exactly the three reserved paths and passed whitespace checks.

| Path | Before lines | After lines | Added | Removed |
| --- | ---: | ---: | ---: | ---: |
| `tests/fixtures/sync-selection-enrollment.ts` | 300 | 175 | 10 | 135 |
| `tests/fixtures/sync-selection-reviewer.ts` | absent | 216 | 216 | 0 |
| `tests/fixtures/sync-selection.ts` | 336 | 337 | 1 | 0 |
| Total | 636 | 728 | 227 | 135 |

The 216-line reviewer is six lines above the design's rough estimate. Exact installed proof validation and self-cleanup account for the new logic. There is one prepare/activate/readback chain.

## Focused verification

Node `v24.22.2`, PostgreSQL `18.6`, npm `11.19.1`, with the Homebrew Node 24 and PostgreSQL 18 directories prepended to PATH. Used the released existing local disposable lease with `EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`. The actual reviewer construction worker binds loopback port zero. Set `EAPR_SELECTION_FIXTURE_EVIDENCE_DIR` to the absolute run directory below, with `CI=1 NO_COLOR=1` for the command logs.

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection.test.ts -t 'same-feed fixture qualification' --testTimeout=180000 --hookTimeout=180000
```

Both commands exited 0. Vitest v5.1.0 reported 1 file passed and 4 tests passed in 54.69 seconds. The unchanged group contains exactly these four unconditionally declared cases, verified against the released blob:

1. `both subjects pass real producers and separate reviewer imports`
2. `shared capture replays without changing parent state`
3. `fresh independent construction preserves all original inputs`
4. `partial construction failure releases owned resources and preserves its error`

Three authority cases were filtered out. The composition failure case still calls the real composition after worker startup and checks sentinel identity plus awaited worker, pool, namespace and root cleanup. The fixed case does not directly inject a failure after control creation. That cleanup branch was inspected in the exact diff.

The first log-wrapper setup exited before invoking npm because shell noclobber rejected writing the precreated temporary filter file. The wrapper was corrected without changing source or replacing the source-pre-run inventory, then the two prescribed commands ran once. No test retry or synthetic RED was used.

## Retained evidence

Worktree-relative run directory: `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C0/run-kBpFAuiy`.

| File in run directory | Bytes | SHA-256 |
| --- | ---: | --- |
| `source-before.json` | 19680 | `a758e90e2ab58c4aca3668f402aa6a8397ab03c2efcec951a188dbb9498f6271` |
| `source-pre-run.json` | 19763 | `e590040c2d4c6ce23dc1d9389e38ea2bf7c2d7f778786b6c2a95db9efe277192` |
| `source-after.json` | 19763 | `e590040c2d4c6ce23dc1d9389e38ea2bf7c2d7f778786b6c2a95db9efe277192` |
| `source-comparison.json` | 2185 | `a70803be079fffe82ff15e2b94a9960e14187705fea9a58b6dd95f6356c07adb` |
| `versions.log` | 53 | `01a4411e6e776c81ba8e583ec9dbcca35b228f1726afce6958a71e07c402521f` |
| `command-status.log` | 38 | `4a5ac80702b573133baf5f31ab5f5bc67e62c78c1a1eb4cefa3c9e5626d6ed84` |
| `typecheck.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
| `qualification.log` | 422 | `8fd6f7d791ab219e941fa593d1eb2437eb6f7c462915081fb637ac32451a4d1b` |

Each source inventory has 110 sorted entries. The before inventory was recorded on the clean released base before edits. Before-to-pre-run changes are precisely the three reserved files. Pre-run and post-run inventories are byte-identical. Absent roots and four absent future suite paths are explicit. Command logs preserve original allowlisted npm and Vitest result lines. The output filter suppresses arbitrary object dumps and HTTP bodies.

The unchanged fixed suite checks temporary per-file input inventories in process. Its reporter retained aggregate results. It did not persist temporary fixed-input manifests, per-invocation producer metrics or proof IDs. Nested subject-runner sizes and timings remain unobserved. This is partial machine evidence for C0. Fresh candidate review and later catalog fixture, selector, slice and joint acceptance remain separate. No provider call, saved-pin rewrite, demo reset, shared cluster stop, push or subsequent fixture implementation was performed.
