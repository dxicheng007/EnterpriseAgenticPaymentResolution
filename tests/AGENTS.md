# Tests

Follow the [repository instructions](../AGENTS.md), [shared test interfaces](../docs/superpowers/plans/2026-11-08-shared-contracts.md#test-interfaces-and-fixtures), and [exact F8 fixtures and acceptance examples](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f8--initial-development-fixtures-and-acceptance-examples).

| Area | V0 responsibility |
| --- | --- |
| [Schema and fixture tests](../packages/contracts/test/fixtures.test.ts) | Verify strict structural acceptance and rejection and canonical hash behavior without DB or model access. |
| [Integration](integration/v0-foundation.test.ts) and [harness](fixtures/harness.ts) | Exercise real disposable PostgreSQL with application migrations and roles. Check readiness, role isolation, restart persistence, rollback, activity publication ordering and bounded transaction retry. |
| [Browser](e2e/v0-health.spec.ts) | Exercise visible service readiness and recovery using Playwright and controlled services. |
| [Fixture exports](fixtures/index.ts) | Provide schema-validated public development-only data, with frozen identities, versions, computed hashes, and expected examples. |

The [preview integration tests](integration/v2-preview.test.ts) exercise real control HTTP, a test-only worker HTTP read, and unchanged control/runtime PostgreSQL schema and ledger state. Source captures, target records and candidate registration are explicit development fixtures. Actual persisted parent reads and registry integration require their own checks.

The [local composition integration tests](integration/local-composition.test.ts) use real PostgreSQL, generated visible uploads, and captured evidence to exercise reviewer bootstrap, restart, both company previews, and unchanged runtime schema, ledgers, and activity. The target is an empty fixture. The [standalone evaluator integration tests](integration/v2-verification.test.ts) exercise the separately composed protected verification route.

Use deterministic barriers for transaction ordering, as specified in [F7](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f7--durable-ui-activity-and-cursor-protocol). Preserve spec-derived expected results when the implementation disagrees. Fix the implementation or raise the precise spec gap through the repository clarification rule.

Public development fixtures are separate from future live construction and protected holdouts. Follow [F6](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol) for independent expected calculations, immutable truth, and evaluator-only access. Schema acceptance alone cannot establish compiler, financial, or live behavior.

Run focused checks while developing and record them as partial. Use the [V0 plan](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v0--open-a-running-system-with-durable-isolated-services) and [G0 review procedure](../docs/superpowers/plans/2026-11-08-verification-playbook.md#g0--does-the-application-persist-state-and-respect-its-boundaries) for full V0 evidence. Record [machine verification, independent review, and joint user acceptance](../docs/superpowers/plans/2026-11-08-verification-playbook.md#what-verification-means) separately. Missing or skipped mandatory cases prevent a machine pass.
