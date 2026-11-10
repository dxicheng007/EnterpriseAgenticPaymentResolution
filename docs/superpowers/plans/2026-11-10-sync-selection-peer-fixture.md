# Same-feed Peer Fixture Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify two independently approved customers on one fixed Company A capture lane through unchanged evidence, financial, bootstrap, reviewer and A5 services, and release a narrowly scoped test fixture only after that proof passes.

**Architecture:** One new test-only factory authors the accepted literal originals and independent expectations once in fresh private roots, captures the shared manifest and completes two separate one-profile proof/approval/import chains. The prerequisite integration group checks exact committed targets, receipts/origins, shared capture/replay, immutable inputs and resource cleanup without importing a selector. Existing producer and production APIs remain unchanged.

**Tech Stack:** Node 24, strict TypeScript, PostgreSQL 18/`pg`, existing Fastify, Vitest, source/evidence/compiler/evaluator/parent APIs, PDF.js and unchanged `textPdf`/pdf-lib; no new dependency.

**Spec:** [Accepted same-feed fixture design](../../progress/2026-11-10/sync-selection-peer-fixture-design.md), SHA-256 `376de67a292f56add6d1a60b576537d4d046675acb3a218276abba3e93867fa3`; [independent design review](../../progress/2026-11-10/sync-selection-peer-fixture-review.md), spec/design quality PASS, no findings. Also read the [selection plan](2026-11-10-sync-selection.md), SHA-256 `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`, and its [accepted design](../../progress/2026-11-10/sync-selection-design.md), SHA-256 `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`.

## Global Constraints

- “All values below are new test-only constants, authored before first publication.” The accepted design's **Literal original and expectation specification** is normative: use its exact identities, record/document versions, byte recipes, monetary literals, terms, dates, filenames, manifest, stream vectors and hash formulas; do not substitute canonical-generator output.
- “No account, amount, expected balance or expected billing term may be discovered from a compiler/preview/worker result.” Raw `3000.00` and expected `300000` remain separately authored literals. Existing APIs alone must satisfy both original invoice/term assertions.
- “Do not call `generateFixtures` or `fixtureA` and transform their output.” All new originals and truth use no-replace writes. Never rewrite truth, approved snapshots or completed approvals to obtain a pass.
- “`tests/fixtures/activation-proof.ts`, all existing fixtures/generators/producers and saved demo pins stay byte-identical.” No contracts, exports, production code, migrations, test configuration, dependencies, original suite files or protected build inventories may change.
- “It exposes neither protected roots/truth nor owner DB connections.” Runtime uses only its own application pool and no model SDK/key/calls. Control and runtime retain separate roles/databases.
- “The factory returns only after both exact approvals, A5 receipts, initial-origin checks and shared-lane initialization succeed.” Registration, bundled profiles and policy installation do not count as enrollment.
- “This supplies only genuine **same-feed** peers on the fixed A lane.” Cross-financial-stream/separate-resource cases remain blocked on their published owner dependency, not waived or relabeled.
- No selector, P1 writer, provider, scheduler, HTTP/composition mounting or new authority behavior is implemented here. Capturing a test page does not apply its financial events.
- This is one test-fixture qualification task. No artificial failing production stub or manufactured red is required. Preserve actual setup/proof failures; syntax/import/setup failure is not behavioral proof and cannot qualify the fixture.

## Review Focus

1. One invoice per customer must really enable complete financial and bootstrap coverage for **both** exact candidates; the real-producer test checks every required result, not merely `eligible` or schema acceptance.
2. First approval or shared capture must not enroll/import the second account; the factory checks its absence immediately before its separate reviewer action, and tests verify distinct commitments and original receipts.
3. Identical lane definitions must share progress without merging customer scopes or duplicating capture/economics; the real-capture replay test checks exact baselines, initializer, counters and unchanged non-capture state.
4. Expectations or original bytes must not change to fit observed output; independent inventories surround the proof chain and compare one additional fresh-root construction.
5. Failure after resources are live must release only owned resources while preserving the actual error; the cleanup test injects a setup exception after real worker/review composition, without faking a proof or successful service response.

---

## Status, order and ownership

This document grants **no source or SQL release**. Planning source candidate is `7e49e552026c59d5ef26a6f92c41ced87bb0341c`; its additions are P1 Task 4 tests, and final P1 review is pending. Root reconciles the final P1 APIs/migrations and exact source candidate, obtains independent review of this plan, and releases paths/Node 24/PostgreSQL 18 lease after C/D/P3. Only the designated Sol writer implements; Astra review remains a separate gate.

