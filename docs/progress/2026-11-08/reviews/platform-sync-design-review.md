# Independent staged P3 design review

Candidate: `docs/progress/2026-11-08/handoffs/platform-sync-design.md`, SHA-256 `2f531e77c5bb602db8fcb354e5be7892050700698e2ce0fe31e776835dde895a`; declared product baseline `7a90f1617b70171495dc90adc206cbe873fe09ee`. Hash verified by read-only command. Reviewed supplied diff and author report.

## Verdicts

**Specification:** Substantially aligned, with two bounded corrections below. No financial or standing-authority expansion is needed to implement the API capture/storage phase. Later application and status sections are proposals, not accepted executable contracts or full P3 readiness. Empty CSV acceptance is an undocumented divergence from the actual source producer.

**Engineering:** First-phase API/semantic capture/storage is close to dispatch-ready after clarifying stale-page conflicts and assigning catalog/shared-file ownership. The named storage, contract, transport, initialization and integration-test paths are concrete enough for that bounded phase. CSV capture remains conditional on its separately reviewed producer contract, including the empty-batch issue. Full application/control dispatch is not approved by this review.

## Findings

1. **[P2] Preserve identity-conflict detection when a concurrent capturer advances the cursor — document lines 91–92.** Step 2 says every nonexact stale response is discarded/refetched before step 3 compares identities. Consider two capturers reading after S: one commits event E; the other's otherwise valid response carries changed bytes for E, with a correspondingly recomputed hash. The second response follows the discard branch, so the promised global conflict/incident check never runs. F1 forbids changing canonical delivery content, and F4 requires conflicting duplicate identity/hash to fail the page. Distinguish benign stale page boundaries (a source may have added more events since the first fetch) from conflicting overlapping identities/positions. Compare overlapping accepted delivery/position bindings before discarding a stale response, and record a conflict without advancing anything when they differ. Add a barrier test where the winning page commits before the conflicting loser obtains the checkpoint lock; also test a harmless longer stale response to avoid treating ordinary feed growth as corruption.

2. **[P2] Do not freeze empty CSV batches as already-supported input — document line 61.** The descriptor explicitly allows an empty batch and advances batch sequence once. Actual `packages/sources/src/company-b.ts:73–76` rejects `document.rows.length === 0` with `SOURCE_CONTENT_INVALID`. The document says source transport uses the fixed parser and that accepted upload/capture semantics are not weakened, but does not list empty-batch support among source-owner gates or proposed source edits/tests. A consumer can therefore accept a state its source cannot publish, or an implementer may silently broaden source acceptance. For the first CSV delivery, require nonempty descriptors consistent with the accepted producer, or explicitly defer empty-batch support to a reviewed source contract with producer/parser/upload/replay tests. This does not block independent API/semantic storage work.

## Confirmed strengths and phase boundaries

- Capture lanes retain exact immutable baseline vectors; they do not replace global delivery/economic identity with lane-local uniqueness. Actual activation validation checks complete baseline stream membership and sequences, so a verified stored bundle can seed baseline positions. CSV original-byte verification remains a separate prerequisite.
- Whole-page writes/checkpoint/activity commit together. Failure rollback and separate incident recording preserve complete-page semantics; capture takes no account/target/application locks. Existing `lockImportIdentities`/`lockParentKeys` provide consistent global advisory-key ordering, including absent identities.
- Existing immutable `runtime_deliveries` and global `parent_financial_records` remain authoritative identity domains. Additive ongoing receipt associations avoid pretending initial-import FKs can store ongoing receipts.
- Source SQL remains in control; bounded private loopback transport supplies worker reads. The design calls for zero capture target writes, no model calls/keys/SDK, no control database credential, strict bytes/hash/envelope verification, and explicit transport failures.
- CSV event/batch domains and advertised missing-batch proof are distinct. The current upload predecessor rejection cannot establish offered-but-missing batch visibility; this is accurately identified as a producer gate.
- Application and capture progress remain separate. Pending/quarantine gaps, unknown account/source scope, all-replay classification, dependency closure, historical snapshot preservation and supported full reversals are not silently converted into successful money effects.
- Proposed mutable heads do not overwrite original activation/receipt reads. Epoch/idempotency/read DTO choices require their own freeze. Reenrollment/version switching, complete governing-document notifications, live artifacts and final V5/V6 remain explicitly deferred.

## Review scope and limitations

Read PRD §§11–13/19, relevant frozen F1/F3/F4/F5/F7 and shared interfaces/locks, actual worker activation and validation, parent persistence/activation storage, runtime002 identity schema, source change-feed and CSV decoder, and private semantics client; checked applicable package/database guidance. Read-only inspection only: no database, tests, product edits, git mutation, or subagents. Only this requested temporary report was written. Unrelated evaluator WIP was not modified.

This is independent document review for the exact hash, not machine verification, source-producer acceptance, implementation correctness, complete P3 approval, or joint user acceptance. Remaining explicit design gates and ownership reservations still apply after these corrections.
