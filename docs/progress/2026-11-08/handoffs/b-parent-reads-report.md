# A3b registered parent reads implementation report

Branch `codex/parent-reads` in the acquisition-evaluator worktree. Base `fcbc0cf969bd965c115d07eb76ed250ea1f70d17`. Candidate `0c7a0955a0ca9faeed3febf2218e07c93d647ae1` (`feat: compose registered parent reads for local preview`). Worktree clean at commit. Machine results here are partial A3b read-only proof. Independent exact-candidate review and joint acceptance are separate.

## Delivered

- Normal startup mounts authenticated worker parent and activation GETs, scoped reviewer control proxies, and the real HTTP target adapter. The worker captures one real A2 index and validates its immutable members before querying runtime. Control checks source and account grants from its own captured safe registry and validates the full returned scope and recorded snapshot hash.
- Inactive latest reads project version zero at the registered manifest instant. Historical selectors only resolve persisted records. The evaluation instant affects the envelope balance and never changes the recorded snapshot. Activation reads preserve the stored paired activation and receipt across registry replacement. Both read paths use the existing SELECT-only parent stores.
- Control registers each compiled source-derived candidate before preview and independently of protected verification pins. Registration failures leave source inspection and the catalog mounted. Catalog refresh probes authorized scopes over authenticated HTTP and emits a safe diagnostic. The operator publishes exact scope selections with the separate A2 command. Production uses persisted-parent mode and the browser labels scoped parent records accordingly.
- Explicit empty-target fixtures remain only in the isolated local source and verification composition tests. Whole V2 and browser fixtures use actual A2 scope publication and worker HTTP. The existing parent-storage fixture moved into `tests/fixtures/parent-storage.ts` unchanged apart from exported helper names and imports. Its use in the new read tests is storage-only evidence for seeded paired facts. The isolated verification-upgrade fixture copies the actual type-only-linked worker HTTP helper with its other source files.

## Verification

Node `v24.22.2` and PostgreSQL 18.6 Homebrew binaries. Lease `EAPR_PG_PORT=55435 EAPR_CONTROL_PORT=3301 EAPR_WORKER_PORT=3302 EAPR_WEB_PORT=5176 EAPR_TEST_PREFIX=eapr_test_review_t2 EAPR_DEMO_NAMESPACE=eapr_review_t2`.

- `npm run typecheck` — PASS.
- `npm run test:integration -- tests/integration/parent-reads.test.ts tests/integration/parent-read-composition.test.ts tests/integration/parent-storage.test.ts tests/integration/local-composition.test.ts tests/integration/v2-preview.test.ts tests/integration/v2-verification.test.ts tests/integration/local-verification-startup.test.ts tests/integration/financial-attestation-composition.test.ts` — PASS, 42 tests across eight files.
- `npm run test:e2e -- tests/e2e/v2-preview.spec.ts tests/e2e/v2-evidence-verification.spec.ts` — PASS, two tests across two files. Both browser flows exercise real A2 publication and worker reads. Browser proof includes the truthful parent balance label, unchanged amounts and verification checks. Screenshots are in the worktree's ignored `test-results` output, including `preview-company-a-balance.png`, `preview-company-b-balance.png`, and `verification-v2-company-{a,b}.png`. Authenticated traces were disabled.
- Exact normal startup smoke — PASS. Ran `npm run dev` with the leased environment. The web service bound 5176 and the smoke harness bootstrapped a normal reviewer session. Both dossiers returned 200 and both preview/read paths returned safe 503 before publication. The smoke harness used the two existing catalog candidate inputs to compile exact artifact references and wrote a mode-0600 strict selection file inside a temporary mode-0700 directory. Ran `node --import tsx scripts/prepare-activation-policy.ts --publish-scopes --selection-file <private-temp>/selection.json` while the same supervisor was running. Published index `ab45354410a661dd441cbec4017e7d7004b4b4c05d7660b38220cfff38b9eda8`. On refresh the parent diagnostic cleared. Both authenticated reviewer parent and activation GETs returned 200 through the real worker. Direct calls without a worker credential returned 401. Both previews returned 200, parentWrites 0, beforeVersion 0, and after balances 80000 and 0 cents. Every runtime table's sorted full rows matched the pre-read snapshot. No policy install or restart was needed. The exact-candidate repeat temporarily held aside only the identical index created by the first smoke and restored it on exit.
- `git diff --check` and staged equivalent — PASS.

