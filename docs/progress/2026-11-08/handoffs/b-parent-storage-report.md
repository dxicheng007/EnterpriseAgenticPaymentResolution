# A3a parent storage implementation report

- Assigned worktree `/Users/devincheng/.codex/worktrees/acquisition-sources/EnterpriseAgenticPaymentResolution`, branch `codex/parent-storage`
- Base `700d1353b9d18d6425b79e710636d68690424b79`
- Candidate `bb8c070930c14364af1a98695ad904fec5b3c238`, commit `feat: persist scoped first imports and immutable parent history`
- Reviewed handoff SHA-256 `0f095fc7524df2b40dc811007ef39da8db049e666861e51a379a9aa59ba3d3b8`
- Candidate worktree clean after the focused checks. Independent review and joint acceptance remain separate.

## Scope and implementation

Runtime002 creates the account-to-full-scope sentinel, immutable target snapshots, a mutable latest pointer, scoped metadata, globally unique economic records, immutable source deliveries, the paired activation/import receipt aggregate, original economic and selected delivery outcomes, and complete ordered import lineage. Canonical JSON text and SHA-256 digests are retained separately from domain hashes. SQL validates object and indexed-field shapes, requires full-scope and receipt associations, and restricts updates to the latest pointer's hash and version columns. Immutable rows have rejecting triggers and app-role SELECT/INSERT grants. There are no runtime status or epoch mutation ports.

SQL index checks use a JSONB projection that replaces NUL and lone-surrogate escapes that PostgreSQL cannot decode. The original canonical TEXT and digest are retained and verified. The integration test includes both actual problematic escapes and a literal backslash-escaped sequence.

Scope and global request-key locks are transaction advisory locks. Current target uses a row lock granted by the restricted pointer UPDATE privilege. Physical advisory lock IDs are sorted before acquiring stable target ID, global economic identity and delivery locks, including absent rows. Full SQL uniqueness remains a final guard. The existing transaction helper owns retries and commit or rollback. The bounded storage primitive requires locks obtained by the same client in the current callback and the transaction owner must propagate rejection out of that callback.

Receipt `targetRecordIds` follows the root's representation ruling. It retains financial operation target IDs in plan order. Metadata ensures remain in the exact plan, lineage and approved snapshot. Exact replay compares the original canonical request and bundle even when the domain hash matches. The initial successful aggregate retains separate recorded/planner targets at their respective instants and the one-version-advanced approved snapshot. A persisted nonempty target can contain accepted baseline delivery events already represented in its records. Selected events receive delivery associations while only new financial operations receive economic rows and receipt target IDs.

Changed only the assigned migration, three parent modules, two focused parent test files, one integration suite, parent package exports/dependencies and the delegated parent workspace entry in package-lock.json. Existing pure parent projection modules were preserved. The V0 health assertion at tests/integration/v0-foundation.test.ts:75 uses a catalog explicitly limited to version 1 and needs no adjustment for runtime002.

## Ports for later composition

- `@eapr/parent/snapshots` exports `readStoredTarget(client: PoolClient, scope: Scope, snapshotHash?: string): Promise<StoredTarget | null>` and `projectStoredParentView(records: TargetState, evaluationAsOf: string): ParentView`. StoredTarget contains records, snapshotHash and digest.
- `@eapr/parent/activation-store` exports `readStoredActivation(client: PoolClient, scope: Scope): Promise<StoredActivation | null>` and `lookupReceiptAssociation(client: PoolClient, key: string, expected: ReceiptExpectation): Promise<ReceiptAssociation>`. ReceiptExpectation contains full scope, requestHash and bundleHash. ReceiptAssociation carries absent, conflict or exact with the paired stored fact.
- `lockFirstImport(client: PoolClient, scope: Scope, key: string): Promise<LockedFirstImport>` returns current target, existing scoped activation and key occupancy. `@eapr/parent/persistence` exports `lockImportIdentities(client: PoolClient, identities: readonly EconomicIdentity[], deliveries: readonly Pick<RawSourceEvent, 'id' | 'sourceRef'>[]): Promise<ImportIdentityLocks>`.
- `persistFirstImport(client: PoolClient, locked: LockedFirstImport, input: ValidatedFirstImport): Promise<StoredActivation>` takes the lock token, request, reviewer, bundle, full plan, activation, receipt and the recorded, planner and approved targets. It verifies shape, identities, byte/digest and domain binding consistency, plan projection and balances. A5 still owns authorization, trusted provenance, readiness, semantic freshness, recomputation from reviewed inputs and retry/error mapping.

## Exact candidate machine evidence

Node `v24.22.2`, PostgreSQL `18.6`. PATH began with `/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@18/bin`. Assigned environment was `EAPR_PG_PORT=55434`, `EAPR_CONTROL_PORT=3201`, `EAPR_WORKER_PORT=3202`, `EAPR_WEB_PORT=5175`, `EAPR_TEST_PREFIX=eapr_test_review_t1`, `EAPR_DEMO_NAMESPACE=eapr_review_t1`. The suite provisions and drops its isolated control/runtime test database pair. It starts no HTTP service and uses no demo or main database. The leased native cluster remains running for coordinated review.

Commands run after commit on the exact candidate:

- `npm run typecheck` passed.
- `npm run test:unit -- packages/parent/test packages/compiler/test packages/finance/test` passed, 43 tests across 7 files.
- `npm run test:integration -- tests/integration/parent-storage.test.ts` passed, 27 tests in one file.
- `git diff --cached --check` before commit and `git diff HEAD --check` after verification passed.

The integration suite exercises actual app-role lock barriers, cross-database access, immutable privileges/triggers, migration hashes, restart recovery, canonical storage and declared-set hash alias rejection, historical latest-pointer advance, scoped metadata and references, global key/economic races, delivery equality and observedAt conflict, money allocation and reversal, rollback after each logical write, real serialization retry, and three-attempt exhaustion. The Unicode case reproduced PostgreSQL's rejection before the validation projection change and passed after it. An initial race fixture failure came from mismatched event envelope and payload version and was corrected to change both pinned fields.

These are partial A3a storage checks. A full balance-overflow aggregate is impractical under the 5,000,000-cent per-record bound in a focused local fixture. Storage uses the existing checked finance path, whose unit tests were included. No V0/V3 slice gate, live activation, A3b registered-scope reads, A5 validation, sync, or joint acceptance was exercised. A2 remains required for A3b.
