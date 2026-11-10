# Proposed journal integration clarification

Document-only technical candidate, 2026-11-10. This is not a plan, source release, migration reservation, executed proof or acceptance.
Preserves the accepted dependency design SHA-256 f8dfae74e41ca2ccd809171bd37ff1af132bf3ecac24048cb6d7e103a45c11eb and selector admission clarification SHA-256 fcdbcb8146a1bcbfeff99826775c7a38af3cc2cd0eff30fc62e60d4a985b4a3e.
Scope is the journal-only first increment: heads, immutable held examinations, bounded restoration/recovery, and the existing uncommitted result table.
No financial/episode rule changes, selected writer/bridge, scheduler, source fence, HTTP, provider/model or generated-account permission are proposed.
Only this temporary document was written; no source, tests, SQL, services, Git or network operations, or subagents were used.

## 1. One aggregate with closed selector and journal admissions

Each operation/transaction attempt owns one private admission state; nothing survives into a new attempt except durable facts subsequently reread.
Its aggregate is capped at 16,777,216 bytes with checked safe-integer arithmetic and exact-fit admission.
Charge (a) admitted physical canonical columns, (b) accepted selector diagnostic role units, and (c) the prospective journal write images described below.
Physical identity is table/full-PK/column. The same physical value reached again is charged once; equal content in distinct physical values is charged separately.
Repeated metadata for an unchanged physical value must agree on digest/length. A reference, an alias, or a selector stage snapshot never grants another budget.
Source canonical values and selector diagnostic units retain their 1,048,576-byte individual ceiling.

The later journal integration will reuse one private aggregate primitive behind two closed admission facades.
The selector facade retains exactly the accepted selector table/column pairs and count-domain rules.
The journal facade admits only the exact coordination-head/examination columns and immutable graph references named in the later journal schema; graph references into selector tables use the selector facade.
There is no arbitrary-table, caller-provided cap, budget, family or admission-policy API.
The extension must not widen the public selector result, its EvidenceFamily union, its one-argument inspector, or caller input.
Journal counts are a separate internal JournalReadSummary: observed heads, observed examinations, and admitted reference identities; selector counts remain the accepted physical-family summary.
The journal summary also records the shared aggregate total and the exact journal limit cause; no synthetic selector evidence family is invented.
Current-head admission is exact-subject and independently bounded to one row; examination transitions admit the complete subject inventory with cap+1 and at most 1,000 stored examinations.
An append when 1,000 already exist is incomplete limit without a write; 999 plus an admitted append may become 1,000.
Historical recovery follows only its necessary exact immutable reference graph, under the same byte/family bounds; it does not scan later unrelated examinations to establish current fingerprint nonmembership.

### Preserve the pure inspector and give the journal an exact cost handoff

The later journal integration will extract/reuse the accepted pure composition implementation behind a private companion returning both its unchanged SelectionInspectionV1 and its exact diagnostic admission delta.
The existing inspectSelectionCut(cut) remains a one-argument pure function returning only SelectionInspectionV1; both entry points use that same computation and charging order.
This is not a second estimator, a re-encoding of the final witness, or a new public input/result field.
The companion's delta includes every successfully admitted diagnostic unit, including provisional values discarded by later incompleteness, exactly as the accepted selector clarification requires.
It binds the immutable physical starting total from cut.admission and the resulting total; the journal installs it exactly once into its operation's aggregate before any subsequent blob admission or write reservation.
No intervening read may change the aggregate between taking that starting snapshot and installing this synchronous result.

For a new-work attempt that reaches selection, do not fetch/decode journal canonical bodies before this handoff.
Earlier journal request/head checks use bounded scalar keys/pointers/lengths only; a found consumed request branches into historical recovery and does not continue to new selection.
Selector physical reads, including pre-admitted authority/import/target helpers, therefore produce the ordinary cut.admission starting total.
After pure composition and its handoff, a held branch admits the complete journal and reference graph into the same aggregate, then considers the append.
No-work/eligible/incomplete paths stop without journal body loading unless needed for exact recovery; they preserve the established result table.
This ordering leaves selector accounting unchanged while preventing journal reads or diagnostic costs from acquiring a fresh allowance.

### Narrow envelope exemption and append boundary

