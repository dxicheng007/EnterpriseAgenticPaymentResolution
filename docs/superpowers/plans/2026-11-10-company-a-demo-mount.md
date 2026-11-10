# Company A demo mount implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Execute serial tasks with one source writer and fresh Astra exact-candidate reviews.

**Goal:** Mount the frozen Company A operator injection, durable capture and deterministic apply demonstration.

**Architecture:** Reuse accepted source scenario/capture/classification/atomic apply. Add fixed worker orchestration, private transports and supervisor/CLI mounting in three reviewed increments. No DDL or general scheduler.

**Tech Stack:** Node 24, strict TypeScript, Fastify, PostgreSQL 18, Vitest.

**Spec:** [design](../specs/2026-11-10-company-a-demo-mount-design.md), subordinate to [frozen demo contract](../../demo/demo-contract.md).

## Global Constraints

- Original demo checkout/database remain untouched. Use designated integration worktree and isolated test namespaces; never stop its shared cluster.
- One source writer and SQL/service owner at a time; no subdelegation by implementers.
- Fixture / development-fixture mode, local-demo-v1, one explicitly approved Company A customer. Runtime hashes come from actual registered approval.
- Current balance 80000 → 50000, cutover remains 80000; expected values belong in tests, never fabricated runtime receipts.
- Runtime worker has no model SDK/client/key. Preview writes zero parent money. Operator capability is separate from reviewer/source/service credentials.
- Preserve checked cents, actual unfiltered source pages, immutable history, current authority and accepted P1 boundaries.
- General selectors, scheduling, grants, live construction, CSV, UI/client and migrations are outside scope.
- Machine checks, independent review, bounded demo proof, full V5/V6 and joint acceptance remain separate.

## Review Focus

1. Exact recovery must validate immutable history; absence of pending input is not success (Task 1).
2. Unapproved, paused/revoked or foreign pending input cannot gain new parent effects (Task 1).
3. Capture drain bounds must fail before applying a truncated suffix (Task 1).
4. Operator/source/service credential confusion and malformed private responses fail closed (Task 2).
5. Supervisor child environments and CLI uncertainty must preserve model/token isolation and honest retry output (Task 3).

### Task 1: T2 fixed capture and exact scenario receipt recovery

**Files:** Create `packages/contracts/src/demo-company-a.ts`, `apps/worker/src/demo-sync.ts`, `apps/worker/test/demo-sync.test.ts`, `tests/integration/demo-company-a-sync.test.ts`. Modify `tests/fixtures/activation-proof.ts` to add optional seed parameters defaulting to current activation-policy seed, and `tests/fixtures/sync-apply.ts` to accept optional third `{seed?:string}` options passed into proof generation/original checks. Reuse its existing activation/provision/cleanup and PR56 operator exports; no new fixture file.

**Interfaces:** Export server-only fixed identities/scenario and strict safe request/response schemas through direct import, not contracts root. Export `createCompanyADemoSync({db,clock,registered,fetchChanges,observe})` with `runOnce(): Promise<ReceiptResponse>`; `fetchChanges(sourceRef,streamId,after)` and `observe(sourceRef)` use existing source types. Implementation may refine TypeScript parameter types within this signature from actual APIs. Runtime registered reader and genuine stored A5 supply hashes/identity; callers cannot provide plans or approval.

**Behavior:** PR56 generic `/internal/apply` and `composeWorkerSync` remain unchanged and are not rebuilt. Follow the [PR56 delta](../../progress/2026-11-10/company-a-pr56-design-delta.md); fixed operator orchestration uses the accepted applier directly, without self-HTTP or caller plans. Implement the design's six-step run-once algorithm. Exact validated historical recovery precedes new application; bounded locator must find overlap with either event then require exactly the pair, and must validate referenced P1 unit/fixed asOf/lane/scenario facts (not receipt IDs alone); complete bounded unchanged source pages are durably captured; prepare uses the frozen instant; only the frozen payment/allocation scenario is eligible; accepted applier rechecks semantics/authority and commits. Unexpected/foreign/extra pending input fails without filtering. No migrations or accepted writer changes. A need for extra paths returns to coordinator.

