import { expect, test } from 'vitest';
import { classifyFindingBlockers } from '../src/findings.js';

test('uncertain assertions and unproven applicability remain independently blocked', () => {
  const observed = { evidenceStatus: 'supported', provenanceClass: 'observed' } as const;
  expect(classifyFindingBlockers(observed, false)).toEqual({
    pending: false, applicabilityUnresolved: true,
  });
  for (const override of [
    { evidenceStatus: 'contradicted' }, { evidenceStatus: 'insufficient' },
    { provenanceClass: 'inferred' }, { provenanceClass: 'unresolved' },
  ] as const) {
    expect(classifyFindingBlockers({ ...observed, ...override }, true)).toEqual({
      pending: true, applicabilityUnresolved: false,
    });
  }
});
