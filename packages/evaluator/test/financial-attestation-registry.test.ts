import { expect, test } from 'vitest';
import * as registry from '../src/financial-attestation-registry.js';

test('a missing completed proof has a fixed unavailable status', async () => {
  type Db = Parameters<typeof registry.createFinancialAttestationRegistry>[0];
  const db = { query: async () => ({ rows: [] }) } as unknown as Db;
  const reader = registry.createFinancialAttestationRegistry(db, {
    getCandidate: async () => { throw new Error('unexpected lookup'); },
  });
  type Expected = Parameters<typeof reader.readRegisteredFinancialAttestation>[1];
  await expect(reader.readRegisteredFinancialAttestation('missing', {} as Expected)).rejects.toMatchObject({
    statusCode: 503, message: 'FINANCIAL_ATTESTATION_UNAVAILABLE',
  });
});
