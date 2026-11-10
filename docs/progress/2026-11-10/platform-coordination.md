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
