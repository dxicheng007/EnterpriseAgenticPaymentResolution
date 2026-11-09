# Existing team integration resumption — 2026-11-09

This is a fetched Git/API status assessment and bounded dispatch record, not slice acceptance. The clean local main checkout remains at `cdcb26d`; the isolated integration branch `codex/platform-activation-integration` starts at fetched main `dbb3fa48e4702e6e8867dfb3906db603b38c07ce`. Preserved A4 `78f355e49925b30cffa6b380b0a28f153d40376b` applied cleanly as `8cfbdb179dcdd38e31cb97c9652040b9bd668fcc`. Original worktrees, running demo, policies and source pins are unchanged by this setup.

## Other developers

| Lane | Current pushed state | Evidence limits / next dependency |
| --- | --- | --- |
| Discovery | William Li's association producer, consumers, compilation, replay/compare and offline model stub merged through PRs 3–7. Current main `dbb3fa4`; latest feature head `19ef57d61361f5c72ea331328e98f4922e331815`. | Implemented prerequisites, not live generation. GitHub reports no CI checks or review verdicts for these PRs. Earlier tracked producer reviews do not cover every later exact candidate. Scoped integration-boundary review is in progress. |
| Experience | Yash's [PR 8](https://github.com/dxicheng007/EnterpriseAgenticPaymentResolution/pull/8), `ad2a1d17806179c7f32d2806c066e7eb8198d656`, is open. Read-only parent/activation client and inactive inspection screen. | Author reports typecheck and parent unit tests passed, browser spec not run. No GitHub reviews or CI checks. Actual inactive browser proof and exact-candidate review remain required; imported-state proof waits for A5. |
| Platform | A4 checkpoint retained; new bounded completion agent dispatched on current integration base. A5 unimplemented. | Complete missing adversarial matrix, independent Astra review and combined checks before releasing A5/API consumers. |

Git establishes pushed/merged states, not whether a developer is presently editing. The local chat inventory did not expose separate active Discovery or Experience chats; no messages were sent to their owners.

## Dispatched work and isolation

GPT-6.1 Sol owns A4 completion: its existing implementation paths and three integration suites, actual transaction barriers, composed proof rejection, source-wide blockers, nonempty target and mirror fault coverage. A second GPT-6.1 Sol agent completed a read-only assessment of A5 ports and downstream handoffs. Astra independently reviews the merged Discovery integration boundary and will separately review the exact completed A4 candidate. Builders do not self-accept.

A4 has the exclusive fresh PostgreSQL port `55441` with `eapr_test_review_t2` / `eapr_review_t2`; the helper permits only t1/t2 names. This is a separate worktree-local cluster, not another lane's database. Preserve control008's existing bytes. No live provider, model credentials, source repinning or runtime import is part of A4.

The A5 assessment confirms committed-intent and mirror APIs match the accepted handoff. A5 must replace the pending-only delivery tail with authorized receipt-first recovery, preserve original intent bytes, and recover through current registry/policy/source outages after a successful worker commit. Runtime002 remains sufficient; no runtime DDL is reserved by this record.

## Discovery unblocks

The [D4 unblock handoff](d4-discovery-unblock-handoff.md) supersedes the old roadmap's implementation-status snapshot. The next independently specifiable Platform unblock is the durable verification adapter keyed by the server tool-step ID, with one atomic budget reservation and unchanged reviewer enqueue wire. It needs a separately reserved additive control migration after 008 and exact-candidate review before Discovery consumes it. This record reserves no new SQL and makes no applied-migration claim.

For generated account IDs, retain the already-specified interim rule: verify only already-trusted allowed scopes. A proposal must not grant its own capability. Broader audited capability policy remains a separate design/user decision if not specified. Repair/completion permissions and transitions require a separate accepted handoff. Provider configuration remains deferred; an offline stub labeled live in a test is not live-model competence.

## Acceptance boundary

No new V3–V7 gate is claimed. A4 pending202 is not an import or activation. Machine results, independent exact-candidate review and joint user acceptance remain separate. Publication to shared main and restarting the preserved integrated demo are not part of this setup record.

## Initial integration evidence

- Root ran `npm run test:unit` with Node 24 against `8cfbdb1` plus integration-test/document WIP: **65 files, 413 tests passed**. The first sandboxed attempt failed before loading tests because Vitest could not write its temporary config; the permitted rerun exited 0. This is a baseline unit check, not full A4 or a slice gate.
- [Independent Discovery boundary review](../reviews/platform-discovery-boundary-review.md) at exact `dbb3fa4` found no actionable blocker in the assigned composition/registration/sandbox/offline-client boundaries. It records a nonblocking production compile/replay composition-test gap. No tests were rerun by that reviewer and it is not a general Discovery acceptance.
- Adapter design must use the actual accepted financial-verification composition: `composeVerification` delegates to `composeFinancialVerification` and `createFinancialAttestationJobs`. The older V4d text naming legacy `jobs.ts` and bootstrap-bearing evidence-support unavailability predates accepted A1c. Preserve current attested provenance and exact-byte reservation/completion when defining the retry-safe discovery adapter; wrapping the legacy enqueue alone would not connect the current product path. Resolve this engineering seam in the adapter's concrete handoff before assigning implementation.

[Experience exact-candidate review](../reviews/platform-experience-parent-review.md), Astra at `ad2a1d1`, requests one P2 correction: ParentView retains old account grants and a failed activation read after App renews the reviewer session. The fix belongs to Experience; no UI paths were taken by Platform. Add a renewed-session/grant-change regression and execute the actual inactive-parent browser spec before acceptance. The reviewer also recommends asserting the changed as-of balance in that browser flow. PR8 remains unmerged here; no review comments were posted to GitHub.
