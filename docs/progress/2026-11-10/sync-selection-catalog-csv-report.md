# C2 genuine CSV catalog fixture qualification

- Released base `213d4f8a2389cffc24ef77562e3b5085569c8a0b`. Exact candidate `15b003b4a4bd57eedd7f0090c85868d2368d19b0`. Immediate parent `b0427c6308a37eeffc4f1908a66db44595fa68ae` is the intervening root documentation-only commit. Stable source inventories exclude any source delta from that commit.
- Plan SHA-256 `51bdb43293e0d7a0745d0874798ac09ba10bb72cd7469d715d6f118b7d024260`. Design SHA-256 `17ce1b1d1c5d9e0c155a70e3da6a916132f0ac22ecda1a1b8e55f9efeab6e49c`.
- Node v24.22.2 and PostgreSQL 18.6. Released test lease port 55441. Shared cluster left running.
- Source reservation comprised exactly the two new C2 files. Scope of review is fixture admission only. Fresh exact-candidate and whole-plan reviews are root-owned.

## Commands and results

- `npm run typecheck` exited 0 on the final source.
- `npm run test:integration -- tests/integration/sync-selection-catalog-csv-fixture.test.ts -t 'csv catalog fixture qualification' --testTimeout=180000 --hookTimeout=180000` exited 0. One file, four cases executed, four passed. The allowlisted log filter and writer also exited 0.
- `git diff --cached --check` exited 0 before committing the final candidate. The scoped commit contains only the two reserved files.

| Case | Result |
| --- | --- |
| real B proof review and CSV-bearing first import | Passed |
| only B is enrolled and original CSV remains immutable | Passed |
| fresh B construction preserves all inputs | Passed |
| partial B construction releases owned resources | Passed |

The earlier typecheck failed on the full upload metadata argument and stat narrowing. The earlier integration run executed all four cases and returned 2/4 because the new test expected an envelope path for financial lineage. The immutable B connector uses payload-relative `/amount_minor`; only the qualification assertion was corrected. The failed candidates were preserved before edits. No unchanged-producer rejection occurred.

## Actual qualification

The one primary and one fresh attempt each read both genuine complete A/B financial reports through the registry. Only the selected B profile received reviewer grants, an authenticated prepared package and intent, selected bootstrap result and real worker A5 import. Runtime and control selecting inventories exclude A. The failure attempt completed both real financial reports and sidecars, then failed at the exact post-composition sentinel with the worker live, before selecting bootstrap, prepare, intent or import. The persisted cleanup records show listener and application-pool shutdown, removal of the owned namespaces and roots, and idempotent primary close.

All 66 visible/truth originals per attempt were inventoried before the first publication. Successful proof/readback and pre-cleanup phases retained the same bytes and hashes. Both generated company inputs matched between fresh and primary roots. The exact committed 18/10/0 baseline included three original six-row CSV batches. Each decoded row was compared to the actual capture, and every selected invoice and allocation matched its genuine batch. The independent literal target and initial origins support the exact nine-event B receipt and 0 → 0 balance.

## Source size and inventory

| Reserved file | Lines added | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `tests/fixtures/sync-selection-catalog-csv.ts` | 193 | 13502 | `5adfb391b2eddc91010dd712f46f62278a741e87199e4e9aca462fdb37c835bf` |
| `tests/integration/sync-selection-catalog-csv-fixture.test.ts` | 866 | 56088 | `6043f9d900f5940c422d6524e1db447585d40e79c90861a86974081951bf600a` |

The total tracked delta is 1,059 added lines across two files and zero deletions. This exceeds the rough design estimate, with concrete qualification code for independent literal/proof/CSV assertions, all resource and evaluator observations, durable checks and persistent evidence. No reviewer approval chain was duplicated. Each run comparison records exactly the two authorized additions from source-before and zero stable pre-run/post-run differences.

## Measured outer boundaries

