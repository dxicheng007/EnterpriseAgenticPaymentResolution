# M2 discovery monitor — independent exact-candidate review

- Reviewer: fresh independent `/root/astra_discovery_monitor_verify`; separate from builder and supervising `/root`.
- Candidate: `3f6a9fceb4cfc4b5987f0b1ac78c2571e37cfe1a`, branch `codex/discovery-monitor`.
- Accepted M1 comparison base: `85f76868105737b3d718ee7fe5c46f5e75a7b975`.
- Read-only candidate checkout: `/Users/devincheng/.codex/worktrees/acquisition-sources/EnterpriseAgenticPaymentResolution`.
- Contract: bounded M1/M2 handoff `b-discovery-monitor-handoff.md`, executable discovery v3 freeze and existing F7 protocol; report records handoff SHA-256 `1c240df6ff66ca73356a49ea3a9986a860b1cca3ee08ad33f465cf1401726777`.

## Verdict

Spec: **pass for bounded M2**. Quality: **pass**. Verification: **pass for bounded M2**, with provenance and limits below. Status: **verified**. Joint acceptance: **pending**.

No actionable defects found. This verdict covers the exact five-file candidate diff, not full V4, live construction, or subsequent integrated commits.

## Review coverage

Read the entire candidate versions and base comparison of `apps/web/src/App.tsx`, `apps/web/src/features/discovery/DiscoveryPage.tsx`, `packages/client/src/discovery.ts`, `packages/client/test/discovery.test.ts`, and `tests/e2e/v4-monitor.spec.ts`. Also inspected shared HTTP/session caching, activity/discovery schemas, lifecycle service/action seams, M1 SSE route, repository/area instructions, frozen cursor semantics, implementation and verification conventions, and builder report.

- Cursor → state → connect order is explicit, including resync. Ordinary reconnect uses the latest delivered event cursor. Event receipt triggers authoritative state reads; monotonic state revision and single-control-stream sequence guards prevent regressive projections and duplicate counters.
- Fetch streaming bounds each pending frame at 64 KiB and awaits delivery one frame at a time. Split bytes are retained until a complete frame; wrong-run/malformed/truncated frames resync safely. Reader cancellation, abort checks and reconnect timer cleanup prevent previous generations from publishing into a new run.
- Current-generation 401 clears the shared CSRF/session cache before coalesced bootstrap. A second 401 before successful authenticated connection stops; 403 does not refresh. Generic post-header resync returns to actual cursor/state HTTP authorization. The App expiration listener shares the cache and does not unmount/reset the monitor recovery episode.
- Loaded state and connected activity are distinct. Pause/resume is allowed on loaded state while the idle stream is still connecting, using authenticated POST with CSRF, current displayed revision and fresh idempotency key. Conflict refetch is explicit and does not replay mutations. The real browser assertions observe SSE response headers and committed pause/resume activity, not merely a pending request or state response.
- UI retains at most 200 recent events, renders authoritative task/usage/in-flight values, and states unavailable model/start/cost/construction honestly. Explicit saved-run selection introduces no list/start endpoint, unsupported result links, approval action, or parent-write authority. Worker and protected evidence surfaces are untouched.

## Evidence and independent checks

Builder-reported exact-candidate checks: typecheck exit 0; 295 unit tests in 39 files (16 monitor cases); 15 focused real PostgreSQL tests covering activity reader and M1 stream; two real Chromium monitor cases. The browser uses an explicitly injected scripted client for durable state/activity and separately tests ordinary no-client composition. Authenticated tracing is disabled. I inspected the test assertions and report; I did not rerun these identical suites or independently inspect their raw logs.

Reviewer commands in the candidate checkout:

- `git rev-parse HEAD`: exact candidate above.
- `git status --short`: empty.
- `git diff --stat 85f7686..3f6a9fc` and `git diff --numstat 85f7686..3f6a9fc`: exactly five files, 911 insertions and 3 deletions.
- `git diff --check 85f76868105737b3d718ee7fe5c46f5e75a7b975..3f6a9fceb4cfc4b5987f0b1ac78c2571e37cfe1a`: exit 0.
- Independent ephemeral Node 24 check using `node --import tsx --input-type=module` and the actual client exports: supplied an SSE heartbeat plus a valid CRLF activity frame containing `é`, split into one-byte stream chunks. Asserted exactly one deep-equal validated event/cursor delivery. Then supplied an initial cursor HTTP 403 to `createDiscoveryMonitor` and asserted rejection, zero state/activity callbacks and exactly one fetch (no bootstrap/reconnect). Exit 0, both assertions passed. This covers additional byte-boundary parsing and initial-denial behavior without duplicating a suite or changing candidate files.

The leased PostgreSQL and service ports were not needed or started. No candidate code, index, branch or commits were changed.

## Limits

No screenshot artifacts are listed in the implementation report, so independent visual layout review is not claimed. Browser interaction proof is builder-reported and its assertions were independently inspected. No full `verify:slice V4`, real provider execution, genuine generated connector, financial correctness, activation, runtime synchronization, or joint user acceptance is established here. The default composition remains model-unconfigured. Integration and any later candidate require their own exact-revision record.
