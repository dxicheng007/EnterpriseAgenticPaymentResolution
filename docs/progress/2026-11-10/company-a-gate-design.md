# T5 bounded Company A gate amendment

Design-only, 2026-11-10. Read root/scripts/tests guides, frozen T0, T5 board, G5, tracked company-a-demo-mount design/plan and PR56 delta, existing V5 runner/parser and runtime-isolation helpers. No source edits, services, DB operations or tests. Task 1 is currently another owner's work. This is a proposed Integrator reservation, not permission to edit their paths concurrently.

## Selector and truthful result

Add exactly `npm run verify:slice -- demo-company-a-ai-off`. Use a distinct dispatch branch and evidence directory `.evidence/<source.evidenceKey>/demo-company-a-ai-off/<runId>/`. Reject trailing arguments for this new selector. No package.json change, no flag that makes V5 mean a smaller scope, and no change to the inject delegation owned by Task 3.

Bounded manifest: `schemaVersion:1`, `gate:'demo-company-a-ai-off'`, `scope:'single-company-a-fixture-mounted-sync'`, `constructionMode:'development-fixture'`, `result:'passed'|'failed'`, `fullV5:'not-established'`, `independentReview:'pending'`, `jointAcceptance:'pending'`. Console: `demo-company-a-ai-off verification passed|failed (bounded fixture scope; full V5 not established)`. Exit 0 only for this bounded pass. Retain source identity, lockfile/tool versions, migrations/configuration, both frozen-contract and demo-contract hashes, normalized commands/assertions, and diagnostics as existing packets do.

Preserve `npm run verify:slice -- V5`, `registry.V5`, `requiredV5Cases`, `syncGateOutcome('V5',...)` and V6's shared lists unchanged: full V5 remains failed / exit 1 / `ai-off-sync-proof-unavailable` even if this separate packet passes. G5 still requires genuine G4 artifacts, Company B file application and other full-scope observations. No bounded packet may say V5 passed. Update T5 board wording to name the additional bounded selector; this reconciles the board with its newer demo design without changing frozen product behavior.

## Minimal path reservation after Task 2/3 acceptance

Integrator-owned implementation:
- MODIFY `scripts/verify-slice.ts`: import and dispatch only for the new selector, plus usage string. Coordinate after Task 3 releases its inject-branch edit.
- NEW `scripts/verify-demo-company-a.ts`: named commands, private run outputs, metadata, collection, packet emission; follow `scripts/verify-v2.ts` / `verifyV5` runner patterns.
- NEW `scripts/verify-demo-company-a-evidence.ts`: strict public observation parser and bounded outcome. Reuse `normalizeReport`, `commandResult` and existing bounded regular-file reader (`readV2Json`) rather than copying these algorithms.
- NEW `tests/integration/verify-demo-company-a-evidence.test.ts`: parser, outcome and privacy regressions, no DB.
- MODIFY `tests/integration/verify-slice-evidence.test.ts`: preserve explicit full-V5 failure with all prerequisites passing; assert bounded success cannot feed/promote the full outcome if needed.
- MODIFY `scripts/AGENTS.md`, `tests/AGENTS.md`: new command and exact limited claim.
- Coordinator only: `docs/superpowers/plans/2026-11-10-demo-remaining-work.md`, `docs/progress/2026-11-10/platform-coordination.md`.

Evidence producer work belongs first to Task 2/3: `tests/integration/demo-company-a-transport.test.ts` must expose its actual mounted proof as narrow JSON observation, written to a runner-provided private path only after assertions pass. Do not add a new fixture or duplicate their activation/transport setup. If unfinished at handoff, reserve this existing test explicitly for Integrator follow-up after sole-writer release. Optional strengthening of `tests/fixtures/v5-ai-off.ts` requires a separate explicit reservation; no production model metric or client is needed. No contracts root, database, source adapter, UI or scheduler changes.

## Mandatory commands and named observations

Run typecheck and the accepted Task 2 transport integration, Task 3 CLI integration, Task 2 control/worker/client unit files, plus runtime-isolation evidence that actually covers the launched mounted worker. Enumerate every test title in each selected file exactly once at implementation handoff; `normalizeReport` intentionally rejects extra as well as missing assertions. Do not guess the implementer's final titles now or weaken matching to prefixes. Existing v5-runtime-isolation tests may be included as supporting checks but cannot replace the mounted AI-off case.

