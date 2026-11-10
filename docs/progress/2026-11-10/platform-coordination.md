# Platform coordination and owner requests — November 10, 2026

## Current integration checkpoint

Developer 0 resumed at `15bb421945bcfd1366e63ef497929737a2995bab`, integrating externally merged PR41–45 into the clean isolated Platform worktree. New work is on `codex/platform-sync-apply-repair`. The user authorized publishing dependency requests and periodically checking upstream. The November 10 team handoff remains the roadmap; newer exact reviews supersede its historical findings when verified.

PR42 browser evidence, PR43 Discovery corrections, PR44 connection reads/UI and PR45 rehearsal documentation are under fresh exact review. Open PR46 was observed at `d717aa90691cb884a3f6de0cca3e5cfc71131416`; it is reviewed separately from merged PR43. Do not infer closure or acceptance from merge status. No source writer is active until its bounded permit is issued.

## Platform ownership reservation

- Developer 0 reserves **`db/runtime/006_sync_apply_repair.sql`** for the bounded unmounted atomic-apply repair. All 75 fetched origin refs were inspected at this checkpoint; none contained runtime migrations beyond005 or control migrations beyond009. Recheck before dispatch and integration.
- Runtime001–005 remain immutable. The plan must repair receipt origins, captured-input coverage and atomic application progress additively while preserving PR44's reads of nonempty `runtime_sync_receipts`. No empty monetary receipt or automatic production mount is authorized.
- Developer 0 owns the protected build-inventory integration correction for the new `packages/contracts/src/connection-state.ts` export. Combined main unit results: 558 passed / two inventory failures; typecheck passed. The source contract remains Experience's existing contribution. Do not weaken the recursive-closure tests or repin the preserved demo.
- No control migration is reserved by this note. Discovery repair/finish grants and generated-account capability rules require their own reviewed Platform contract and reservation.

## Owner follow-up protocol

Discovery and Experience requests will be appended here with exact source references, requested deliverables and dependencies after the current independent reviews finish. Preserve completed owner work; do not redispatch historical defects that the latest source corrects. Owners should publish exact commit/test evidence and identify shared paths before modifying Platform storage, contracts or protected inventories.

Developer 0 fetches while source writers or tests are active and integrates main at clean checkpoints. Each newly merged candidate receives appropriate review and combined checks; unavailable full V4–V7 proof remains unavailable. A passing harness or fixture UI does not supply missing live, financial or recovery proof.

## Discovery request — exact merged PR43/46 review

PR46 subsequently merged externally as `cfbf679c865a799f9d7864aee2a55e378a318732`; Platform integrated it at clean checkpoint `98c82ef`. Its relevant source is byte-identical to the reviewed `d717aa9`. The [fresh review](discovery-pr43-pr46-review.md) credits commit-ambiguity handling, pause/capture/current settlement, production injection gating, scoped response improvements, atomic claim and transcript preservation. Do not reopen those repaired source defects.

Discovery owns the next bounded correction: revalidate immutable dispatch/task/capture and complete remaining-batch identity after external preparation; authenticate the original history consistently for recovery/read/state; persist observed revocation and ensure queued/running recovery makes bounded progress; preflight every registered subject before earlier effects. Preserve PR46's same-transaction claim while replacing the false rule that every running job is interrupted with a recorded producer uncertainty observation. Supply real owner/service recovery barriers rather than rewinding financial job state in a test. The report numbers these R1–R5.

The transport follow-up must reject message-level refusal, retain known usage on normalization failures, and stop reading an oversized response before unbounded allocation. Keep live composition unmounted. Platform will separately resolve the approved actual-input meter/model configuration boundary; the bytes/4 heuristic cannot certify a provider token ceiling. No new provider configuration or generated-account grant follows from these fixes. Publish the exact correction SHA and checks for fresh integration review; coordinate any shared contract output changes before editing them.

## Experience request — exact merged PR42/44/45 review

The [fresh review](experience-pr42-pr44-pr45-review.md) credits the import-version wording correction, original-receipt recovery through a real lost reply, evidence inspection and blocked approval coverage. Remaining work is narrower than the old missing-controls defects.

Experience owns three bounded corrections:

1. Resolve operations capture streams/incidents by the selected account's exact committed source/manifest lane, not by `runtime_capture_lanes.initial_activation_id`. The capture contract permits multiple enrolled accounts to share the lane created by the first; the second account currently loses visibility. Add a real two-account read regression while retaining account/source authorization and zero writes.
2. Replace the unsupported literal runtime model-call metric with an honest representation until the real worker fresh-input trap supplies evidence. Coordinate a strict shared contract change with Platform if needed; do not report an unmeasured count as measured zero.
3. Correct the walkthrough's reset instructions: `db:down` stops the cluster and retains approvals/imports. Document restart as restart and use a separately owned disposable rehearsal setup for a fresh state. Do not reset the preserved demo.

Platform owns the protected source-inventory omission from PR44 and has dispatched that repair. Experience should retain the new read-only view and coordinate additional progress fields after the apply/progress contract lands. V3 run-specific public packet observations, remaining browser variants and actual V7 rehearsals remain separate proof tasks; the checklist is not completed rehearsal evidence.

## Protected-inventory correction checkpoint

Source `cd777756a0154b79cbe7e51bbdd5e1f4057358c3` adds the connection-state leaf to bootstrap subject/evaluator and financial build inventories, with byte-mutation and missing-file coverage. The [implementation report](connection-build-inventory-report.md) and [fresh exact review](connection-build-inventory-review.md) record five focused tests and typecheck passing; review has no findings. Root's integrated unit suite after PR46 and this repair passes all 560 tests / 79 files. Root is checking the affected V3 browser/activation workflow separately. No preserved-demo repinning or protected expected-value change was performed.
