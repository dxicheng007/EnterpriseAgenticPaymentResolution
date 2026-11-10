# Task 3 bundled-profile qualification

- Released base `9322fc3930a0a55d84136c257d43c65b5b07bb5c`.
- Verified and committed source `48ef6319d74d03ea220146a5ef21d0a34fde5c0d`, parent `6c46f5f00e905bd5dd9c22c45b06b9bf52b52843`. Root commits `43f8b7f` and `6c46f5f` between release and commit changed only the coordination document. The four-path review range may be isolated at the commit parent.
- Final source inventory fingerprint `583f4ecb94f6c4863acc19e12e03c7c20f2705801595195d02831bbfce43b0bb`. Before-edit to pre-run changes are exactly the four authorized paths. The 111 sorted pre-run and after entries, hashes and lengths are identical. Both full inventories are byte-identical. The four committed blobs match the tested source. Only the four authorized paths were staged and committed.
- Normative design `11c6193cd23d9f371fe2ad5a689a17abfa0053941809264944fffd313ede6ab3`, plan `1a429ce30a791ce1bd48f1027e9bb6a3881044b3b6e7dc703e37d0ebdb9546e9`, and release amendment/preflight `f112bddd2b71bd7fa104bb70f3d7d42e85d870667a2e486b879c26d07993d99b`.
- Focused machine checks passed. Exact-candidate review and joint user acceptance are pending.

## Verification

Node v24.22.2, PostgreSQL 18.6, Vitest 5.1.0. Used the released existing PostgreSQL lease with one sequential suite invocation at a time. The primary, fresh and deliberate partial-failure attempts of each final suite closed their owned resources. The cluster was retained.

```sh
npm run typecheck
npm run test:integration -- tests/integration/sync-selection-bundled-fixture.test.ts -t 'bundled-profile fixture qualification' --testTimeout=180000 --hookTimeout=180000 --reporter=verbose
npm run test:integration -- tests/integration/sync-selection-baselines-fixture.test.ts -t 'distinct-baseline fixture qualification' --testTimeout=180000 --hookTimeout=180000 --reporter=verbose
```

Typecheck and both suites exited 0. Bundled 4/4 in 46.25s. Baseline 4/4 in 54.83s. Neither focused suite skipped or filtered out a case in its file. Scoped pre-commit and committed-range whitespace checks passed. The baseline's literal financial, lane and four test bodies were independently compared byte-for-byte against the released source. Only its observation imports, utility implementation placement and calls changed.

The first typecheck found a new-suite reference to `bootstrap.pin.hash`. The wire schema uses `fixtureHash` and the operator reader expects it as `hash`. The first bundled execution passed real construction and the deliberate cleanup case but failed three qualification cases on two test expectations. The stored bootstrap bundle uses sequence order while proof hashing uses event-ID order, and the bundle stores the installed policy's issuer/ID/hash binding. The corrected tests assert both exact established representations. No fixture authoring or protected producer code changed after that run. The source snapshots for both diagnostic candidates and a safe projection of the failed assertions are retained. There was no genuine producer rejection or proof fallback.

### Executed prerequisites across the variants

- Task 1 `13c301a5a72121d1c5a248cac570d67251ed1dff`, accepted prior prerequisite. The four `same-feed fixture qualification` cases were `both subjects pass real producers and separate reviewer imports`, `shared capture replays without changing parent state`, `fresh independent construction preserves all original inputs`, and `partial construction failure releases owned resources and preserves its error`. The Task 1 filter excluded `authority_same_client`, `authority_inactive_recognition`, and `authority_missing_head_with_history`. Task 3 left the fixed file unchanged and did not rerun it.
- Task 2 `6721f37860cd1f60ea9442ebc68dd4e192ed28d2`, accepted prior prerequisite. The four `distinct-baseline fixture qualification` cases were `real distinct proofs and first imports`, `independent complete lane intervals`, `fresh construction and immutable inputs`, and `partial construction cleanup`. All four were requalified at the Task 3 commit after extraction.
- Task 3 `48ef6319d74d03ea220146a5ef21d0a34fde5c0d`, machine verified and awaiting fresh review. The four `bundled-profile fixture qualification` cases were `full artifact proof with selected-only authority`, `unselected remains absent with captured input`, `fresh construction and immutable inputs`, and `partial construction cleanup`.
- Installed-review executor prerequisite `620bf2de35fa42f014c9b23364c18962a7794af3` was already accepted. Task 9 unselected routing and inactive-authority subscenarios, cross-stream/unaffected-mapping cases, later slice gates and joint acceptance remain separate.

