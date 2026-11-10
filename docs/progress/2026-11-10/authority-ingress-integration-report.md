# Task 4 authority ingress composition and HTTP/A5 evidence

- Branch: codex/platform-authority-ingress
- Exact accepted base: 8541b9bcf241364a6f2d12892647d2d250c9339a
- Composition: 1b2f35d075c39811bc678529e381a98d39cce421
- Candidate: d8e2833b4e8d0004052074df6c82d9797705779b
- Plan SHA-256: eff819287185eb750733329648b057e1f4f45500e8648a44e64f21fda29711a7
- Design SHA-256: 53b42ecc85ece726742e76745d20341da0e65e10964a1a4e60b68e0710be1edd
- Node 24.22.2, PostgreSQL 18.6, Vitest 5.1.0. Serial root lease used PostgreSQL 55441 and the review-t2 disposable namespace prefix. Control reused its leased loopback port 3241 and worker/test relay used ephemeral loopback ports. The combined existing suites also used the leased 3242 worker and 5182 web-origin settings.

## Delivered and verified behavior

- Local composition uses the existing reviewer session and mounts authority separately from candidate registration, policy, verification and parent overview. The option-absent path reaches real session checks and returns authenticated 503. The supervisor generates the separate admission bearer and sends it only to control and worker. The source/service/admission capabilities are checked for pairwise distinction without printing values.
- The two committed A5 subjects were produced by unchanged protected proof issuance, real reviewer prepare/approve HTTP and the actual worker activation transaction. The test checks both independently reconstructed approved targets using the unchanged verifyOriginals helper. Company B's separately captured second original agreement supplies a genuine third candidate, registered and published but never approved/imported. The positive read compares the full stored identity and pins. Published-only and missing imports return 404. Owner-only digest corruption returns 503 and restores the original digest.
- Control, worker and callback traffic used actual loopback listeners and accepted HTTP clients. Tests cover authorization before parser/framework diagnostics, forbidden credentials and injected headers, session/Origin/CSRF, grant denial without saved disclosure, distinct callback bearer, live binding and old ticket after restart. Control options, policy/registry/evaluator files and scoped source outage were tested independently. Authority remains available for read/pause/revoke/no-op/replay where specified, changed paused-to-active resume needs source semantics, and overview output bytes are identical at the same committed state.
- Per-request SQL checkout/transaction traces surround real admission and source fetch entries, proving client release and zero runtime SQL overlap. Read, fresh pause/resume, exact entry replay, callback failure and failed-observation winner recovery assert their specific orders. A disposable owner-installed one-shot SQLSTATE 40001 activity trigger forces rollback and a fresh scope lock without new admission. A terminal SQL activity error also rolls back head/audit/event/counter and the later exact retry commits once. Temporary owner fixtures and SQL trigger/function/sequence are cleaned up.
- Simulated permission changes use a wrapper around the real local session authorization. Required account/source loss, changed reviewer/session, and a fresh empty session service deny admission or recovered-winner disclosure. Unrelated grant changes retain permission. No product session mutation/revocation endpoint was added. The socket-abort test waits for real callback authorization to be in progress and observes the control transport cancellation before allowing it to return. A separate test changes the session after successful final admission and shows the short admitted SQL transaction can commit, while a later request sees the denial. This is not instantaneous or cross-database session revocation.
- A one-shot relay at the browser boundary consumes the actual successful control response after worker commit and destroys the downstream socket before returning headers. Fresh same-reviewer session recovery returns the byte-identical canonical result and retains the original audit session. A separately authenticated reviewer conflicts. The historic pause replay remains paused after revoke while GET returns the revoked current state. Duplicate delivery, stale epoch, occupied-key action/body change, no-op timing and activity, revoked status edges and maximum safe epoch are pinned. Original activation/receipt/import and all ten parent financial/metadata/snapshot/delivery and lineage tables are unchanged, as are the relevant control review and activation tables.
- The fixture checks observed credential values against public output, captured logs, activity and authority JSON in memory. It also checks that audit session IDs stay out of public output, captured logs and activity while remaining in the runtime audit. The initial capture probe falsely failed by inspecting raw Fastify log arguments that contain socket/request/reply objects in memory. The final child logger sink projects the same-raw-socket framework req/res records to method/URL and status code, the relevant safe subset of Fastify's actual logger-pino serializers. It retains other arguments for inspection and asserts actual log entries exist. This checks those captured surfaces in the fixture and does not claim coverage for alternate logger configurations or arbitrary object serialization. No credential values were printed.

## Commands and evidence

Behavioral red before composition was wired: npm run test:integration -- tests/integration/authority-ingress.test.ts exited 1 with one executed case. Both A5 imports and a real session succeeded, then the authority GET returned 404 against expected 200. An earlier bad fixture namespace was a setup error and is not the red evidence. The retained behavioral run is task-4-red.log. First wired run recorded two integration passes in task-4-first-green.log. The 26-case focused run is task-4-working-http.log. An earlier combined log retained as task-4-integration-before-log-projection.log shows four existing files passing and the raw-object sink issue in the new file; the final safe projection run supersedes it.

