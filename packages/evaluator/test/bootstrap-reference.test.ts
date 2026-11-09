import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { bootstrapLeafPointers } from '../src/bootstrap-reference.js';

test('enumerates escaped primitive, terminal null and empty-array pointers', () => {
  expect(bootstrapLeafPointers({
    'a/b': [null, { '~': 'text' }], contractTerm: { evidenceRefs: [], validToExclusive: null }, sourceAccountIds: [],
  })).toEqual(['/a~1b/0', '/a~1b/1/~0', '/contractTerm/evidenceRefs', '/contractTerm/validToExclusive', '/sourceAccountIds']);
});

test('keeps protected expectation modules independent of subject planning and product candidates', () => {
  for (const path of ['bootstrap-fixtures', 'bootstrap-reference', 'bootstrap-cases', 'fixtures', 'reference-model', 'fixture-store', 'evidence-fixtures']) {
    const source = readFileSync(new URL('../src/' + path + '.ts', import.meta.url), 'utf8');
    expect(source, path).not.toMatch(/(?:@eapr\/(?:compiler|finance|parent)|(?:\.\.\/)+(?:compiler|finance|parent|apps)\/|demo-candidates|subject-comparison|subject-runner|tests\/fixtures)/);
  }
});
