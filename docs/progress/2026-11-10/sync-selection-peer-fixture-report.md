# Task 1 report — fixed same-feed peer fixture qualification

Status **DONE** for focused machine qualification. Exact base `578624a43a85c3e9b2dfe20803330b4506f7e786`, committed candidate `cc78b73a075b90b5d53a086519542edcdeabaaa4`, branch `codex/platform-sync-peer-fixture`. Accepted fixture design SHA-256 `376de67a292f56add6d1a60b576537d4d046675acb3a218276abba3e93867fa3`. This commit adds exactly `tests/fixtures/sync-selection.ts` and `tests/integration/sync-selection.test.ts`. The fixture exposes only the runtime application pool, two stored subjects, capture and close. Scope is the fixed two one-profile Company A customers on one common vector.

## Focused checks

Node v24.22.2 and PostgreSQL 18.6. Ran under the released `EAPR_PG_PORT=55441` / `EAPR_TEST_PREFIX=eapr_test_review_t2` lease and supplied loopback ports. No other suite or provider ran. The first typecheck identified the Fastify close spy overload, corrected before integration. The prescribed focused integration command then passed all four tests (54.66s). Self-review added full literal target and exact completed-proof readback inside the fixture. The strengthened candidate passed typecheck and one focused integration run with Vitest console summaries enabled.

```text
$ node --version
v24.22.2
$ pg_config --version
PostgreSQL 18.6 (Homebrew)
$ npm run typecheck
> typecheck
> tsc --noEmit
exit 0
$ npm run test:integration -- tests/integration/sync-selection.test.ts -t 'same-feed fixture qualification' --testTimeout=180000 --hookTimeout=180000 --silent=false
stdout | tests/integration/sync-selection.test.ts > same-feed fixture qualification > both subjects pass real producers and separate reviewer imports
Original input inventory SHA-256 b12ee60cd2ebb6bff26379cfea27287c0435ba834d6cd0b13e715b9d5aea2fea
Qualified peer {"accountId":"company-a.seller-a.sync-selection-one","manifestHash":"7abd307e984a3938d2a3ba275294154b56c9e61a6b034f85b4f73d4df0498334","artifactHash":"1575160017739976a5525f4c6f7ca4f3370ad200bb3a707f084257aac55cbbdf","profileHash":"abc64547c43f6004a92b640f2c6db6c87e60781ea8ad7d4117526efbc0be0490","reportId":"report:sync-selection-financial:one","reportHash":"afa3f13784175a17d60ae7bcc750bb36af2898b5e10f5d29460fdf38c1c8f2d2","financialAttestationHash":"4b95dc4a5e7114f4cee7400c330741084d968804e45256d8d47a1c73bd3998e9","financialChecks":13,"bootstrapResultId":"bootstrap-result:2904a218-67c7-468c-a725-73082d802f36","bootstrapResultHash":"09a8e8acadeeb37a75b431fdbcfa2226c43db78f0a3b1f0650b05b5b6f4426f7","bootstrapCases":10,"bootstrapAssertions":9,"reviewPackageId":"fd9fdd7f-6fc8-4060-82fb-c0f72b81c753","requestKey":"sync-selection-approve-one","activationId":"activation:bbbb9ba0-c252-492e-897c-d9bae5629f0a","bundleHash":"75a3bb110ea9b07596d030ebef22c800b614fcd8d37e427cfe67a30862281212","receiptId":"receipt:15625b63-07c9-4948-a653-a9758511c8b3"}
Qualified peer {"accountId":"company-a.seller-a.sync-selection-two","manifestHash":"7abd307e984a3938d2a3ba275294154b56c9e61a6b034f85b4f73d4df0498334","artifactHash":"96abe70a18080c69ff8c58903a597019ebe23b8eee395501deae76381c39526c","profileHash":"1df49d3e1f369bfb0046fd00c733879e26a348a1b546dfe1708694c1e2439fd6","reportId":"report:sync-selection-financial:two","reportHash":"e8801098e1a3cd98e7c2d1afd00dc7961d15713f076cd03580e0e04a9ba37403","financialAttestationHash":"b56192c223ca6877addbfe227a553ddc398af36066398920a616b8df51195128","financialChecks":13,"bootstrapResultId":"bootstrap-result:08f9ea1b-b20c-4e86-99bf-b7d83686e63f","bootstrapResultHash":"1e864ba7553f932803c9496a8b8dbd11b68969fff3b5b2b6e739b2639d371a4d","bootstrapCases":10,"bootstrapAssertions":9,"reviewPackageId":"d468e4b7-c1c0-45ae-a19e-ff992cd1ca8e","requestKey":"sync-selection-approve-two","activationId":"activation:9d7e9fb0-4b31-4742-9dfc-2b758f9e2154","bundleHash":"965f80b964d1f41ea1e9996fff8e28082fb413a266d63f022dcab9737e9093e4","receiptId":"receipt:d7bb9f21-10b3-4ce9-b1c5-3b5c67b12e55"}

Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  05:40:55
   Duration  54.84s (tests 99%, import 1%)
exit 0
```

