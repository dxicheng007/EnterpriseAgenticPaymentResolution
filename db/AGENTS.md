# Database

Follow the [repository instructions](../AGENTS.md), [PostgreSQL setup and data ownership](../prdv2.md#postgresql-setup-and-data-ownership), and [transaction rules](../prdv2.md#transactions-and-concurrent-writes).

- [Control migration 001](control/001_base.sql) and [runtime migration 001](runtime/001_base.sql) each create migration and seed ledgers, a singleton activity counter, and that database's activity table. Activity sequence is unique within its stream and consistent with the event payload.
- [Native provisioning](../scripts/native-db.ts) establishes the local databases and isolated roles. [Migration runner](../scripts/migrate.ts) uses privileged migration credentials. Services use separate application roles, with no cross-database access or DDL authority. Keep credentials in local backend configuration.
- Add assigned schema changes as new versioned migrations. Do not edit applied SQL. Preserve recorded migration hashes. Test migrations, constraints, races, and rollback against real isolated PostgreSQL databases.

The [activity transaction contract](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f7--durable-ui-activity-and-cursor-protocol) locks the singleton counter, advances it, and inserts the event atomically. Rollback also rolls back the increment. Publish committed events in per-stream sequence.

Later schema work follows the [SQL responsibility map](../docs/superpowers/plans/2026-11-08-shared-contracts.md#durable-events-and-sql-responsibilities) and the applicable frozen contract. Keep future evidence/review metadata in control and authoritative activation, parent records, inbox, checkpoints, and receipts in runtime. Under [F1](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f1--representation-identity-canonical-hashes) and [F5](../docs/superpowers/plans/2026-11-08-contract-freeze.md#f5--immutable-receipts-and-trusted-activation-bridge), enforce delivery and economic uniqueness on their distinct exact keys, and enforce activation scope and idempotency. Use one runtime transaction for authorized monetary effects, receipt, and application progress. A control mirror is separate from the authoritative transaction.
