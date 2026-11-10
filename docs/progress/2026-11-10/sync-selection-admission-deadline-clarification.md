# Proposed selector admission and deadline clarification

Document-only candidate for root and fresh independent review, 2026-11-10. This grants no implementation, source, SQL, service, test, migration or fixture release. The baseline fixture agent remains the only source writer. No product or financial-policy gap was found in these three questions; these are proposed internal representation and operational interpretations. The separately owned Task 7 legacy-history question is not decided here.

Read and SHA-256 verified in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`:

- `.superpowers/sdd/2026-11-10-sync-selection/task-8-preflight.md`: `61e622436c7228f92cc5ee4149d9f2031b446342ea4b9de4f15ed407958567e7`.
- `docs/progress/2026-11-10/sync-selection-design.md`: `0f01668bffbfe799ba38f940781d6e1a2e37e6b6a6a4585ede7095c8db1b3b6d`.
- `docs/superpowers/plans/2026-11-10-sync-selection.md`: `89b4004bfb6e453f1bbd3069c43e2e89c11debda8f134e77aa8d5e81f97d26c0`.
- `docs/progress/2026-11-10/sync-selection-closure-interface-clarification.md`: `40fb3ee45cfde69d73744964ef48d4a90ded10ae880b52d4fcaad537810e2d42`.

Also read Task 8 brief, Tasks 5–7 preflights, progress rulings, accepted `selection.ts`, capture/history readers, runtime002–006 DDL and installed pg 8.23.1. References below are repository-relative specification/source anchors, not new authority.

## 1. One physical admission ledger, with an explicit immutable handoff

**Decision proposed:** Task 8 owns a fresh inspection context. Tasks 5–7 share that exact context and leased client. Do not reconstruct admission from `SelectionEvidence.bytes`, re-encoded returned DTOs or per-stage sums. Evidence references establish provenance; a physical admission ledger establishes size and observation accounting. Aliases, scalar sentinels and bytes admitted before a later failed decode make them different inventories.

Add only the following DTO field and internal reader context. Existing public `SelectionInput`, result/witness schemas, one-argument pure inspector, and ready/incomplete discriminants remain unchanged. The summary field is deterministic admission metadata, not trusted external input and not a new witness-preimage field.

```ts
// selection.ts
export type SelectionReadSummary = {
  counts: Partial<Record<EvidenceFamily, number>>;
  canonicalBytes: number;
};
// Add to the existing SelectionCut, retaining every existing field:
//   admission: SelectionReadSummary;

export function inspectSelectionCut(cut: SelectionCut): SelectionInspectionV1;

// selection-read.ts; all new exports below are internal worker/test interfaces.
export type SelectionReadContext = {
  admission: SelectionReadAdmission;
  assertActive(): void; // fixed internal timeout sentinel, no SQL or checkout
};
export function createSelectionReadAdmission(): SelectionReadAdmission;

export function readSelectionCatalog(
  client: PoolClient, input: SelectionInput, context: SelectionReadContext,
): Promise<SelectionCatalogResult>;
export function readSelectionCapture(
  client: PoolClient, input: SelectionInput,
  catalog: SelectionCatalogResult, context: SelectionReadContext,
): Promise<SelectionCaptureResult>;
export function readSelectionCut(
  client: PoolClient, input: SelectionInput, context: SelectionReadContext,
): Promise<SelectionReadResult>;
```

`SelectionCatalogResult` and `SelectionCaptureResult` name the exact existing plan result unions; their fields do not change. The third/fourth context argument is required, without a default fresh ledger. Only `readSelectionCut` produces `ready`. Direct reader tests create an explicit ledger and caller-owned context; they do not acquire transactions through a reader. `createSyncSelector({db}).inspect({sourceRef,asOf})` remains the only production caller boundary and never accepts a context, budget, limit or clock from its caller.

The proposed ledger operations are precise enough for the reader owners to implement together; their maps remain private and never enter a cut:

```ts
type SelectionCause = CutSummary['causes'][number];
type PhysicalRow = {
  table: SelectionReadTable; // closed allowlist of the tables listed below
  key: readonly string[];   // full primary key in declared PK column order
  family: EvidenceFamily;
};
type PhysicalValue = {
  row: PhysicalRow;
  column: SelectionCanonicalColumn; // closed table/column pairs below
  bytes: number;                    // checked SQL octet_length
  digest: Hash;                     // stored digest, later strictly verified
};
type SelectionCountDomain =
  | {kind: 'enrollment'}
  | {kind: 'lanes'}
  | {kind: 'streams'}
  | {kind: 'ongoing_deliveries'}
  | {kind: 'source_originals'}
  | {kind: 'target_records'; owner: readonly string[]} // relational scope rows only
  | {kind: 'family'; family: EvidenceFamily; domain: string};
