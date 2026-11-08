# Scripts

Follow the [repository instructions](../AGENTS.md) and [execution and verification conventions](../docs/superpowers/plans/2026-11-08-implementation-plan.md#execution-and-verification-conventions).

| Script | Command and responsibility |
| --- | --- |
| [Native database](native-db.ts) | `npm run db:up` provisions and starts the local PostgreSQL 18 cluster. `npm run db:down` stops it and retains data. |
| [Migrations](migrate.ts) | `npm run db:migrate` applies each database's versioned SQL with migration credentials and checks recorded hashes. |
| [Seed](seed.ts) | `npm run db:seed` records idempotent V0 seed state and activity. |
| [Development launcher](dev.ts) | `npm run dev` starts the database, migrates and seeds, then launches loopback services and the browser development server. Keep ordinary startup free of destructive resets. |
| [Slice verifier](verify-slice.ts) | `npm run verify:slice -- V0` runs mandatory V0 cases and typecheck and records results. The registry names later slices, whose verification is unavailable in the foundation. |

The current readiness probe covers migration 001. Later slices must check all expected migrations under [F6](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol). Current live verification and demo injection entry points report unavailability. Future `npm run test:live -- <file>` must require real provider execution, with missing access, failed checks, and skipped mandatory cases unable to pass. Keep future injection operator-only.

Use [workspace command definitions](../package.json) and the [evidence packet rules](../docs/superpowers/plans/2026-11-08-verification-playbook.md#evidence-packet). Record the exact commit, configuration and commands, and redact credentials from logs and evidence. Test fixtures and helpers must never expose protected truth to product tools.
