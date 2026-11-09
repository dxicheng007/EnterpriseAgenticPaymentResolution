import { expect, test } from 'vitest';
import { toolSchemas } from '../src/roles.js';

test('advertises source and finding tools to each role only with a reader', () => {
  for (const role of ['coordinator', 'identity', 'contract', 'receivables', 'connector'] as const) {
    const existing = role === 'coordinator' ? ['delegateTask'] : [];
    expect(toolSchemas(role).map(tool => tool.name)).toEqual(existing);
    expect(toolSchemas(role, true).map(tool => tool.name)).toEqual([
      ...existing, 'describeSource', 'querySnapshot', 'searchEvidence', 'readEvidence', 'publishFinding', 'readFinding',
      ...(role === 'connector' ? ['draftConnector', 'reviseConnector'] : []),
    ]);
  }
});
