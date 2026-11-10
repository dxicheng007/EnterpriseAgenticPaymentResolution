# Independent plan review — authority operations ingress

Reviewed plan: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution/docs/superpowers/plans/2026-11-10-authority-operations-ingress.md`.

Exact SHA-256: `eff819287185eb750733329648b057e1f4f45500e8648a44e64f21fda29711a7`.

Approved design: `docs/progress/2026-11-10/authority-operations-ingress-design.md`, verified SHA-256 `53b42ecc85ece726742e76745d20341da0e65e10964a1a4e60b68e0710be1edd`. Its saved independent review approves that exact design with no unresolved findings. Both hashes were checked again at the end of this review.

## Verdicts

**Specification: approved.** The plan faithfully implements the approved bounded HTTP adapter without modifying accepted current-authority semantics or adding product permission rules.

**Plan quality and implementability: approved.** Interfaces, ownership reservations, sequencing, failure handling and required evidence are sufficiently concrete for implementation after root dispatch and the active apply writer's release.

**Actionable findings: none.** Zero critical, important or minor findings. No additional product clarification or architectural redesign is required by this review.

**Verification: static plan review only.** No implementation, test pass, mounted availability, full slice acceptance or joint user acceptance is established.

## Review assessment

### Authorization and admission races

Tasks 1–3 preserve the required distinction between authenticating the channel, binding an operation to an original request, and freshly authorizing that request. The descriptor/hash preimage, ticket syntax, action-to-mode mapping, private callback credential and strict response bindings are explicit. Public session authorization and worker/callback bearer checks precede body parsing. The narrow server hooks address malformed URLs and overlong parameters that Fastify may reject before route hooks.

Task 2 requires the callback to rerun the actual original request's session/Origin/CSRF authorization and recheck the identical map entry and deadline after the await. This closes the specifically identified cancellation-during-authorization race. Disconnect handling distinguishes an aborted response from normal completed request-body processing; shutdown invalidates pending entries at `preClose`. Capacity, deadlines, cancellation, cleanup and repeated matching checks all have assigned tests.

The callback checks the original reviewer/session and required account permission. Worker and the unchanged service check the committed actual source. Unrelated grant changes remain permitted. This matches `apps/worker/src/sync/current-authority.ts`, including its fresh final admission and failed-observation recovery admission. Task 4 labels test-only permission/session substitutions accurately rather than claiming a production revocation API exists.

The plan correctly preserves the accepted boundary after final admission: the short mutation transaction and bounded SQL retries do not call control or cancel an already admitted transaction when a session subsequently changes. Task 4 explicitly tests this boundary alongside per-request transaction/client instrumentation and the real SQL40001 retry path. The current `withTransaction` helper and existing current-authority test provide a feasible implementation pattern without changing production service hooks.

### Committed identity and historical recovery

Task 3's repeatable-read, read-only lookup uses the scalar account row only to locate scope, then calls `readStoredActivation` on the same client to verify the actual immutable import. The proposed result fields are available from that existing reader. Its corruption/error mapping matches the accepted authority store's known decode handling, and client release precedes subsequent admission/service calls.

The adapter does not use the mutable registry, activation-policy files, evaluator files or the connection overview to infer authority. It passes the derived identity to the existing service and leaves occupied-key ordering and actual-source authorization there. Worker validates full returned identity/source/pins; control validates the bindings it independently knows. This implements both resolved design-review clarifications.

Task 4 proves fresh same-reviewer recovery after response loss and control/session restart, unchanged original audit session, different-reviewer conflict, and historical pause replay after later revoke. A separate GET supplies current revoked state. The no-op/stale/revoked/exhaustion cases preserve existing service behavior rather than inventing reenrollment or overriding the original activation history.

### Preserved service and scope

The plan explicitly excludes edits to the accepted current-authority service, store, errors and runtime004, as well as activation, capture and apply implementations. Its factories consume the actual current service and storage signatures. The source observer uses the existing bounded source-semantics client; unavailable observation affects changed paused-to-active resume without disabling read/pause/revoke/replay.

There is no original-approver-only role, registry-removal-as-revocation rule, durable capability lease, policy reinterpretation, new financial effect or automatic reenrollment. Runtime audit remains authoritative and no control success mirror is introduced. Worker receives neither browser/control database credentials nor a model/evaluator runtime dependency.

### Ownership and implementation sequencing

The file table reserves all new leaves, shared exports, both protected build inventories and their mutation tests. Those inventory edits correspond to the existing bootstrap and financial source-build lists. Root retains the server hooks, local composition and supervisor secret wiring; Experience owns only browser/client work. No new production DDL or package/configuration change is required. The test-only SQL trigger/barrier is isolated disposable-fixture machinery, consistent with the established retry test.

Root release, shared-path reservation, database/port lease and exact-candidate review are explicit gates. Existing APIs and composition entry points support the described integration, including returning the control framework-error callback together with feature plugins. Missing admission wiring fails closed, and authority mounting does not depend on current activation setup.

### Test adequacy

The planned tests cover strict DTOs and hash binding; bounded transport/status validation; real session and callback HTTP; authorization-before-parsing; malformed route handling; private-header and actor injection; ticket lifecycle; source/account/actor changes; genuine A5 imports; corruption; registry/policy independence; retry and historical recovery; and unchanged financial/import/receipt rows. Deterministic barriers and instrumentation provide evidence for the critical ordering assertions, rather than relying on timing sleeps or a trusted fake adapter alone.

The bounded verification commands include changed unit surfaces, protected source-build tests, existing current-authority coverage and relevant composition/source integrations. Mandatory skipped cases cannot pass. Experience's separately reserved browser work remains an explicit dependency for integrated user-facing claims; this Platform plan does not claim to complete it.

## Evidence inspected and limits

Read the complete reviewed plan, approved design and its review; applicable repository/apps/packages/tests/scripts/evaluator/parent guidance; PRD product/process/approval/financial/acceptance sections; implementation verification conventions; shared ownership; frozen F1/F5/F7 and foundation sequencing; and the verification playbook. Also read the accepted current-authority plan and ad13e2f review, current authority schemas/service/store/errors, local session implementation, control/worker servers, local composition/supervisor, source-semantics client, A5 reader, protected build inventories, transaction helper and relevant existing authority integration fixture/retry code.

Only read-only filesystem inspection and SHA-256 commands were used. No Git commands, repository edits, tests, database access, provider/browser activity or subagents were used. The only write was this requested report under `/private/tmp`. The supplied planning baseline `ac968f4` was not independently verified through Git. Existing implementation/review evidence was contextual material, not recertified machine evidence. Root must still reconcile moving source APIs before dispatch and obtain fresh review of the exact implementation candidate.
