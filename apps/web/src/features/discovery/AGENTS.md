# Discovery monitor

Follow [apps guidance](../../../../AGENTS.md) and the [reviewed monitor handoff](../../../../../docs/progress/2026-11-08/handoffs/b-discovery-monitor-handoff.md). This page opens an explicit saved run ID. It does not invent run listing, start flows, proposals, approval actions or a scripted production model.

[Client](../../../../../packages/client/src/discovery.ts) obtains cursor, authoritative state, then the bounded fetch stream. Reconnect from the last delivered cursor; events trigger state refresh and never increment financial/task totals locally. Preserve stale-generation/revision guards and bounded recent activity. Actual401 invalidates the cached session and has one bounded recovery attempt;403 stops. Pause/resume uses actual CSRF/revision/idempotency checks and never automatically replays a failed mutation.

Loaded state and stream connectivity are distinct. The default localhost composition has no model and says so. [Browser tests](../../../../../tests/e2e/v4-monitor.spec.ts) inject a scripted model only into a real test service and prove persisted pause/resume/usage and real stream delivery. [Independent review](../../../../../docs/progress/2026-11-08/reviews/b-discovery-monitor-independent-review.md) is scoped to this monitor, not generated connectors, live competence or joint acceptance.

Run focused client unit tests, typecheck and the assigned isolated browser test. Keep authenticated traces off and secrets/transcripts out of UI and artifacts.
