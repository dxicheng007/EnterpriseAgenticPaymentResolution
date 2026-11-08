# Source evidence UI

Follow the [apps guide](../../../../AGENTS.md) and [frozen evidence contract](../../../../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f4--evidence-uploads-and-coordinated-snapshots). [App](../../App.tsx) mounts [SourcesPage](SourcesPage.tsx) after the local reviewer session opens. It reads company and manifest dossiers through the [source client](../../../../../packages/client/src/sources.ts). [UploadForm](UploadForm.tsx) stores a file with explicit scope and document metadata. A complete capture supplies the evidence IDs. The [evidence panel](EvidencePanel.tsx) uses the [evidence schema](../../../../../packages/contracts/src/evidence.ts) to display the cited UTF-16 span and the scoped original.

Run the [citation rendering check](../../../../../packages/client/test/review-display.test.ts) through `npm run test:unit -- packages/client/test/review-display.test.ts`.
