import { expect, test } from 'vitest';
import { PublishFindingInputSchema as schema } from '../src/discovery-construction-tools.js';

const input = {
  expectedRevision: 0, subject: { kind: 'source' }, fieldPath: '/terms', value: null,
  provenanceClass: 'unresolved', evidenceStatus: 'insufficient', evidenceRefs: ['z', 'a'],
  derivationInputs: [], alternatives: [], unresolvedQuestions: [],
};

test('publication accepts only agent input and exact CAS forms', () => {
  expect(schema.parse(input).evidenceRefs).toEqual(['a', 'z']);
  for (const fields of [
    { expectedRevision: 1 }, { findingId: 'existing' }, { reviewDisposition: 'pending' },
    { origin: 'agent' }, { value: 'x'.repeat(8192) },
    { value: Array.from({ length: 130 }).reduce<unknown>(value => [value], null) },
  ]) expect(schema.safeParse({ ...input, ...fields }).success).toBe(false);
});
