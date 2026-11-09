# A4 control008 receipt observation mirror — root-assigned addendum

Design only, supplementary to preserved `b-activation-review-handoff.md` and its accepted review. Root confirms control008 is not implemented or applied and explicitly assigns this storage to A4/B SQL owner before implementation. Authority proposal §9 already requires observation-only receipt mirroring; this addendum makes the omission concrete without granting A4 worker authority. Root obtains fresh scoped review before implementation. No additional migration, existing migration edit, code, test or commit is delivered here.

## Storage in reserved control008

Add an immutable `activation_receipt_observations` table associated to the immutable A4 intent by its existing primary identifier. Exact intent column naming follows actual 008 DDL; do not create a second intent identity. One successful initial receipt observation per intent: intent_id PRIMARY KEY and FK to activation intent. Store receipt_id TEXT NOT NULL UNIQUE, receipt_canonical TEXT NOT NULL (strict ReceiptResponse.receipt/SyncReceipt canonical JSON object), receipt_digest TEXT NOT NULL (64-character SHA-256 canonical-byte digest), and observed_at timestamptz NOT NULL from injected control clock. Store only the receipt, not transport replayed: replayed describes the current response, not a mutable historical fact. Use existing schema validation/canonical encoding conventions and immutable-table trigger plus app-role SELECT/INSERT only, no UPDATE/DELETE. This table is an observation of committed runtime fact; no pending/failed/provisional receipt rows.

The FK intent already contains original canonical request, reviewer, scope, bundle bytes/hash and key; do not copy mutable current head/policy pointers into the mirror. Insertion validates exact receipt scope, artifact hash and plan hash against that immutable intent's bundle, epoch1/status applied, and full expected bindings available from bundle (event IDs, ordered financial target IDs, plan after balance). Receipt identity/activation identity/timestamps are worker-issued, never synthesized by control. A5 validates the authenticated worker envelope before this call. The mirror cannot independently certify issuance from self-consistent hashes or an arbitrary caller payload.

Idempotent insert must lock/read the existing observation for the intent (or INSERT ON CONFLICT DO NOTHING then read the winner) in a short transaction. Exact existing canonical receipt bytes/digest return the original row, preserving first observed_at. Differing bytes for the same intent or receipt ID conflict safely; never overwrite, choose “latest”, or treat conflict as a new approval. Unique receipt_id prevents silently associating one imported receipt with another intent. FK and immutable intent digest checks prevent cross-scope association. No filesystem/HTTP or worker call inside this transaction.

## Concrete repository ports and A5 consumption

Add these private methods to A4 `apps/control/src/review-repository.ts`, using existing repository intent type/lookup rather than exporting a new public contract:

```ts
recordWorkerReceiptObservation(input: {
  intentId: string;
  expectedRequestHash: string;
  expectedBundleHash: string;
  receipt: SyncReceipt;
}): Promise<{ receipt: SyncReceipt; observedAt: string }>;
readWorkerReceiptObservation(intentId: string): Promise<{
  receipt: SyncReceipt;
  observedAt: string;
} | null>;
```

Runtime validates IDs/hashes/receipt with existing strict contracts. record method loads immutable intent, compares both expected hashes and all receipt bindings above, computes canonical bytes/digest locally, then inserts idempotently. read method strictly decodes/re-hashes persisted bytes and verifies their association before returning. These are repository-internal ports, not HTTP or tool routes, and never accept a caller-supplied digest/timestamp. A4 does not call the write method in its pending-only implementation; its tests can exercise repository storage with clearly labeled synthetic observations. It still must not claim runtime application.

A5 `activation-delivery.ts` obtains committed intent only after existing reviewer/account/source authorization, then calls real authenticated scoped worker GET or POST. On verified ReceiptResponse it calls recordWorkerReceiptObservation with original intent request/bundle hashes and actual returned receipt. On retry, query authoritative worker first; do not use the mirror as permission to skip authentication or imply new import. Mirror read supports safe local observation/history only. Worker success followed by control mirror failure is an unknown/control-observation failure with preserved intent, never rollback evidence; subsequent retry recovers exact runtime receipt and repairs the absent mirror idempotently. For this bounded delivery path, return the existing pending202 envelope if the worker succeeded but the observation could not be recorded; it describes unfinished control recovery, never runtime rollback. Next authorized retry queries runtime and completes mirroring before returning ReceiptResponse. No forged success or replacement grant is allowed.

## Required checks and limits

A4 storage checks: app-role insert/read succeeds and update/delete fails; absent intent rejects; wrong request/bundle/scope/artifact/plan/event/target-record association rejects; same exact receipt concurrent inserts preserve one row and first timestamp; different bytes for same intent and reused receipt ID on another intent reject; transaction failure rolls back; restart round-trips original canonical bytes. Synthetic repository fixtures prove storage only.

A5 full proof: actual worker commit then response loss or crash before mirror; exact scoped retry retrieves worker receipt first, inserts observation once, returns byte-identical receipt; concurrent control delivery/recovery preserves one import and observation; worker outage never causes a mirrored fact to be fabricated as a newly applied result. No mirror entry grants authority, advances head, changes original reviewer, installs policy, or mutates runtime. Existing control008 head/intent/publication tests and A5 integration provide separate evidence; joint V3 remains A6/user acceptance.