export type SelectionReadAdmission = {
  observeRows(rows: readonly PhysicalRow[]): void;
  observeCount(
    domain: SelectionCountDomain, keys: readonly (readonly string[])[],
    cause: SelectionCause,
  ): void;
  admitValues(values: readonly PhysicalValue[], cause: SelectionCause): void;
  admitTargetCardinality(
    value: Pick<PhysicalValue, 'row' | 'column'>,
    counts: Readonly<Record<'invoices' | 'payments' | 'credits' | 'allocations' |
      'reversals' | 'customers' | 'accounts' | 'billingConfigurations', number>>,
    cause: SelectionCause,
  ): void;
  snapshot(): SelectionReadSummary;
};
```

The domain strings/owner keys are a closed reader-owned mapping described below, not free-form caller-selected budgets. `observeRows` records distinct actual physical rows, including an observed cap+1 row, once by table + full PK; it cannot decode or fetch a canonical value. `observeCount` checks fixed caps on the named bounded root corpus, with deduplication by the declared full key. `admitValues` reserves each distinct physical table/PK/column once. Duplicate metadata must agree on family, bytes and digest; disagreement is storage invalid. Repeated helper reads do not consume new allowance. Equal content in separate columns or rows does. All arithmetic is checked safe-integer arithmetic; malformed lengths are storage invalid; equality with either byte ceiling is admitted.

`admitTargetCardinality` is a separate structural check keyed by physical table/full PK/column, restricted to the admitted import `recorded_target`/`planner_target` columns and snapshot `canonical` column. After byte admission and before any target body/helper read, obtain checked scalar SQL array lengths for exactly the eight named arrays; require their array types, nonnegative safe-integer counts and a checked combined sum. A sum above 10,000 raises the same fixed `limit` sentinel; equality passes. Malformed types/counts or conflicting repeated cardinalities are storage invalid. This operation neither adds bytes nor fabricates observed rows/ordinal keys. It memoizes a checked physical target value across roles. Relational financial/metadata key admission remains `observeCount({kind:'target_records', owner: fullScopeKey}, ...)`, independently capped at 10,000.

Reserve values in returned scalar row order and, within a row, column-name order. Reserve an individual value atomically: reject if it exceeds 1,048,576 bytes or would make the running sum exceed 16,777,216. Do not include that rejected value in `canonicalBytes`; previously admitted values remain counted even if a subsequent stage stops before fetching them. Complete the relevant scalar admission pass before any associated helper/blob read. No reordering by estimated size, byte-content equality or eventual routing is permitted. Stage owners must document their deterministic root scan order; no result claims a later, unvisited family was inspected.

### Physical column closure and count meanings

| Physical row/key | Canonical columns charged separately | Evidence family |
| --- | --- | --- |
| `runtime_activation_imports` / `idempotency_key` | `request`, `reviewer`, `bundle`, `plan`, `activation`, `receipt`, `recorded_target`, `planner_target` | `import` |
| `runtime_authority_heads` / `account_id` | `grant_canonical` | `authority` |
| `parent_snapshots` / `account_id,snapshot_hash` | `canonical` | `target` |
| `parent_financial_records` / `record_id` | `canonical` | `financial` |
| `parent_metadata` / `account_id,family,record_id` | `canonical` | `metadata` |
| `runtime_capture_lanes` / `source_ref,manifest_hash` | `manifest_canonical`, `capture_canonical` | `lane` |
| `runtime_deliveries` / `source_ref,event_id` | `canonical` | `delivery` |
| `runtime_capture_pages` / `source_ref,manifest_hash,stream_id,after_cursor` | `canonical` | `page` |
| `runtime_capture_incidents` / `source_ref,manifest_hash,stream_id,incident_hash` | `source_ids_canonical` | `incident` |
| `runtime_sync_units` / `unit_hash` | `audit` | `unit` |
| `runtime_sync_event_outcomes` / `source_ref,event_id` | `canonical` | `outcome` |
| `runtime_sync_receipts` / `receipt_id` | `receipt`, `plan` | `receipt` |

Scalar rows contribute observed counts and validated evidence, but zero canonical-column bytes: `parent_targets` (`target`), capture checkpoints (`checkpoint`), source positions (`position`), inbox (`inbox`), application heads (`application_head`), financial origins and initial/ongoing economic mirrors (`origin`), and initial/legacy delivery associations (`outcome`). Their full keys and bounded scalar projection remain mandatory. Domain/table discriminators in evidence keys distinguish different tables sharing a family/key shape; no bare event/record ID substitutes for the full physical key. A bounded `EXISTS` result is a scalar assertion, not a returned row or a canonical value. The authority-command existence probe must not fetch command/reviewer/result/resume canonicals. Import lineage is already inside admitted plan content; no newly authorized lineage-table scan exists.

`counts` is the deduplicated **observed physical row** inventory by family, not the size of `evidence` or a claim that all caps have that same unit. Initial receipt references alias an admitted import column: they add neither a physical receipt row nor bytes. A separately persisted receipt/plan or audit containing the same information remains a separate physical charge. `SelectionEvidence.bytes` is the sum of the reference's own physical canonical columns, or zero for a purely scalar/alias reference; it is not an accounting API. The ledger is the sole total.

The fixed count-domain mapping makes the existing specific corpus limits explicit:

- Source enrollment: 8 source-root import keys. Foreign imports reached through history do not enroll new subjects; they share a separate 1,000-row import-family graph ceiling with all other admitted imports. Lanes: 8. Definitions: 32 distinct lane/stream pairs, checked against canonical definitions as well as checkpoint roots.
- Ongoing corpus: 1,000 distinct full `(source_ref,event_id)` deliveries with actual post-baseline membership. Baseline-only/original-only deliveries are counted as observed physical delivery/position rows and charged for their columns, but do not consume ongoing-corpus slots. They must be exhaustively bounded by already admitted import/bootstrap or history references; there is no unbounded baseline scan. A delivery serving both roles consumes one ongoing slot and one physical row/column charge. Ongoing positions share that same `ongoing_deliveries` set through their unique `(source_ref,event_id)` binding; the position root scan uses remaining cap+1 for previously unseen keys (disjoint ordered scans or exclusion of already admitted keys, never truncation of an overlapping scan) and calls `observeCount` with those full delivery keys before fetching canonical bodies. Later delivery admission deduplicates the same keys, never creates a second allowance. Independently validate the one-to-one `(source_ref,stream_id,sequence)` to delivery binding; a duplicate or contradictory position is storage invalid. Baseline/original-only positions use already bounded exact references and do not enter this ongoing count domain.
- Page, inbox, incident, unit and application-head families: 1,000 distinct physical root keys each. P1 outcomes: 1,000 full source/event keys; initial delivery associations and legacy delivery associations: each bounded to 1,000 exact full source/event keys with separate table domains. Their reported `counts.outcome` is the union of physical rows across the domains, not a mislabeled count of P1 acknowledgments.
- Original associations: 1,000 distinct record IDs rooted in the source-wide financial scan, including its overflow sentinel; exact shared-origin and initial/ongoing-domain mirrors are mandatory checks of those same root keys, not extra original slots. Additional original keys reached through admitted history join the same original-root set. `counts.origin` reports the actual mirror rows observed, potentially more than 1,000; this does not silently reduce the original-association corpus to 500. Missing or contradictory mirrors remain storage invalid.
- Receipts: 1,000 exact logical receipt identities across initial import aliases and ongoing receipt rows. Use `[initial, import_key, receipt_id]` or `[sync, receipt_id]`; repeated role references share a slot. Initial alias bytes remain on the import. Snapshot rows and transitive imports each have a 1,000-row family graph ceiling; target pointers have one exact row per admitted scope.
- A target's financial plus metadata record count is at most 10,000. Enforce separately for each physical embedded target value and each current relational scope set, including historical/foreign targets before a helper decodes them. `admitTargetCardinality` identifies physical table/key/column for embedded values; `target_records` owner keys identify full scope for relational sets. These specific target limits govern financial/metadata rows; do not accidentally impose a new global 1,000-target-record limit. A source-wide original root independently has the 1,000-association ceiling above. Snapshot reuse shares its structural-count check.

This table is a **proposed clarification of count domains**, including the distinction between logical original/receipt roots and their physical mirrors. The accepted plan's abbreviated “per evidence family” sentence alone does not specify these domains. Root/fresh review must accept this mapping before Tasks 5–7 treat it as released. It introduces no larger ongoing, original, receipt or target corpus and no index/schema change.

### Progress, failure and ready handoff

Task 8 retains the ledger even when a helper throws. Each scalar result records bounded observed rows before checking its applicable count sentinel. After a query/decode await, check the deadline before admitting newly returned facts or dispatching another query. A limit sentinel records the exact fixed cause; the caller takes `snapshot()` after the joined reader stops. A timeout similarly derives `CutSummary` from this same ledger, with false contract completeness, empty contract observations before pure work, and the exact known cause fields or nulls. Do not invent later facts or report estimated totals.

Each successful stage's existing `boundedFacts` is a snapshot of the shared ledger, never a delta to sum. For ready, Task 7 copies `snapshot()` into `cut.admission` only after complete catalog/capture/history closure and strict validation. Task 8 detaches and deeply freezes the whole cut before successful transaction completion; the live context and clock remain outside it. The pure inspector validates summary integer/bound invariants and seeds its diagnostic total from `cut.admission.canonicalBytes`; it neither trusts a public witness nor tries to prove the reader's physical closure from the summary. Unit fixtures must supply an explicit valid summary; no production fallback of zero bytes is allowed.

Anchors: design “One captured cut, finite reads”; plan “Interfaces and representation decisions” and Tasks 5–8; Task 5 “Query and byte admission”; Task 6 “Bounded read and relation map”; Task 7 “Preflight the physical dependency graph” and “Shared budget decisions”; Task 8 preflight “Admission handoff and pure composition”.

## 2. Deadlines govern admission; cleanup is joined, not raced

**Decision proposed:** retain the ordinary runtime pool's 1,500 ms client read timer as an earlier admission failure. Install the required server-local 2,000 ms `statement_timeout`; enforce the 5,000 ms monotonic application transaction admission deadline. Do not change pool configuration or add pg cancellation sockets, `transaction_timeout`, a server cancellation service, or a per-query config override for production.

The plan expressly calls these *admission limits*. Five seconds means: after that cutoff no new reader query, helper step, newly returned fact, ready cut or successful result is admitted. It does **not** promise a response within five seconds, immediate remote termination, or a five-second limit on post-transaction pure classification. Start the monotonic deadline immediately before dispatching BEGIN, after the single awaited checkout. Checkout failure is unavailable; never race a pool checkout and abandon its eventual client.

A SELECT dispatched just before the five-second cutoff can continue until its 2-second PostgreSQL statement timeout. The 1.5-second pg rejection may occur earlier without stopping that SELECT. Application cleanup may therefore extend past five seconds. A hard five-second remote transaction kill would be a different operational requirement requiring separately reviewed server mechanisms, not something a JavaScript timer or socket-close assertion establishes.

The required lifecycle is:

1. Strictly validate only sourceRef/asOf before checkout. Validate the supported pool contract below; await one checkout and install a lease-owned error listener. Validate the actual leased timer/non-pipeline mode before any BEGIN. A failed lease check acquires no transaction, follows joined end/discard, and yields fixed unavailable only after teardown; a failed pre-check acquires no lease. Start deadline; await exact `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; await `SET LOCAL statement_timeout = '2000ms'` before any catalog read. Check the deadline around both operations.
2. Pass a scoped call-through client/query observer to every reader/helper on that same lease. It checks admission before dispatch and after settlement, records query failures *before* P1 can translate them into `SYNC_STORE_INVALID`, and never dispatches reads after the first stop. Preserve the existing promise query signatures used by the inspected helpers; no query-config override is needed. No parallel reader queries or pipelining; no fire-and-forget helper call.
3. A monotonic deadline flag/check is sufficient: do not create a rejecting `Promise.race`. If a timer is used it only marks admission stopped. Await the one reader call, including a test wrapper delaying its promise. Guards at each actual query boundary prevent an already-running helper from dispatching another query after stop, even if it catches/wraps an earlier error.
4. On ready, check the deadline after detachment/freezing and immediately before COMMIT. Await COMMIT and require command `COMMIT` and `getTransactionStatus() === 'I'`; an aborted transaction's `ROLLBACK` command tag is not success. Check the deadline again after COMMIT; late completion yields timeout with zero proposals even though the read-only transaction ended normally. Release once; only then call the pure inspector. No classifier runs on a failed reader or failed/late commit.
5. On any stopped/error path, join the reader first, then await ROLLBACK on the same connection if usable. Cleanup bypasses the *admission* guard. In ordinary pg non-pipeline operation rollback queues behind any still-executing SELECT. Require the rollback response and idle transaction status before normal release. A query error promise alone is not proof of ReadyForQuery or idle status.
6. If rollback fails, local timeout removes its queued query, or idle cannot be established, enter `discard_wait`: await public `client.end()` and only after it settles invoke `release(true)` exactly once. Keep the error listener and lease ownership throughout. This wait deliberately has **no application time bound**; it may remain pending indefinitely if graceful teardown stalls. Do not release or return while it is pending. `release(true)` alone is not an awaited discard proof in installed pg-pool. Join all owned promises before returning; clear the admission timer when entering cleanup and in the finalizer. Never reuse this client.

