import { hashCanonical } from '@eapr/contracts';
import { expect, test } from 'vitest';
import {
  hashDiscoveryModelPolicy, parseDiscoveryModelConfiguration, resolveOfflineDiscoveryModel,
  type TrustedModelPolicyV1,
} from '../src/discovery-model-configuration.js';

const policy = {
  schemaVersion: 1,
  providerId: 'test-provider', modelId: 'test-model-rev1',
  adapterId: 'test-adapter', adapterVersion: 'v1',
  meterId: 'test-meter', meterVersion: 'v1',
  providerRulesHash: 'a'.repeat(64), endpointBindingId: 'test-endpoint',
  limits: { maxInputTokens: 8192, maxOutputTokens: 2048, timeoutMs: 60000, maxPreparedRequestBytes: 131072 },
} satisfies TrustedModelPolicyV1;
const configured = { schemaVersion: 1, state: 'configured', policy } as const;
const disabled = { schemaVersion: 1, state: 'disabled' } as const;
const invalid = { ok: false, code: 'MODEL_CONFIGURATION_INVALID' };
const marker = 'do-not-reflect';

test('parses only exact disabled and configured shapes', () => {
  expect(parseDiscoveryModelConfiguration(disabled)).toStrictEqual({ ok: true, value: disabled });
  expect(parseDiscoveryModelConfiguration(configured)).toStrictEqual({ ok: true, value: configured });

  for (const input of [
    undefined, null, {}, [], { ...disabled, schemaVersion: 0 }, { ...configured, schemaVersion: 2 },
    { ...disabled, state: 'unknown' }, { schemaVersion: 1, state: 'configured' },
    { ...configured, policy: { ...policy, schemaVersion: 2 } },
  ]) {
    expect(parseDiscoveryModelConfiguration(input)).toStrictEqual(invalid);
  }
});

test('does not coerce or strip policy fields', () => {
  const extras = [
    { ...configured, extra: true },
    { ...disabled, policy },
    { ...configured, policy: { ...policy, apiKey: marker } },
    { ...configured, policy: { ...policy, url: 'https://example.invalid' } },
    { ...configured, policy: { ...policy, path: '/test' } },
    { ...configured, policy: { ...policy, limits: { ...policy.limits, extra: true } } },
    { ...disabled, schemaVersion: '1' },
    { ...configured, policy: { ...policy, schemaVersion: '1' } },
  ];
  const prototypeKeys = ['__proto__', 'constructor', 'prototype'].flatMap(key => [
    { ...disabled, [key]: true },
    { ...configured, [key]: true },
    { ...configured, policy: { ...policy, [key]: true } },
    { ...configured, policy: { ...policy, limits: { ...policy.limits, [key]: true } } },
  ]).map(value => JSON.parse(JSON.stringify(value)) as unknown);

  for (const input of [...extras, ...prototypeKeys]) {
    const result = parseDiscoveryModelConfiguration(input);
    expect(result).toStrictEqual(invalid);
    expect(JSON.stringify(result)).not.toContain(marker);
  }
});

test('enforces exact bounded policy fields', () => {
  for (const [field, ceiling] of Object.entries(policy.limits)) {
    for (const value of [
      ceiling - 1, ceiling + 1, 0, -0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, String(ceiling),
    ]) {
      const limits = { ...policy.limits, [field]: value };
      expect(parseDiscoveryModelConfiguration({ ...configured, policy: { ...policy, limits } }), field)
        .toStrictEqual(invalid);
    }
  }

  const ids = ['providerId', 'modelId', 'adapterId', 'adapterVersion', 'meterId', 'meterVersion', 'endpointBindingId'];
  for (const field of ids) {
    for (const value of ['', ' ', 'bad/id', 'x'.repeat(161)]) {
      const input = { ...configured, policy: { ...policy, [field]: value } };
      expect(parseDiscoveryModelConfiguration(input), field).toStrictEqual(invalid);
    }
    const input = { ...configured, policy: { ...policy, [field]: 'x'.repeat(160) } };
    expect(parseDiscoveryModelConfiguration(input), field).toStrictEqual({ ok: true, value: input });
  }

  for (const providerRulesHash of ['a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) {
    expect(parseDiscoveryModelConfiguration({ ...configured, policy: { ...policy, providerRulesHash } }))
      .toStrictEqual(invalid);
  }
});

test('hashes the domain-separated parsed policy', () => {
  const hash = hashDiscoveryModelPolicy(policy);
  expect(hash).toBe(hashCanonical({ kind: 'discovery-model-policy', version: 1, policy }));

  const reordered = {
    ...Object.fromEntries(Object.entries(policy).reverse()),
    limits: Object.fromEntries(Object.entries(policy.limits).reverse()),
  } as TrustedModelPolicyV1;
  expect(hashDiscoveryModelPolicy(reordered)).toBe(hash);

  const changedIdentities = {
    providerId: 'other-provider', modelId: 'test-model-rev2',
    adapterId: 'other-adapter', adapterVersion: 'v2',
    meterId: 'other-meter', meterVersion: 'v2',
    providerRulesHash: 'b'.repeat(64), endpointBindingId: 'other-endpoint',
  };
  for (const [field, value] of Object.entries(changedIdentities)) {
    expect(hashDiscoveryModelPolicy({ ...policy, [field]: value }), field).not.toBe(hash);
  }

  for (const malformed of [
    { ...policy, policyHash: hash },
    { ...policy, limits: { ...policy.limits, maxInputTokens: 8191 } },
  ]) {
    expect(parseDiscoveryModelConfiguration({ ...configured, policy: malformed })).toStrictEqual(invalid);
    expect(() => hashDiscoveryModelPolicy(malformed as TrustedModelPolicyV1))
      .toThrow(new Error('MODEL_CONFIGURATION_INVALID'));
  }
});

test('never makes configured metadata available', () => {
  const unconfigured = { available: false, reason: 'MODEL_UNCONFIGURED' };
  const invalidConfiguration = { available: false, reason: 'MODEL_CONFIGURATION_INVALID' };
  const original = structuredClone(configured);

  expect(resolveOfflineDiscoveryModel()).toStrictEqual(unconfigured);
  expect(resolveOfflineDiscoveryModel(disabled)).toStrictEqual(unconfigured);
  expect(resolveOfflineDiscoveryModel(undefined)).toStrictEqual(invalidConfiguration);
  expect(resolveOfflineDiscoveryModel({})).toStrictEqual(invalidConfiguration);
  expect(resolveOfflineDiscoveryModel(configured))
    .toStrictEqual({ available: false, reason: 'MODEL_LIVE_RELEASE_PENDING' });
  expect(configured).toStrictEqual(original);
});

test('sanitizes unexpected validation exceptions', () => {
  const unreadablePolicy = {
    ...policy,
    get modelId(): string {
      throw new Error(marker);
    },
  };
  const input = { ...configured, policy: unreadablePolicy };

  expect(parseDiscoveryModelConfiguration(input)).toStrictEqual(invalid);
  expect(resolveOfflineDiscoveryModel(input)).toStrictEqual({ available: false, reason: 'MODEL_CONFIGURATION_INVALID' });
  expect(() => hashDiscoveryModelPolicy(unreadablePolicy)).toThrow(new Error('MODEL_CONFIGURATION_INVALID'));
});
