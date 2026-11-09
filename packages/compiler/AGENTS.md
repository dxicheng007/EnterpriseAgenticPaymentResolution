# Compiler

Follow the [package guide](../AGENTS.md) and [repository instructions](../../AGENTS.md).
[Compilation](src/compile.ts) checks the frozen source contracts, mappings and profile bindings and emits a canonical artifact. [Batch planning](src/plan-batch.ts) validates exact scope and source versions, resolves financial dependencies and returns proposed operations, lineage and holds. Both functions are pure. The [preview adapter interfaces](src/preview-adapters.ts) keep immutable source, target and registry access separate from the compiler.

Financial amount constants are unsupported in v1 because the executable contracts have no record-applicability binding for a finding. Source-wide USD and supported nonmonetary constants follow the [frozen DSL](../../docs/superpowers/plans/2026-11-08-contract-freeze.md#f2--concrete-source-contracts-and-executable-dsl).

[Bootstrap planning](src/plan-bootstrap.ts) wraps the unchanged financial planner with explicit metadata ensures, leaf-level lineage and copied [parent projection](../parent/AGENTS.md). It requires one nonempty financial baseline and conservatively retains blocking holds; empty or replay-only inputs cannot produce a metadata-only import. Follow the [S1 handoff](../../docs/progress/2026-11-08/handoffs/b-bootstrap-planner.md). This pure plan grants no approval and does not establish source support.
