# Scoped review: selector admission, deadline and representation clarification

Candidate: `/private/tmp/eapr-sync-selection-admission-deadline-clarification.md`

Exact candidate SHA-256: `51f66b4acda64253b72ec1ca39c2455ab9aae92c1246d868985a0410e030d285`.

Reviewed worktree: `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`.

## Verdicts

**Specification compliance: conditional alignment, not ready for acceptance.** The proposed shared admission ledger, detached summary, diagnostic units and incident references preserve the pinned complete-cut, compiler, financial and witness requirements. The distinction between a five-second admission deadline and joined cleanup is supported by the plan's explicit “admission limits” wording. The proposed count mapping is a substantive explicit interpretation of the previously abbreviated family limits, which root must accept and publish as an amendment before reader release; it cannot be described as the already implemented frozen mapping. The operational guarantee about preventing unbounded cleanup is not established by the proposed checks, for the two Important findings below.

**Design quality / implementability: request changes.** The main decomposition is implementable with the existing schemas and installed pg/types. Two concrete lifecycle gaps must be corrected before this is a reliable implementation contract. No Critical finding. Two Important findings; one Minor clarification.

This review neither accepts this candidate nor releases any reader, fixture, source, SQL, test or migration work.

## Important findings

### I1. A finite query timeout does not bound the proposed awaited `client.end()` fallback

Candidate anchors: lines 145–149, especially “never silently accept unbounded cleanup” at line 147 and the mandatory await-end/discard sequence at line 145.

Installed evidence:

- `node_modules/pg/lib/client.js:425–442`: a backend ErrorResponse clears `_activeQuery` and rejects the query before ReadyForQuery.
- `node_modules/pg/lib/client.js:702–731`: the read-timeout callback removes an unsent queued query; it does not close a normal non-pipeline connection.
- `node_modules/pg/lib/client.js:799–841`: `end()` destroys the socket for an unqueryable client or an active non-pipeline query, but uses graceful `connection.end()` when neither is present. Its promise waits for the connection `end` event without a timeout.
- `node_modules/pg/lib/connection.js:62–64,217–226`: connection `end` comes from socket `close`; graceful end writes Terminate and calls `stream.end()`. This branch does not force local socket destruction or install a teardown deadline.

A concrete state allowed by this driver is: the server emits an error; `_activeQuery` becomes null; ReadyForQuery never arrives because the connection stalls; rollback remains queued, then its positive client timer removes it. The candidate correctly selects discard, but `client.end()` now chooses the graceful branch. The positive query timer no longer applies. A stalled transport can therefore leave the awaited teardown and selector unresolved. The same issue can arise when idle status cannot be established and there is no active query.

The text is correct that a *resolved* end promise proves local closure and that local closure does not prove instantaneous remote termination. The defect is its unsupported implication that validating a positive query timeout eliminates unbounded cleanup.

**Required change:** explicitly settle teardown liveness as well as query liveness. Either document and accept that this fallback can wait without an application bound, removing the contradictory bounded-cleanup claim, or specify a separately reviewed, supported forced-local-close mechanism and ownership/settlement proof for the no-active-query state. Do not solve this by racing end and returning with a live lease, by claiming `release(true)` is awaited, or by inventing an immediate remote-termination guarantee. Add a focused future verification obligation for ErrorResponse without subsequent ReadyForQuery, queued rollback timeout, and the resulting teardown path. Existing blocked-SELECT tests alone exercise the active-query branch and do not cover this state.

### I2. `db.options.query_timeout` does not establish the leased client's effective timer

Candidate anchor: line 147. The candidate requires the effective timer to equal pool configuration, but its specified validation checks only the typed pool option and mentions silent test-wrapper overrides. There is an ordinary installed-driver override path, without any wrapper.

Installed evidence:

- `packages/storage/src/runtime-db.ts:5–6` builds a pool from an arbitrary supplied `connectionString` plus `query_timeout: 1500`.
- `node_modules/pg/lib/connection-parameters.js:54–61` merges the parsed connection string *over* the constructor configuration.
- `node_modules/pg-connection-string/index.js:40–42` copies URL search parameters, including `query_timeout`.
- `node_modules/pg/lib/connection-parameters.js:8–21,124` resolves the effective query timeout from that merged configuration.
- `node_modules/pg/lib/client.js:702` uses `this.connectionParameters.query_timeout`, not `pool.options.query_timeout`.

