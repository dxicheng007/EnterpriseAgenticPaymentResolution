# Final whole-branch integration review — bounded capture

Base: `aafe7aeec8529e080cc3caf3f38c9b51c894fe71` (integrated main).
Candidate: `2194fd39ea162749da129f6739e964781d967df0`.
Exact package: `.superpowers/sdd/2026-11-09-sync-capture/review-aafe7ae..2194fd3.diff`, SHA-256 `7914fcf621cf6e1de62336881b6551410dce8bf1d43e1e96b75952bb7783395f`.

**Specification/integration verdict: PASS for the bounded internal API/semantic capture phase.**

**Engineering-quality verdict: PASS. Ready to merge within that scope.** No actionable P0–P3 findings identified. No fixes or additional test runs requested by this review.

## Scope and method

Fresh review using the requesting-code-review standards, the exact branch package, accepted capture plan, progress ledger, builder report, task review, repository/area instructions and relevant frozen contracts. I inspected the changed production code, additive SQL, contracts/build-closure edits, focused tests and branch documentation. Unchanged dependencies were inspected for concrete integration risks: committed activation decoding and delivery insertion, shared advisory locks, canonical/source contracts, transaction retry and activity publication.

HEAD matched the assigned candidate and the checkout was clean before review. `git diff --check` for the reviewed range passed. Comparing `efce3de8e83b6003e2eac8185b26820c2ef3351a` with HEAD across apps/packages/db/tests/scripts showed only `packages/evaluator/AGENTS.md`; the reviewed capture implementation and tests are unchanged by the main integration. No tests, database operations, source edits, git mutations or subagents were used. This report is the sole artifact written by this reviewer.

## Integration assessment

- **Committed provenance and financial separation.** Initialization uses the existing canonical A5 reader and exact scope/activation/bundle selector. The full checked baseline, including events without an initial monetary outcome, seeds only delivery and position facts. Shared-lane reopening preserves checkpoint/history and does not require later genuine subjects to own the initial provenance pointer. CSV in either the capture definition or manifest rejects the entire lane before writes. Existing first-import delivery persistence already accepts an identical canonical delivery without treating its presence as an applied outcome, so capture facts do not suppress a later authorized import.
- **Global identity and lock graph.** Delivery uniqueness remains `(sourceRef,event.id)` and position uniqueness `(sourceRef,streamId,sequence)`, independent of lane/account/version. Canonical comparison includes observedAt. Bootstrap takes lane, complete stream group, then complete delivery group; capture takes checkpoint, stream, then complete delivery group. Both use the existing identity lock helper. Bootstrap does not subsequently lock existing checkpoints, and A5 does not acquire capture locks after delivery locks. No reverse dependency was found. Global stream locks serialize different IDs competing for one position across lanes.
- **Atomicity and replay.** Identity comparisons precede stale returns. Changed overlaps conflict; harmless stale growth returns refetch without inserting a suffix. Empty current pages reserve no immutable page boundary. Nonempty page, inbox, global identities, checkpoint CAS and sanitized activity use one transaction; activity is last. A uniqueness failure rolls back and rechecks instead of claiming success. Separate incident transactions follow rollback, deduplicate their safe summaries and fail unavailable if incident persistence fails. Progress uses one statement snapshot and validates bound definitions, counters and incident hashes.
- **Migration compatibility.** Runtime003 is additive; no control or existing SQL migration changed. Directly checked hashes match the recorded evidence: runtime001 `c09e49970e4fc3394294f643035acba224b9f19bdc4f6e46b66c6679fd82c2f3`, runtime002 `a06874e335f6acfd6f62d89760c00c76059c95b9ab05782707999ff70f8ddc56`, runtime003 `aedc4cdec78c5d4cecf02a41f5f68e0e706bb195cf36182890e3af0f5e039b8c`. Keys/FKs, immutable triggers and restricted checkpoint-column grants match the plan. The existing parent-storage reset change adds only the six FK-dependent capture tables to its disposable TRUNCATE list.
- **Protected build closure and process boundaries.** The new contracts barrel leaf is present in both protected build source lists and their mutation coverage. No evaluator behavior, eligibility or expected financial result changed. Production capture adds no source client, model/evaluator/operator dependency, control pool, route, scheduler or composition mount; the Clock reference is type-only. Writes do not touch parent records, snapshots, activation imports, receipts or economic/delivery outcomes.
- **Documentation and claims.** The later current-authority text is explicitly a reviewed design, with no implementation or migration reservation. Its future shared fence does not alter capture's current lock graph. The external Discovery/Experience reports identify their own exact candidates and retain their failed gates; their defects are not attributed to this branch's capture code. The latest continuation entry supersedes earlier pending-review checkpoints without claiming V5/V6 or full synchronization.

## Findings

Critical/P0–P1: none. Important/P2: none. Minor/P3: none.

The focused tests meaningfully exercise real PostgreSQL and genuine proof/reviewer/worker activation, including whole-lane CSV rejection, baseline completeness, cross-lane position races, stale losers, rollback, restart, immutable grants, corruption and historical incidents. They do not fabricate committed activation history or weaken evaluator eligibility for alternate synthetic subjects.

## Declined to judge

- External Discovery PR15 and Experience PR14/earlier E1 executable branches: outside this candidate; only their included reports and claim separation were reviewed.
- Current-authority status implementation and trusted ingress: design-only and expressly unreserved here; no implementation readiness inferred.
- CSV capture, polling/source clients, financial application, connection UI and ongoing receipts: explicitly excluded from the accepted bounded plan.
- Live construction, V5/V6, both-source AI-off synchronization and joint user acceptance: require their separate end-to-end evidence and are not established by this review.

## Evidence limits

Machine results are attributed to the supplied builder/root evidence, not independently rerun: builder typecheck and 25 focused unit tests passed; 21 capture plus 27 parent-storage cases passed after the reserved reset maintenance, with the V3 activation case passing in the earlier combined run (49 distinct focused integration cases). The original 26 reset failures remain disclosed in the builder report. Root separately reported 464 unit tests in 70 files and five migration/local-composition cases in two files passing. The post-check pull introduced normative documentation only in the inspected code areas.

These reported machine results, the earlier exact-candidate review and this fresh integration review are separate evidence. Acceptance here covers the internal, unmounted capture foundation only; it grants no broader product or financial authority.