### Supported pool and effective-driver check

Use the standard JavaScript `pg` 8.23.1 Pool/Client on Node 24, with ordinary driver-owned transport and promises, no native client, pipeline, custom Client/connection/stream/Promise, onConnect/verify hooks or lifecycle callbacks that mutate clients. Production pool/client options and methods must remain unchanged throughout ownership. The explicit transparent test-wrapper arrangement below may intercept the supplied pool's connect and each checkout's query without mutating either underlying object. Instrumentation cannot change the effective timeout, pipeline mode, driver end/status behavior, actual query arguments, results or errors. This is a supported internal dependency contract, not validation of arbitrary hostile Pool objects.

Task 8 owns two small checks in `selection-read.ts` (no new file/export or storage change):

```ts
function assertSupportedSelectionPool(db: Pool): number;
function assertSupportedSelectionLease(client: PoolClient, queryTimeoutMs: number): void;
// Deliberately version-pinned read-only view used only by the second check:
type Pg8231LeaseConfiguration = {
  connectionParameters: { query_timeout: unknown };
  pipeline: unknown;
};
```

The first check requires `Object.getPrototypeOf(db) === Pool.prototype`, the unsupported custom options above absent, no forced-native runtime, `pipeline` absent or false, and `db.options.query_timeout` a positive integer at most 2,147,483,647 (Node timer range). A transparent proxy of the standard pool preserves this prototype; `connect` must be callable but is not compared by function identity. The check returns the expected duration; it does not claim this is already the effective client timer. The second requires `Object.getPrototypeOf(client) === Client.prototype`, `client.end === Client.prototype.end`, `client.getTransactionStatus === Client.prototype.getTransactionStatus`, callable `query` (explicitly **no query function-identity check**), runtime `pipeline === false`, and `client.connectionParameters.query_timeout` **strictly equal as a number** to the expected duration. Missing fields, disabled/empty/default-fallback values, numeric strings and conflicting effective timers fail unavailable before BEGIN. Perform the same effective-field check at each actual dispatch, including cleanup; if it fails after checkout, dispatch no further query and enter joined end/discard. No pool/client/default mutation and no production per-query override are authorized.

