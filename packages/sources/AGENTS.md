# Source acquisition

Follow the [repository instructions](../../AGENTS.md), the [package boundaries](../AGENTS.md), and the frozen [evidence and coordinated snapshot contract](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f4--evidence-uploads-and-coordinated-snapshots).

- [Company A](src/company-a.ts) declares its read-only source contracts and constructs raw events. Preserve the frozen [source vocabulary](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f2--concrete-source-contracts-and-executable-dsl).
- [Visible fixture templates](src/canonical-fixtures.ts) generate public source inputs. The [operator generator](../../scripts/generate-fixtures.ts) writes protected evaluator v1 construction truth to separate, private roots. Existing output files require a fresh destination. Product imports must not reach protected truth, public comparison fixtures, or operator commands.
- [Uploads](src/uploads.ts) persist original associations and activity. [Dossiers](src/dossier.ts) read manifest capture state. Control owns source metadata in the [source migration](../../db/control/002_sources.sql).
- [Evidence extraction](../evidence/src/extract.ts), [locators](../evidence/src/locate.ts), and [byte storage](../evidence/src/store.ts) implement original-byte provenance. Preserve UTF-16 offsets and scoped associations. The [HTTP plugin](../../apps/control/src/routes/sources.ts) requires injected authorization.

Keep raw identity separate from approved customer scope. This package records source data and capture state. Compiler, finance and runtime own interpretation, money, and target writes.

[Company B](src/company-b.ts) decodes the fixed CSV envelope and declares independent file, receipt, and semantic streams. [Manifest services](src/manifest.ts) serve pinned captures and [change pages](src/change-feed.ts). [Scenario administration](src/scenario-admin.ts) is a separate operator-only import that requires its own token and explicit enablement. Keep it out of product tools.