- Both exact registered artifacts held one profile each and the same complete two-event capture. Both real financial reports were eligible with zero unexplained cents, all 13 required checks executed and passed with cases, and all five financial kinds covered. The completed attestation matched each durable bundle and actual capture binding.
- Both authenticated reviewer preparations executed protected bootstrap. Each passed all 10 required cases and 9 assertions with the actual selected profile, sidecar and first-import plan. Two separately approved intents produced two A5 receipts. The second scope had neither stored activation nor target between the two reviewer actions. Each version-1 target contained the full literal metadata and its own September invoice, zero other financial records, and a 300000-cent balance. Each receipt moved its own balance from 0 to 300000 and its initial origin matched its own request key and receipt.
- Both approvals opened one capture lane with the first activation as initializer, finance baseline/capture 2 and semantics baseline/capture 0. The two sequence-3/4 payment events advanced shared finance progress to 4 with two records and one page. The second subject replayed the same page, with zero newly captured records. Replay preserved all capture/activity rows and both calls preserved parent, approval, origin, authority and P1 state. Both original target balances remained 300000.
- The pass-through observer independently compared all ten pre-publication input paths, lengths and hashes after approvals and after capture/replay. A second genuine construction used a fresh namespace and root with equal original bytes and passed the same proof/import assertions. The failure attempt reached real worker listener and review composition after real financial work. It preserved the exact injected Error and observed completed listener and pool closures, one awaited owned namespace drop and absence of the temporary root. Normal primary close succeeded twice.

## Protected and source inventory

The pre-edit and post-run ordered inventories matched for 83 files and two absent roots. The aggregate SHA-256 is `4c7f411e770a10200f9e749ab5cc809ddf39b34b471f47c613ca89f921f05128`. The absent roots were `.local/activation-policy` and `.local/protected-bootstrap`. In-suite checks also compared the pre-existing protected paths after successful and failed construction. No protected contents were retained. Key path and candidate digests were:

```text
d223602dfb3e6c364a1f9208d1a5d1203e4c5b80f48aae357bad230c9eca9fcb  tests/fixtures/activation-proof.ts
422b8f44035f7aac043d79f646dc40363facbc74fde9a951dc159b0308d4ffee  tests/integration/sync-capture.test.ts
044fac269f20367707ea9b2120abd7d5dd711488d503187153da75d34e23d164  scripts/generate-fixtures.ts
33876ee4d2e88cc96bc319c74d088630800795d47b6fc6fa95db683dff0d70aa  package-lock.json
fb5933e7dcff9d4ce1b834044d5e26accb07af6db4fb402b2ca6d7faacdb4708  tests/fixtures/sync-selection.ts
b93c164da6cc27c3c6f452e8ac67042016d8a407af813a810c06140893b5b8aa  tests/integration/sync-selection.test.ts
```

Self-review confirmed the scoped commit, preserved literal inputs, independent readback, no generated truth rewrites, and no selector, P1 writer, provider or original demo action. No unresolved fixed-peer execution gap was observed. Cross-stream and the later audit variants remain outside this qualification. The source and DB/port leases are released to root. Independent exact-candidate review and joint acceptance remain separate.

## Controller evidence retention note

The original ordered 83-file/two-absent-root inventory was kept in memory, as the task allowed. Its matching digest and comparison outcome are recorded above, but the original per-file map was not persisted and is unavailable in the implementer follow-up session. It cannot be independently reconstructed as historical evidence from this diff. No new inventory is substituted. The exact two-file-only Git change and the in-suite before/after comparisons remain separate evidence. Future fixture tasks must save safe path/hash inventories.
