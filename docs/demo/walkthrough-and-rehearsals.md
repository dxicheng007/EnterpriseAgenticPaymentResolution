# Final walkthrough and rehearsal checklist

This rehearsal checklist is subordinate to the [demo contract](demo-contract.md), which freezes identities, construction modes, expected cents, injection, and pass/fail observations.

Status: checklist for operators. Three agent-timed Company A fixture/AI-off rehearsals passed on candidate `bac37fa` / tip `a945586` (see [experience-mvp-completion.md](../progress/2026-11-10/experience-mvp-completion.md)); **joint user acceptance and a main-tip rehearsal remain open**. Record each run's real outcome in the table below; do not invent rows. Steps 1–8 below are the pre-T1 subset; a full track rehearsal must complete [demo-contract](demo-contract.md) steps 1–10. Path: [demo-mvp-path.md](../progress/2026-11-10/demo-mvp-path.md).

## Preconditions

- Node 24 and PostgreSQL 18 on PATH, `npm ci`, then `npm run dev`. See [verification setup](verification-setup.md), [parent-read setup](parent-read-setup.md) and [activation review setup](activation-review-setup.md).
- Both synthetic acquisitions loaded; reviewer verification mounted (valid operator-pinned fixtures).
- Machine checks green for the exact candidate: `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`.
- Not provided by this document: live provider keys, independent review, joint acceptance.

## Walkthrough (one customer, about 10 minutes)

1. **Discovery.** Open the source dossier. Show evidence reads and the discovery detail panels. State that the runtime worker has no model client.
2. **Preview.** Run the deterministic connector preview. Point out zero parent writes and integer-cent amounts.
3. **Inspect evidence before approval.** In Review, open source evidence for a rule. Confirm every amount shows its evidence or derivation.
4. **Unsupported term.** Show a package with a blocker diagnostic: approval is disabled and the unresolved decision is shown. No amount is invented.
5. **Approve one customer.** Approve; show the activation receipt (id, activation id, epoch, parent version).
6. **Lost reply and changed head.** Retry after the head changes: the original receipt returns (`replayed`), one import row, no repeat economic effect.
7. **Parent-version wording.** Approval binds to the displayed parent version only; a changed parent means re-prepare and re-approve.
8. **Operations.** Open Operations: status, epoch, streams, gaps/conflicts, receipt history. Pending, quarantine and lag read "Not measured" until the platform persists them. Pause/resume/revoke controls are not available yet.

## Known gaps to say out loud

- Construction is a **development fixture** / hardcoded pregenerated connector, not live model construction.
- New money in the demo is the **simulated** operator inject (`freshPaymentA`), not browser-held operator capability.
- Correction submission stays fail-closed (422); there is no correction UI.
- Pending, quarantined and lag counts stay **Not measured** until persisted.
- Pause/resume/revoke are mounted for Experience on the platform tip; do not claim them on older `main` tips without checking.
- Live discovery and live sync remain planned (T9), not this track.

## Rehearsal log (fill in from real runs)

| Run | Date/time | Operator | Candidate commit | Completed demo-contract steps 1–10 | Deviations / failures |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-11-10T21:22:17Z (~166s) | Experience agent (lease 55444) | `bac37fa` | yes (fixture/AI-off Company A) | none; sync `receipt:e4b25ae1-…` 80000→50000 then replayed |
| 2 | 2026-11-10T21:41:12Z (~166s) | Experience agent (fresh DB) | `bac37fa` | yes | none; sync `receipt:b3c2e2db-…` 80000→50000 then replayed |
| 3 | 2026-11-10T21:44:55Z (~166s) | Experience agent (fresh DB) | `bac37fa` | yes | none; sync `receipt:9804e7d7-…` 80000→50000 then replayed |
| user | | | | | |

**Reset between first-apply runs:** `npm run db:down` only **stops** the cluster and retains approvals/imports. For a fresh first-apply rehearsal follow [disposable staging](disposable-staging.md): leased checkout/namespace, drop/recreate that lease’s demo databases, then `npm run dev`. Never reset the preserved original demo. Keep staged demo responses **off** for recorded rehearsals.
