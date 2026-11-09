# D2 recovery correction independent review

- Exact candidate: `a5209db46bc82b28f95bbe31b7ff550b958677a2`.
- Fix base: `3fad7de41a38185601dd0a3a199e6537eb04e566`.
- Candidate worktree: `/Users/devincheng/.codex/worktrees/acquisition-verification-startup/EnterpriseAgenticPaymentResolution`.
- Reviewer: `/root/astra_d2_fix_review`, separate from builder and supervising root.
- Original P1 finding: **ADDRESSED**.
- Fix-only spec/code verdict: **PASS**. No new actionable breakage identified in this three-file correction.

## Review evidence

Read the original P1, appended correction report, accepted evidence-tools E2 transitions and D2 implementation handoff, supplied recovery diff, complete changed supervisor/service paths, repository blocker/resume behavior, and real-D1 regression fixture helpers. Confirmed candidate HEAD and clean candidate worktree; `git diff --check 3fad7de41a38185601dd0a3a199e6537eb04e566 a5209db46bc82b28f95bbe31b7ff550b958677a2` passed.

Replacement reconciliation first removes stale running claims from the in-flight projection. Its guarded authority check now runs for abandoned reads before paused-only refencing eligibility, so both paused and runnable revoked recovery persist interrupted/null-content with task/run `DISCOVERY_FORBIDDEN`. The task becomes interrupted; paused run status is preserved. Existing diagnostics are appended/preserved, never cleared.

Paused recovery checks authority again after external capture preparation and after guarded capture recheck. Runnable execution checks under the owner transaction before preparation and after preparation/recheck. A revocation actually observed between batch preparations is carried into the guarded transaction even if policy is restored meanwhile. Authority failure takes precedence over capture preparation failure without inventing a revocation from unavailable capture. Never-claimed pending work retains its existing non-sticky preliminary denial behavior.

The service marks interrupted recovery rows and bypasses only its preliminary authority filter for those rows. Saved/current authorization remains enforced by the owner before any source preparation or claim. Its generation-aware pending-step tracking permits replacement while stale I/O remains outstanding. Reconciliation also observes already-revoked runnable recovery before normal scheduling. This closes the original scheduler-filter omission without granting execution authority.

`interruptForbiddenRead` is shared with current-owner settlement and explicitly clears the result. The existing generation, latest-attempt, ordered-step and task-revision guards remain. Once the sticky transition commits, task status prevents further step loading, run status prevents scheduling, and restored authority plus pause/resume still yields blocked. Replacement cannot clear these diagnostics. No successful tool result is emitted by the correction.

## Focused machine verification

Independently ran the four new real-D1 barrier cases on the assigned isolated lease (PostgreSQL 55438, control/worker/web 3601/3602/5179, test prefix `eapr_test_review_t2`, demo namespace `eapr_review_t2`):

```sh
npm run test:integration -- tests/integration/v4-discovery-evidence-tools.test.ts -t 'persists revoked authority'
```

Result: **1 file passed; 4 tests passed, 16 skipped**. Cases exercise paused/runnable replacement, revocation before recovery and during external preparation, persisted task/run forbidden diagnostics, interrupted/null result, zero in-flight steps, no successful tool result, stale callback rejection, and no further preparation/claim/model call after restored authority, another replacement and resume. The initial sandboxed invocation could not create Vite's temporary config in the candidate worktree; the approved escalated rerun passed. No source/test/index/commit edits were made.

## Limits

This is a scoped correction review, not a repeat review of the entire original D2 implementation. The four new runnable cases use the supervisor directly; service filtering/replacement was reviewed by control flow, not a new reviewer-run revoked-service regression. Builder-reported typecheck and 87 focused PostgreSQL tests were not rerun broadly. No browser, live provider, full V4 gate, construction, financial, activation, sync, or joint user acceptance is established. Integration remains with root.
