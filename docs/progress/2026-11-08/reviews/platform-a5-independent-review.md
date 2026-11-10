# Independent A5 exact-candidate review

Candidate: `b67b1cd7fee15ff629b49e36907fa20c7b05b62d`
Base: `17d6714e6fb9264750a7575f28a41b951a94a90d`

HEAD matched the requested candidate and the worktree was clean. Review was read-only; no source edits, subagents, database use or broad suite reruns.

## Finding

**[P2] Return pending202 when a committed worker receipt cannot be mirrored.** `apps/control/src/activation-delivery.ts:18–22` directly awaits `recordWorkerReceiptObservation`, so an observation database failure rejects delivery for both the receipt-first recovery branch (line 28) and the new-application branch (line 39). The route's generic error handler then returns 503 `REVIEW_UNAVAILABLE`, even though runtime has already committed. The accepted `b-activation-review-mirror-addendum.md`, Concrete repository ports and A5 consumption, explicitly specifies: “For this bounded delivery path, return the existing pending202 envelope if the worker succeeded but the observation could not be recorded.” The current integration assertion at `tests/integration/v3-activation.test.ts:824` expects 503 and therefore preserves the contract violation. Catch the observation persistence failure in the delivery adapter and return the existing pending envelope without replacing the intent or reporting success; keep retry querying the authoritative worker first. Update the composed failure assertion to require 202 and the exact pending identity, then prove retry mirrors and returns the original receipt. This is an API recovery-contract defect, not evidence of duplicate economic effects or runtime rollback.

Independent targeted reproduction: Node24 with the candidate's actual `createActivationDelivery` and controlled worker/repository ports reproduced the escaping mirror exception for both a recovered receipt and a newly applied receipt. Each path had the expected receipt-first call ordering. The existing composed test supplies additional real PostgreSQL mirror-failure evidence; no database rerun was needed to establish this finding.

## Specification verdict

**Changes requested for the finding above.** No other actionable A5 authority or financial-semantics defect identified.

Reviewed the candidate diff, P2 brief/report, tracked A5 implementation report, accepted worker activation handoff and A4 mirror addendum, A4 completion/authorization repair, applicable repository/app/parent/test guidance, v4 authority and v2 activation freezes, and the actual financial capture/report validators, contracts, parent storage and transaction dependencies.

The worker's bounded capture checks align with accepted financial capture derivation, including complete event membership, stream sequence/watermarks, content and aggregate hashes, and distinct snapshot content/object hashes. Financial validation checks exact safe persisted report hashing, full mandatory passed-positive-case coverage, normalized diagnostic expectations, source/profile/kind coverage and eligibility. Job/report ID association is enforced by the strict attestation schema. Bootstrap schema and explicit bindings enforce the result matrix, pin, capture and plan; locked target verification supplies the remaining target hash check. No evaluator import is introduced into the worker validation path.

Successful POST associations and scoped receipt GET are resolved from runtime storage before registry, policy or source access. Preflight failure performs successful-key recovery and active-scope precedence checks. The transaction callback reacquires scope/key/target and global identity locks on every retry, recomputes the full plan from the complete capture and actual locked target, and separates recorded target bytes from the cutover planner copy. Persistence stores original records, authority, canonical bundle/request/reviewer, approved snapshot, lineage, selected delivery outcomes and activity in the same transaction. Source observation and file reads occur outside the callback. Exact receipt replay uses stored bytes; new-key active and conflicting-key results remain failures. Control keeps reviewer/account/source authorization and immutable intent association ahead of delivery and queries the worker before republication.

## Quality verdict

**Acceptable bounded implementation structure subject to the recovery-contract fix.** The new worker/client/delivery modules have narrow responsibilities, strict request and response parsing, bounded transport, redirect rejection, explicit capability separation, safe diagnostic mapping and no false success after uncertain worker response or mirror failure. No additional blocking maintainability issue found. The mirror path fails closed today, but its status/envelope must follow the agreed recovery contract.

## Verification verdict

**Substantial machine evidence, with the mirror expectation needing correction; no full V3 or joint acceptance claim.** Inspected the real-proof integration setup and asserted negative matrix, failure injection, lock/retry barriers, race and recovery sequences. The large composed case obtains actual A/B financial and bootstrap issuance, verifies A's 80,000-cent balance and B's separate zero-balance original-record import, and checks unrelated captured events are not acknowledged as applied. Synthetic resealed negative bundles are appropriately only rejection evidence, not successful issuance evidence.

Builder reports typecheck, 421 units, five tests across the three A5 files, 46 adjacent cases, ordinary no-policy supervisor startup/restart, and a 296-module worker import closure. These are builder evidence inspected in this review, not independently rerun results. The focused independent delivery reproduction above is an additional adapter check only. Normal supervisor smoke did not establish a configured-policy import; the composed HTTP/PostgreSQL test supplies that separate evidence. Browser approval, full named V3 verification and joint user acceptance remain separate.