The permitted test arrangement uses the unchanged service boundary `createSyncSelector({db: observedPool})`. `observedPool` is a transparent Proxy over the genuine standard fixture Pool; only its `connect` property is intercepted. That function awaits exactly one real `pool.connect()` and returns a transparent per-checkout Proxy over that same real PoolClient. The checkout proxy intercepts only `query`; all other properties use ordinary `Reflect.get`, including actual options, effective-driver fields, prototypes and the original end/status/release functions. Do not bind or replace end/status functions (which would change their checked identities), mutate a reusable client's method, alter a global prototype, perform an extra checkout, or add a setup query such as a PID lookup through this wrapper. Use existing read-only observations for any needed backend identity.

The per-checkout query closure immediately invokes the original real client's query with that real client as receiver and the exact original argument list, exactly once. It joins that real promise. SQL observation may inspect a normalized copy but cannot replace the sent SQL/values/configuration. For a selected real reader query, it may then await a test barrier **after the real query settles and before forwarding that settlement**. It returns the identical result object or throws the identical error object. This post-settlement barrier pauses the inspection before its next read while retaining the established repeatable-read snapshot; a delayed successful result can cross five seconds and exercise the application's post-await cutoff. No pre-dispatch delay, second query, synthetic settlement, changed per-query timeout, or background promise is permitted. Cleanup ROLLBACK and end/status/release remain undelayed. The already-required late-COMMIT control may separately delay only forwarding of a real successful COMMIT result; the actual dispatch and result stay unchanged. Tests must release their gates and join the inspection in cleanup.

