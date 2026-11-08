# Protected evaluator

Follow the [package guidance](../AGENTS.md), [T2.2 plan](../../docs/superpowers/plans/2026-11-08-implementation-plan.md#t22-independently-verify-the-artifact-and-make-the-report-reviewable), and frozen [financial](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f3--target-records-mutations-finance-and-preview) and [process](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol) contracts.

- [Reference model](src/reference-model.ts) evaluates complete, independently specified facts at an explicit instant and retains the original financial records for comparison. Keep expected-state calculation independent of compiler, finance, runtime, and subject output. Share contracts and canonical identities.
- [Protocol](src/protocol.ts) and [runner](src/runner.ts) exchange bounded JSON through a fixed Node executable and trusted entrypoint. The subject receives visible inputs only. Keep expected results, protected paths and provider credentials outside the wire and product tool, HTTP and browser roots. Treat runner failure codes as safe transport categories and discard raw stderr.
- [Oracle tests](test/reference-model.test.ts) use public development facts. [Transport tests](test/protocol.test.ts) use scripted children and prove framing and failure handling. A successful exchange establishes structural validity. Report binding, coverage, eligibility and issuance require the separate verification gate.

Run `npm run test:unit -- packages/evaluator/test/reference-model.test.ts packages/evaluator/test/protocol.test.ts` and `npm run typecheck` for this partial oracle and protocol proof.
