# Final walkthrough and rehearsal checklist

This rehearsal checklist is subordinate to the [demo contract](demo-contract.md), which freezes identities, construction modes, expected cents, injection, and pass/fail observations.

Status: script and checklist only. No rehearsal has been run. Record each run's real outcome in the table below; do not pre-fill it. Steps 1–8 below are the pre-T1 subset; a full track rehearsal must complete [demo-contract](demo-contract.md) steps 1–10.

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

- Pause/resume/revoke command ingress is not mounted.
- Correction submission stays fail-closed (422); there is no correction UI.
- Pending, quarantined and lag counts are not persisted.
- Live discovery and live sync remain planned.

## Rehearsal log (fill in from real runs)

| Run | Date/time | Operator | Candidate commit | Completed demo-contract steps 1–10 | Deviations / failures |
| --- | --- | --- | --- | --- | --- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |

Restart between runs: `npm run db:down` stops the cluster and retains approvals and imports; `npm run dev` then restarts on the same preserved data. It is not a reset. A fresh state needs a separately owned disposable rehearsal setup; never reset the preserved demo.
