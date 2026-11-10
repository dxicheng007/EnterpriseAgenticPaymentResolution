import type { PoolClient } from 'pg';
import { HashSchema, ScopeSchema, type InternalActivationRequest } from '@eapr/contracts';
import { lookupReceiptAssociation, type ReceiptAssociation } from '@eapr/parent/activation-store';

/** Only the private, service-authenticated POST can resolve an association by its exact bundle and key. */
export async function lookupActivationPost(client: PoolClient, request: InternalActivationRequest): Promise<ReceiptAssociation> {
  const { rows: [row] } = await client.query<{
    company_id: string; seller_entity_id: string; account_id: string; request_digest: string; bundle_hash: string;
  }>(
    `SELECT company_id, seller_entity_id, account_id, request_digest, bundle_hash
     FROM runtime_activation_imports WHERE idempotency_key = $1`,
    [request.idempotencyKey],
  );
  if (!row) return { status: 'absent' };
  if (row.bundle_hash !== request.bundleHash) return { status: 'conflict' };
  const scope = ScopeSchema.parse({ companyId: row.company_id, sellerEntityId: row.seller_entity_id, accountId: row.account_id });
  const association = await lookupReceiptAssociation(client, request.idempotencyKey, {
    scope, requestHash: HashSchema.parse(row.request_digest), bundleHash: request.bundleHash,
  });
  if (association.status !== 'exact' || association.stored.request.idempotencyKey !== request.idempotencyKey) {
    throw new Error('Stored activation association is inconsistent');
  }
  return association;
}