Require these named assertions in the transport/process proof (wording may be finalized once, then pinned in the registry):
1. `Company A fixture activation establishes one authorized customer and an 80000-cent cutover balance`
2. `A fresh Company A payment and allocation are captured over mounted HTTP and applied without a second approval`
3. `Worker sync receipt records 80000 to 50000 while the persisted cutover remains 80000`
4. `Mounted Company A worker applies with model access disabled throughout`

These assertions must exercise the actual accepted supervisor mounting/child environment as well as real control/worker HTTP and separate disposable PostgreSQL databases. An in-process service test, Fastify inject-only route test, CLI stub server, health response or generic PR56 `/internal/apply` test is supporting proof only. Source injection uses the real fixed operator endpoint, worker reads real complete source pages using its private source capability, and CLI uses its actual fixed two-hop command. Source facts must be absent from the approved baseline and arrive after activation; no replay-only setup can satisfy the fresh-application case. Reconstruct/retry evidence remains separately attributed to T6 even if these suites contain it.

## Public observation schema

One strict object, one positive mounted-case binding; no arbitrary map/string payload. Use existing public schemas for IDs, hashes, scope, epoch, versions, integer cents and opaque cursors, projected to explicit fields. Never serialize complete receipts/bundles/env or DB rows as an observation.

- `schemaVersion:1`, `gate:'demo-company-a-ai-off'`, `test`: exact mandatory mounted-positive title; run token generated by runner and echoed by producer to bind this run (not a credential).
- `constructionMode:'development-fixture'`, `targetMode:'persisted-parent'`.
- `scope`: exact T0 company/seller/account/customer scope from approved identity; `sourceRef:'legacy-a'`, `manifestId:'manifest-a-d22feb38e846-d4e83b7db551'`, actual `manifestHash`, `artifactHash`, `profileHash`; candidate/profile/spec IDs and versions checked against T0 in producer. Hashes come from the real registered/approved selection, never fixture constants from another namespace.
- `activation`: public `activationId`, `initialReceiptId`, `epoch:1`, `initialAfterBalanceCents:80000`.
- `sync`: public `receiptId`, same `activationId`, actual epoch, `replayed:false`, `beforeBalanceCents:80000`, `afterBalanceCents:50000`. Require receiptId differs from initialReceiptId. This is the new worker-authored committed receipt, not a browser calculation.
- `sourceEventIds`: exact tuple `evt:pay-a:demo-pay-a-cutover-300`, `evt:alloc-a:demo-pay-a-cutover-300`; `paymentId:'pay-a:demo-pay-a-cutover-300'`, `allocationId:'alloc-a:demo-pay-a-cutover-300'`, `amountCents:30000`, `effectiveDate:'2026-10-03'`, `observedAt:'2026-10-03T00:00:00.000Z'`.
- `parent`: `currentAsOf:'2026-10-03T00:00:00.000Z'`, `currentBalanceCents:50000`, `cutoverAsOf:'2026-10-01T00:00:00.000Z'`, `cutoverBalanceCents:80000`, existing parent versions before/after. Check the actual version transition using its existing contract, not a new rule encoded as guessed arithmetic.
- `assertions`: literal true for `previewParentWritesZero`, `baselineExcludesInjectedEvents`, `sameApproval`, `onePaymentAndAllocation`, `approvedSnapshotUnchanged`, `receiptMatchesStoredParent`, `actualSupervisorMount`, `privateBoundary`. Each is an assertion of observed state in the producer, not an input supplied by the product.
- `runtimeIsolation`: `credentialsAbsent:true`, `modelFreeWorkerImports:true`, `mountedHttpPathProtected:true`, `positiveControlPassed:true`. No `runtimeModelCalls:0` or invented product counter.

If useful, include capture/application cursors only as separately named projections of existing persisted capture progress and receipt/unit application progress; do not infer appliedThrough from capturedThrough. The smallest packet omits cursor fields because the source-event/receipt binding plus persisted observations already proves this fixed application. Do not emit lag/pending/quarantine counts; those remain unmeasured. Validate exact literal facts, public identifiers, strict unknown-key rejection, duplicate identities and cross-field activation/receipt bindings. Keep all private producer output outside the retained packet and clean up on failure.