## Results and self-review

Both successful bundled constructions passed 13 mandatory financial checks with 106 total reported cases and zero unexplained difference. Report, reservation, attestation, artifact and capture all bind the two exact profile hashes, five event kinds and source. The real shared page citation supports currency under both independently authored contract fact IDs in the protected pin readback. One validated sidecar subject selected only the approved profile. Its bootstrap passed 10 cases and nine assertions, preserving both required profile hashes.

Both full registered profiles were present in the committed bundle. One selecting scope, policy, review selection, account grant, prepared review, intent/request and A5 import selected the approved profile. Its version-1 target contains only its USD 300000 invoice, customer, account and configuration, with exact 0→300000 receipt and one strict initial financial origin. The logical initial authority read active at epoch 1 with empty physical authority head and command tables. No other account was granted a scope, target, metadata, receipt or origin. One lane initialized at finance 2 and semantics 0. Capture persisted both raw seq3/4 payments without changing non-capture state or either selecting catalog. Exact replay preserved all capture and activity state too.

The private evidence retains safe source and authored input inventories for primary, fresh and failure attempts. Before publication, after proof and after capture/replay inventories were compared while files still existed. Each successful fresh attempt preserved its own deterministic input bytes and matched the primary's corresponding inputs. Post-composition failure exercised real financial work and a live worker, preserved the exact sentinel, and observed namespace, root, listener and both app-pool cleanup. No bootstrap or A5 completion was credited to the deliberate failure.

| Source | Released lines | Final lines | Added | Deleted |
| --- | ---: | ---: | ---: | ---: |
| `tests/fixtures/sync-selection-bundled.ts` | 0 | 375 | 375 | 0 |
| `tests/fixtures/sync-selection-evidence.ts` | 0 | 102 | 102 | 0 |
| `tests/integration/sync-selection-baselines-fixture.test.ts` | 772 | 695 | 12 | 89 |
| `tests/integration/sync-selection-bundled-fixture.test.ts` | 0 | 739 | 739 | 0 |

The shared filesystem, safe output and two typed outer measurement helpers reduce the accepted baseline suite by 77 lines. Adding the 102-line helper costs 25 lines before reuse. The bundled suite now calls those same helpers, avoiding a second copy of approximately 77 lines for an estimated net reduction of 52 lines against two inline implementations. Its 739 lines exceed the original rough suite estimate because the complete two-database catalog, authority, pin, capture, cleanup, and independent financial checks remain scenario-local. No second copy of the enrollment, reviewer or A5 lifecycle was introduced.

## Observed transport and authored input sizes

Framed requests use schema-normalized UTF-8 JSON plus one LF. Context uses UTF-8 JSON plus one LF on the private pipe. The returned object size excludes LF and measures reserialization of the parsed object. Raw wire output bytes and individual nested child sizes and timings are unobserved. Outer financial and bootstrap evaluator deadlines remain 120,000 ms. Each nested financial/bootstrap runner uses the unchanged 10,485,760-byte cap and 5,000 ms deadline. The transport rejects normalized JSON plus LF, context, or cumulative stdout+stderr only when its corresponding count exceeds the cap. The same-run completed mandatory reports and unchanged enforcement are the nested compliance evidence. No extra evaluator run or private telemetry was used for measurements.

The shared PDF was 1,351 bytes. The visible set includes two API originals and four indexes. The private author JSON and all originals have path/hash/byte-length entries in the before-publication files below.

