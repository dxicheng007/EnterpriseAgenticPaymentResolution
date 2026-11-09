# Parent projection

Follow the [repository](../../AGENTS.md) and [package](../AGENTS.md) guides. [Financial projection](src/state.ts) copies target financial arrays for preview. [Bootstrap projection](src/bootstrap.ts) additionally validates scoped metadata and duplicate IDs, preserves exact canonical matches and rejects conflicting customer, account or billing-configuration records. The read interface supplies a scoped target at an explicit instant. Both are pure; neither persists a parent record, changes target version, issues invoices or moves money.

Use the [bootstrap proposal section 2](../../docs/progress/2026-11-08/handoffs/v3-bootstrap-verification-proposal.md#2-pure-planner-and-projection), [planner handoff](../../docs/progress/2026-11-08/handoffs/b-bootstrap-planner.md), and [financial freeze](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f3--target-records-mutations-finance-and-preview). Existing metadata arrays retain their order; only declared prepared sets are normalized. Review does not establish factual evidence support.

Run `npm run typecheck` and `npm run test:unit -- packages/compiler/test packages/parent/test packages/finance/test`. Persistence and authorized activation require separately assigned worker transactions and verification.
