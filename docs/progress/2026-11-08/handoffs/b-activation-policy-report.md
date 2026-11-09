# A2 activation policy and publication implementation

- Branch `codex/activation-policy` in `/Users/devincheng/.codex/worktrees/acquisition-sources/EnterpriseAgenticPaymentResolution`.
- Initial base `f7e95d4748899b8bca091b7c2a7f41d58019c532`. After the transport step `97fdd85`, integrated the accepted A1c candidate from main `dbda6725eb21328871089b28c3da0e7d6af8b0a0` with the root's authorization. Exact A2 candidate `bc272a5127af0e288cc46ae7617f00de5ffee244`.
- Assigned files only in the diff against accepted main. The storage policy package subpath exports only the reader. Its private bounded file helper supplies the operator installer. The scope registry reader takes `registryRoot` pointing at `.local/artifacts` and loads `activation-registry/current.json` once per snapshot.
- The operator setup uses the accepted real capture reader and actual persisted financial provenance. It verifies a correctly hashed singleton policy per selection, checks the complete immutable subject and revalidates the capture, descriptor and fixed builds before publication. The operator scope-only mode has no proof dependency. Policy preparation writes immutable candidate history. Explicit install atomically replaces the operator current file.
- Bundle publication takes an injected committed-intent reader and checks the exact intent ID, canonical bytes, hash, request and reviewer before publication. Its transport tests use the committed-intent seam. Future A4 owns control008 and real transaction/recovery integration.

## Focused machine verification

Use the activation-policy worktree. Node 24 and PostgreSQL 18 were on PATH. The isolated lease used `EAPR_PG_PORT=55434`, `EAPR_TEST_PREFIX=eapr_test_review_t1`, `EAPR_DEMO_NAMESPACE=eapr_review_t1`. Reserved HTTP ports were control `3201`, worker `3202`, and web `5175`. These focused checks used PostgreSQL and fixed local evaluator children without starting HTTP services or configuring a model client.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55434 EAPR_CONTROL_PORT=3201 EAPR_WORKER_PORT=3202 EAPR_WEB_PORT=5175
export EAPR_TEST_PREFIX=eapr_test_review_t1 EAPR_DEMO_NAMESPACE=eapr_review_t1
npm run typecheck
npm run test:unit -- packages/storage/test/activation-policy.test.ts packages/storage/test/activation-registry.test.ts packages/contracts/test/activation-authority-hash.test.ts packages/contracts/test/activation-bundle-v2.test.ts packages/contracts/test/v3-hash-compatibility.test.ts
npm run test:integration -- tests/integration/activation-policy-setup.test.ts tests/integration/activation-publication.test.ts tests/integration/bootstrap-fixture-setup.test.ts tests/integration/financial-attestation-registry.test.ts
node --import tsx scripts/prepare-activation-policy.ts
git diff --check
```

- Typecheck and diff check passed. Unit suite passed 20 tests in five files. Integration suite passed five tests in four files. The CLI with no arguments exited 1 with `ACTIVATION_SETUP_REQUIRED` as expected.
- Native setup integration registered real metadata-bearing A and B captures, validated reviewed descriptors against protected evidence, and stored genuine fixed-child financial completions. It exercised alternate evidence pins on the same capture and rejected a report valid for another entry in the same candidate policy. It also rejected foreign profiles and descriptors, missing and stale proof, failed provenance, unattested legacy reports, and a self-hashed forged report inserted into test persistence. The test installed in an isolated temporary directory, independently loaded matching policy snapshots, read the registered scopes, and verified unchanged runtime table counts.
- Storage and transport checks exercised canonical decoding, symlink and configured-path handling, private modes, immutable collisions, truncation and size bounds, stale locks, overlapping publication with retry, historical members, recovery from a publication failure with identical bytes, and old bundle reads through policy rotation. The configured-path regression failed before the loader was changed to open the same normalized path it checks.
- Auto-review declined a proposed CLI negative-argument smoke check because the command line contained an install flag. That invocation did not run. The isolated integration install and the no-argument CLI smoke check covered the authorized paths. The production current policy path was absent after verification.

## Build and remaining acceptance

The narrow storage exports alter the financial fixed closure because it includes `packages/storage/package.json`. It changed from `7019df51b13dd65fa6a4757cffff1cf325c9f88b536cd527d62fc027703b1ede` at accepted A1c main to `c5140fb37a4deffc8f8183b64cc8fbfd2fcc6d9bdf14b892eb6b622619684c6e` in this A2 candidate. The bootstrap evaluator and subject closure hashes remained `e81ebd3f7d03baa2c0adcf5509be98432816abb89cd5f0c187a413a56c24c586` and `ee7eecf0c88218b8c74198a0abd02b6401a355fe0d03f57b725dbcce7bd1aa34`.

Fresh production financial verification and explicit operator preparation/install follow stabilization of the final source closures. Independent control and worker startup loading, authenticated parent reads, target-bound bootstrap readiness, durable intent integration, and runtime authorization are downstream. This report records focused machine evidence. Exact-candidate independent review and joint user acceptance remain separate.