This qualification precedes every consumer of `createSyncSelectionFixture`. Future selection Task 1 may append its authority cases to the new integration file after qualification. Selector-dependent route/proposal/zero-write assertions remain selection Task 9's mandatory consumer gate; do not add a fake selector, skip those assertions into a purported selection pass, or claim this task completes them.

| Reserved-on-release path | Responsibility |
| --- | --- |
| `tests/fixtures/sync-selection.ts` (new) | Literal construction, real proof/reviewer/import orchestration, invariant assertions, shared-lane setup, capture delegation and owned-resource cleanup. |
| `tests/integration/sync-selection.test.ts` (new) | Independently runnable `same-feed fixture qualification` group, with literal target assertions, independent file inventories and cleanup observation. |

No third source/test file or fixture-barrel export is needed. Keep helper internals private. Read root/test AGENTS and the spec/review before implementation. Do not run a second DB task while the existing lease is held.

### Task 1: Implement and independently qualify the same-feed peer fixture

**Files:** Create only the two paths above. Existing source and tests are read-only references.

**Interfaces:** Produce exactly the accepted factory signature below; subject order is one, two. Import types from their existing contracts/parent exports.

```ts
export async function createSyncSelectionFixture(): Promise<{
  db: Pool;
  close(): Promise<void>;
  subjects: [
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
    { identity: CommittedAuthorityIdentityV1; stored: StoredActivation },
  ];
  capture(identity: CommittedAuthorityIdentityV1, page: ChangePage): Promise<CaptureResultV1>;
}>;
```

Consume unchanged exported `captureEvidenceFixture(dependencies, roots, 'a')`, `buildDemoCandidate`, `compile`, `createCandidateRegistry`, `decodeTruth`/`decodeEvidenceProducer`, `pinProtectedEvidenceFixture`, protected financial probe/reserve/start/launch/complete, `prepareBootstrapVerification`, `createRegisteredScopePublication`, `prepareAndPublishActivationPolicy`, `composeActivationReview`, local reviewer session and worker parent-read composition. A5 delivery calls `createWorkerActivation(...).activate({idempotencyKey, bundleHash})` using the actual committed intent. Read back with `readStoredActivation(client, scope)`, `readStoredTarget(client, scope)` and `readFinancialOrigins(client, scope, records)`. Capture delegates to `createRuntimeCapture({db, clock}).openCommitted(identity)` and the returned `capturePage(page)`; `readProgress()` and `lane` are available on that returned object. `withTransaction` supplies caller-owned clients for the validated reads. The accepted design's execution sequence gives exact binding/policy/sidecar values; use it rather than copying private functions from `sync-capture.test.ts`.

- [ ] **Step 1: Record the authorized candidate and immutable baseline.**

After root release, check the exact source candidate and accepted design hash, Node/PG versions, granted `EAPR_TEST_PREFIX` and exclusive lease. Before edits, inventory existing `tests/fixtures/**`, `tests/integration/sync-capture.test.ts`, `scripts/generate-fixtures.ts`, `packages/sources/src/**`, `packages/evaluator/src/**`, `package-lock.json`, and existing saved demo pin files under `.local/protected-evaluator`, `.local/protected-bootstrap`, `.local/activation-policy`, `.local/artifacts`. Record absent roots as absent. Keep relative-path/byte-hash inventories in memory or a root-authorized evidence location, never copy protected file contents into logs or the report. No inventory entry may later be silently excluded because it changed. The two newly reserved files are excluded from this pre-existing-file inventory only.

- [ ] **Step 2: Author the immutable fixture inputs and lifecycle in `tests/fixtures/sync-selection.ts`.**

Implement the signature with a fresh `testNamespace('selpeers')` pair and fresh temporary root, separate application pools and the exact accepted literal specification. The two original invoices are the September 1, version-1, USD `3000.00` records; each independently authored expected invoice and balance anchor is `300000`. Two PDFs, exact identity/term support, finance sequences 1/2 and semantics watermark 0 must match the design. Use actual source/byte/canonical hashes and truthful generator source inventory; validate the input shapes before `wx` publication. No data is changed after publication. The helper records its own original/truth inventory before capture and checks it before returning.

Register cleanup as each resource is acquired. One shared idempotent cleanup path closes any control/worker instances, releases held clients, ends both pools, drops only the allocated namespace, and removes only the allocated temporary root. On construction failure run all owned cleanup actions and rethrow the original failure; retain cleanup failure details without masking it. Normal `close()` attempts all actions and surfaces cleanup failure. Do not stop the native cluster.

- [ ] **Step 3: Complete both real proof/approval chains and initialize the lane.**

