# C3 actual v2 browser checkpoint implementation brief

> For the assigned Sol worker: execute this bounded brief inline using `superpowers:executing-plans`; do not delegate. This handoff selects the execution method. Do not request another design approval for the routine choices fixed here.

**Goal:** Exercise both actual captured development candidates through B's evidence assembly and C2's protected checker in Chromium, proving all thirteen checks pass and the bound report is eligible for review with zero parent writes.

**Architecture:** Add a separate actual-v2 browser checkpoint and an explicit test-only fixture mode. Keep the existing expected-only/v1 browser checkpoint intact. Real operator preparation, immutable C1 storage, real control jobs and evaluator/subject subprocesses remain the system under test.

**Stack:** Node 24, PostgreSQL 18, strict TypeScript, Vitest and Playwright; existing dependencies only.

**Authority:** Read repository/tests AGENTS; PRD sections 1, Local process boundaries and 19; implementation plan T2.1/T2.2; contract freeze F3/F6/F8; verification playbook G2 and evidence-packet rules; `docs/progress/2026-11-08/handoffs/evidence-v2-contract.md`, B/C2 reports, and their exact-candidate independent reviews. Frozen contract clarifications outrank older abbreviated plan examples.

## Dependency and scope

Observed integrated main: `f3e5375` (B assembly from `3dd6173`), above `064cfa1` (C2 from `b03fced`). Begin only with both independently reviewed changes integrated. Record actual base/candidate SHA. This brief precedes `b-v2-verifier.md`; its output contract below is the verifier's input.

Allowed edits:

- `tests/e2e/support/verification-fixtures.ts`: explicit additional v2 copy mode, preserving default/v1 behavior and ownership cleanup.
- `tests/e2e/support/local-review.ts`: opt-in v2 mode and test-only private-boundary assertions/metadata needed by the new checkpoint.
- Create `tests/e2e/v2-evidence-verification.spec.ts`: one real A/B browser test.
- Create `tests/integration/c3-v2-pin-isolation.test.ts`: focused private-copy, collision and cleanup regressions.
- Create `docs/progress/2026-11-08/handoffs/c3-v2-browser-report.md`: exact candidate, checks and limitations.

Read/run but do not change `tests/e2e/v2-verification.spec.ts`, `tests/e2e/v2-preview.spec.ts`, or `tests/integration/c3-pin-isolation.test.ts`. No product/UI, evaluator, generator, operator preparation, contracts, migrations, configuration, package or lockfile edits. Never change the product pin store implementation, allow overwrite, reserve a different product version, or alter operator selection. Raise a concrete product defect to its owner if this checkpoint finds one.

## Fixed interfaces and preservation rules

Extend `openLocalReview` to accept `verification?: boolean | 'evidence-v2'`. Omitted/false remains preview-only; `true` remains the current expected-only v1 path; `'evidence-v2'` selects the new path. Extend `browserVerificationFixtures` with `mode?: 'expected-v1' | 'evidence-v2'`, defaulting to `expected-v1`. Retain its `prepare(bindings, pin)` and `close()` interface. `pin` remains the real `prepareVerificationPins({db,captures,truthRoot,store})` callback in the browser; no fake launcher/report injection.

For each company in v2 mode, decode the actual generated `expected-<company>.json` and `evidence-<company>.json` before copying. Require original producer version `1` and construction truth. In an exclusive temporary input directory, change only:

1. Truth `fixtureSetId` to `browser-fixture:<nonce>:<company>` and its own canonical `hash`.
2. Producer `fixtureSetId` to that same ID, `producerTruthHash` to the copied truth hash, and its own canonical `hash`.

Use `decodeTruth`, `decodeEvidenceProducer`, `canonicalJson` and `hashCanonical`; preserve the producer's existing lexical set ordering. Re-decode both copies and compare the remaining canonical fields to their originals. Financial facts, evidence text/bytes/hashes, generator seed/build, identities, terms, source/company/seller/manifest and source events must be unchanged. Fact IDs do not depend on fixtureSetId and must remain unchanged. The copied producer still declares `producerFixtureSetVersion: '1'`. Do not synthesize a bundle, mutate financial truth to version 2, or copy a stale producer hash. B assembles from the real capture and C1 alone performs the frozen v2 rebind and publication.

