# Acquisition connector prototype

Reconstruct an acquired company's contract-to-cash history and translate its existing records into a predefined simulated parent system. Design-time agents will propose evidence-backed connector rules; explicit per-customer approval authorizes bounded, deterministic synchronization. The product does not issue invoices or move money.

**Current build:** local PostgreSQL-backed source capture, evidence inspection, single-customer development connector previews, and independent verification. Live agent construction, activation, persisted parent imports, and ongoing sync are not implemented yet. Preview performs zero parent writes.

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

Open http://127.0.0.1:5173. The loopback demo establishes a local reviewer session without a sign-in screen. Native setup creates isolated local databases and synthetic source records. See [process instructions](apps/AGENTS.md) and [verification setup](docs/demo/verification-setup.md).

```sh
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
```

Run integration and browser checks using the isolated leases described in the implementation guides; do not restart another developer's active database. Generated evidence, database contents, credentials, and protected verifier bundles remain local and git-ignored. The repository includes their generators and setup code.
