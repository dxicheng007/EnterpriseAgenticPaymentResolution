# Packages

Follow the [repository instructions](../AGENTS.md) and [shared file ownership](../docs/superpowers/plans/2026-11-08-shared-contracts.md#file-ownership).

| Area | V0 responsibility |
| --- | --- |
| [Contracts exports](contracts/src/index.ts) and [common schemas](contracts/src/common.ts) | Shared Zod schemas and TypeScript types. Keep object shapes strict except explicitly declared raw JSON, and validate raw payloads against pinned source contracts at their specified boundary. |
| [Canonical helpers](contracts/src/canonical.ts) | Own deterministic canonical encoding and hash helpers. Reuse them across consumers and preserve explicit preimages, declared set ordering, and array order elsewhere. |
| [Control pool](storage/src/control-db.ts) and [runtime pool](storage/src/runtime-db.ts) | Keep service-specific PostgreSQL connections separate. |
| [Transactions](storage/src/transaction.ts) and [activity](storage/src/activity.ts) | Use one checked-out `pg` client for the whole transaction. Keep it short and external I/O outside it. Retry whole transactions only for supported SQL states within the bounded retry policy. Publish activity in the transaction that advances its locked counter. |

Follow frozen [representation and identity](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f1--representation-identity-canonical-hashes). Distinguish delivery identity `(sourceRef,id)` from economic identity `(sourceRef,sellerEntityId,kind,recordId)`. Version and account aliases do not create new monetary effects. Resolve approved scope only from the exact approved identity map. Use checked integer cents and explicit `BIGINT` conversion within safe bounds. Preserve the exact money, reversals and preview semantics in [F3](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f3--target-records-mutations-finance-and-preview).

## Planned packages and contracts

Compiler and finance follow [T2.1](../docs/superpowers/plans/2026-11-08-implementation-plan.md#t21-compile-the-restricted-mapping-language-and-reconcile-a-preview), the [restricted DSL](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f2--concrete-source-contracts-and-executable-dsl), and F3. Keep planning pure with an explicit evaluation instant. The protected evaluator follows [T2.2](../docs/superpowers/plans/2026-11-08-implementation-plan.md#t22-independently-verify-the-artifact-and-make-the-report-reviewable) and [F6](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f6--health-and-protected-verification-protocol). Its reference calculations are independent of production finance, compiler and runtime.

`CustomerActivation`, `ConnectionState`, and `ParentView` are deferred. Do not export placeholder or permissive versions. Resolve the exact contract with the responsible owner before consumers require it. See the [freeze deferral](../docs/superpowers/plans/2026-11-08-contract-freeze.md#foundation-scope-and-sequencing) and the [review and runtime vocabulary](../docs/superpowers/plans/2026-11-08-shared-contracts.md#review-and-runtime).