| Suite / attempt | Stage | JSON request B | Framed request B | Framed context B | Returned object B | Outer ms | Pin or sidecar B |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bundled primary | financial-probe | 14942 | 14943 | 560 | 936 | 626.6 | 29696 |
| Bundled primary | financial-launch | 15948 | 15949 | 560 | 3397 | 12378.3 | 29696 |
| Bundled primary | bootstrap | 15414 | 15415 | 983 | 15748 | 2046.9 | 1331 |
| Bundled fresh | financial-probe | 14942 | 14943 | 560 | 936 | 619.1 | 29696 |
| Bundled fresh | financial-launch | 15948 | 15949 | 560 | 3397 | 12337.5 | 29696 |
| Bundled fresh | bootstrap | 15414 | 15415 | 983 | 15748 | 2103.1 | 1331 |
| Baseline primary | financial-probe | 13799 | 13800 | 560 | 960 | 618.7 | 31383 |
| Baseline primary | financial-launch | 14756 | 14757 | 560 | 3298 | 6456.6 | 31383 |
| Baseline primary | financial-probe | 14556 | 14557 | 560 | 960 | 615.5 | 34255 |
| Baseline primary | financial-launch | 15513 | 15514 | 560 | 3298 | 6565.8 | 34255 |
| Baseline primary | bootstrap | 14255 | 14256 | 989 | 15014 | 2150.0 | 1291 |
| Baseline primary | bootstrap | 15012 | 15013 | 989 | 15014 | 2082.7 | 1291 |
| Baseline fresh | financial-probe | 13799 | 13800 | 560 | 960 | 620.4 | 31383 |
| Baseline fresh | financial-launch | 14756 | 14757 | 560 | 3298 | 6386.2 | 31383 |
| Baseline fresh | financial-probe | 14556 | 14557 | 560 | 960 | 618.8 | 34255 |
| Baseline fresh | financial-launch | 15513 | 15514 | 560 | 3298 | 6392.7 | 34255 |
| Baseline fresh | bootstrap | 14255 | 14256 | 989 | 15014 | 2067.9 | 1291 |
| Baseline fresh | bootstrap | 15012 | 15013 | 989 | 15014 | 2084.0 | 1291 |

## Retained evidence inventory