The selector validates the proxy through the same checks, then places its ordinary admission/query observer outside this supplied query closure: selector checks → transparent closure → same real lease query → joined result/error and optional test gate → selector post-await checks. Production has no test gate or new option. Runtime prototype/effective-field checks do not prove an arbitrary closure transparent; transparency of this explicitly trusted fixture instrumentation is established by its source review and call-through assertions. The fixture verifies its underlying real client uses the original standard query/end/status methods before wrapping; this is not a service bypass or a demand that the proxy's query equal that original function. All effective-timer rejection checks still run on the forwarded actual fields, before BEGIN and at dispatch.

The two fields in `Pg8231LeaseConfiguration` are installed-driver internals absent from the public TypeScript API. This proposal explicitly adds only **read-only compatibility coupling** to them inside the lease check, with defensive shape validation; it is not a claim of a supported upstream API. Ordinary connection strings can override constructor options, so a typed pool-options check alone is insufficient. In pg 8.23.1 query_timeout URL parameters are strings; these overrides are deliberately unsupported even if numerically equal. An empty parameter falls back to the disabled driver default and is likewise rejected. The existing queryless local URLs and explicit numeric 1,500 ms runtime option satisfy the inspected construction path. A fixture requiring actual 57014 uses an explicit numeric pool timeout greater than two seconds and no overriding URL parameter, then passes the same leased check. Re-review this compatibility seam and its controls when pg changes; do not silently fall back if its shape changes.

