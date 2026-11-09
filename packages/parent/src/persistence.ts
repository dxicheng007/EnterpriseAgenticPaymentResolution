import type { PoolClient } from 'pg';
import {
  canonicalJson, EconomicIdentitySchema, IdSchema, targetRecordId, type EconomicIdentity, type RawSourceEvent,
} from '@eapr/contracts';

/** Lock callers must hold an open transaction and acquire these groups in first-import order. */
export async function lockParentKeys(client: PoolClient, keys: Iterable<string>) {
  const { rows } = await client.query<{ lock_id: string }>(
    'SELECT DISTINCT hashtextextended(key, 0) AS lock_id FROM unnest($1::text[]) AS key ORDER BY lock_id',
    [[...keys]],
  );
  for (const { lock_id } of rows) await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lock_id]);

}

const heldKeys = new WeakMap<ImportIdentityLocks, { client: PoolClient; keys: ReadonlySet<string> }>();
declare const identityLockBrand: unique symbol;
export type ImportIdentityLocks = { readonly [identityLockBrand]: true };
type DeliveryKey = Pick<RawSourceEvent, 'id' | 'sourceRef'>;

function identityKeys(identities: readonly EconomicIdentity[], deliveries: readonly DeliveryKey[]) {
  return [...new Set([
    ...identities.flatMap(input => {
      const identity = EconomicIdentitySchema.parse(input);
      return [
        canonicalJson(['parent-economic', identity]),
        canonicalJson(['parent-record', targetRecordId(identity)]),
      ];
    }),
    ...deliveries.map(({ sourceRef, id }) => canonicalJson(['parent-delivery', IdSchema.parse(sourceRef), IdSchema.parse(id)])),
  ])].sort();
}

/** Acquires transaction locks for existing and absent global identities, after scope and target locks. */
export async function lockImportIdentities(
  client: PoolClient, identities: readonly EconomicIdentity[], deliveries: readonly DeliveryKey[],
): Promise<ImportIdentityLocks> {
  const keys = identityKeys(identities, deliveries);
  await lockParentKeys(client, keys);
  const token = {} as ImportIdentityLocks;
  heldKeys.set(token, { client, keys: new Set(keys) });
  return token;
}

export function requireImportIdentityLocks(
  client: PoolClient, token: ImportIdentityLocks, identities: readonly EconomicIdentity[], deliveries: readonly DeliveryKey[],
) {
  const held = heldKeys.get(token);
  const required = identityKeys(identities, deliveries);
  if (!held || held.client !== client || required.some(key => !held.keys.has(key))) {
    throw new Error('First import identities are not locked by this transaction');
  }
}
