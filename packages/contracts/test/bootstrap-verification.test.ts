import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as browser from '@eapr/contracts/bootstrap-verification';
import { hashBootstrapVerificationResult as digest } from '@eapr/contracts/bootstrap-verification-hash';
import { hashBootstrapVerificationResult, SourceSnapshotSchema } from '@eapr/contracts';

const { BootstrapBindingV1Schema, BootstrapVerificationResultV1Schema: resultSchema } = browser;
const assertions = [
  'capture_binding', 'identity_name_support', 'term_configuration_support', 'scoped_metadata_records',
  'ensure_equivalence_conflict', 'metadata_lineage', 'financial_suffix', 'operation_order_hash', 'baseline_blockers',
] as const;
const cases = [
  'captured_baseline', 'exact_metadata_reuse', 'customer_conflict', 'account_conflict',
  'configuration_conflict', 'empty_events', 'financial_replay', 'selected_blocker',
  'source_wide_blocker', 'unrelated_account_hold',
] as const;
const matrix = [[0], [0, 1], [0, 1], [0, 1], [1, 2, 3, 4], [0, 1], [0, 1], [0, 1], [5, 6, 7, 8, 9]];
const coverage = Object.fromEntries(assertions.map((id, i) => [id, matrix[i]!.map(index => cases[index]!)]));
const hash = (digit: string) => digit.repeat(64);
const instant = '2026-11-08T00:00:00.000Z';
const status: 'passed' | 'failed' | 'unavailable' = 'passed';

function vector(): browser.BootstrapVerificationResultV1 {
  return {
    schemaVersion: '1', id: 'bootstrap-result:job-1', jobId: 'job-1',
    pin: {
      runnerId: 'eapr-bootstrap-1', protocolVersion: '1', evaluatorBuildHash: hash('a'),
      subjectBuildHash: hash('b'), fixtureSetId: 'fixture', fixtureSetVersion: '1', fixtureHash: hash('c'),
    },
    binding: {
      artifactHash: hash('d'), profileHash: hash('e'), requiredProfileHashes: [hash('0'), hash('e')],
      scope: { companyId: 'company', sellerEntityId: 'seller', accountId: 'account' },
      manifestId: 'manifest', manifestHash: hash('f'), snapshotId: 'snapshot', snapshotHash: hash('1'),
      eventsHash: hash('2'), targetSnapshotHash: hash('3'), expectedTargetVersion: 0, asOf: instant,
    },
    planHash: hash('4'),
    assertions: assertions.map(id => ({ id, status, caseIds: [...coverage[id]!] })),
    cases: cases.map(id => ({ id, status })),
    passed: true, createdAt: instant, hash: hash('5'),
  };
}

function unavailable() {
  const result = vector();
  return {
    ...result, passed: false, planHash: null,
    assertions: result.assertions.map(({ id }) => ({ id, status: 'unavailable' as const, caseIds: [] })),
    cases: result.cases.map(({ id }) => ({ id, status: 'unavailable' as const })),
  };
}

function negative() {
  const result = vector();
  result.assertions[4] = { id: 'ensure_equivalence_conflict', status: 'failed', caseIds: ['customer_conflict'] };
  result.cases[2]!.status = 'failed';
  result.passed = false;
  return result;
}

function permuted() {
  const result = vector();
  result.binding.requiredProfileHashes.reverse();
  result.assertions.reverse().forEach(assertion => assertion.caseIds.reverse());
  result.cases.reverse();
  result.binding.asOf = result.createdAt = '2026-11-08T00:00:00Z';
  return result;
}

// Independent encoding of these safe synthetic vectors. Sort only object keys.
function expectedJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(expectedJson).join(',') + ']';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + expectedJson(object[key])).join(',') + '}';
}

const sha256 = (value: unknown) => createHash('sha256').update(expectedJson(value)).digest('hex');