| Attempt | Construction ms | Stage | Job | Framed request bytes | Framed context bytes | Parsed response JSON bytes | Outer ms | Evidence pin / sidecar bytes |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: |
| primary | 18731.2 | financial-probe | `activation-policy:a:first` | 41358 | 548 | 938 | 654.6 | 156660 |
| primary | 18731.2 | financial-launch | `activation-policy:a:first` | 42287 | 548 | 3242 | 6452.4 | 156660 |
| primary | 18731.2 | financial-probe | `activation-policy:b:first` | 40697 | 548 | 938 | 636.9 | 142877 |
| primary | 18731.2 | financial-launch | `activation-policy:b:first` | 41626 | 548 | 3242 | 7021.5 | 142877 |
| primary | 18731.2 | bootstrap | `a9b55d16-a2bb-44ed-ad06-43313fbd2b81` | 41187 | 980 | 56563 | 2198.1 | 1296 |
| primary |  | actual prepared sidecars A / B |  |  |  |  |  | 1296 / 1296 |
| fresh | 19031.9 | financial-probe | `activation-policy:a:first` | 41358 | 548 | 938 | 632.3 | 156660 |
| fresh | 19031.9 | financial-launch | `activation-policy:a:first` | 42287 | 548 | 3242 | 6568.7 | 156660 |
| fresh | 19031.9 | financial-probe | `activation-policy:b:first` | 40697 | 548 | 938 | 807.5 | 142877 |
| fresh | 19031.9 | financial-launch | `activation-policy:b:first` | 41626 | 548 | 3242 | 7100.3 | 142877 |
| fresh | 19031.9 | bootstrap | `e30b62ba-42e7-406c-b2e4-f324db5cb43f` | 41187 | 980 | 56563 | 2258.0 | 1296 |
| fresh |  | actual prepared sidecars A / B |  |  |  |  |  | 1296 / 1296 |
| failure | 16277.9 | financial-probe | `activation-policy:a:first` | 41358 | 548 | 938 | 661.8 | 156660 |
| failure | 16277.9 | financial-launch | `activation-policy:a:first` | 42287 | 548 | 3242 | 6549.1 | 156660 |
| failure | 16277.9 | financial-probe | `activation-policy:b:first` | 40697 | 548 | 938 | 663.0 | 142877 |
| failure | 16277.9 | financial-launch | `activation-policy:b:first` | 41626 | 548 | 3242 | 7039.9 | 142877 |
| failure |  | actual prepared sidecars A / B |  |  |  |  |  | 1296 / 1296 |

Requests and launch contexts are UTF-8 JSON plus one newline. Response figures are serialized parsed success values. Raw wire response size and individual nested invocation size/time are unobserved. The unchanged transport rejects framed input, context or combined output greater than 10,485,760 bytes and uses an outer 120,000 ms deadline and nested 5,000 ms deadline. Financial registry rejects canonical bytes at or above 10,485,760 bytes. Complete reports from the same unchanged-enforcement run support compliance separately from measurements.

## Persisted safe artifacts

Paths are relative to the worktree. Each artifact was hashed after the run. Protected originals, truth, payloads, headers, credentials and sidecar contents are excluded.