## Runtime isolation reuse and honest limit

Reuse `modelCredentialEnvNames`, `scrubModelCredentials`, `assertModelCredentialsAbsent`, `assertWorkerSourcesModelFree` and `workerProductionImportGraph`. Assert against the environment actually supplied to the launched worker, not only the runner; start the worker with no model client/credentials and keep it so through injection/capture/application/readback. Include actual demo-sync composition/client and accepted generic sync composition in inspected entrypoints. Existing graph follows relative imports only; package dependency/import inspection must account for that limitation and no claim of complete transitive analysis should be made without it.

The grounded [Task3 process design](company-a-task3-process-design.md) supersedes broad egress wording: one guard on the actual worker child's global fetch permits only its configured control origin and redirect:error, with forbidden-call positive controls and unchanged guard/trap through the measured interval. Combined with credential absence and candidate-specific source/dependency inspection, this proves the current worker application HTTP path. It does not claim all-egress, raw-socket, hostile native code or arbitrary transitive-package containment. Missing real mounted-path evidence still fails the bounded gate.

## Acceptance and error regressions

Positive: exact command set all exit 0, all exact named assertions pass once, strict observation matches this run and fixed scope, actual mounted runtime proof passes, metadata/cleanup succeed => only bounded selector exit 0. Review and joint acceptance remain pending.

Negative: prerequisite-only; no transport proof; baseline already contains events; replay-only receipt; wrong scope/seed/manifest/profile; initial receipt substituted; second approval; receipt-parent mismatch; 80000 current/50000 cutover; missing allocation; missing runtime proof/failed positive control; malformed/oversized/symlink/stale observation; unknown or secret-bearing extra key; duplicate/missing/skipped/todo/flaky/failed title; wrong report file; command timeout/signal/nonzero; metadata/cleanup failure => exit 1 and bounded failed. Gate diagnostics are stable allowlisted codes, never raw stderr or source evidence.

Test full V5 still exits 1 with all legacy prerequisites passing and independently with a valid bounded observation present. Do not alter V6 shared predicate. Exercise selector rejection of unexpected extra args. Source/test work passes focused typecheck, parser/outcome tests and the new bounded invocation before independent exact-candidate review. Full V5 need not be repeatedly executed merely to rediscover its deliberate unavailable result; unit regression preserves that rule.

## Remaining gap / release condition

No material product or financial decision is missing for the fixed T0 scenario. Selector and packet names are routine verification choices. Actual Task 2/3 mounted transport/process tests and their final names/public observation emission do not yet exist as accepted evidence; they are required before implementation registry freeze and release. The exact test-only runtime interception mechanism must be grounded in that launched process, not claimed in advance. This design grants no T5 pass today, no live/two-source V5, full V6, Operations browser acceptance or joint G5 acceptance.

## Release refinement after the implemented Task3 interface

Reuse the actual six named tests in demo-company-a-transport.test.ts, including the single compound mounted CLI case that checks fresh money, current/cutover, isolation and process recovery. Do not split that setup merely to manufacture four titles; pin every actual title exactly. Require the twelve CLI cases, three app transport units and typecheck as additional commands. Record only public observations already asserted by that process case; T5 need not repeat V2 preview or browser workflow. Omit previewParentWritesZero from this packet rather than claim it was measured here. Approval is genuine fixture setup and remains same through sync; no live construction claim. Keep scope as normal Scope and parentCustomerId separately.

Observation is emitted after all process assertions AND child/fixture cleanup succeed, to a runner-provided private path with run token. Read bounded regular files without symlinks; strict parser rejects unknown keys and stale token. Require real receipt/activation/hash bindings, new receipt distinct from initial, fresh source pair, one economic effect, actual current50000/cutover80000/version advancement, same approved snapshot, original receipt on replay, and bounded runtime proof. Do not retain raw process output, DB rows, full bundles, tokens, private paths or environment.

Keep changes small: new runner and evidence parser plus parser tests; one new selector/usage branch in verify-slice may pass its existing sourceIdentity result to the new runner. Do not import verify-slice into tests because it executes CLI dispatch. Preserve existing full V5/V6 selectors/predicates untouched; own regression tests can call syncGateOutcome to verify no promotion. No edit to existing V5 requirements is necessary.