describe('bootstrap verification shape claims', () => {
  it('exports the exact public vocabulary and freezes the coverage matrix', () => {
    expect(Object.keys(browser).sort()).toEqual([
      'BootstrapAssertionIdSchema', 'BootstrapBindingV1Schema', 'BootstrapCaseIdSchema',
      'BootstrapPinV1Schema', 'BootstrapVerificationResultV1Schema', 'bootstrapAssertionCases',
      'bootstrapRequiredAssertions', 'bootstrapRequiredCases',
    ]);
    expect(browser.BootstrapAssertionIdSchema.options).toEqual(assertions);
    expect(browser.BootstrapCaseIdSchema.options).toEqual(cases);
    expect(browser.bootstrapRequiredAssertions).toEqual(assertions);
    expect(browser.bootstrapRequiredCases).toEqual(cases);
    expect(browser.bootstrapAssertionCases).toEqual(coverage);
    for (const value of [
      browser.bootstrapRequiredAssertions, browser.bootstrapRequiredCases,
      browser.bootstrapAssertionCases, ...Object.values(browser.bootstrapAssertionCases),
    ]) expect(Object.isFrozen(value)).toBe(true);
    expect(hashBootstrapVerificationResult).toBe(digest);
  });

  it('accepts full passing, unavailable and negative shapes and normalizes permutations', () => {
    for (const result of [vector(), unavailable(), negative()]) expect(resultSchema.parse(result)).toEqual(result);
    expect(resultSchema.parse(permuted())).toEqual(vector());
  });

  it.each([
    ['duplicate profile', { binding: { ...vector().binding, requiredProfileHashes: [hash('e'), hash('e')] } }],
    ['absent selected profile', { binding: { ...vector().binding, requiredProfileHashes: [hash('0')] } }],
    ['empty profiles', { binding: { ...vector().binding, requiredProfileHashes: [] } }],
    ['negative version', { binding: { ...vector().binding, expectedTargetVersion: -1 } }],
    ['fractional version', { binding: { ...vector().binding, expectedTargetVersion: 0.5 } }],
    ['malformed nested hash', { pin: { ...vector().pin, fixtureHash: 'bad' } }],
    ['malformed own hash', { hash: 'bad' }],
    ['job mismatch', { jobId: 'other' }],
    ['too-long prefixed ID', { jobId: 'j'.repeat(160), id: 'bootstrap-result:' + 'j'.repeat(160) }],
    ['unknown key', { extra: true }],
    ['unknown nested key', { pin: { ...vector().pin, extra: true } }],
    ['omitted assertion', { assertions: vector().assertions.slice(1) }],
    ['omitted case', { cases: vector().cases.slice(1) }],
    ['duplicate assertion', { assertions: [...vector().assertions, vector().assertions[0]] }],
    ['duplicate case', { cases: [...vector().cases, vector().cases[0]] }],
    ['unknown assertion', { assertions: [...vector().assertions, { ...vector().assertions[0], id: 'extra' }] }],
    ['unknown case', { cases: [...vector().cases, { ...vector().cases[0], id: 'extra' }] }],
    ['unknown status', { cases: [{ id: cases[0], status: 'pending' }, ...vector().cases.slice(1)] }],
    ['duplicate case reference', { assertions: [{ ...vector().assertions[0], caseIds: [cases[0], cases[0]] }, ...vector().assertions.slice(1)] }],
    ['passed assertion with partial coverage', { assertions: [{ ...vector().assertions[0], caseIds: [] }, ...vector().assertions.slice(1)] }],
    ['passed assertion with failed case', { cases: negative().cases, passed: false }],
    ['unavailable assertion with case', { assertions: [{ ...vector().assertions[0], status: 'unavailable' }, ...vector().assertions.slice(1)], passed: false }],
    ['failed assertion with no case', { assertions: [{ ...vector().assertions[0], status: 'failed', caseIds: [] }, ...vector().assertions.slice(1)], passed: false }],
    ['failed assertion with unavailable case', { ...negative(), cases: negative().cases.map(item => item.id === cases[2] ? { ...item, status: 'unavailable' } : item) }],
    ['failed assertion with unrelated case', { ...negative(), assertions: negative().assertions.map(item => item.id === assertions[4] ? { ...item, caseIds: [cases[0]] } : item) }],
    ['false despite full pass', { passed: false }],
    ['true despite failure', { ...negative(), passed: true }],
    ['true despite null plan', { ...unavailable(), passed: true }],
    ['passed baseline despite null plan', { ...negative(), planHash: null }],
  ])('rejects %s', (_name, patch) => {
    const input = { ...vector(), ...patch };
    expect(resultSchema.safeParse(input).success).toBe(false);
    expect(() => digest(input as ReturnType<typeof vector>)).toThrow();
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects prototype key %s at each object boundary', key => {
    const inject = (value: object) => ({ ...value, ...JSON.parse('{"' + key + '":{}}') });
    const result = vector();
    for (const input of [
      inject(result), { ...result, binding: inject(result.binding) },
      { ...result, assertions: [inject(result.assertions[0]!), ...result.assertions.slice(1)] },
    ]) {
      expect(resultSchema.safeParse(input).success).toBe(false);
      expect(() => digest(input as ReturnType<typeof vector>)).toThrow();
    }
  });

  it('accepts either well-formed snapshot digest at the shape boundary', () => {
    const snapshotContent = {
      manifestHash: hash('f'), streams: [], files: [], eventIds: [], evidenceIds: [],
    };
    const snapshot = SourceSnapshotSchema.parse({
      id: 'snapshot', sourceRef: 'source', manifestId: 'manifest',
      capturedAt: instant, eventIds: [], evidenceIds: [], contentHash: sha256(snapshotContent),
    });
    const wholeObjectHash = sha256(snapshot);
    expect(snapshot.contentHash).not.toBe(wholeObjectHash);
    for (const snapshotHash of [snapshot.contentHash, wholeObjectHash]) {
      // S2/S3 reject whole-object hash substitution using the actual capture.
      expect(BootstrapBindingV1Schema.parse({ ...vector().binding, snapshotHash }).snapshotHash).toBe(snapshotHash);
    }
  });
});

