import type { Pool } from 'pg';
import { ActivationStateV1Schema, TargetStateSchema, type ParentReadQuery } from '@eapr/contracts';
import { readStoredActivation } from '@eapr/parent/activation-store';
import { projectStoredParentView, readStoredTarget } from '@eapr/parent/snapshots';
import type { createRegisteredScopeReader } from '@eapr/storage/activation-registry';
import type { Clock } from '@eapr/storage/control-db';
import { ParentReadError } from './routes/parent.js';

export type RegisteredScopeReader = ReturnType<typeof createRegisteredScopeReader>;

export function createParentReads(db: Pool, clock: Clock, registry: RegisteredScopeReader) {
  async function registered(accountId: string) {
    const member = (await registry.readSnapshot()).resolveRegisteredScope(accountId);
    if (!member) throw new ParentReadError(404);
    return member.entry;
  }

  return {
    async readParent(accountId: string, query: ParentReadQuery) {
      const { scope, manifestAsOf } = await registered(accountId);
      const client = await db.connect();
      try {
        const stored = await readStoredTarget(client, scope, query.snapshotHash);
        if (!stored && query.snapshotHash !== undefined) throw new ParentReadError(404);
        const records = stored?.records ?? TargetStateSchema.parse({
          scope, version: 0, asOf: manifestAsOf, invoices: [], payments: [], credits: [], allocations: [],
          reversals: [], customers: [], accounts: [], billingConfigurations: [],
        });
        return projectStoredParentView(records, query.asOf ?? clock().toISOString());
      } finally {
        client.release();
      }
    },

    async readActivation(accountId: string) {
      const { scope } = await registered(accountId);
      const client = await db.connect();
      try {
        const stored = await readStoredActivation(client, scope);
        return ActivationStateV1Schema.parse({
          schemaVersion: '1', scope, activation: stored?.activation ?? null, initialReceipt: stored?.receipt ?? null,
        });
      } finally {
        client.release();
      }
    },
  };
}
