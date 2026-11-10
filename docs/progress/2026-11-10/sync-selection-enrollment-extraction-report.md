# Task 1 enrollment extraction report

- Status **DONE**
- Released base `a5e834f385aed00f8a606d0953ba0ff4a422db5a`
- Commit `13c301a5a72121d1c5a248cac570d67251ed1dff` — `refactor: share sync fixture enrollment lifecycle`
- Tested worktree candidate `worktree:d6a351e53a33e4126b957a577b521bacfd5a5a6ab7fde169ec6f0fb37ef3eabb`. The committed two-file bytes match that pre-run/post-run inventory.
- Accepted design `11c6193cd23d9f371fe2ad5a689a17abfa0053941809264944fffd313ede6ab3`, plan `1a429ce30a791ce1bd48f1027e9bb6a3881044b3b6e7dc703e37d0ebdb9546e9`, refreshed preflight `781979a3721bc94ef27345a1577642fa93abf0257025c7b49c7c811264051d23`

## Implementation and scope

`tests/fixtures/sync-selection-enrollment.ts` owns the temporary root, exact generated namespace, separate migrated app pools, evidence/candidate/source services, real financial proof and selected bootstrap pin, registered-scope publication and installed policy, authenticated review, A5 approval and committed readback. It derives reviewer account grants and approval scope from the exact selected-profile/manifest matches in the freshly published index, and checks canonical installed entry membership and prepared package bindings before activation. The financial reservation still uses the exact registered artifact's full required profiles. The reviewer session retains one memoized reverse listener stop and the context retains memoized reverse cleanup for all acquired resources. A construction error survives cleanup errors.

`tests/fixtures/sync-selection.ts` retains the original zero-argument signature and ordered subjects tuple, authoring, capture/pinning and registration, separately authored descriptor, first-then-second literal import/receipt/origin checks with the intervening second-account absence assertion, shared capture lane and vector, and original input equality. The fixed financial assertion now checks the approved target that the shared A5 readback already proved equal to the persisted target. The only author body change is the added source path in the sorted generator hash inventory, which means newly authored private truth/provenance build hashes can change. No saved originals or pins were rewritten.

| Source | Released lines | Candidate lines | Added | Deleted |
| --- | ---: | ---: | ---: | ---: |
| `tests/fixtures/sync-selection.ts` | 531 | 336 | 58 | 253 |
| `tests/fixtures/sync-selection-enrollment.ts` | absent | 300 | 300 | 0 |
| Total | 531 | 636 | 358 | 253 |

The fixed fixture shrank by 195 lines. The two-path total increased by 105 lines to introduce the reusable typed boundary. The real approval sequence now lives in the enrollment helper, ready for the separately scheduled C0 extraction. No C0 work is included here.

## Focused verification

Node `v24.22.2`, PostgreSQL `18.6` and npm `11.19.1` using `PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH`. The existing test cluster accepted connections on loopback 55441. The test environment used `EAPR_PG_PORT=55441 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2 EAPR_CONTROL_PORT=3241 EAPR_WORKER_PORT=3242 EAPR_WEB_PORT=5182`. The fixture launched its construction worker on a loopback ephemeral port as before.

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection.test.ts -t 'same-feed fixture qualification' --testTimeout=180000 --hookTimeout=180000
```

Typecheck exit 0. Vitest v5.1.0 exit 0, one file passed, four cases passed, and three authority cases filtered out. Runtime was 54.82 seconds. Comparing the suite to the released Git blob confirmed byte equality and exactly four cases in the selected group:

1. `both subjects pass real producers and separate reviewer imports`
2. `shared capture replays without changing parent state`
3. `fresh independent construction preserves all original inputs`
4. `partial construction failure releases owned resources and preserves its error`

This exercises the genuine financial and bootstrap proof/import path, captures and replays without parent effects, fresh construction, and the deliberate failure after real review composition. The existing tests observe the real capture, worker, pool and provisioning/composition calls, await cleanup, and require exact sentinel identity on the deliberate failure. No manufactured red run or retry was used.

## Retained evidence

All files below are under `evidence/task-1/` in this plan's ignored SDD workspace. Inventories are no-replace JSON and contain 107 sorted file/absence entries with path, SHA-256 and byte length metadata only. The baseline includes immutable runtime007, SHA-256 `82c9e8ade1d3d1f7265c7cc35d48c335f74c2b6321be0f7bc0d93caf5ab4dcc7`. The sole before/pre-run changes are the two reserved paths. Pre-run/after changes are zero, and both candidate files were checked against the committed blobs.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `source-before.json` | 19660 | `865cfa7dabd7a7c24986b944730a88a0a0e4cd1d16f62e951fcd889cb018b3de` |
| `source-pre-run.json` | 19777 | `4c38aa41486ad61a72520bc50200decddf372c4e788941fe5330182663ceb07d` |
| `source-after.json` | 19777 | `4c38aa41486ad61a72520bc50200decddf372c4e788941fe5330182663ceb07d` |
| `source-comparison.json` | 2331 | `9c21224ec173e3e296153cfa94ab9cf8c22f5b535e00eac6d722b263743a571b` |
| `typecheck.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
| `qualification.log` | 422 | `223c4392f9f94f24c03623406b00b48ff6bdafc63cc77bb7be5af842561c78ed` |

The unchanged suite compares temporary input inventories in-process and retains its original aggregate logging calls. The successful command's reporter emitted only aggregate test counts, with neither those logging calls' output nor the temporary per-file maps in the retained log. The persistent source inventory covers the prescribed repository and saved-pin paths, with no copied proof, original, or credential content.

## Self-review and handoff

Scoped diff and committed range whitespace checks passed. A source comparison confirmed that authoring differs only by the build inventory dependency, the public signature and literal financial assertions match the released source, and the complete integration test file is byte-identical. The working tree was clean at commit. The internal helper adds no scenario mode, injection option, dependency or barrel entry. Listener cleanup remains observable through the named exports. No issue remains in this task scope.

This is partial machine requalification of the fixed fixture. Independent exact-candidate review is pending. Variant, selector, cross-stream/unaffected mapping, slice and joint acceptance require separate evidence. The existing cluster stayed running, and no push was performed.
