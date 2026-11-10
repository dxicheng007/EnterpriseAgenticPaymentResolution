# Repository instructions

Build reviewable acquisition connectors from source evidence. A reviewer approves one customer and the exact rules for that customer's later automatic synchronization. The worker applies those rules deterministically to existing financial records. The product neither issues invoices nor moves money.

## Current local implementation

The foundation provides shared contracts, isolated PostgreSQL storage and durable activity, control and worker health, and native setup and verification scripts. Local development startup loads two synthetic acquisitions and mounts source dossiers, evidence reads, and deterministic connector preview against registered parent state through the authenticated worker. The loopback browser bootstraps a server-managed demo reviewer session. The local demo mounts reviewer verification when both captured sources have valid operator-pinned construction fixtures. See the [verification setup guide](docs/demo/verification-setup.md). Incomplete mandatory evaluator coverage keeps candidates ineligible. Pure bootstrap planning and authenticated discovery lifecycle/delegation are implemented prerequisites; the default local composition has no configured model client. The Discovery monitor, pinned source reads, supported agreement associations, findings/proposals, compilation and empty-sandbox replay/compare are implemented. The offline model stub does not establish live generation. Runtime parent storage, authenticated parent reads, financial attestation provenance and operator scope publication are implemented. Publish the exact demo scopes using the [parent-read setup guide](docs/demo/parent-read-setup.md). Authenticated review preparation, durable per-customer approval intents and worker first import/receipt recovery are mounted through the normal supervisor. Authenticated immutable package-detail reads expose the saved financial preview, selected profile, evidence references and bounded future rules without protected proof material or writes. The retry-safe attested Discovery verification producer is accepted; Gate J `requestVerification` / `readVerification` supervisor consumers are wired against interim trusted scopes but **not Gate J–accepted** (open authorization/recovery/settlement findings). Repair/finish, live holdouts, live-transport mount readiness, and full V4 acceptance remain open. New activation requires exact operator-installed policy, real financial/bootstrap proofs and explicit reviewer approval; missing setup fails closed while committed receipts remain recoverable. See the [worker activation setup guide](docs/demo/worker-activation-setup.md). The approval browser workflow, full V3 acceptance, live construction and ongoing synchronization remain separate unfinished work.

The stack is Node 24, strict TypeScript with npm workspaces, Fastify, React/Vite, PostgreSQL 18 with `pg`, Zod, Vitest, and Playwright. PDF.js extracts PDF text, and pdf-lib generates synthetic development documents. The runtime worker must have no model calls, SDK, or key. See [workspace commands](package.json), [compiler configuration](tsconfig.json), and [local process guides](apps/AGENTS.md).

## Read before changing behavior

- [PRD v2 product thesis](prdv2.md#1-product-thesis), [local process boundaries](prdv2.md#local-process-boundaries), and [acceptance criteria](prdv2.md#19-acceptance-criteria).
- [Implementation plan and verification conventions](docs/superpowers/plans/2026-11-08-implementation-plan.md#execution-and-verification-conventions) and [shared contracts and file ownership](docs/superpowers/plans/2026-11-08-shared-contracts.md#file-ownership).
- [Contract freeze v1](docs/superpowers/plans/2026-11-08-contract-freeze.md#foundation-scope-and-sequencing) and its sections for the behavior being changed.
- [Joint verification playbook](docs/superpowers/plans/2026-11-08-verification-playbook.md#what-verification-means).

Follow the latest direct user instructions, then applicable repository guidance and authoritative specifications. Frozen contract clarifications take precedence over older abbreviated shared-contract shapes and illustrative PRD examples. Resolve behavior from the existing authoritative specifications first. For an absent or conflicting requirement, raise the exact gap to the responsible owner. The owner may locate or clarify intent already specified. Materially unspecified product or financial behavior requires user clarification. While it is pending, continue only independent, explicitly specified work. Choose routine implementation details only where needed to implement the specified behavior.

Implement only the assigned scope and paths. Avoid extra features or semantic broadening. Commit at coherent logical steps with a labeled, descriptive subject under 20 words, such as `docs: document repository boundaries`.

## Product invariants

- Keep original evidence, interpretations, reviewed inputs, and imported records distinct. Every monetary value or binding term needs applicable evidence or a reproducible derivation. Review does not turn an unsupported amount into a fact.
- Use checked integer cents and explicit scope, currency, effective time, and versions. Unallocated funds do not reduce an invoice balance. Only supported full payment or credit reversals reverse their associated allocations and preserve originals. Keep historical approved snapshots and guard against repeat economic effects.
- Preview performs zero parent writes. Only explicit per-customer reviewer approval may grant bounded standing authority. Worker receipts are authoritative. Control and runtime own separate databases with separate application credentials. Keep credentials and protected verification truth out of product tools, browser bundles, and evidence packets.

See [financial integrity and evidence](prdv2.md#12-financial-integrity-and-evidence), [money and preview](docs/superpowers/plans/2026-11-08-contract-freeze.md#f3--target-records-mutations-finance-and-preview), and [activation authority](docs/superpowers/plans/2026-11-08-contract-freeze.md#f5--immutable-receipts-and-trusted-activation-bridge).

## Local setup and checks

Put Node 24 and PostgreSQL 18 binaries on PATH for the [native database script](scripts/native-db.ts). On Apple Silicon with Homebrew, use `export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin:$PATH`. Run `npm ci`, `npm exec playwright install chromium` for browser checks, and `npm run dev` to start the local app. Use `npm run db:down` to stop the native cluster while retaining data.

Use `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, and `npm run verify:slice -- V0`. Record focused checks as partial. Machine results, independent review for the exact candidate, and joint user acceptance are separate. Live, financial, and later-slice claims require their own evidence.

Pull requests run the same typecheck, unit, integration, and e2e commands through [GitHub Actions](.github/workflows/pr.yml) on Node 24 with native PostgreSQL 18. Slice verify packets and live model runs stay out of that PR gate. After merge, mark the three workflow jobs as required checks on `main`.

## Area guides

- [Apps](apps/AGENTS.md)
- [Packages](packages/AGENTS.md)
- [Database](db/AGENTS.md)
- [Scripts](scripts/AGENTS.md)
- [Tests](tests/AGENTS.md)