| Artifact | SHA-256 | Bytes |
| --- | --- | ---: |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/failure-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/failure-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/failure-cleanup.json` | `a4e65578918a378b2a62fbcaa62befe0be76318b83032ea79b74c6c058084876` | 408 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/failure-financial-before-sentinel.json` | `ebe33ac34bc7c16a51ea0f9b1b77090cdb14dfae38944dddacbd9a338044146a` | 8309 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/failure-outer-measurements.json` | `9142b2e9ae615690c3a576d477f9f3b3e3366513248a23ce55249e52d893d2c6` | 3288 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-after-proof-import.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-cleanup.json` | `a689d3c215db8714c946b68236c4b6d034decc55f07a52a0787521af6b41a2d5` | 406 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-outer-measurements.json` | `1a76aee746ef17d61a0f7cab2f44f587dd1ab2db7b095247288afbb7c65c6422` | 3826 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/fresh-proofs.json` | `1583c5ca79bacb5cb788deef69dc74900993bd94857048c2c19bbb7cc7b57d87` | 16857 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/integration-status.log` | `1ec59fb50aba23c549d967f7c92b7c9a678c19c904757ba40a2f2291716817ba` | 54 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/integration.log` | `f39b90d2c2f4a4aa09bdb877bc59b2c9c5c37b598715cf9e39607736827e58c0` | 432 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-after-proof-import.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-after-readback.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-cleanup.json` | `dcea227e6c0ef69eb5c500138e7e174463945f36c9c1f333eaf054bd2065d9ea` | 406 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-outer-measurements.json` | `6320b876ed05606e2c88f7c6350e7c05153bbc1e3031aa6be896c7b6ee118bbc` | 3801 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/primary-proofs.json` | `e21c861fce3609182e8e81a131a6c107a44ce77e11ef314c2e76400821a89e63` | 16857 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/source-after.json` | `88b58f52f2c2bf0ef2e093568c613c116e3e95494bd14221f9d68554f906789d` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/source-before.json` | `3723e16a03b033d6aee57f595b011b2bed584f2915271d2ec888a841e19769c9` | 20277 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/source-comparison.json` | `d08cc4ce38211823a7f04ed00de69cccae68751fb5feed883e9ae5c3dc78d088` | 1058 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/source-pre-run.json` | `88b58f52f2c2bf0ef2e093568c613c116e3e95494bd14221f9d68554f906789d` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/typecheck-status.log` | `27defb71d02103d5ef7d007f4ba2a563e69e45834e417adda7c7cdf26435123f` | 17 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/typecheck.log` | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` | 29 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-LnPQZHPD/versions.log` | `6dcf0bf91c8e0a7aec17847deda584f9754c470c0a188a4020e8e368ac2ed152` | 45 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failed-source/fixture.ts` | `5adfb391b2eddc91010dd712f46f62278a741e87199e4e9aca462fdb37c835bf` | 13502 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failed-source/integration.ts` | `d4bcb9aac7197f94c9e15b594d40799ab54a55434371b316bc362a4d1a7dbaa1` | 56096 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failure-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failure-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failure-cleanup.json` | `fbf5e7d5c0251ea112ac02f0225743ec31545a3a160cd2a5b651c31c0250926c` | 408 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failure-financial-before-sentinel.json` | `21cfe8f40e47f77a5eaba0580070a32db5269285605aec2d6aabf4556aa87788` | 8309 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/failure-outer-measurements.json` | `308115eb501c0d7c270e88d6db9b0192168c70d22e035080a210bb13756732ac` | 3289 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/fresh-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/fresh-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/fresh-cleanup.json` | `cca9cd471f9819598bb68920210d28108ff6e01e2afc8951bcbe14972ba69d5c` | 406 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/integration-status.log` | `3f4d459613b222ae5b48217ab5f41d6f0d73b062c4209f4271b32aa25a35c0d5` | 54 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/integration.log` | `7bbeed1c42281ce6a2a3be9a02fde08edb320fd8aa689074b7b948c3c93bd7ee` | 1309 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/primary-after-readback.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/primary-before-cleanup.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/primary-before-publication.json` | `a1f858972920bfcc6062c0093cc9a6c81b5dac75b9e70d801752eafd2d244bbc` | 12814 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/primary-cleanup.json` | `404f8f8dd35a8d0b49c6aa78f35072c272adcd5937977a6fe0de9e9a1cd2a6fd` | 406 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/source-after.json` | `12f5976f1476f5a7ea557856f182c8c94462f87656da665a3a684f78b80c101e` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/source-before.json` | `3723e16a03b033d6aee57f595b011b2bed584f2915271d2ec888a841e19769c9` | 20277 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/source-comparison.json` | `3f63e33f04bef701797e7b6b6eeefb261e3c158e363ae69a535c85246bd2dbe8` | 1058 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/source-pre-run.json` | `12f5976f1476f5a7ea557856f182c8c94462f87656da665a3a684f78b80c101e` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/typecheck-status.log` | `27defb71d02103d5ef7d007f4ba2a563e69e45834e417adda7c7cdf26435123f` | 17 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/typecheck.log` | `8fa1cf5506304e8abac55868e7f1a136c9b1dde57a3981a382da4c21ea129a6f` | 29 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-Vo0pe8oi/versions.log` | `6dcf0bf91c8e0a7aec17847deda584f9754c470c0a188a4020e8e368ac2ed152` | 45 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/failed-source/fixture.ts` | `5adfb391b2eddc91010dd712f46f62278a741e87199e4e9aca462fdb37c835bf` | 13502 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/failed-source/integration.ts` | `462e34a003e06052145bdb2ef1235f45ecaf510c6584a96e42fbf7e8f163546f` | 55917 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/source-after.json` | `1108cab4d9e99472f64700f8db982008ee53470ecc13dc6979832373b9d3826e` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/source-before.json` | `3723e16a03b033d6aee57f595b011b2bed584f2915271d2ec888a841e19769c9` | 20277 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/source-comparison.json` | `bb6f5a21b6901f3ae91d6e6c5482fbdb2e0adc0ac2cc7f840b518df99b0164b8` | 1058 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/source-pre-run.json` | `1108cab4d9e99472f64700f8db982008ee53470ecc13dc6979832373b9d3826e` | 20445 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/typecheck-status.log` | `cc133cd2c5fa4e6ff63d09251a0adefcff4cfa8b1806a993159730e466d99f86` | 17 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/typecheck.log` | `0756bcdd76ed2336615d07a7e0422128eee34377cc9e932e9048782523160e6c` | 1125 |
| `.superpowers/sdd/2026-11-10-sync-selection-catalog-fixtures/evidence/task-C2/run-jysXgF3V/versions.log` | `6dcf0bf91c8e0a7aec17847deda584f9754c470c0a188a4020e8e368ac2ed152` | 45 |