Only the explicitly versioned journal examination/witness envelope column is exempt from the 1 MiB individual-value ceiling.
The later plan must freeze a numeric encoded-envelope cap E and demonstrate it with a concrete fixture; E must be at most 16,777,216.
Every stored envelope is scalar-length/digest pre-admitted and must fit both E and the aggregate's remaining allowance before its body is fetched.
Embedded bytes are covered by the envelope's actual length; separately stored referenced canonicals are physical values and are charged separately when loaded.
Repeated references reuse the admitted physical identity. Do not recursively embed predecessor examinations or discount stored duplicate bytes by content hash.
The selector's ephemeral witness wrapper remains an uncharged alias under its accepted rules; serializing a journal envelope containing those facts is a new reservation, not an alias exemption.
Before persistence, encode the exact prospective examination and any canonical head-cache/activity write images and reserve their byte lengths against the same remaining aggregate.
The examination uses E; any other canonical image retains the ordinary 1 MiB cap. Distinct stored copies are separate reservations even if their content matches.
Prospective writes have private write-image identities, separate from already-read physical versions; they do not fabricate observed rows or replace prior read charges.
Reserve each actual write image once in deterministic write order; the later plan freezes the exact column/image mapping.
Failure of count, individual-size or aggregate admission returns uncommitted incomplete limit after rollback; no request, head, examination or activity survives.
This is deliberately a bounded admitted corpus plus prospective-output budget, not a response-size or peak-heap promise.
Exact SQL schema, E, envelope/hash preimages, reference ordering and encoded fixtures remain later plan obligations.

## 2. Bounded pre-admission includes authority and historical recovery

All reads use the operation's caller-owned leased client, query observer, deadline context and admission state; no helper checks out a second connection.
The later journal integration will introduce a private bounded pre-admission hook in the shared authority resolution path, supplied only by journal-owned internal entry points.
Existing readAuthoritySnapshotInTransaction, readAuthoritySnapshot and lockCurrentAuthority signatures/ordinary callers remain unchanged.
Reuse their resolver and validation; do not implement a second grant decoder or financial validator.
The hook executes scalar key/length/digest/cardinality admission for the complete reachable import/approved-target/head graph before readStoredActivation or any authority canonical body load.
It also pre-admits a newly inserted lazy authority head before the resolver rereads/decodes that row; an absent row is not fabricated as an observed row.
The journal-owned locked entry point acquires the existing parent-scope advisory lock before that hook, then preserves the same current-authority row locking and live token checks.
The later plan must reconcile this exact internal seam with accepted Tasks 5–8 source; it is not an assumed current export or permission to amend current selector tasks now.

For a new-work read-write attempt, start the deadline before BEGIN, establish repeatable read before data access, and set the accepted server statement bound plus the design's lock bound.
Make the existing lockParentKeys hashed-key SELECT the first snapshot-taking SELECT, before its advisory-lock wait; pre-admission follows that scope lock.
Then use the admitted shared resolver, check exact consumed-request recovery under the lock, validate active epoch, and lock/validate target and coordination head in the accepted order.
Reacquire tokens each retry. An absent-head uniqueness race fails closed; no arbitrary 23505 retry or synthetic epoch-1 fallback is allowed.
Any later implementation introducing an earlier SELECT must identify that statement as the actual snapshot boundary and adjust its proof; locks do not refresh repeatable-read visibility.
Capture/enrollment after that boundary stays outside the cut. This adds no freshness fence.

Exact recovery occurs first in a separate SELECT-only bounded operation, before current authority, semantic preflight or new-work admission.
Its first scalar lookup establishes its own snapshot. Pre-admit its immutable examination and exact reference graph before bodies/helpers; reconstruct historical observations without today's source catalog or mutable heads.
A missing row may yield null only after a successful bounded exact lookup; corruption, graph limit, timeout or unavailable storage cannot be represented as absence.
Early current-authority admission uses its own bounded SELECT-only operation with the same pre-admission hook; allowlisted semantic observation remains outside the write transaction.
Known early refusal/preflight failure performs the design's exact concurrent-winner recovery before returning refusal.
Each operation has a fresh context; none supplies a cached authority result, cut or ledger as write authority.
The write attempt calls future readSelectionCut(client,input,context) on its existing client and uses the pure companion inside the transaction, with admission checks before and after CPU-only composition.
SQL/query failures are recorded at the actual guarded query boundary before strict helpers translate errors; no read is dispatched after admission stops.
Exact historical reference/DTO mappings and strict query closure proofs remain the later plan's obligations.

## 3. Durable COMMIT outcomes override read-only late-success rejection

