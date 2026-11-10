import type { Pool } from 'pg';

/**
 * Parent ledger and first-import outcome tables that must stay byte-stable across
 * capture/authority containment paths. Capture may append runtime_deliveries /
 * positions; those are not applied monetary effects.
 */
export const committedFinancialTables = [
  'parent_scopes', 'parent_snapshots', 'parent_targets', 'parent_metadata', 'parent_financial_records',
  'runtime_activation_imports', 'runtime_economic_outcomes',
  'runtime_delivery_outcomes', 'runtime_import_lineage',
] as const;

/** Fingerprint committed financial / import rows without reading capture inbox tables. */
export async function committedFinancialFingerprint(db: Pool) {
  return Object.fromEntries(await Promise.all(committedFinancialTables.map(async table => [
    table,
    (await db.query('SELECT to_jsonb(t)::text AS row FROM ' + table + ' t ORDER BY to_jsonb(t)::text')).rows,
  ])));
}
