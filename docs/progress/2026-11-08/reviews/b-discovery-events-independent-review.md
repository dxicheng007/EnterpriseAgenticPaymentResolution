# M1 discovery events independent review

- Base: `735e680088f3fb4ad43ed1a72439a1f293351879`
- Exact candidate: `a32721ce9d50472d69b8644cab42940912176f7d`
- Branch: `codex/discovery-events`
- Reviewed worktree: `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`
- Scope: M1 server transport and sibling composition only; M2 client/UI excluded.

## Verdicts

**Specification: PASS for assigned M1 scope. Quality: PASS.** No actionable findings in the reviewed candidate. This is independent source review, not joint user acceptance or a V4/live completion claim.

The complete three-file diff was reviewed against the M1 handoff, applicable repository/area guidance, and the discovery cursor freeze. Named dependency seams inspected were the existing activity window/page readers, cursor helpers, reviewer session authorizer, lifecycle route ownership, and service/repository run authorization.

## Findings and evidence

- Authentication precedes run/cursor validation and storage-window access. Initial authorization delegates to `readState`; the stream repeats the reviewer authorizer and actual run policy before every page and after each backpressure drain. The production composition passes `service.readState`, preserving source grants and reviewer ownership instead of substituting a transport-specific SQL check.
- Explicit `after` takes precedence over Last-Event-ID. Existing strict decoding provides canonical encoding, run binding, safe integer, size, future and retained-floor checks. SSE IDs use each event's sequence. Internal continuation advances only after the page is sent, and empty scans do not emit checkpoint events.
- The reader supplies validated control-only, run-filtered pages. The route requests 100 events, sends serially, and awaits drain before continuing; it does not accumulate history across pages. Disconnection, retirement and shutdown abort waits and prevent further reads/writes after outstanding operations settle. A genuinely stalled socket is destroyed on retirement/shutdown.
- Pre-header failures use no-store, allowlisted API errors with correlation IDs. Post-header replay/policy failures use the minimal redacted resync frame. Timers and response listeners are cleaned up through abort/finally. The 60-second retirement is distinct from session failure.
- Composition registers events beside lifecycle, avoiding lifecycle's query prohibition. Lifecycle remains the only owner of `service.close`; the new plugin owns active stream stops.

## Verification and limits

Verified candidate HEAD and clean worktree. Independently ran `git diff 735e680088f3fb4ad43ed1a72439a1f293351879..a32721ce9d50472d69b8644cab42940912176f7d --check`: passed.

Reviewed the builder's focused evidence: typecheck passed; 15 tests across discovery events and activity readers passed against isolated PostgreSQL on port 55438. The new tests cover cursor errors/precedence, source rejection, restart-invalidated cookies, redacted failures, interleaved runs and page continuation, internal empty-scan progress, policy revocation at poll/drain, reconnect from delivered IDs, cancellation, shutdown, and simulated normal retirement. These checks were not rerun because review found no concrete concern requiring duplicate execution.

The stream tests inject the run-policy seam; production policy wiring was checked by source inspection, while the composed-route test establishes unauthenticated rejection. Backpressure and elapsed retirement use deterministic seams rather than a wall-clock slow-client stress test. Already-running PostgreSQL operations are not cancelled by the stream abort; the code checks abort before subsequent transport work. No browser behavior, model provider behavior, runtime stream, full F7/V4 gate, or user acceptance was evaluated.
