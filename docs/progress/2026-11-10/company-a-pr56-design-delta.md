# PR56 delta: retain only bounded T2 orchestration

Read-only architecture reconciliation against PR56 `49245de4832d4d41f9cb9d28ac74fda42e92cfb4` during the coordinator's merge. Inspected routes/sync.ts, sync-composition.ts, scripts/dev.ts, sync-apply-mount.test.ts, updated sync-apply fixture, AI-off helpers, tracked demo design and its independent review. No source edits, services, databases or tests.

## Decision

Keep Task1's small fixed-scenario orchestration service, relabel it **T2 capture and exact scenario receipt recovery**, and preserve PR56's mounted `/internal/apply` unchanged. Do not rebuild a generic apply route/composition or count the new service as completing that already-merged T1 work.

PR56 now supplies a real service-token POST `/internal/apply` with `{accountId}`, server-clock prepare, accepted applyBatch/applyReplay, and explicit `{status:'no_work',replayed:false}` when no suffix remains. scripts/dev.ts mounts it. Its proof uses actual source injection/capture and real HTTP application, but capture itself is performed by the test, uses the activation-policy seed and November observedAt, and supplies in-process semantics. It is useful accepted prerequisite evidence, not exact T0 operator-chain proof.

The remaining service is justified because PR56 does not fetch/capture pages, enforce the fixed two-event scenario, or recover a specific receipt after restart/no_work. Calling `/internal/apply` from the fixed service would still require all three missing pieces and would lose its fixed prepared subject/asOf guard: the route independently prepares at wall clock and cannot accept that guarded subject. Do not add client-supplied plans/asOf, fake the worker clock (which would also falsify committedAt), use self-HTTP, or widen the generic route merely to avoid a few shared-library calls. Both paths should reuse createSyncApplier, not copy its implementation. Task1 remains unmounted; its later operator-only facade is a distinct bounded T2 ingress, not a replacement for `/internal/apply`.

## Revised Task1 interface and ownership

Freeze base at the coordinator's completed PR56 merge SHA, not the prior plan SHA. Keep:

`createCompanyADemoSync({db, clock, registered, fetchChanges, observe}).runOnce(): Promise<ReceiptResponse>`

- `registered`: existing registered-scope reader; no registration may manufacture approval.
- `fetchChanges`: existing source service's `(sourceRef, streamId, after) => Promise<ChangePage>` signature; Task1 injects it in-process, later transport supplies the private HTTP client.
- `observe`: existing semantic preflight port; monetary core remains createSyncApplier.
- No dynamic account/scenario/amount/asOf/plan/epoch arguments. Fixed evaluation instant is separate from real commit clock.

Exact paths (six total):
1. NEW `packages/contracts/src/demo-company-a.ts`: server-only fixed identities/request/response constants as reviewed; no root export.
2. NEW `apps/worker/src/demo-sync.ts`: fixed binding check, bounded complete feed capture, P1 delegation and exact validated historical recovery only. The existing empty untracked file can become this implementation; it is not accepted source yet.
3. NEW `apps/worker/test/demo-sync.test.ts`: bounded drain and failure dispatch tests.
4. MODIFY `tests/fixtures/activation-proof.ts`: optional seed with old default, passed through generation and verifyOriginals.
5. MODIFY `tests/fixtures/sync-apply.ts`: add optional third options argument `{seed?: string}` to createSyncApplyFixture and thread it into issueActivationProofs/verifyOriginals. Existing positional arguments and behavior stay unchanged. PR56 already exports operator, operatorToken and registryRoot: reuse them. Do not duplicate its activation/provision/cleanup sequence into a new fixture.
6. NEW `tests/integration/demo-company-a-sync.test.ts`: createSyncApplyFixture(undefined, undefined, {seed:'local-demo-v1'}), assert frozen identities, use its existing scenario operator, then exercise the new service against real durable source/runtime state.

This replaces the old reservation for NEW `tests/fixtures/demo-company-a.ts`; no new fixture wrapper is needed unless a later mounted test has a concrete reason. No edits to routes/sync.ts, sync-composition.ts, sync/apply*.ts, source adapters, general selection, migrations, V5 gate or web in Task1. No scope grant or scheduler.

## Binding requirements and focused proof remain unchanged

- Recover by bounded overlap with either fixed event, then require one coherent pair-only association. ReadSyncReceipt and mandatory readSyncUnit validate financial history; apply the same fixed source/account/time/amount/invoice/unit-asOf guard on recovery as new work. Partial/extra/multiple or wrong-fact history fails, never masquerades as successful retry. Preserve invalid-history errors. Do not convert generic no_work into replay success.
- Every fetch/refetch/terminal empty probe counts against a finite request cap; <=1000 events does not prove exhaustion. Drain both streams, check empty response still matches persisted checkpoint, capture pages unchanged and fail without apply if incomplete/exhausted. Keep all independent-review corrections.
- First apply: receipt 80000→50000, two new economic records, one version/unit/receipt; current at October 3 is 50000, cutover and original approval snapshot remain 80000/unchanged. Retry after service reconstruction returns identical receipt/replayed:true. Source facts are absent from immutable discovery snapshot. Wrong/unapproved scope and extra input do not get filtered into a successful pair.
- Include a high-risk interoperability negative: a valid P1 unit containing the fixed event IDs but created through generic apply at another evaluation instant must not be falsely reported as this exact scenario's recovered unit. This is an explicit limitation of fixed-scenario proof, not an allegation that PR56's general financial result is invalid. Operator runbook must use the bounded demo command, not mix generic apply into its staged proof.
- Reuse tests/fixtures/v5-ai-off.ts where helpful, acknowledging its package-import graph limitation; do not rebuild AI-off helpers. T5 still needs bounded public observations, not automatic promotion of original live/two-source V5.

Focused validation: typecheck; new unit/integration files; existing `tests/integration/sync-apply-fixture-lifecycle.test.ts` plus PR56 `tests/integration/sync-apply-mount.test.ts` for helper compatibility. Record partial results. Other prior checks need not be repeated just for Git ancestry.

## Downstream delta only

B/C retain existing approved source-injection/private-feed/operator-facade/CLI design. Their service calls this T2 orchestrator; leave PR56's generic service-token mount in place. scripts/dev.ts later adds only enabled demo-specific plugins/token plumbing, never a second composeWorkerSync registration. Source HTTP semantics and source feed must be exercised for the exact fixed seed/event in those mounted tests. Existing Connections/Parent read-model agreement needs no change.

No material product gap was introduced by PR56. The only immediate action is freeze the merged base, narrow/rename the Task1 reservation as above, and release the held implementer after the coordinator's review. The reviewed recovery and drainage requirements remain binding.
