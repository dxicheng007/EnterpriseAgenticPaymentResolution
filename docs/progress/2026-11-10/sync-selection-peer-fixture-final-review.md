# Final whole-branch review — fixed same-feed peer fixture

**Reviewed range:** `578624a43a85c3e9b2dfe20803330b4506f7e786..cc78b73a075b90b5d53a086519542edcdeabaaa4`.

**Verdict: Ready to merge — Yes, for the fixed Company A fixture prerequisite.** No critical, important, or minor code findings. This is independent source review, not joint user acceptance or a selector/slice/live verification result.

## Review scope and evidence

Reviewed both complete added files (531 and 450 lines), the accepted fixture design and implementation plan, task brief/preflight/progress/report, repository/test guidance, and relevant frozen approval, financial, and verification boundaries. The branch adds only `tests/fixtures/sync-selection.ts` and `tests/integration/sync-selection.test.ts`; there are no production, migration, dependency, existing-fixture, or protected-producer changes.

The supplied review package's diff body matches the exact Git diff; its additional preamble contains the range, commit, and file summary. Both inspected source files match the committed HEAD bytes. Their SHA-256 values are respectively `fb5933e7dcff9d4ce1b834044d5e26accb07af6db4fb402b2ca6d7faacdb4708` and `b93c164da6cc27c3c6f452e8ac67042016d8a407af813a810c06140893b5b8aa`. The inspected design hashes to the accepted `376de67a292f56add6d1a60b576537d4d046675acb3a218276abba3e93867fa3`.

Dependency inspection covered real evidence capture/original association, captured-agreement candidate construction, source event construction, review composition and protected bootstrap execution, committed capture initialization, transaction-client release, native namespace provisioning/cleanup, worker launch cleanup, and the initial-origin trigger. The unchanged Vitest integration configuration disables file parallelism; these four tests are not concurrent tests.

The supplied exact-candidate report records Node v24.22.2, PostgreSQL 18.6, successful typecheck, and all four focused qualification cases passing in 54.84 seconds, with report/attestation/bootstrap/receipt identifiers. I assessed that evidence and the assertions producing it; I did not rerun tests or access PostgreSQL. No concrete unanswered source risk justified another run. Only this review report was written; no source, index, HEAD, branch, database, or service state was changed. Existing controller documentation edits were outside the reviewed code range.

## Strengths

- **Independent literal inputs:** `tests/fixtures/sync-selection.ts:90–218` authors the two original invoices and agreements directly from the accepted fixed literals. Protected expected invoices and balances separately contain integer `300000`, rather than values obtained from compiled plans or targets. Fact support, original byte hashes, stream/manifest hashes, and the source inventory bind actual inputs. Decoders run before private, no-replace publication. There is no canonical-generator transformation, truth repair, fabricated passing report, or protected producer modification.
- **Two genuine enrollments:** `tests/fixtures/sync-selection.ts:281–496` compiles and registers two one-profile candidates against the same complete capture, runs separate financial probe/reserve/start/launch/complete chains, publishes actual scope/policy bindings, and performs separate authenticated reviewer preparation/activation actions. Inspection of `apps/control/src/review-proof-selection.ts` confirms preparation executes the protected bootstrap job. Each A5 call consumes the actual committed intent. Between the first and second approvals, the second scope must have neither activation nor target. Registration and policy publication are not substituted for approval.
- **Exact financial and historical readback:** the helper validates full target records and completed proof objects before returning; `tests/integration/sync-selection.test.ts:96–218` independently supplies full literal customer/account/term/invoice expectations, mandatory financial and bootstrap coverage, capture/profile/artifact bindings, distinct commitments, own-event receipts, and initial origins. The unchanged migration trigger creates those origins; the fixture performs no backfill. Both targets remain version 1 with one own invoice, no other financial records, and 300000-cent balances.
- **Shared capture without economic effects:** `tests/fixtures/sync-selection.ts:500–520` opens the two real commitments in order and checks one lane with the first activation as initializer. `tests/integration/sync-selection.test.ts:311–349` uses the accepted sequence-3/4 payment page, checks shared finance progress and unchanged semantic progress, and verifies the second capture is replayed without new capture/activity rows. Complete fixed snapshots cover parent, import, origin, lineage, authority, and current P1 outcome/unit/head tables after each call. The financial state is also checked directly. No selector or sync writer is called.
- **Owned lifecycle and repeatability:** cleanup is registered after successful acquisitions and attempted in reverse order, with idempotent close and preserved construction errors. Existing provisioning and worker-launch functions handle their own unsuccessful acquisitions; transaction clients release in `finally`. Setup listeners close before fixture return. Independent pass-through observers inventory all ten inputs before publication and compare them after proofs/capture. One fresh construction repeats the real qualification with distinct root/namespace and identical input bytes. The deliberate failure case reaches real financial work and live worker/review composition, then verifies completed listener/pool closure, the exact owned namespace drop, root removal, and identical error propagation; it includes fallback cleanup.

## Issues

- Critical: None found.
- Important: None found.
- Minor: None found.

## Historical inventory evidence boundary

The task explicitly permitted retaining the pre-edit inventory in memory. The controller discloses that the original 83-file/two-absent-root map is no longer available, while its contemporaneous aggregate digest and equality result remain recorded. Consequently, I cannot independently replay that historical comparison, especially for ignored saved demo pins. The Git diff establishes unchanged pre-existing tracked source between the reviewed commits; it does not establish historical ignored-file equality. The passing in-suite before/after comparisons protect their observed execution interval and are separate evidence, not a reconstruction of the earlier map.

This is a disclosed retention limitation, not evidence of mutation, a fabricated replacement inventory, or a violation of the permitted in-memory option. No concrete code or qualification defect follows from it. Future tasks should persist the safe path/hash/length and absent-root inventory, as the controller already requires. The historical claim should continue to carry this limitation wherever it is reused.

## Declined to judge

- Selector inspection, known-peer routing, earliest group proposals, and selector zero-write guarantees: no selector implementation or invocation belongs to this prerequisite; the later consumer gate remains mandatory.
- Cross-financial-stream/separate-resource enrollment and additional audit variants: this fixture deliberately uses the unchanged fixed Company A lane; their owner dependency and later qualification remain pending.
- Future sync application, concurrency/revocation races, authority HTTP ingress, and delivery scheduling: the change captures/replays pages but does not exercise those broader existing subsystems as end-to-end consumers.
- Live model construction, Company B/CSV behavior, browser workflow, full slice/demo acceptance, and production readiness: the supplied results are focused synthetic fixture checks, not those separately required proofs.
- Independently reproducing the historical pre-edit ignored-file comparison: the original map was not retained; the narrower available evidence and limitation are stated above.
- Exhaustive filesystem/DB outage and cleanup-failure behavior: source inspection and the specified late construction fault cover the assigned lifecycle gate, not a fault matrix for all unchanged infrastructure dependencies.

## Assessment

**Ready to merge? Yes.** The exact branch implements the accepted fixed-peer prerequisite through genuine existing proof and approval interfaces, preserves literal expected economics and original inputs, and provides meaningful qualification of shared capture and cleanup. The supplied focused machine evidence is consistent with the inspected implementation. Merge readiness does not waive the disclosed historical evidence limit or authorize claims about the deferred selector, cross-stream, variants, live behavior, or joint acceptance.