Paths are relative to the variants SDD workspace. Initial diagnostic and corrected run artifacts are distinct.

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `evidence/task-2/run-task-3-extraction-candidate-2/failure-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/failure-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-task-3-extraction-candidate-2/failure-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-task-3-extraction-candidate-2/failure-cleanup.json` | 622 | `2d7297fd0eb4a3e3126fcf33658a318ad1814aeba054b0fd59e441f4a0bb9501` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-cleanup.json` | 622 | `e20a55050a8d64ca1dac6191dcbdf328b3dab7cb1bd52cf915235928b5897541` |
| `evidence/task-2/run-task-3-extraction-candidate-2/fresh-proof.json` | 26501 | `fe0fd46e0832fb1b1c241d31aa44caa94739b468abee2cfb95c4ef4dae35e3e7` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-after-capture.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-after-proof.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-after-replay.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-before-publication.json` | 3714 | `81aea82a1f4dccec9b7545962e2e08366f9d1d4eb1b437fdbae147128098683f` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-capture-and-replay.json` | 3557 | `f56a8609826bce6bef77a70dae65857d7d9f63d32db2a7575e801c1281212cf9` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-capture-input-new.json` | 2224 | `ea805067edb535adf857239a7a36b5eb5c5f6ce5e8d47d297fee6191ec6774ce` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-capture-input-old.json` | 1993 | `1bd0f9a9a91828d6cbc4ed6cfa6be47225f8ab1da32d00a8c6c6f6f0595bf558` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-cleanup.json` | 622 | `305f8b6fa01cc0ecfa9c2dccbcddcbd434a025b9f49e50ba0364ea28db68d8f3` |
| `evidence/task-2/run-task-3-extraction-candidate-2/primary-proof.json` | 26489 | `23f6e96e3f22157c1025e11d93ebe7a93debc713944f1f597b324773c7b52e96` |
| `evidence/task-3/baseline-extraction.log` | 1113 | `3fd52d2b5a87cc3b474c8f20fac97741aba7319f9dde7b57b56cf61964127e0e` |
| `evidence/task-3/bundled-first-safe.log` | 1283 | `169a65df95d1c31e87c50a51bec60827aaae5568005734099ff09b255ead19fb` |
| `evidence/task-3/bundled.log` | 1113 | `67aabb1456a1a22fe53ab599e89971c3885478a1ffac1fe8c124555c5ed5569d` |
| `evidence/task-3/run-bundled-candidate-1/failure-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-1/failure-cleanup.json` | 641 | `464c4e212c1300fae5597853a5538b4130dbf9a349b0701a55e41546f79a410d` |
| `evidence/task-3/run-bundled-candidate-1/failure-financial-before-sentinel.json` | 1225 | `a5d8edecd40ae0a67b61358b001f747b5dfaa2e7111c3b496e91d66f24866943` |
| `evidence/task-3/run-bundled-candidate-1/fresh-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-1/fresh-cleanup.json` | 641 | `7fd7b91239bff7de083c705b829f30d52e4e3e713eab4e15da9ca74ff251f79b` |
| `evidence/task-3/run-bundled-candidate-1/primary-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-1/primary-cleanup.json` | 641 | `61a9840d717062ebb052cab5482eea2006a4d80e447418e546360354f3c09cc8` |
| `evidence/task-3/run-bundled-candidate-2/failure-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/failure-cleanup.json` | 641 | `1a4731ee831d802eec63f2b8b98c586b43851378ec9f35bb536fb75db39dd010` |
| `evidence/task-3/run-bundled-candidate-2/failure-financial-before-sentinel.json` | 1234 | `16e6c0dd96cbb241f5e8dacf1e9bd892747e5d62a49481af9b3b6fa16e0bacf8` |
| `evidence/task-3/run-bundled-candidate-2/fresh-after-proof.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/fresh-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/fresh-cleanup.json` | 641 | `22a13920e8ac0792510629e41c85d2848ca72654b698a0d621d37095ef1f3354` |
| `evidence/task-3/run-bundled-candidate-2/fresh-proof.json` | 12393 | `7c94efde69086961843281ca6d149cc6c2bc433d2a3f26653bd7b6f5cacc6fca` |
| `evidence/task-3/run-bundled-candidate-2/primary-after-capture.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/primary-after-fresh-construction.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/primary-after-proof.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/primary-after-replay.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/primary-before-publication.json` | 1567 | `4e469bfb2a2606834f81a0d0dcf9d733ef29fb6964a80dbad1382a06f19aad1e` |
| `evidence/task-3/run-bundled-candidate-2/primary-capture-and-replay.json` | 5942 | `f13a663487ed12ffe12183d4f496234899c2ba906f35632481f0448166900e81` |
| `evidence/task-3/run-bundled-candidate-2/primary-cleanup.json` | 641 | `3bcf2df8b5c0e8acf3ba8738b671849b5f9757172cd5f837a1ff28a1483f3bf3` |
| `evidence/task-3/run-bundled-candidate-2/primary-proof.json` | 12381 | `d5ab3a9d059ee666275db72354019bd80ffe5a32e1290172e93b2d6e3448fdc0` |
| `evidence/task-3/source-after.json` | 20439 | `fba44ab225efc39db3183b1c6e9d234766065ee3a19a7c3543003573780a37c6` |
| `evidence/task-3/source-before.json` | 20188 | `0c2f5faa565e429231b1dc45ac44bb02f60f48a7a7485320445fb01f77107872` |
| `evidence/task-3/source-comparison.json` | 1291 | `6c4f13ff53f7d82b2fa9b7ad5d75cb6c2ec9becdee9535c10bb03620bd42fe9d` |
| `evidence/task-3/source-inventory.py` | 2735 | `3ef805dd469c549f4aa5fe9eb400f846a0e899b2f2e1550faeb98746235531fc` |
| `evidence/task-3/source-pre-run-oracle-diagnostic.json` | 20439 | `6688cacce70232407059b5f0c8599642af6766943710a94f97421f7af44fd654` |
| `evidence/task-3/source-pre-run-type-diagnostic.json` | 20439 | `86b33e250413182ef49c4ed43ab0b2161cafd65807eed92392a97a4515b4c980` |
| `evidence/task-3/source-pre-run.json` | 20439 | `fba44ab225efc39db3183b1c6e9d234766065ee3a19a7c3543003573780a37c6` |
| `evidence/task-3/typecheck-before-oracle-fix.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
| `evidence/task-3/typecheck-first.log` | 332 | `f19bbaad99161ff2a427c6d47294907746ed86eea7786f21ba4c8a04bacda7a5` |
| `evidence/task-3/typecheck.log` | 29 | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` |
