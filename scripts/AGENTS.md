# Scripts

Follow the [repository instructions](../AGENTS.md) and [execution and verification conventions](../docs/superpowers/plans/2026-11-08-implementation-plan.md#execution-and-verification-conventions).

| Script | Command and responsibility |
| --- | --- |
| [Native database](native-db.ts) | `npm run db:up` provisions and starts the local PostgreSQL 18 cluster. `npm run db:down` stops it and retains data. |
| [Migrations](migrate.ts) | `npm run db:migrate` applies each database's versioned SQL with migration credentials and checks recorded hashes. |
| [Seed](seed.ts) | `npm run db:seed` records idempotent V0 seed state and activity. |
| [Demo loader](load-demo.ts) | Generate a missing synthetic dataset using the [operator generator](generate-fixtures.ts), validate visible source members, and publish and capture them with the accepted source services. Existing complete input is checked and reused. A partial or corrupt dataset blocks startup. |
| [Development launcher](dev.ts) | `npm run dev` starts the database, migrates, seeds, and loads the demo before launching loopback services and the browser development server. Only control receives evidence storage configuration and pinned capture IDs. Worker and control read the safe scope registry. Control registers source candidates and preview reads the worker over authenticated loopback HTTP. See [parent read setup](../docs/demo/parent-read-setup.md). The supervisor supplies a separate private source-read capability to control and the worker. Control receives the optional review selection path, and the worker receives the fixed source origin and allowlist. See [worker activation setup](../docs/demo/worker-activation-setup.md). |
| [Slice verifier](verify-slice.ts) | `npm run verify:slice -- V0` runs mandatory V0 cases and typecheck and records results. `npm run verify:slice -- V1` runs the five mandatory source and evidence files and typecheck, then records allowlisted assertions and two screenshots with authenticated traces disabled. The V2 gate runs 94 named checks across 20 files plus typecheck. It retains ten validated screenshots and allowlisted observations from both actual version-2 verification jobs. Later slice gates are unavailable. |

The loader uses seed `local-demo-v1` and as-of `2026-10-01T00:00:00.000Z`. The supervisor keeps visible input, protected generator output and evidence storage in separate ignored directories under `.local/demo`. It does not pass protected output configuration to control, worker, or web. Evidence originals are served through scoped control routes.

Startup discovers the versioned SQL catalog. Readiness requires the complete expected migration version and checksum list under [F6](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol). Current live verification and demo injection entry points report unavailability. Future `npm run test:live -- <file>` must require real provider execution, with missing access, failed checks, and skipped mandatory cases unable to pass. Keep future injection operator-only.

Use [workspace command definitions](../package.json) and the [evidence packet rules](../docs/superpowers/plans/2026-11-08-verification-playbook.md#evidence-packet). Record the exact commit, configuration and commands, and redact credentials from logs and evidence. Test fixtures and helpers must never expose protected truth to product tools.