For query/rollback admission, this verified effective timer establishes the driver's finite local rejection timer, subject to JavaScript scheduling. It does **not** bound graceful `end()`. The driver can clear its active query on ErrorResponse, receive no ReadyForQuery, and leave rollback queued until its timer removes it. With no active query, `client.end()` then chooses graceful Terminate/stream.end and waits for socket close without a timer. This candidate accepts that pending cleanup state: there is no promised finite failed-inspection response for that transport failure. Normal blocked-SELECT cancellation and successful rollback still settle as observed.

A forced-local-close alternative would require at least deliberate access to the private `client.connection.stream` and a separately reviewed destroy/close/driver-end settlement sequence, including TLS and already-ended states. It is not selected or released here. The current read-only two-field compatibility check must not become permission to mutate private driver state, call stream.destroy, create a secondary cancellation socket, or race-and-abandon end. If root requires guaranteed local teardown progress under stalled graceful close, that narrower additional driver-coupled design is a prerequisite; the present candidate makes no such guarantee.

**Exact guarantee:** successful COMMIT/ROLLBACK plus idle status proves transaction completion on the leased session before return. In a transport/discard path, **a resolved** end promise plus joined reader/query settlement proves local connection teardown and no unresolved owned query/helper promise, and discard prevents reuse. Until end resolves, the inspection and its lease remain owned and pending; no timeout/error response or teardown-complete claim is emitted. It cannot prove the remote backend stopped at that instant. Server statement cancellation or later disconnect detection governs remote termination. This physical limitation must remain explicit in the implementation report; “no race return” means no abandoned local reader/cleanup or live reusable lease, not a false assertion about a partitioned server. The connection is read-only and produces no proposal. Remote termination assertions belong only in tests that actually observe the backend.

At the actual query boundary classify SQLSTATE `57014` and this installed pg driver's own untyped `Error('Query read timeout')` as timeout. Match the latter only at that trusted boundary, never from arbitrary caught compiler/storage message prose. Store a private failure category; never expose text/SQL/cause. Preserve it if a helper later wraps the error. Deadline/local-read/server-cancellation primary stops yield incomplete `timeout` only after cleanup/discard completes (potentially remaining pending in `discard_wait`); independent primary transport/query failures yield fixed `SELECTION_UNAVAILABLE`; strict persisted binding failures yield fixed `SELECTION_STORAGE_INVALID`. Secondary cleanup errors mandate discard and do not turn a timeout into a complete result. Invalid input yields fixed `SELECTION_INPUT_INVALID` without checkout. Record the first terminal admission outcome. An already-established reader limit/other incomplete reason is not changed merely because its joined cleanup extends beyond five seconds; a deadline reached while still admitting the reader or ready/COMMIT result establishes timeout. Independent primary DB failure remains unavailable. Cleanup cannot reopen admission; no incomplete branch has proposals.

Installed evidence: `packages/storage/src/runtime-db.ts:5`; `node_modules/pg/lib/connection-parameters.js:54` (URL precedence) and `:124` (effective timer); `node_modules/pg-connection-string/index.js:40` (URL parameters); `node_modules/pg/lib/defaults.js:76` (disabled timer default); `node_modules/pg/lib/client.js:101` (runtime pipeline), `:425` (ErrorResponse clears active query), `:702` (local timer, no active-query cancellation), `:795` (status), `:799` (end); `node_modules/pg/lib/connection.js:62` and `:217` (close forwarding and unbounded graceful end); `node_modules/pg-pool/index.js:368` (release), `:172` (asynchronous removal); `packages/parent/src/sync-store.ts:42` (error translation). The proposed read-only internal-field seam is grounded in this installed source, not an asserted public driver API. These behaviors require pinning/call-through tests when dependencies change.

## 3. Canonical diagnostic charging and retained incident references

### Diagnostic units and order

The following fixes the unspecified derived-value units without changing the accepted guard-prefix ruling. Every charge is `Buffer.byteLength(canonicalJson(value), 'utf8')`, 1 MiB per declared unit, added to the **same** 16 MiB running total seeded from `cut.admission`. Arrays' separator punctuation and enclosing container syntax are not additional units. Equal serialized contents in different declared roles are separate units; repeated appearances of the same already charged role value are aliases, not new charges. Do not deduplicate by serialized content or charge the whole witness as one value.

Admit these units in this exact phase order:

