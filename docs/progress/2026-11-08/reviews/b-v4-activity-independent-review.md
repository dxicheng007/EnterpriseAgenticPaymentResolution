# Spec compliance: Approved

Exact candidate reviewed: `f2b5545a967766edd86485de83f20e051e9b59df`, base `15dd830cf638626d18af92c11859d57d11ff777c`, supplied exact review package `review-15dd830..f2b5545.diff`. Review and independent execution targeted the assigned idle `acquisition-evaluator/EnterpriseAgenticPaymentResolution` checkout. No source, index, HEAD, or branch changes; no subagents, merge, or push.

- `packages/storage/src/activity.ts:72` validates strict input; malformed cursor values use InvalidCursorError at line 89. `:75` rejects malformed/unsafe stored BIGINT values. `:80` returns committed H and the explicit baseline floor zero.
- `packages/storage/src/activity.ts:91` uses one parameterized SQL statement/MVCC snapshot for H and exact-run bounded limit+1 selection, with explicit `sequence <= counter.sequence` at `:96`. The empty left join still returns H. Future cursors reject at `:104`.
- `packages/storage/src/activity.ts:105` validates every fetched row, including lookahead, for schema, stream, run, stored/event sequence equality, and requested bounds. `:116` advances to the last emitted sequence only when unfinished; exhaustion advances to H. The reviewed shared page schema is reused at `:114`.
- `packages/storage/src/activity.ts:12` and `:29` add only the six requested discovery event names and typed summary fields. Existing publication transaction/counter and readActivity paths are unchanged in the diff. New helpers issue SELECTs only.
- `tests/integration/v4-activity-read.test.ts:45`, `:91`, `:111`, and `:143` cover required pagination/input/no-write, malformed lookahead, real transaction snapshot, and allowlist behavior using isolated PostgreSQL fixtures and cleanup.

# Code quality: Approved

No critical, important, or minor actionable findings. The additive implementation is compact, uses existing shared schemas, rejects inconsistent history, and preserves legacy paths. Tests make explicit cursor assertions and use transaction barriers rather than timing sleeps.

# Focused independent verification

Independent script: `/private/tmp/v4-independent-probe.mts`; executed through Node 24.22.2 with `node --import tsx`, PostgreSQL 18 PATH, assigned PG port 55435 and `EAPR_TEST_PREFIX=EAPR_TEST_NAMESPACE_PREFIX=eapr_test_review_t2`. No full suite was rerun.

Final probe execution exited 0:

1. Window and page reads succeed inside an actual `BEGIN READ ONLY` transaction.
2. Seed global events A/B/A/B/A, read A with limit 1 at H5, then commit B/A before continuation. Paging from returned nextAfter produces exactly `[1,3,5,7]`, no omissions or duplication, and exhausts at cursor 7.
3. Existing database constraints reject stored/event sequence disagreement and unsafe counter values with SQLSTATE 23514.
4. After removing those constraints only inside a disposable owner fixture, malformed lookahead event sequence and runtime stream both make the page reject rather than return partial success.
5. Unsafe BIGINT H makes both window and page reject.
6. Isolated databases and roles were dropped; the leased PostgreSQL cluster was stopped in finally cleanup.

The first probe attempt exited 1 because its corruption setup encountered the existing activity_events constraint. This was a probe setup issue, not a candidate failure; cleanup succeeded. The final probe explicitly asserts that database guard before testing application defense with disposable fixture constraints removed.

Named focused reads outside the diff: shared `packages/contracts/src/discovery.ts:246` and `packages/contracts/src/activity.ts` to check actual output validation dependencies; `scripts/native-db.ts`, `scripts/migrate.ts` import surface, package commands, and `tests/fixtures/harness.ts` to use the assigned isolated database lease; `db/control/001_base.sql:14` to explain the corruption setup guard. No changed source file was reread separately and no broad source crawl was performed.

Builder-reported 12 focused integration tests, 79 full integration tests, 198 unit tests, and typecheck are recorded in the builder report; they were not independently rerun. This review approves only the bounded V4a storage primitive. It establishes no SSE, authorization, provider, retention job, runtime bridge, live/financial acceptance, or joint user acceptance claim.