The new integration files cover default catalog degradation and recovery without verification pins, registry/current/member damage, cross-scope snapshot isolation, stored and inactive facts, maximum-length and malformed selectors, no-store failures, paired seeded activation and receipt after an actual A2 atomic replacement during a held read, wrong-scope and malformed HTTP responses, worker outage and restart, reviewer CSRF, and preview over a stored nonempty parent with beforeVersion 1 and before balance 12345 cents. Before/after comparisons cover all runtime tables. The parent-storage regression separately exercises the actual store readers under `SET TRANSACTION READ ONLY`.

## Protected source closure

Recomputed using the existing financial and bootstrap manifest path lists and canonical hashing, against the exact base and candidate files. The only changed member in each list is `packages/contracts/src/local-demo.ts`. Build manifests were left untouched.

| Closure | Base | Candidate |
| --- | --- | --- |
| Financial evaluator | `c5140fb37a4deffc8f8183b64cc8fbfd2fcc6d9bdf14b892eb6b622619684c6e` | `c0c28ab8669a967419dc480cc9c7e97007d8ca96b9f64af12ab841416c8b425d` |
| Bootstrap evaluator | `e81ebd3f7d03baa2c0adcf5509be98432816abb89cd5f0c187a413a56c24c586` | `b76581d2db136143d974f0addc9a82f7d18d39bb905c2835ecc0715663aeb56d` |
| Bootstrap subject | `ee7eecf0c88218b8c74198a0abd02b6401a355fe0d03f57b725dbcce7bd1aa34` | `b47301d4e92402124a990f307af1df47729c505a96d447d45eb5492eff32e1c6` |

A2 policy preparation needs to use the exact final protected builds. Scope-only publication and read availability are independent of that preparation.

## Scope of evidence

No slice gate, live model run, first approval, activation mutation, sync, or joint acceptance was exercised. The direct storage fixture seeds approved-shaped facts only to prove paired read behavior. Candidate registration is an intentional control write separate from runtime-zero-write preview and reads.

## Independent review correction

Reviewed predecessor `0c7a0955a0ca9faeed3febf2218e07c93d647ae1`. Corrected candidate `a24adcf75dfcd5d92236c0bede2845c1463515c3` (`fix: clear parent catalog diagnostics after registry recovery`). Original branch base remains `fcbc0cf969bd965c115d07eb76ed250ea1f70d17`. The corrected worktree is clean.

Catalog refresh now rechecks a failed startup registration through the existing read-only candidate registry after its live parent probe succeeds. It clears the failure after the exact artifact/manifest pair resolves with the original manifest hash and snapshot. Refresh performs no registration writes or scope publication. The recovery test obstructs the real artifact directory with a regular file, confirms source dossiers and the catalog remain usable and previews fail safely, removes the obstruction, registers the exact attempted subjects, and publishes scopes explicitly. The same control instance then clears its diagnostic and serves successful previews. The test also verifies that catalog refresh itself did not attempt registration and runtime tables remained unchanged.

- Red, before the production fix, on the same leased environment above. `npm run test:integration -- tests/integration/parent-read-composition.test.ts` ran two scenarios. Initial publication passed and storage recovery failed at the post-publication diagnostic assertion, returning `PARENT_READ_UNAVAILABLE` for both scopes.
- Green. `npm run typecheck` passed. `npm run test:integration -- tests/integration/parent-read-composition.test.ts tests/integration/parent-reads.test.ts tests/integration/local-composition.test.ts tests/integration/v2-preview.test.ts` passed all eight tests across four files. `git diff --check` and the staged equivalent passed.
- The correction changes two files outside all three protected source manifests. The protected hashes above remain applicable. The original candidate's browser and normal-startup smoke results are recorded above. This correction was verified with the focused integration checks and typecheck.
