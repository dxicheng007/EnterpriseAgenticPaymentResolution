# Source evidence UI

Follow the [apps guide](../../../../AGENTS.md) and [frozen evidence contract](../../../../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f4--evidence-uploads-and-coordinated-snapshots). The [evidence panel](EvidencePanel.tsx) uses the [source client](../../../../../packages/client/src/sources.ts) and [evidence schema](../../../../../packages/contracts/src/evidence.ts) to display the cited UTF-16 span and the scoped original.

Run the [citation rendering check](../../../../../packages/client/test/review-display.test.ts) through `npm run test:unit -- packages/client/test/review-display.test.ts`.