The journal owns a narrowly scoped transaction lifecycle; do not change global withTransaction behavior.
Preserve its maximum three whole-transaction attempts and retry only definitive 40001/40P01 aborts after joined cleanup.
Each retry starts a fresh five-second monotonic admission deadline immediately before BEGIN after awaited checkout, fresh ledger/cut and fresh lock tokens; expectedEpoch is unchanged.
Checkout, external observation and cleanup are not disguised as part of a guaranteed five-second response.
Use the accepted effective-driver/pool checks, 1,500 ms production client read timer, 2,000 ms server statement bound and joined cleanup semantics; no new cancellation socket/private forced close or production timeout override.
Five seconds stops further helper/query/CPU-result/write/COMMIT admission. Check it around awaits, after pure composition, and immediately before COMMIT dispatch.
A private rollback-result signal handles every committed:false branch, including eligible/no-work/refused/deferred/incomplete; a normal transaction callback return must never commit lazy writes for those branches.

Before COMMIT dispatch, a stop or failure joins the owned helper/query and establishes rollback/idle, or enters joined discard cleanup, before returning.
An incomplete result before COMMIT is allowed only when transaction termination is established; an unconfirmed abort must remain a fixed safe unavailable failure, never a false committed:false guarantee.
After COMMIT dispatch, the outcome rules are:
- Confirmed command COMMIT plus idle status means committed held, including a late successful acknowledgment after five seconds. Return the exact durable result; do not substitute incomplete timeout or issue a meaningless compensating ROLLBACK.
- A confirmed transaction abort permits the corresponding safe uncommitted failure/result after cleanup. Only a definitive backend 40001/40P01 may trigger the bounded retry rule.
- A local COMMIT read timeout, transport loss, invalid/missing success confirmation, or uncertain settlement is a fixed safe commit-outcome-unknown error. It carries no committed:false claim and consumes no new automatic attempt.
A later successful ROLLBACK/idle response or local teardown does not disambiguate an earlier uncertain COMMIT; confirmed abort requires evidence about that commit attempt itself.
No arbitrary uniqueness, timeout, malformed-storage, business-hold or ambiguous-COMMIT retry is introduced.
The design's “every error consumes no key” statement is narrowed: ordinary established-abort errors consume none; commit-outcome-unknown may have consumed the exact key.
The caller retries/recoveries use that same key. A later bounded fresh operation returns the strictly validated immutable held result if committed; it never invents a replacement.
Do not hide the uncertain attempt with a new synthesized result or automatic new-work attempt. The existing explicit recover method and recovery-first advance retain their semantics.

All error paths join owned promises. Cleanup bypasses the admission guard but retains effective-driver checks and the lease-owned error listener.
Require successful rollback plus idle status before normal release; on failed/unconfirmed cleanup await public client.end() and then release(true) exactly once.
If end remains pending, retain ownership and remain pending. A resolved local teardown is not proof of immediate remote abort or of the outcome of an uncertain COMMIT.
No race-return, abandoned checkout/query, reusable uncertain lease, or five-second remote-termination assertion is permitted.
Known committed success remains committed even if subsequent release bookkeeping fails; never report it as uncommitted.
The later plan freezes fixed safe error schemas and direct driver/protocol proofs, including late successful commit, ambiguous commit, failed rollback and stalled graceful end.

## Scope, anchors and ownership

Basis: dependency design §§4–6,8,10 and its clarification review's six obligations; selector admission clarification §§1–3; accepted closure interface's held dependencies.
Stable source anchors: packages/storage/src/transaction.ts withTransaction; packages/storage/src/runtime-db.ts createRuntimeDb; apps/worker/src/sync/current-authority-store.ts resolveSnapshot/lockCurrentAuthority/readAuthoritySnapshotInTransaction; packages/parent/src/persistence.ts lockParentKeys; packages/parent/src/activation-store.ts readStoredActivation; apps/worker/src/sync/apply.ts prepareAttempt.
Platform owns journal schemas/transitions and this later integration; selector owners retain ledger/diagnostic contracts, and authority ownership covers the private admitted resolver seam.
Exact paths/exports/extraction are reconciled only after Tasks 5–8 land and receive acceptance. No proposed helper in this document is claimed implemented.
The later plan still owns strict immutable witness/reference recovery, DTO/hash mapping, schema/privileges, encoded envelope evidence and the six existing focused proof obligations.
Root retains path/release/migration assignment; C1 is complete and accepted; C2 now owns the sole source and SQL lease. runtime007 is already consumed; no next number is selected.
No materially unspecified product or financial question was found. These are scoped technical choices proposed for independent review.
