import { expect, test } from 'vitest';
import { ValidatorIdSchema, hashProfile, type ConnectorSpec, type CustomerProfile } from '@eapr/contracts';
import { compile } from '@eapr/compiler/compile';
import { parseMinorUnits } from '@eapr/compiler/operations';
import { baselineEventsA, profileA, profileB, validSpecA, validSpecB } from '../../../tests/fixtures/index.js';

function artifact(spec: ConnectorSpec, profile: CustomerProfile) {
  const result = compile(spec, [profile]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.value;
}

test('canonical_hash_ignores_object_key_order', () => {
  const reordered = Object.fromEntries(Object.entries(validSpecA).reverse()) as ConnectorSpec;
  reordered.capture = [...reordered.capture].reverse();
  reordered.sourceContracts = [...reordered.sourceContracts].reverse();
  const first = artifact(validSpecA, profileA);
  expect(artifact(reordered, profileA)).toEqual(first);
  expect(first.normalizedPlan.validators).toEqual([...ValidatorIdSchema.options].sort());
  expect(first.sourceContractHashes).toHaveLength(validSpecA.sourceContracts.length);
  expect(artifact(validSpecB, profileB).hash).not.toBe(first.hash);

  const nextProfile = { ...profileA, version: 2 };
  nextProfile.hash = hashProfile(nextProfile);
  expect(artifact(validSpecA, nextProfile).hash).not.toBe(first.hash);
});

test('rejects_unknown_operation', () => {
  const spec = structuredClone(validSpecA);
  spec.mappings[0].fields.currency = { op: 'execute_sql', value: 'select' } as never;
  expect(compile(spec, [profileA]).ok).toBe(false);
  spec.mappings[0].fields.currency = { op: 'field', path: '/constructor' };
  expect(compile(spec, [profileA]).ok).toBe(false);
});

test('checks mapping source fields, input types and capture coverage', () => {
  const spec = structuredClone(validSpecA);
  const invoice = spec.mappings.find(mapping => mapping.kind === 'invoice')!;
  invoice.fields.amountCents = { op: 'decimal_to_minor', scale: 2, path: '/missing' };
  expect(compile(spec, [profileA]).ok).toBe(false);
  invoice.fields.amountCents = { op: 'field', path: '/version' };
  expect(compile(spec, [profileA]).ok).toBe(false);
  invoice.fields.amountCents = { op: 'decimal_to_minor', scale: 2, path: '/amount' };
  spec.capture = spec.capture.filter(stream => !stream.resources.includes(invoice.resource));
  expect(compile(spec, [profileA]).ok).toBe(false);
});

test('blocks unsupported constants, lookup tables and overlapping contract terms', () => {
  const spec = structuredClone(validSpecA);
  const invoice = spec.mappings.find(mapping => mapping.kind === 'invoice')!;
  invoice.fields.amountCents = { op: 'constant', value: 300000, evidenceRef: 'ev-a-currency' };
  expect(compile(spec, [profileA]).ok).toBe(false);
  invoice.fields.amountCents = { op: 'decimal_to_minor', path: '/amount', scale: 2 };
  invoice.fields.currency = { op: 'constant', value: 'CAD', evidenceRef: 'ev-a-currency' };
  expect(compile(spec, [profileA]).ok).toBe(false);
  invoice.fields.currency = { op: 'constant', value: 'USD', evidenceRef: 'ev-a-unsupported' };
  expect(compile(spec, [profileA]).ok).toBe(false);
  invoice.fields.currency = { op: 'approved_lookup', path: '/account', tableId: 'missing' };
  expect(compile(spec, [profileA]).ok).toBe(false);

  const profile = structuredClone(profileA);
  profile.contractTerms.push({ ...profile.contractTerms[0], id: 'overlap' });
  profile.hash = hashProfile(profile);
  expect(compile(validSpecA, [profile]).ok).toBe(false);
});

test('parses canonical decimal money without rounding or unsafe inputs', () => {
  expect(parseMinorUnits('12.34')).toEqual({ ok: true, cents: 1234 });
  expect(parseMinorUnits('1.005')).toEqual({ ok: false, code: 'MONEY_SCALE' });
  expect(parseMinorUnits('50000')).toEqual({ ok: true, cents: 5000000 });
  expect(parseMinorUnits('50000.01')).toEqual({ ok: false, code: 'MONEY_RANGE' });
  expect(parseMinorUnits('9007199254740991')).toEqual({ ok: false, code: 'MONEY_RANGE' });
  for (const malformed of ['+1', '-1', '1e2', '1,000', ' 1', '1\n', '01', '.25', '1.']) {
    expect(parseMinorUnits(malformed)).toEqual({ ok: false, code: 'MONEY_FORMAT' });
  }
});

test('a cited fixed amount cannot overwrite observed source money', () => {
  const spec = structuredClone(validSpecA);
  const payment = spec.mappings.find(mapping => mapping.kind === 'payment');
  if (!payment || !('amountCents' in payment.fields)) throw new Error('Missing payment mapping');
  payment.fields.amountCents = { op: 'constant', value: 300000, evidenceRef: 'ev-a-contract' };
  spec.evidenceRefs.push('ev-a-contract');
  expect(baselineEventsA.find(event => event.kind === 'payment')?.payload.amount).toBe('2000.00');
  const profile = structuredClone(profileA);
  profile.findings.push({
    id: 'finding-contract-amount', scope: profile.scope, taskId: 'task-amount', fieldPath: '/amountCents',
    value: 300000, origin: 'deterministic', provenanceClass: 'observed', evidenceStatus: 'supported',
    reviewDisposition: 'confirmed', evidenceRefs: ['ev-a-contract'], derivationInputs: [], revision: 1,
  });
  profile.hash = hashProfile(profile);
  expect(compile(spec, [profile])).toMatchObject({
    ok: false, diagnostics: [expect.objectContaining({ code: 'EVIDENCE_SUPPORT', fieldPaths: ['/amountCents'] })],
  });
  expect(compile(validSpecA, [profile]).ok).toBe(true);
  profile.findings[0].evidenceStatus = 'contradicted';
  profile.hash = hashProfile(profile);
  expect(compile(validSpecA, [profile]).ok).toBe(false);
});
