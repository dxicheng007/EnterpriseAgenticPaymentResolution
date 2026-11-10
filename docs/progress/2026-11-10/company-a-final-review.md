# Whole-branch Company A demo integration review

Reviewed implementation candidate `8468b7e0b4de8c0034de633d897c110844065642` against `49245de4832d4d41f9cb9d28ac74fda42e92cfb4` in `/Users/devincheng/.codex/worktrees/platform-activation-integration/EnterpriseAgenticPaymentResolution`. Independent reviewer: `/root/demo_final_review`. No source edits, subagents, service starts, tests or SQL operations. The later integration HEAD `40933883efb7ebec079174903d40191f0aa61350` changes documentation only; implementation source is identical to the reviewed candidate.

## Verdict

Changes requested for one bounded verification gap. No additional actionable production correctness, security, cross-task interface or gate-integrity finding identified. Machine results, independent acceptance of the implementation and user joint acceptance remain distinct.

## Finding

**[P2] Verify the sync receipt through the mounted authenticated Connections proxy.** `tests/integration/demo-company-a-transport.test.ts:483`–`494` opens a real reviewer session but only reads `/api/demo/candidates`. The mounted positive test validates the sync receipt and Parent state through direct runtime readers; neither this test nor `demo-company-a-sync.test.ts` requests `/api/connections/:accountId`. The approved design explicitly requires that Connections return the actual sync receipt and null unmeasured fields through the authenticated control proxy (`docs/superpowers/specs/2026-11-10-company-a-demo-mount-design.md:103`). Consequently this branch's bounded gate could pass while the mounted Operations read path is absent, miswired or does not reflect the new receipt. Existing generic direct `createConnectionReads` tests and authority-ingress overview tests do not exercise this exact mounted Company A apply.

Add assertions in the existing mounted test using its reviewer cookie and `ConnectionStateV1Schema`: exact scope, the new receipt ID with kind `sync`, original activation/epoch, 80000-to-50000 amounts, unchanged initial receipt at 80000, `appliedBatches: 1`, `lastReceiptId`, incremented parent version, `pendingEvents: null`, `quarantinedEvents: null` and each stream's `lagEvents: null`. Place this required readback before the `collectObservation` early return so ordinary focused mounted runs also exercise it. The existing production route/client already provides this interface through `apps/control/src/routes/parent.ts:19`, `apps/control/src/parent-read-client.ts:76` and `apps/worker/src/parent-read-composition.ts`; this repair needs no UI, DTO or production behavior expansion.

## Reviewed boundaries

- Fixed Company A configuration uses the genuine registered scope and committed A5 import, preserving the accepted P1 capture/classification/apply boundary. No financial values or approval are manufactured by the facade.
- Exact historical recovery uses a bounded overlap locator and accepted receipt/unit validators, then checks fixed scenario facts. Complete source pages are captured unchanged with finite event/request limits and both terminal probes; foreign or extra pending input cannot be selected away.
- Private operator/source/service capability separation, strict command bodies and canonical feed queries, bounded nonredirecting clients and redacted uncertainty reporting agree across source transport, worker transport, supervisor and CLI.
- The actual role launcher shares explicit environment construction with the process proof. The measured isolation claim is correctly limited to credential absence, inspected sources/dependencies and the mounted global-fetch HTTP path with positive controls.
- The bounded gate pins exact commands/titles and a strict fresh run-bound public observation emitted after cleanup. The source-ID versus parent-ID repair is appropriate: allocation funding refers to the payment's source economic identity; receipt target IDs are checked separately.
- Full V5/V6 predicates are unchanged; the bounded manifest says `fullV5: not-established`, with independent review and joint acceptance pending. No browser workflow, three timed rehearsals, live construction, scheduler or Company B claim is inferred.

## Evidence and limits

Read applicable root/apps/packages/scripts/tests guidance, PRD process/finance/acceptance boundaries, ownership and verification conventions, frozen contracts, the approved Company A design/plan and amendments, accepted Task 1–3 reviews, Task 4 report, exact changed source/test paths and the retained clean-candidate machine packet. The latter records six transport cases, twelve CLI cases, three app unit cases and typecheck passed on `8468b7e`, with zero gate diagnostics; these are builder results, not this reviewer's executions.

`git diff --check 49245de4832d4d41f9cb9d28ac74fda42e92cfb4 8468b7e0b4de8c0034de633d897c110844065642` passed. `git status --short` was empty. No independent machine command was run during this whole-branch review because the separate Task 4 reviewer held the exclusive verification lease. The identified omission is established by source inspection and does not need another database run to reproduce.

Read the separate fresh Task 4 reviewer report `/tmp/company-a-task4-review.md`: exact candidate `8468b7e` passed 24 parser regressions, rejected trailing selector arguments with exit 1, and passed the actual bounded gate (six transport cases, twelve CLI cases, three app unit cases and typecheck), with empty diagnostics. Its independent packet is `/Users/devincheng/.codex/worktrees/company-a-demo-review/EnterpriseAgenticPaymentResolution/.evidence/8468b7e0b4de8c0034de633d897c110844065642/demo-company-a-ai-off/2026-11-10T20-30-44-530Z-45079/manifest.json`. The review-owned 55442 cluster was stopped and the lease released. These independent execution results support the reviewed existing paths; they cannot close the missing Connections assertion, which is not part of that gate yet.

Experience PR59 findings and browser/T3/T4/T8 acceptance remain externally owned. This review requests only the expressly required authenticated API proof, not Experience UI changes or full demo acceptance.
