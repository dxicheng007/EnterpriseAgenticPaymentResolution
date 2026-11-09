import { expect, test } from 'vitest';
import { createTestSystem, testNamespace } from '../fixtures/harness.js';

test('control008 creates empty review and observation storage with restricted mutation privileges', async () => {
  const system = await createTestSystem({ modelMode: 'disabled', dbNamespace: testNamespace('a4store') });
  try {
    const { rows } = await system.db.control.query(`
      SELECT
        (SELECT count(*) FROM review_heads) AS heads,
        (SELECT count(*) FROM activation_intents) AS intents,
        (SELECT count(*) FROM activation_receipt_observations) AS observations,
        has_table_privilege('activation_receipt_observations', 'INSERT') AS can_insert,
        has_table_privilege('activation_receipt_observations', 'UPDATE,DELETE') AS can_mutate
    `);
    expect(rows).toEqual([{ heads: '0', intents: '0', observations: '0', can_insert: true, can_mutate: false }]);
  } finally {
    await system.close();
  }
});