Thus a supported `Pool` can have `options.query_timeout === 1500` while a connection-string parameter supplies a different effective value. An empty `query_timeout` parameter falls through to the driver's default rather than the explicit pool option. The installed default is disabled (`node_modules/pg/lib/defaults.js:76`). A typed check of the pool field alone therefore cannot prove bounded rollback query settlement. Custom Pool clients/on-connect hooks and pipelined clients also need an explicit supported-pool contract; a `Pool` type by itself is not that contract.

**Required change:** define how production and fixture pool configurations establish the effective finite positive timer and non-pipeline mode before BEGIN. A narrowly enforced supported-configuration restriction that excludes connection-string timer overrides/custom behavior is sufficient if implemented and tested; otherwise specify the actual effective configuration check using a deliberately reviewed API/seam. Do not mutate pool/client options or assume that a valid pool option wins over connection-string settings. Add a focused future control showing that a conflicting/disabled effective timer is rejected before BEGIN. This is separate from I1: a genuinely finite rollback timer still does not bound graceful end.

## Minor finding

### M1. Complete the count-domain contract for embedded target cardinality and source positions

Candidate anchors: lines 67–86, 107, 113–120. Task 5 preflight “Query and byte admission” requires SQL scalar array cardinalities for embedded targets before helper decoding; Task 6's position scan uses a shared remaining cap+1 and separately validates baseline-only keys.

The proposed `observeCount(domain, keys, cause)` is key-set based. Embedded target cardinality is naturally supplied as checked scalar array lengths, not as physical row keys. The text also describes observed position rows but does not explicitly identify the ongoing-position count domain. These are implementable details, but this document is intended to settle the shared API before four owners proceed, and guessing could produce either synthetic row inventories or an unintended second/larger position allowance.

**Required clarification:** state whether embedded target structural admission is a separate checked cardinality operation keyed by physical table/PK/column, or a documented reader-owned scalar check that raises the same fixed sentinel. Preserve combined financial/metadata array counts without fetching embedded record bodies or treating fabricated ordinal keys as observed physical rows. State that ongoing positions are bounded through exact one-to-one delivery membership (the unique source/event key) or an explicit shared position domain, while baseline/original-only positions must be reached through already bounded exact references. This clarification should not impose a 1,000 cap on the valid 10,000-record target or silently count baseline-only work as ongoing work.

## Verified schema and API feasibility

I checked the physical column table against runtime002–006 and the narrow readers. **Every canonical column listed in the candidate has an actual stored digest in the inspected schema.** In particular, both `recorded_target_digest` and `planner_target_digest` exist (`db/runtime/002_parent_activation.sql:145–148`); they must not be confused with domain snapshot hashes. The import's eight columns each have their own digest. The remaining pairs are authority `grant_digest`; snapshot/financial/metadata/delivery/page/outcome `digest`; lane `manifest_digest` and `capture_digest`; incident `source_ids_digest`; unit `audit_digest`; receipt `receipt_digest` and `plan_digest`.

The candidate's canonical-table primary keys match the DDL. Scalar rows generally do **not** have stored canonical digests: their evidence reference digests must commit the strictly validated scalar projection. They are not `PhysicalValue`s and must not be forced into its stored-digest requirement. The full scalar PKs differ: e.g. initial economic outcomes use `(source_ref,seller_entity_id,kind,source_record_id)`, shared/ongoing origins use `record_id`, and application heads use `(activation_id,source_ref,manifest_hash,stream_id)`. Domain/table discriminators are necessary, as proposed. No new digest column, migration, lineage scan or authority-command canonical read is required.