1. Each `ContractObservation`, in the unchanged guard order. Keep exactly the longest fitting prefix, stop at the first non-fitting observation, and return `limit`, zero proposals and false contract completeness. A fitting `unexamined` retains its actual code/path (or nulls) and its existing reason. The 8,000-observation cap and standalone checker behavior are unchanged.
2. Each complete `RouteObservation`, in existing compareInbox/source order.
3. Each router `SelectionBlocker`, in the accepted deterministic router output order. This includes raw, mapping, authority and source/compiler holds; no diagnostic string is replaced with a paraphrase.
4. Each complete witness `sourceGuards` entry `{identity, classification}`, in canonical committed-identity order. Its nested classifier binding/items/groups/holds/plan/lineage are covered by this single unit; do not charge the same nested fields again independently.
5. For each subject in canonical identity order, obtain the accepted Task 4 result only if structural coverage so far is complete. Admit that subject's group-selection blockers individually in their existing order, then its entire witness classification entry `{identity, full, selected, dependencies}` as one unit. Dependencies include held/missing edges and the full mapped-index no-match hash. They are inside this unit, **not** additionally charged edge-by-edge. Null classifiers and empty dependencies remain the explicit existing fields. A non-null hashless `group` is a separate unit, charged next; its nested dependencies/plan/origins are covered within that unit. Store the group as provisional until every subject passes global admission.
6. Any composed incident blocker is an individual `SelectionBlocker` unit; order these by canonical lane/stream/full incident key, before publishing any final groups. All otherwise eligible groups are discarded if any unit fails or any Task 4 result has `group_limit` (real input_limit or defensive cap). No later smaller unit is substituted for a rejected one.

`classifications[*]` rather than each compiler item is deliberately the unit: complete group/hold/provider metadata cannot be truncated into a seemingly complete classification. This is a proposed stricter, unambiguous *technical output admission* interpretation for review, not a change to compiler invocation or financial rules. A large classifier entry may cause incomplete limit even when all its events individually fit. Tests must cover that consequence directly.

The accepted pure router currently computes its guard/routes/full-source outputs together. This proposal meters their returned diagnostic values in the phase order above; it does not claim the compiler avoided transient computation before a combined-byte rejection. It requires no new Task 2/3 signature. The reader still finishes before any classification, and no Task 4 group selection occurs after known structural incompleteness. Preserve a guard-prefix failure even if the already-computed router carries other output; do not publish a blocker whose causing guard observation was excluded by that prefix.

Derived selector causes, totals, booleans, hashes and the bounded scalar evidence references are bookkeeping/provenance, not extra canonical diagnostic units. Persisted input copies in witness subjects/pages/acknowledgments/origins are already covered by physical admission. The output proposal is an alias of its charged hashless group plus the computed hash, not another full charge. The complete witness/hash wrapper is not charged again. These rules bound the declared canonical input/diagnostic corpus, not the exact serialized response byte length or peak heap size.

On late incompleteness, keep the admitted guard prefix, routes and blockers representable by the frozen result, with accumulated canonicalBytes and observed counts in CutSummary; set `sourceContractChecksComplete:false` even if all actual guard calls passed earlier. There is no complete witness or proposal. The frozen incomplete shape has no classifier/dependency array: do not add one implicitly or pretend that discarded provisional classifier values are serialized there. Their already admitted costs remain counted. A complete held cut does retain those entries and dependencies in the complete witness as required by the accepted closure supplement.

Anchors: progress ruling at “Task2 read-only preflight released” (canonical observation units and fitting prefix); `selection.ts:87` (`checkSourceContracts`) and `:266` (`routeSelectionCut`); closure supplement “Missing dependency observations must survive a hold”; Task 8 brief explicit preimage/sourceGuards/hash equations.

### Every incident retained through an immutable full-key reference

Use the existing `SelectionWitnessPreimage.evidence` and `SelectionEvidence` shape, with one reference per validated incident, including a provably closed gap:

```ts
{
  family: 'incident',
  key: [sourceRef, manifestHash, streamId, incidentHash],
  digest: hashCanonical({
    lane, streamId, incidentHash,
    summary: {code, pageHash, sourceIds, observedAt},
    sourceIdsDigest,
  }),
  bytes: /* actual admitted source_ids_canonical octet_length */,
}
```

Here `sourceIdsDigest` is the strictly verified digest of canonical source IDs; `summary` is the exact strictly validated detached `CaptureIncidentSummaryV1`. Recompute the writer's incident key separately from `{lane,streamId,code,pageHash,sourceIds}`. That key excludes observedAt; the reference digest above includes it. Thus the immutable reference commits every retained summary fact and resolves by full PK, not just the latest incident or an event ID. No new raw-incident array or preimage field is needed. Raw summaries remain in `SelectionLane.incidents` while composing.

“Preserve all raw incidents in witness” means none of these validated retained incident references may be omitted, including closed gaps. A conflict remains unresolved after later successful capture. A gap clears only when its exact attempted page digest occurs on the same lane/stream in the independently complete contiguous baseline-to-checkpoint chain. An unrelated later page, timestamp, count or checkpoint cannot establish that. The complete witness already retains exact accepted page boundary/digest/member references; the incident reference commits the comparison's other side. An unresolved blocker uses the same incident reference, not a weakened or newly fabricated summary. A closed-gap reference stays in the evidence inventory without an unresolved blocker. This is the existing narrow closure proof, not a new resolution policy.