describe('bootstrap verification result hash', () => {
  it('pins the normalized full preimage and ignores only the valid own hash', () => {
    const { hash: _hash, ...preimage } = vector();
    const golden = '012880a6bc6feeaaaf905232b9e5d782bba5181318506d8d112d004d9d2c8bef';
    expect(sha256(preimage)).toBe(golden);
    expect(digest(preimage)).toBe(golden);
    expect(digest({ ...preimage, hash: hash('9') })).toBe(golden);
    expect(digest(permuted())).toBe(golden);
    expect(() => digest({ ...preimage, hash: undefined })).toThrow();
  });

  it('binds each remaining field through coherent mutations or schema rejection', () => {
    const result = vector();
    const different = (input: ReturnType<typeof vector>) => expect(digest(input)).not.toBe(digest(result));
    different({ ...result, jobId: 'job-2', id: 'bootstrap-result:job-2' });
    different({ ...result, planHash: hash('9') });
    different({ ...result, createdAt: '2026-11-08T00:00:01.000Z' });
    different(negative());
    different(unavailable());
    for (const patch of [
      { evaluatorBuildHash: hash('9') }, { subjectBuildHash: hash('9') },
      { fixtureHash: hash('9') }, { fixtureSetId: 'other' }, { fixtureSetVersion: '2' },
    ]) different({ ...result, pin: { ...result.pin, ...patch } });
    for (const patch of [
      { scope: { ...result.binding.scope, accountId: 'other' } },
      { artifactHash: hash('9') }, { profileHash: hash('0') }, { requiredProfileHashes: [hash('e')] },
      { manifestId: 'other' }, { manifestHash: hash('9') }, { snapshotId: 'other' },
      { snapshotHash: hash('9') }, { eventsHash: hash('9') }, { targetSnapshotHash: hash('9') },
      { expectedTargetVersion: 1 }, { asOf: '2026-11-08T00:00:01.000Z' },
    ]) different({ ...result, binding: { ...result.binding, ...patch } });
    expect(() => digest({ ...result, schemaVersion: '2' } as unknown as typeof result)).toThrow();
    expect(() => digest({ ...result, id: 'bootstrap-result:other' })).toThrow();
  });
});