V1 mode writes only the two expected files, never companions. V2 mode writes exactly the two expected and two evidence files, `wx`, private directory/file permissions. Predict target paths with `hashCanonical([id,'2'])`; require both absent before invoking preparation. Returned pins must exactly match both expected company/source/manifest/snapshot bindings, IDs, version `2`, purpose `construction`. Only after complete matching publication and fingerprinting both files may cleanup claim ownership. Preserve the existing device/inode/mode/content-hash check before unlink. A preexisting, replaced, altered or unconfirmed partially published file must survive. Never recursively remove `.local/protected-evaluator`, overwrite a historical pin, or delete a pin merely because its name looks test-generated.

All generated input, visible originals, existing protected pins and any operator selection remain unchanged. Cleanup must run on browser failure too. Capture before/after hashes and modes in memory; assertion failures involving private input must report booleans or safe codes, not raw objects. The same ownership rule applies to v1 default mode.

## Exact new test IDs and assertions

Create these Vitest full names in `tests/integration/c3-v2-pin-isolation.test.ts` (top-level tests, no describe prefix):

- `v2_browser_copy_preserves_facts_and_rebinds_producer`: actual generator output copied coherently; copied truth ID/hash and producer ID/truthHash/hash agree; all other decoded facts and original bytes/modes unchanged; callback receives four files and returns version-2 binding pair. An unchanged producer with the changed truth must be rejected before publication (or by the real preparation boundary), never repaired by dropping the companion.
- `v2_browser_pin_collision_preserves_existing_files`: a preexisting second target prevents the callback, preserves both inputs and all old pins, and close removes nothing.
- `v2_browser_partial_publication_is_not_owned`: simulated second-publication failure leaves first unconfirmed pin and historical sentinel unchanged after close.
- `v2_browser_cleanup_preserves_replaced_and_changed_pins`: exercise replacement inode, same-inode altered bytes/mode and symlink substitution in disposable test roots; close removes only still-matching owned files and never follows/deletes replacement targets.
- `v2_browser_repeated_runs_preserve_prior_pins_and_inputs`: two separate successful runs with distinct nonces remove only their confirmed matching pins; every historical sentinel and original producer/truth file retains bytes/mode. Also assert the default mode remains expected-only v1, complementing the unchanged old regression file.

These are ownership/copy tests, not evaluator tests; test-local callback simulation is appropriate only here. Use disposable roots for hostile/race/partial-publication cases, never the real store's historical files.

New Playwright test full title, exactly:

`verifies both captured companies with v2 evidence and all thirteen checks without parent writes`

Set `test.use({trace:'off',video:'off'})` and bounded overall/poll deadlines sufficient for two real jobs (e.g. 240 seconds overall and up to 120 seconds per evaluator job). No retries or polling that hides a failed job. Exercise:

- Real `openLocalReview({verification:'evidence-v2'})`, reviewer bootstrap/session and CSRF via existing helpers; exact A/B candidate catalog and empty-fixture label.
- Each candidate: clear the previous report on selection; click Run preview, assert exact submitted candidate request, artifact/profile hashes and real captured manifest binding. A balance is 80000 cents, generated B is 0 cents. Do not replace B's generated captured baseline with the independent F8 80000 fixture. Assert parentWrites 0 and visible zero-write copy.
- Click Verify artifact. Assert the real POST body contains exactly artifactHash/profileHashes/manifestId, receives the real job, and the page completes through actual status reads. A/B job/report/artifact IDs are distinct. No route mocking or supplied eligible JSON.
- Parse the completed job and assert an exact unique set of the thirteen IDs below, each passed, coverageComplete true and eligible true. Assert the UI has thirteen body rows with matching status/diagnostic cells, completed job ID, report ID and manifest hash, visible compiled artifact hash, `Mandatory coverage complete` and `Eligible for review`. Do not merely recompute whatever status the server happened to return and accept it.
- Test-harness SQL reads the single immutable `verification_reports` row for that job. Parse and compare report ID/artifact/profile/manifest against the browser subject, fixtureSetVersion `2`, all thirteen cases positive, evidence_support cases `4`, exact required/executed sets, zero unexplained difference and eligible true. Compare safe derived fields only; do not expose the private row/truth or teach the browser its fixture ID. Assert private metadata in the DB does not occur in product summaries.
- Compare actual runtime public table inventory and rows before and after both previews/jobs (including migration/seed/activity state and any existing parent tables); no writes or created parent tables. Control writes for jobs/reports are expected. Assert no approve/activate/sync controls and no activation/import/receipt HTTP requests. This proves this fixture preview path only, not persisted parent reads or runtime application.
- Exercise private HTTP/file boundaries with authenticated requests: ordinary product responses must have strict public shapes and omit private paths, fixture IDs, producer/financial truth hashes, expected-record fields, raw reports and private case details. Probe actual existing private inputs/pins via control file routes and Vite `/@fs/`/blocked-root paths; require 403/404, never private file content or module source. Inspect request failures using booleans, not private response dumps. No new product endpoint or public test flag. A test-only closure in local-review may check its private paths without returning secrets to page code. Include DOM/served app module checks for protected payload/fixture metadata; existing import-graph regressions provide the static side of the boundary.

