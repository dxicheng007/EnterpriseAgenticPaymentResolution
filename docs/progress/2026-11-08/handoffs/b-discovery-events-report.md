# M1 discovery events implementation

| Item | Value |
| --- | --- |
| Base | `735e680088f3fb4ad43ed1a72439a1f293351879` |
| Candidate | `a32721ce9d50472d69b8644cab42940912176f7d` |
| Branch | `codex/discovery-events` |
| Worktree | `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution` |
| Verification | Focused, partial machine evidence |
| Independent review and joint acceptance | Pending |

The commit changes three assigned paths.

- `apps/control/src/routes/events.ts` implements authenticated cursor lookup and bounded discovery-run activity replay. It reuses the strict cursor helper and the read-only activity readers. Each scan reauthorizes through the reviewer and lifecycle state policy. A drain reauthorizes before the buffered suffix can be sent. The transport polls every second when caught up, sends heartbeat comments on a 15-second cadence during healthy polling, and retires after 60 seconds. Retirement and shutdown destroy an actual stalled response if queued bytes cannot flush.
- `apps/control/src/discovery-composition.ts` registers the events plugin alongside lifecycle with the same authorizer and state reader. Lifecycle retains ownership of service close.
- `tests/integration/v4-discovery-events.test.ts` exercises the normal composition mount and uses real loopback HTTP, the reviewer session and app-role PostgreSQL for the stream checks. Test seams substitute the run authorization policy, elapsed timing, retained floor, page limit and socket backpressure where required. No production scripted client is added.

## Commands and results

Used Node 24 and PostgreSQL 18 on PATH with `EAPR_PG_PORT=55438`, `EAPR_DEMO_NAMESPACE=eapr_review_t2`, and both test prefix variables set to `eapr_test_review_t2`. The control route tests bind an ephemeral loopback HTTP port. The primary cluster was outside this run.

- Red: `npm run test:integration -- tests/integration/v4-discovery-events.test.ts` observed composed unauthenticated cursor response 404 versus expected 401 before implementation.
- `npm run typecheck` passed.
- `npm run test:integration -- tests/integration/v4-discovery-events.test.ts tests/integration/v4-activity-read.test.ts` passed 15 tests in two files, including 11 new tests. An earlier run exposed a test lease label exceeding the harness limit. The label was shortened and the complete focused command passed.
- `git diff --cached --check` passed. `git status --short` returned no entries after commit.

## Self-review and limits

The cursor check precedes SSE headers. Its committed high-water is separate from each emitted event ID. The integration cases cover query precedence, Last-Event-ID reconnect, run filtering, malformed and wrong-run cursors, future and floor boundaries, explicit no-store responses, old-cookie rejection after session restart, page continuation past 100 events, publication after an empty snapshot, normal retirement, pre-header storage failures, redacted post-header failure, authorization revocation before a poll and after drain, disconnect, and shutdown. Existing reader tests cover storage invariants. Socket backpressure and elapsed retirement use deterministic seams. PostgreSQL calls already in flight can settle after disconnect; abort prevents further page reads, waits or writes. Runtime/F7 composite streaming, live model use, browser behavior, full V4 verification and acceptance remain outside this candidate's evidence.
