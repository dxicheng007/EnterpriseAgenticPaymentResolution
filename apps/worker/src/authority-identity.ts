import { IdSchema, type CommittedAuthorityIdentityV1, type Hash, type Id } from '@eapr/contracts';
import { FinanceError } from '@eapr/finance/validate';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { BootstrapProjectionError } from '@eapr/parent/bootstrap';
import { scopeOf, type ScopeRow } from '@eapr/parent/snapshots';
import type { Pool, PoolClient } from 'pg';
import { ZodError } from 'zod';
import { AuthorityError, authorityError } from './sync/current-authority-errors.js';

const storedBindingErrors = new Set([
  'Stored canonical digest differs', 'Stored JSON is not canonical', 'Invalid stored BIGINT',
  'Invalid stored account or customer association', 'Stored snapshot bindings differ',
]);

async function readVerifiedImport(client: PoolClient, row: ScopeRow) {
  try {
    return await readStoredActivation(client, scopeOf(row));
  } catch (error) {
    // Match the accepted authority store's A5 decode classification. The parent reader also performs SQL.
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof FinanceError ||
        error instanceof BootstrapProjectionError || (error instanceof Error &&
          (error.message.startsWith('Inconsistent first import ') || storedBindingErrors.has(error.message)))) {
      throw authorityError('AUTHORITY_STORAGE_INVALID');
    }
    throw error;
  }
}

export async function readIngressAuthorityIdentity(db: Pool, accountId: Id): Promise<{
  identity: CommittedAuthorityIdentityV1; sourceRef: Id; artifactHash: Hash; profileHash: Hash; manifestHash: Hash;
}> {
  if (!IdSchema.safeParse(accountId).success) throw authorityError('AUTHORITY_INPUT_INVALID');
  let client: PoolClient | undefined;
  let discard = false;
  try {
    client = await db.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query<ScopeRow>(
      'SELECT account_id,company_id,seller_entity_id FROM runtime_activation_imports WHERE account_id=$1 LIMIT 2', [accountId],
    );
    if (rows.length === 0) throw authorityError('AUTHORITY_NOT_FOUND');
    if (rows.length !== 1) throw authorityError('AUTHORITY_STORAGE_INVALID');
    const stored = await readVerifiedImport(client, rows[0]!);
    if (!stored || stored.activation.scope.accountId !== accountId) throw authorityError('AUTHORITY_STORAGE_INVALID');
    const { scope, id: activationId, artifactHash, profileHash, manifestHash } = stored.activation;
    const subject = {
      identity: { scope, activationId, bundleHash: stored.bundleHash },
      sourceRef: stored.bundle.manifest.sourceRef, artifactHash, profileHash, manifestHash,
    };
    await client.query('COMMIT');
    return subject;
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    }
    throw error instanceof AuthorityError ? error : authorityError('AUTHORITY_UNAVAILABLE');
  } finally {
    client?.release(discard);
  }
}