| Command | Exit/result | Exact HEAD log |
| --- | --- | --- |
| npm run typecheck | 0 | task-4-head-typecheck.log |
| npm run test:unit -- packages/contracts/test/authority-ingress.test.ts apps/control/test/authority-worker-client.test.ts apps/worker/test/authority-admission-client.test.ts | 0, 18 tests in 3 files | task-4-head-task1-unit.log |
| npm run test:unit -- apps/control/test/authority-ingress.test.ts | 0, 12 tests in 1 file | task-4-head-task2-unit.log |
| npm run test:unit -- apps/worker/test/authority-ingress.test.ts | 0, 10 tests in 1 file | task-4-head-task3-unit.log |
| npm run test:unit -- packages/contracts/test/current-authority.test.ts packages/evaluator/test/bootstrap-build.test.ts packages/evaluator/test/financial-attestation-build.test.ts | 0, 21 tests in 3 files | task-4-head-contract-build-unit.log |
| npm run test:integration -- tests/integration/authority-ingress.test.ts tests/integration/current-authority.test.ts tests/integration/source-semantics.test.ts tests/integration/activation-composition.test.ts tests/integration/local-composition.test.ts --disableConsoleIntercept | 0, 79 tests in 5 files, including 26 new cases | task-4-head-integration.log |

The five-file integration command also passed unchanged before commit without the console flag (task-4-integration.log). The exact HEAD flag retains the allowlisted source identifiers emitted by the fixture. No cases were skipped. The base-to-candidate range contains only apps/control/src/composition.ts, scripts/dev.ts and tests/integration/authority-ingress.test.ts. Both Task 2/3 server hooks, all predecessors, protected fixtures and migrations are unchanged. Git diff --check passed. Root's independent coordination-document edit was excluded.

## Source and schema identities

The final A5 fixture identities below are the public scope, source, artifact/profile/manifest pins and original activation/bundle identifiers for this run. Runtime binds all of them from the committed import. The published-only account is an alternate Company B account under the same genuine B manifest.


- legacy-a, scope company-a.seller-a.cust-a-3d81f7a948d8-1, manifest manifest-a-3d81f7a948d8-d4e83b7db551
  - manifestHash: 8446d5758430fd177d848384b631cf9a92861d4278a25d3f7466c8b151eed09f
  - artifactHash: 6256d7865a02dfeb34b2b34c5718e39ec43c72c450478b1a56ee4828e604e8fb
  - profileHash: fbd39c605cbfa0b342b4239d0b82210e372505c4cb9ca029d823d41c5733d54a
  - activationId: activation:a9431bf1-9260-4512-8d38-ec520c261363
  - bundleHash: 0149b5ae7df0e0b705680e57cca357a1aedca9ff9f511e037ccf112d3e985661
- legacy-b, scope company-b.seller-b.cust-b-3d81f7a948d8-1, manifest manifest-b-3d81f7a948d8-d4e83b7db551
  - manifestHash: 598a1e1c8ba73bee7e6e5abcf85612704acf5b43fe5ce09efa25c386625ef077
  - artifactHash: 63e17b5740fd399d0051e1d27c0120ee0ec0a4ca6b88fa67f0dce7d1da8e8dd1
  - profileHash: b9edf95f33fb8f9c1abe4da5d8dbfa25fefe42089422455f0f3935a506466d74
  - activationId: activation:be39980e-fb41-4fe9-bfcb-41ed7cfb4279
  - bundleHash: df198ac9bcf30b6be23833f3bed56bb2a7cdd38eb0f9c195bb4f2c2834923388
- Published only: company-b.seller-b.cust-b-3d81f7a948d8-2

Exact Git tree: a00fd76ef1b6e27ba305c67e83e3f90a6d5fa2c0

Applied migration catalog SHA-256 identities (unchanged in the task range):

- db/control/001_base.sql  b2f5e5ce3a689ecb1ccef3c51dd90db6485fffe33bcdffec6d94d2984f11284f
- db/control/002_sources.sql  3b8df852acf97a5fde560eb53329e974bd6f7914e531da2081117fd44a033fed
- db/control/003_artifacts.sql  2c996c8f7b87581f303762bdbef80abb6137d293c0d686268776b5d57b98a22c
- db/control/004_discovery.sql  5cbfbc573a337414d3e544aa3e70ceac4313db5dc08ff163d6012f6d433546fb
- db/control/005_bootstrap_verification.sql  ce373f832bd5cce6f77386411de423876a043807fee4a3763a9c8396e6188b31
- db/control/006_financial_provenance.sql  a01d43772e40e3c1a8d29425707fe5109d2a0db06c2adbfa5e04bebeee692e45
- db/control/007_discovery_construction.sql  f9c0883a6da0e5ae25c04c8fe566682c72e2acfcc9f22a88e2e0105a83b9f35b
- db/control/008_review_activation_intents.sql  956127c4414c86ab5ffe4bd630cabd333662fb61688af540a8b19184b97b0a54
- db/control/009_discovery_verification_requests.sql  5080b0c7cec1c0a6eb366aa650f01e87d50183d5de3fa490691bf0f8085c1ab0
- db/control/010_discovery_completion.sql  105774fbb6904ed34d116151a2f93edc3157034b581baca441093e25cace91f3
- db/runtime/001_base.sql  c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3
- db/runtime/002_parent_activation.sql  a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56
- db/runtime/003_sync_capture.sql  aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c
- db/runtime/004_current_authority.sql  f232c9e552362618e785cc0bb23e847e4d7f319e0c0fae9084fb9aebc98deab7
- db/runtime/005_sync_apply.sql  7c35563ed3504766153aa6b7706c4a448dd4c50f3f1d0203345525c215f3ef96
- db/runtime/006_sync_apply_repair.sql  3bad0cc496ff74aa4a480e9bdc5783a1f4fd2326401c4452ee3f8976558d6836

## Handoff

The owned suite disposed its temporary fixtures and databases. All three fixed HTTP lease ports are free. The shared PostgreSQL cluster remains running. Source and DB/port leases are released to root. No normal demo, provider, push, merge or V5/V6 run occurred. This is fixture machine evidence for bounded authority ingress. Fresh independent exact-candidate review, any mounted browser proof and joint acceptance remain separate gates.
