# Discovery monitor implementation report

M2 started on `codex/discovery-monitor` at `09e89f0215756f150fafd08c0b4d5722b9ff4f7c`. The handoff SHA-256 matched `1c240df6ff66ca73356a49ea3a9986a860b1cca3ee08ad33f465cf1401726777`.

| Revision | Role |
| --- | --- |
| `9515f3166ceee84fe10ef0d5eedbf64dc354020e` | Initial bounded monitor implementation |
| `85f76868105737b3d718ee7fe5c46f5e75a7b975` | Accepted M1 integration and M2 comparison base |
| `714f48307d1288865cab939ddccd2cbe54507b94` | M2 branch merge of accepted M1 |
| `3f6a9fceb4cfc4b5987f0b1ac78c2571e37cfe1a` | Final M2 candidate |

The final comparison contains five files. The client reads the opaque cursor first, authoritative state second, and the scoped stream third. It validates each complete activity frame, enforces a 64 KiB pending frame limit, and delivers one frame at a time. Normal reconnect waits 500 ms and resumes after the last delivered event. The sequence watermark deduplicates the single control stream and a state revision guard prevents reordered responses from regressing displayed state. Session recovery checks the active generation, invalidates the shared session cache on a real 401, and attempts one automatic bootstrap per episode. A real 403 ends monitoring. The recent list retains at most 200 events and state remains authoritative for task and usage totals.

The Discovery page accepts a selected run ID and retains it in the URL fragment. It shows pinned binding, task progress, diagnostics, in-flight work, usage, and explicit model, cost, and construction availability. Pause and resume send CSRF, a fresh idempotency key, and the displayed revision. Conflicts are visible and refetch state. A failed mutation is never replayed automatically.

The first scripted browser run reached real pause activity and unknown usage, then timed out before resume after reload. The idle SSE response can wait behind the Vite proxy until the first activity frame or heartbeat reaches the browser. The final monitor distinguishes authoritative state availability from stream connectivity. Controls can act on loaded state while the transport is connecting, with mutation authorization and revision checks enforced by the actual POST route. The real browser proof observes the stream request, checks actual successful SSE headers, and asserts committed pause and resume events rendered through the stream. The scripted client is injected by the test into the real discovery composition. The separate default-mode case uses ordinary local composition.

## Machine verification

Node 24 and PostgreSQL 18 from Homebrew. The integration and browser checks used the assigned isolated lease.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
export EAPR_PG_PORT=55434 EAPR_TEST_PREFIX=eapr_test_review_t1 EAPR_DEMO_NAMESPACE=eapr_review_t1
export EAPR_CONTROL_PORT=3201 EAPR_WORKER_PORT=3202 EAPR_WEB_PORT=5175
npm run typecheck
npm run test:unit
npm run test:integration -- tests/integration/v4-activity-read.test.ts tests/integration/v4-discovery-events.test.ts
npm run test:e2e -- tests/e2e/v4-monitor.spec.ts
git diff --check 85f76868105737b3d718ee7fe5c46f5e75a7b975..3f6a9fceb4cfc4b5987f0b1ac78c2571e37cfe1a
```

Typecheck and diff check exited 0. Unit passed 295 tests across 39 files, including 16 monitor client cases. Focused real PostgreSQL passed 15 tests across two files. Browser passed two Chromium cases, including the real durable scripted run through M1. Browser tracing was disabled for authenticated requests. The Playwright runner emitted an environment color warning.

Machine verification covers this bounded M2 increment and its real M1 dependency. Independent review and joint acceptance are pending. The durable browser fixture uses one scripted coordinator with unknown usage and preserves its model call count through reload. Full V4, live provider execution, generated connector construction, and financial behavior are outside this proof.