Follow the accepted design's six execution steps exactly: one real shared capture; two independently compiled/registered one-profile candidates; common protected evidence pin; separate genuine financial reports and bootstrap sidecars; combined scope/policy publication; separate authenticated prepare/activate actions and A5 deliveries. Each bootstrap evaluator must actually execute through normal reviewer preparation. The factory checks the second account has no stored activation or target after the first import and before the second reviewer action. It verifies each target/origin and opens committed capture in one-then-two order before returning. Close temporary listeners after their setup role completes; keep only the owned pools/resources needed by returned operations until `close()`.

Do not expose roots, an owner pool, injected outcomes, a failure flag or a new public fixture configuration surface. Setup/proof failure stops qualification and retains the real failure. Do not weaken literals, skip mandatory coverage, add baseline facts, or edit producers in response; report any exact unchanged-interface gap to root.

- [ ] **Step 4: Add `same-feed fixture qualification > both subjects pass real producers and separate reviewer imports`.**

Use the first factory instance for this test and the capture test. A bounded `beforeAll` may construct it; `afterAll` must close it even if an assertion fails. The test contains independent literal expected records and metadata from the design, not values derived from the returned target. For each subject, assertions include:

```ts
expect(stored.bundle.verificationReport.eligible).toBe(true);
expect(stored.bundle.verificationReport.unexplainedDifferenceCents).toBe(0);
expect(stored.bundle.verificationReport.coverage.executed.toSorted())
  .toEqual([...VerificationCheckIdSchema.options].sort());
expect(stored.bundle.verificationReport.checks.every(check => check.status === 'passed' && check.cases > 0)).toBe(true);
expect(stored.bundle.bootstrapVerification.passed).toBe(true);
expect(stored.approvedTarget.records.version).toBe(1);
expect(stored.receipt.beforeBalanceCents).toBe(0);
expect(stored.receipt.afterBalanceCents).toBe(300000);
```

Also assert required coverage equals the mandatory set; exact report profile/source/artifact/manifest bindings; full five-financial-kind coverage; actual financial-attestation binding; all `bootstrapRequiredCases` and `bootstrapRequiredAssertions` present/passed and the exact selected profile/plan binding. Read back each stored activation/target with accepted readers. Compare **full** expected invoice, customer, account and billing-configuration objects: one own invoice, version 1, September 1 effectiveAt, September 30 due date, USD 300000; no payments/credits/allocations/reversals; exact September 1 monthly terms/anchor 1/terminal null. Resolve expected target IDs using only `targetRecordId` and evidence IDs using actual captured citation bindings; monetary/identity/date expectations stay literal.

Require two distinct reviewer package IDs, request keys, artifact/profile/bundle/activation/receipt IDs, and exact single-profile membership per artifact. Both bundles contain the same complete two-event capture, while each plan, receipt event/target IDs and imported economics name only its own invoice. Require each `readFinancialOrigins` result to equal its own literal approval key plus exact own stored receipt and derived record ID, `kind:'initial'`; no manually inserted origin or peer receipt. Exercise the factory's pre-second-approval absence assertion on every creation.

- [ ] **Step 5: Add `same-feed fixture qualification > shared capture replays without changing parent state`.**

Read both bound progress objects: one lane with schemaVersion `1`, sourceRef `legacy-a`, actual common manifestHash; finance baseline/capture `2`, semantics baseline/capture `0`, zero captured counters. SQL SELECT verifies exactly one lane with initial_activation_id equal to subject one's activation. Snapshot current parent targets/financial+metadata records, imports/receipts/origins/lineage, authority and P1 outcomes/units/heads before capture.

Construct the accepted design's real `ChangePage`: two new payment events on `a-finance`, sequences 3/4, source accounts `sync-selection-one`/`sync-selection-two`, record IDs `sync-selection-payment-one`/`sync-selection-payment-two` and event IDs `evt:` plus those record IDs. Use version 1, sem-a-1, effective `2026-10-01`, observedAt `2026-11-09T08:00:00.000Z`, raw USD `100.00` and actual event hashes. Page fields are sourceRef `legacy-a`, streamId `a-finance`, after `2`, next `4`, complete `true` and these two events; `ChangePage` has no manifestHash field (the committed capture binding supplies the lane). Call the returned capture operation for one and then the identical page for two:

```ts
expect(await fixture.capture(one.identity, page))
  .toEqual({ disposition: 'captured', captured: 2, cursor: '4', replayed: false });
expect(await fixture.capture(two.identity, page))
  .toEqual({ disposition: 'replayed', captured: 0, cursor: '4', replayed: true });
```

Both progress reads must agree: finance cursor `4`, capturedRecords 2, capturedPages 1; semantics remains `0`. After the first capture save the complete capture/activity rows and compare after replay: no duplicates or new replay activity. The non-capture snapshot remains equal before/after both calls, and each target remains the original single invoice with 300000 balance. Do not call the writer or selector. The captured payments are not target payments, and this test makes no proposal/routing claim.