Mandatory IDs are `baseline_reconcile`, `new_record`, `duplicate_delivery`, `retry_restart`, `invalid_money`, `allocation_scope`, `full_reversal`, `dependency_order`, `schema_drift`, `semantic_drift`, `unknown_identity`, `snapshot_boundary`, `evidence_support`. The report's `retry_restart` is fresh-subprocess planner replay, not persisted PostgreSQL restart.

## Stable safe artifact contract for B

Only after assertions pass, write `v2-browser-results.json` under `testInfo.outputPath`. Strict shape (no extra keys):

- `schemaVersion: 1`, `test`: exact new title above.
- `assertions`: exactly `runtimeUnchanged`, `parentWritesZero`, `summariesBound`, `rowsMatch`, `privateBoundary`, `noActivation` (each boolean true, set only after the corresponding real assertions).
- `companies`: exactly A then B; each contains `companyId`, `jobId`, `state:'completed'`, `reportId`, `artifactHash`, `profileHashes`, `manifestHash`, `evaluatorBuildHash`, `fixtureSetVersion:'2'`, `parentWrites:0`, `previewBalanceCents` (80000/0), `coverageComplete:true`, `eligible:true`, `checks`.
- Each `checks` entry contains only `id`, `status:'passed'`, `cases` (positive safe integer from persisted report), `diagnosticCodes` (the same safe codes as the summary). Exact unique thirteen-ID set; evidence_support cases 4. Do not include full private coverage/fixture records or oracle outputs.

Screenshot names exactly `verification-v2-company-a.png` and `verification-v2-company-b.png`, restricted to the Independent verification region. No cookies, CSRF, headers, environment, private paths, full reports/truth, raw stdout, traces, videos or hidden expected values in retained artifacts. Existing v1 checkpoint output names/schema remain unchanged.

## Work and verification sequence

- [ ] Add focused copy/ownership tests and the strict actual-v2 browser test; record a meaningful initial failure (v2 mode unavailable/incoherent or not all thirteen pass), not an infrastructure error.
- [ ] Implement only the opt-in test helper mode and new checkpoint. Run new isolation tests and unchanged v1 isolation tests.
- [ ] Run `npm run typecheck`; `npm run test:integration -- tests/integration/c3-pin-isolation.test.ts tests/integration/c3-v2-pin-isolation.test.ts`; `npm run test:e2e -- tests/e2e/v2-preview.spec.ts tests/e2e/v2-verification.spec.ts tests/e2e/v2-evidence-verification.spec.ts --trace=off` with a dedicated fixed lease set before imports.
- [ ] Run the new actual-v2 file twice sequentially (`--repeat-each=2` is acceptable for this extra repeat check); verify existing private input/pin/selection inventory preserved across both runs, and inspect both safe screenshots/results. This repeat invocation is a focused preservation check, not the later runner's single-test report input.
- [ ] Run `git diff --check`, inspect the allowed changed-file list, commit a coherent candidate under 20 words (for example `test: verify both captured companies with private v2 evidence`), and publish the handoff report. Do not call full V2 passed before the separate runner exists.

Evidence claims: focused machine checks only; fresh exact-candidate independent review and joint G2 acceptance remain separate/pending. No live generation, approval, activation, parent configuration execution, persisted sync or final-holdout claim. No genuine product gap was found in architecture review; surface only reproducible deviations from these contracts.