The installed types support the named APIs: `PoolOptions extends PoolConfig extends ClientConfig` exposes `query_timeout`; `ClientBase.getTransactionStatus()` exists; `PoolClient` inherits promise-returning `Client.end()` and exposes `release(Error | boolean)`. Installed pg-pool removal is asynchronous, so waiting for local end before one `release(true)` is a sound ownership sequence when end actually settles. The ordinary runtime constructor specifies 1,500 ms; server-local 2,000 ms remains independently required. No unsupported per-query configuration extension is needed for the candidate's chosen approach.

## Scope and specification assessment

- A single context surviving reader failure solves both deduplication and truthful timeout progress. The live ledger stays outside the detached cut; adding `admission` to the internal cut preserves the public source/asOf boundary and the one-argument pure inspector. Summary bytes are neither evidence closure nor a witness preimage replacement.
- The table intentionally distinguishes physical observations from logical root caps. Eight enrolled source imports do not preclude bounded transitive imports; a shared-origin row plus its domain mirror must not halve the 1,000-original allowance. Initial receipt aliases have no additional physical byte charge. Distinct physical copies are charged even when contents agree.
- Root should explicitly approve the outcome-domain split: up to 1,000 P1 outcome keys, 1,000 initial-association keys and 1,000 legacy-association keys does not mean a single union cap of 1,000 physical `counts.outcome` rows. This is disclosed at candidate lines 115/120; it is an operational interpretation requiring publication, not a hidden larger ongoing-delivery allowance. The logical ongoing/original/receipt/target caps themselves remain bounded. Scalar observations do not establish completeness without the existing bidirectional membership and strict-history validation.
- Fixed ordering, checked arithmetic, exact-fit admission, retention of previously admitted bytes on failure, and global zero proposals after any later limit are consistent. The diagnostic-unit proposal is stricter for large complete classifier entries, explicitly disclosed, and preserves the guard-prefix ruling. It also admits that routing/compiler computation can happen before derived-byte rejection; it claims neither bounded heap nor response bytes.
- The complete witness keeps source guards, full/selected classifications and held dependency observations, including the full mapped-index no-match hash. Incomplete results do not fabricate a classifier array or a complete witness. Proposal hashes and witness hashes retain their accepted equations.
- Incident evidence commits full PK, exact validated summary including observedAt, and source-ID digest. The incident writer's key excludes observedAt (`capture-store.ts:160–172,273–294`), so the added evidence digest correctly covers the omitted fact. Closed-gap references remain retained; only exact same-lane/stream page digest plus independently complete contiguous chain proves closure. Conflict incidents remain unresolved. This does not weaken incident coverage or invent a resolution policy.
- The five-second rule is an admission boundary, not a response-time bound. Starting it after awaited checkout, joining the reader, guarding all actual query boundaries, checking COMMIT command/status and deadline, and classifying only after release are coherent. Normal successful rollback plus idle status proves session transaction completion; transport teardown cannot prove instant remote backend termination. The remaining defects concern local liveness claims, not permission to make proposals after an incomplete read.
- The accepted legacy-history refusal clarification remains separate and unchanged. This candidate need not force reverse legacy enumeration after a sound unsupported-history stop. A ready cut still requires complete global original/delivery/history closure; an incomplete legacy stop grants neither acknowledgment nor completeness.

## Evidence and limits

The candidate and all four hashes it pins were independently checked and match: design `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`, plan `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`, closure supplement `40fb3ee45cfde69d73744964ef48d4a90ded10ae880b52d4fcaad537810e2d42`, Task 8 preflight `61e622436c7228f92cc5ee4149d9f2031b446342ea4b9de4f15ed407958567e7`.

Read-only inspection included Tasks 5–8 preflights, Task 8 brief, accepted selection interfaces/guard/router/closure boundaries, runtime schema, narrow activation/snapshot/capture/history reader dependencies, runtime pool construction, and installed pg/pg-pool/pg-connection-string/types implementation. This was not a whole-source audit or an implementation review of not-yet-released readers. No tests, database commands, services, dependency installations, Git/source changes or subagents ran. Only this report was written. Driver-edge findings are source-supported analysis, not claims of executed transport fault injection. Query-plan, backend timeout, typecheck, future reader closure and all required integration proofs remain unexecuted.