- [ ] **Step 6: Add `same-feed fixture qualification > fresh independent construction preserves all original inputs`.**

In the integration test, independently inventory the ten new input files (eight visible plus two truth files) at entry to the **real** `captureEvidenceFixture`, before it performs publication, using a pass-through Vitest observer installed before the first factory invocation. After the factory returns and again after capture/replay, compare all path/hash/length entries to that pre-publication inventory. This observer must not read expected values from target output or replace any service return. The helper's own inventory assertion is not the only evidence.

Create exactly one additional fresh-root/fresh-namespace factory instance for this independence check, pass it through the same real two-subject qualifications, and close it in `finally`. Assert roots/namespaces are distinct, newly authored input inventories equal the first construction's literal byte inventory, and each inventory is unchanged after its own proofs/imports. Do not require runtime-generated review/job/receipt identifiers to equal across independent databases. Compare the Step 1 pre-existing-file inventory after qualification. No repeated whole suite or extra rebuild is required once these checks pass; rerun only after a change or failure needing verification.

- [ ] **Step 7: Add `same-feed fixture qualification > partial construction failure releases owned resources and preserves its error`.**

Use a separate fresh fixture attempt for this failure case only. Observe actual root/namespace, pools and worker handle through pass-through spies on their existing creation exports. Wrap `composeActivationReview` for this attempt: await the real composition, then throw one distinctive test `Error` before any successful factory return. This exercises cleanup after real input capture, protected financial work and a live worker listener. It is lifecycle fault injection, not a manufactured financial failure or a mocked passing producer. Do not change the helper signature or production source for this test.

Require the factory rejection to preserve that exact error; observed worker listener is closed; both actual application pools have completed `end`; the real `dropTest` call completed for only the observed allocated namespace; the owned temporary root is absent. Call-through cleanup methods must be awaited, not merely counted as invoked. Assert pre-existing-file inventory unchanged. Restore every spy in `finally`; retain a test cleanup fallback for unexpected failure so this test cannot leak its own resources. In final primary-fixture teardown, after all its tests, call normal returned `close()` twice and require idempotent success. No financial/proof assertion is waived by this intentional failure case.

- [ ] **Step 8: Run the bounded qualification and inspect actual results.**

Root must already have released the SQL lease. Use its existing prefix, cluster and environment; do not invent another lease. On Apple Silicon put Node 24/PostgreSQL 18 on PATH, then run:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
node --version
pg_config --version
npm run typecheck
npm run test:integration -- tests/integration/sync-selection.test.ts -t 'same-feed fixture qualification' --testTimeout=180000 --hookTimeout=180000
```

Expected: Node v24 / PostgreSQL 18, typecheck exit 0, and all four named qualification tests passing with no skipped prerequisite case. The run has one primary construction, one fresh independent successful construction, and one deliberate partial-failure construction; it must not become a retry-until-green loop. Preserve actual evaluator/setup failures and distinguish them from code import/type errors. Logs/report retain safe stage/result summaries and hashes, never protected truth, credentials, subprocess configuration or expected probe internals. These are focused **partial** machine checks, not a slice/selector/P1/live acceptance claim. No broader unit, integration, browser, slice or provider suite is requested by this task.

- [ ] **Step 9: Self-review and hand off the exact qualified candidate.**

Check the two-path diff, unchanged inventories, both genuine producer/approval paths, exact literals, all four prerequisite tests and cleanup. Record the source candidate, safe real report/receipt bindings, focused command results, qualification status and unresolved gaps in the root handoff; do not add an unreserved report file. Commit only the two paths as one coherent step after checks pass, subject `test: qualify independent same-feed peer fixture`. Root obtains a fresh independent review of that exact candidate before fixture consumers are released. A failure or owner gap means qualification remains open, not a conditional pass.

## Plan self-review and unresolved gates

Self-review: one cohesive task covers the accepted design's construction, proof chain, interface, exact targets/origins, shared capture, immutability and cleanup. The four test cases cover all five review-focus risks. The exposed factory signature and existing DTO properties were checked against source. Original bytes/expectations remain normative in the linked accepted design instead of being re-specified here.

No product/financial ambiguity was identified by this plan. Runtime feasibility remains unexecuted; final P1 reconciliation, source/SQL release and actual qualification are pending. Selector-dependent assertions are deliberately retained in selection Task 9, and cross-stream admission remains the separate unresolved owner dependency. This plan was authored by read-only inspection plus this document write; no source/test/DB/Git/provider operation or implementation dispatch occurred.
