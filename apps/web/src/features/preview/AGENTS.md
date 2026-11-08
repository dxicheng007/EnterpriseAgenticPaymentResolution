# Preview and verification UI

Follow the [apps guide](../../../../AGENTS.md) and [frozen preview and verification protocol](../../../../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol). The [report view](VerificationReport.tsx) reads the [public job and summary schemas](../../../../../packages/contracts/src/review.ts). Mandatory status, coverage, and eligibility are separate, and the browser displays only the public report.

Run the [report rendering check](../../../../../packages/client/test/review-display.test.ts) through `npm run test:unit -- packages/client/test/review-display.test.ts`.
