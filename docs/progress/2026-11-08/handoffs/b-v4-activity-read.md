# B handoff: control discovery activity read primitive

**Assignment:** Add the read-only control-stream window/page primitive and narrowly extend activity summary allowlists. No SSE/HTTP endpoint, discovery tables/scheduler, retention job, UI, worker bridge, provider, or runtime stream work.

**Authority:** accepted `v4-orchestration-contract-proposal.md` SHA-256 `b1837d309cf42af960838b61fc7a4c9aee64cb3a74150ca0f0c8b81cc715f3cf`, §6 and R3. Depends on the reviewed exports from `b-v4-contracts.md`; do not hand-copy divergent schemas. This brief corrects only test ownership: every PostgreSQL check belongs in `tests/integration`, not the unit project.

## Owned files and exact API

- Modify `packages/storage/src/activity.ts`: additive helpers and approved summary fields/event types; preserve `publishActivity` transaction/counter behavior and existing `readActivity` signature/semantics.
- Create `tests/integration/v4-activity-read.test.ts`: real isolated PostgreSQL, existing native DB/harness conventions and cleanup. No DB tests in `packages/storage/test`.
- Contract/freeze shapes come from the first brief. If an implementation exposes a gap, request the smallest B contract patch rather than changing a wire silently. No migration or root configuration changes.

```ts
readControlActivityWindow(db: Pick<Pool, 'query'>): Promise<ControlActivityWindow>;
readControlActivityPage(
  db: Pick<Pool, 'query'>,
  input: {after:number; limit:number; runId:Id},
): Promise<ControlActivityPage>;
```

Exports continue through the existing `@eapr/storage/activity` package subpath; no package export edit needed. Accept a Pool or checked-out PoolClient query surface for real transaction/barrier tests. No authorization is implied: future route owner must authorize run/source before every call/page, using the actual process-local session service. The storage reader is not an HTTP endpoint and emits no cookies, cursors, errors containing SQL, or source text.

## Algorithm to implement exactly

1. Validate `after` nonnegative safe integer, `limit` integer1..1000, runId existing Id syntax, no unrecognized input keys. Malformed numeric cursor uses existing `InvalidCursorError`; other malformed internal input is validation failure. Use query parameters, never interpolated IDs.
2. Window returns current committed control counter as `highWater` and `retainedAfter:0`. There is no pruning/retention ledger at this baseline, so zero is an explicit current implementation fact, not inferred from minimum matching event. Future retention support requires its own schema/transaction assignment.
3. Page uses **one SQL statement/MVCC snapshot** to read H (control counter) and F=0, then at most limit+1 events for exact runId with `after < sequence <= H`, ordered ascending. Return H/F even for empty projection. No follow-up unbounded page query or independent newer high-water query.
4. Reject after>H with InvalidCursorError; after=H returns empty/exhausted. Current F=0 cannot trigger old-retention resync, but shared cursor helpers already test nonzero-floor semantics for future consumers. Never invent/prune rows to claim the storage reader supports retention.
5. If lookahead exists, return only first limit rows, hasMore true, nextAfter final returned sequence. Otherwise return all found rows, hasMore false, nextAfter H. Reuse reviewed ControlActivityPageSchema; additionally check every emitted event is control/runId-matched and sequence within requested bounds. Parse BIGINT strings safely, reject corrupted/malformed rows without returning a partial success.
6. Calls perform reads only; no activity publication, capture, table mutation, cursor advancement in DB, or registry action. Do not translate an exception into successful empty history. HTTP/SSE transport error mapping belongs to A later.

**Authoritative page examples:** global `1:A,2:B,3:A,4:A`, after0/limit1/run A → events[1], H4,F0,next1,more true; after1 → [3],next3,more true; after3 → [4],next4,more false. Run C → [],next4,more false. With101 A events/limit100, event101 is retained for next page. An event committed after the captured H is excluded from this page and read later. The page's H is not a license to advance an unfinished replay.

## Narrow publication allowlist extension

Keep all existing allowed event names/fields and filtering behavior. Add only architecture-approved event types:

`discovery.started`, `discovery.paused`, `discovery.resumed`, `discovery.blocked`, `discovery.completed`, `discovery.interrupted`.

Add `proposalId`, `dispatchId`, `toolStepId` (Id); `proposalRevision`, `findingRevision`, `taskRevision` (Version); `inputTokens`, `outputTokens`, `modelCalls`, `unknownUsageCalls`, `repairRound`, `toolRounds` (nonnegative safe integer); `mode` enum scripted/live. No raw prompts/transcripts/credentials/paths/documents/hidden expected answers or arbitrary dynamic fields. This permits future publishers; it does not create fake discovery events now. ToolStepId records the server identity, not provider-native call ID.

## Red/green integration checklist

- [ ] Use existing `provisionTest`/migrate/app-role/harness conventions with unique namespace and finally cleanup. No credentials in logs, no static test DB reuse. A deterministic clock and actual `publishActivity` create source rows. Integration test needs PostgreSQL18/Node24 PATH; unit suite does not.
- [ ] Add meaningful failing assertions for empty window/page, limit1 interleaving,101/100 pagination, exact run isolation, after=H, future/negative/fractional/unsafe after, malformed ID/limit, increasing sequences and stable page bounds. Assert explicit nextAfter/hasMore values, not just count.
- [ ] Verify zero writes by before/after counters/row content and existing schema state. Invalid input and failed query do not publish a row. Validate corrupted retained event fails closed (test-only owner fixture corruption, not a product mutation endpoint).
- [ ] Add real commit/rollback barriers using checked-out clients: publication waiting before commit is absent from H/page, rollback does not advance; commit then becomes readable. Reuse F7 counter-lock ordering conventions from `v0-foundation.test.ts`; no sleeps as correctness evidence.
- [ ] Prove barrier consistency: use an actual checked-out REPEATABLE READ read transaction to pin the snapshot, commit a new event on another client, then read the page through the pinned client; page H/events stay at the prior snapshot. A fresh read sees the new event. Inspect the production query to confirm H and page are one statement with explicit `sequence <= H`; do not add a production hook merely to force an inter-query race that the implementation must not have.
- [ ] Assert newly allowed summaries survive publication; raw credentials/provider response text/source document/path/hidden-answer keys are removed as before. Existing allowed events remain accepted. Existing `readActivity` behavior remains unchanged.
- [ ] Run `npm run test:integration -- tests/integration/v4-activity-read.test.ts tests/integration/v0-foundation.test.ts`, focused existing activity unit checks if present, and `npm run typecheck`. Record exact results as partial V4a storage evidence; no SSE/live/V4 acceptance claim.
- [ ] Commit only the reader and integration test with subject `feat: read bounded control activity pages`; report exact commit and tested signatures/window/page vectors to root for fresh review before A uses them.

## Consumer handoff after review

A's later run-scoped SSE uses this reader's safe nextAfter; each event's ID is its emitted sequence, and internal nextAfter advances only after sending the page. A must not call standalone cursor/window to skip unfinished replay. C later follows cursor-first/state-second/reconnect-third and deduplicates stream/sequence. Current sessions have no expiry metadata; route authorizes actual state. Full frozen composite `/api/events` and runtime activity require a separate real worker read bridge; neither is implemented by this primitive.
