# Apps

Follow the [repository instructions](../AGENTS.md) and [PRD local process boundaries](../prdv2.md#local-process-boundaries).

| Area | V0 responsibility |
| --- | --- |
| [Control server](control/src/server.ts) | Own the control pool. Combine its migration probe with a timed, service-authenticated worker health request for `GET /api/health`. Report 503 when either side is unready, with redacted diagnostics. |
| [Worker server](worker/src/server.ts) | Own the runtime pool. Serve authenticated `GET /internal/health` on loopback and probe only the runtime DB. |
| [Browser entry](web/src/main.tsx), [app](web/src/App.tsx), [health page](web/src/features/health/HealthPage.tsx), [proxy](web/vite.config.ts) | Render per-service health and retry through the control API. The browser has no service or database credentials. |

Inject dependencies through the service builders and register assigned feature routes through the existing `featurePlugins` option. Preserve the service boundaries and shared response schemas. Control uses its worker client for worker operations. The worker never connects to the control database or receives model calls, an SDK, or a model key.

The [preview feature plugin](control/src/routes/preview.ts) exposes the frozen preview route when explicitly mounted. It requires an injected read authorizer, immutable source snapshot reader and scoped target reader. Candidate registration is optional and uses the injected registry writer. The default local composition has no preview mount until real adapters are available.

## Planned surfaces

- Source evidence, preview and review surfaces follow [V1](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v1--inspect-both-acquired-companies-and-their-evidence), [V2](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v2--preview-an-executable-connector-without-writing-the-parent), and the frozen [verification protocol](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol). Agents can request protected verification within their capabilities. They cannot choose expected outputs, fixtures, or runner paths.
- [V3 review and activation](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v3--approve-one-customer-and-inspect-the-parent-import) consumes the [trusted activation bridge](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f5--immutable-receipts-and-trusted-activation-bridge). Only the authenticated reviewer route can construct the trusted bundle after checks. The worker recomputes and commits authority for the exact customer. Control mirrors the worker receipt. Agent tools, arbitrary report JSON, and a UI state change grant no authority.
- [V4 build activity](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v4--let-collaborating-agents-construct-the-reviewed-connector) and [V5 connection operations](../docs/superpowers/plans/2026-11-08-implementation-plan.md#v5--keep-the-connection-running-with-no-ai) consume the [durable activity and cursor protocol](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f7--durable-ui-activity-and-cursor-protocol). Activity persists before emission. Replay is ordered per stream and resync follows the frozen high-water cursor sequence.