Anchors: design “Witness and coverage meaning” and retained-incident coverage case; Task 6 “Incident resolution from retained evidence”; progress “Task6 preflight rulings”; `capture-store.ts:160` and `:273`; Task 8 preflight “Explicit deterministic witness”.

## Required focused verification after review and release

These are unexecuted obligations, not requested test/DB permission in this document:

- Ledger: independent SQL octet-length sum across all eight import columns, both lane columns, receipt/plan pairs and transitive snapshots; shared current/approved snapshot charged once; equal bytes in distinct physical columns twice; baseline-only delivery charged but no ongoing slot; original mirrors preserve 1,000 root slots; initial receipt alias not double charged. Observe actual cap+1/count domain and zero blob/helper reads after rejection. Timeout in a later helper preserves earlier ledger counts/bytes. Ready-cut pure composition starts at that exact total, not evidence-byte reconstruction. Scalar embedded-target checks cover combined 10,000/10,001 counts before body retrieval with no invented physical rows; position/delivery overlap shares one ongoing key set while bounded baseline-only positions remain outside it.
- Error/cleanup: prove an actual backend-blocked SELECT. Ordinary runtime pool exercises the real 1.5-second local rejection with awaited rollback after the server's 2-second bound. A separate fixture app pool with a finite client timer longer than two seconds exercises actual SQLSTATE 57014. Keep the lock through return; observe backend idle/rollback, one release, and clean subsequent checkout. Separately inject transport loss/failed rollback and verify awaited local end plus one discard without claiming unobserved remote termination. Add the distinct ErrorResponse-without-ReadyForQuery control: prove active query is cleared, queued rollback times out and is removed, and graceful end remains pending; assert no response/release/classification while stalled. Then let the controlled transport actually close and assert end settlement, exactly one discard, and final safe failure. The test must itself close the controlled transport and join the inspection; it must not leave a deliberately hung test behind or claim this proves a bounded teardown guarantee.
- Supported configuration: ordinary queryless runtime URL/numeric 1,500 ms and a finite longer fixture timer pass both checks. A positive pool option combined with URL `query_timeout=0`, an empty value, a different numeric string, and even an equal numeric string is rejected before BEGIN based on the actual effective field; default/invalid values, pipeline and custom client/hooks also reject. Explicitly observe no BEGIN and joined discard if checkout already occurred. Call-through instrumentation must not bypass these checks or change timeout/end behavior. Add a service-level positive control using the exact supplied-pool/per-checkout proxies above: validation admits the wrapper, actual BEGIN and a real reader SELECT execute on one lease, a post-settlement gate holds the real inspection while external accepted writes commit, and resumption preserves its coherent old snapshot. A separate gate delays a real result beyond five seconds and proves the joined timeout/cleanup path. Assert underlying arguments, result/error object identity, effective timer, end/status and one release/discard are preserved. Run the negative effective-timer controls through the same wrapper and require rejection before BEGIN; a direct reader test or disabled check is not a substitute. These controls remain separate from the stalled-end control.
- Five-second admission: delay a real query wrapper beyond the deadline; assert the reader settles before response, no next query, no classification, joined cleanup, retained prior progress, zero proposals. Add late successful COMMIT rejection and no orphan checkout. Verify the classifier's first invocation occurs only after successful COMMIT/idle and release.
- Diagnostics: real individually oversized SOURCE_SCHEMA observation and exact-fit control; combined physical-read plus guard overflow preserves precisely the unchanged guard prefix. Independently calculate the declared sourceGuard, classification-with-dependencies and group units, including a missing-edge held subject and duplicate content in different roles. Exercise per-unit and aggregate exact-fit/overflow; a later subject's group_limit or diagnostic overflow discards an earlier eligible proposal globally. Never report a whole-witness-length assertion as this accounting proof.
- Witness: independently reconstruct both accepted hash equations. Resolve every incident reference to its immutable complete summary and exact page chain; prove both retained conflicts, unrelated-success unresolved gap, and exact-page closed gap while keeping all incident refs. Changed observedAt changes the evidence digest/witness even though the writer incident key excludes it. Recreated pool/service and physical retrieval permutations yield the same admitted complete output at fixed state/asOf.

Tasks 5–7 own complete bounded physical-read closure; Task 8 owns context lifetime, error translation, diagnostics and witness composition. Existing approved compiler/capture/parent/P1 schemas and implementations remain unchanged. Root must publish the accepted context/count/diagnostic interpretation to all four owners before release; fresh review must specifically assess the operational count-domain table and the admission-versus-cleanup guarantee.
