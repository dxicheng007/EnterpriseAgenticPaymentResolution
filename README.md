# Acquisition connector prototype

Reconstruct an acquired company's contract-to-cash history and translate its existing records into a predefined simulated parent system. Design-time agents will propose evidence-backed connector rules; explicit per-customer approval authorizes bounded, deterministic synchronization. The product does not issue invoices or move money.

**Current build:** local PostgreSQL-backed source capture, evidence inspection, registered parent-state reads, development connector previews, independent verification, and persisted discovery findings/proposals. The monitor and scripted orchestration checks exist; live agent construction, customer activation, persisted parent imports, and ongoing sync remain incomplete. Preview performs zero parent writes.

- [Demo remaining work (active track: pregenerated connector + AI-off sync)](docs/superpowers/plans/2026-11-10-demo-remaining-work.md) — shared task board; update when dispatching or completing work
- [Current team handoff — November 10 owner tasks](docs/progress/2026-11-10/team-handoff.md)
- [Three-team handoff: lane ownership and older dependency graph](docs/superpowers/plans/2026-11-08-team-expansion-handoff.md)
- [Progress, verification, branches, and next work](docs/progress/2026-11-08/README.md)
- [PRD v2](prdv2.md)
- [Vertical implementation plan](docs/superpowers/plans/2026-11-08-implementation-plan.md)
- [Joint verification playbook](docs/superpowers/plans/2026-11-08-verification-playbook.md)
- [Repository and agent instructions](AGENTS.md)

## Local development

Use Node 24 and PostgreSQL 18. On Apple Silicon with Homebrew:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH
npm ci
npm exec playwright install chromium
npm run dev
```

Open http://127.0.0.1:5173. The loopback demo establishes a local reviewer session without a sign-in screen. Native setup creates isolated local databases and synthetic source records. See [process instructions](apps/AGENTS.md), [parent-read scope publication](docs/demo/parent-read-setup.md), and [verification setup](docs/demo/verification-setup.md). A fresh checkout needs explicit scope publication before parent-backed preview; this does not approve a customer.

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

Run integration and browser checks using the isolated leases described in the implementation guides; do not restart another developer's active database. Generated evidence, database contents, credentials, and protected verifier bundles remain local and git-ignored. The repository includes their generators and setup code.