- [ ] Add meaningful failing tests after minimal exports exist: genuine T0 approval and 80000 baseline, actual source injection then capture/apply 50000, same receipt replay and one effect, cutover/approved snapshot preservation, absent approval, pause/revoke new-write block, foreign/extra pending input, bounded fetch failure including exact budget/terminal empty probes and stalled refetch, conflicting/partial receipt associations fail closed, valid historical unit with exact IDs but wrong facts/asOf rejected.
- [ ] Record intended assertion failures, not setup/import failure as RED.
- [ ] Implement the bounded service and fixture; reuse genuine protected financial/bootstrap producers and explicit reviewer intent.
- [ ] Run `npm run typecheck`, `npm run test:unit -- apps/worker/test/demo-sync.test.ts`, `npm run test:integration -- tests/integration/demo-company-a-sync.test.ts`, and existing `tests/integration/sync-apply-fixture-lifecycle.test.ts` plus `tests/integration/sync-apply-mount.test.ts` for default-seed helper compatibility. Save exact commands/results, source SHA and retained evidence.
- [ ] Self-review and commit a coherent candidate; report limitations and return source/test lease for fresh independent review.

### Task 2: Private source and worker HTTP transports

**Files:** Create `apps/control/src/demo-source-composition.ts`, `apps/worker/src/demo-sync-composition.ts`, `apps/worker/src/demo-source-client.ts`, their matching tests under each app's `test/`, and `tests/integration/demo-company-a-transport.test.ts`; modify `tests/fixtures/sync-apply.ts` only if HTTP setup requires a separately justified extension; prefer setup local to the transport test.

**Interfaces:** Design's fixed control injection POST, private change-feed GET, and worker sync POST; direct Task 1 service invocation. No dynamic financial request fields. Existing source capability reads feed; distinct enabled operator token mutates source/triggers worker. Source package unchanged.

- [ ] Write failing strict-auth/body/query/disabled and HTTP client malformed/redirect/oversize/timeout checks.
- [ ] Implement bounded transports and real isolated HTTP fixture.
- [ ] Prove real operator inject → source HTTP → durable capture → worker apply, unauthorized/preapproval zero parent writes, original receipt recovery after worker reconstruction/lost response, and foreign input containment. No harness injection stub.
- [ ] Run typecheck and the three new app unit files plus transport integration. Record evidence, self-review and commit for fresh Astra review.

### Task 3: Supervisor, CLI and operator setup

**Files:** Modify `scripts/dev.ts`, `apps/control/src/composition.ts` (optional demo configuration using its existing source instance), `tests/fixtures/sync-apply.ts` (narrow fixture-only role setup projection), only inject branch of `scripts/verify-slice.ts`, `tests/integration/demo-company-a-transport.test.ts` for mounted/process proof, and implementation-status/invocation text only in `docs/demo/demo-contract.md`. Create `scripts/demo-inject.ts`, `tests/integration/demo-inject-cli.test.ts`, `tests/fixtures/demo-company-a-process.ts`, `docs/demo/company-a-sync-setup.md`.

**Process-proof design:** Follow [grounded process delta](../../progress/2026-11-10/company-a-task3-process-design.md). Reuse actual role mounting and extracted explicit environment builder; fixture paths are injected only through typed test launcher APIs. Worker IPC/config receives only registry/policy paths, not control/protected paths. Single global-fetch guard + positive control in actual worker, accurately labeled bounded HTTP-path evidence (not all-egress). No new dependency or generic launcher/network framework.

**Interfaces:** Existing `npm run demo:inject -- freshPaymentA` delegates to new CLI and the accepted Task 2 endpoints. Explicit supervisor enable/token mounts; token never reaches web/product tools. No package.json change needed.

- [ ] Write failing CLI input/non-2xx/malformed/timeout/uncertainty tests and supervisor isolation/mount proof.
- [ ] Implement fixed CLI and supervisor composition with explicit child environment allowlists and distinct tokens; validate safe receipt response before printing success.
- [ ] Document isolated operator setup/retry and honest limitations; preserve frozen identities and money.
- [ ] Run typecheck, CLI regressions, existing local-composition regression with absent demo config, affected fixture lifecycle cases and actual mounted transport/process proof with model credentials absent. Record commands and candidate; self-review and commit for fresh Astra review.

T5 gate, T6 additional containment and T8 rehearsal follow only after these accepted interfaces. Root owns shared board/coordination updates and owner communication. Do not claim those tasks complete from prerequisite tests.
