import * as contracts from '../src/index.js';
import { expect, test } from 'vitest';
import { compile } from '../../compiler/src/compile.js';
import { planBatch } from '../../compiler/src/plan-batch.js';
import {
  ActivationBundleSchema, CustomerProfileSchema, hashBundle, hashCanonical, hashProfile, type ActivationBundle,
} from '../src/index.js';
import {
  baselineEventsA, baselineManifestA, emptyTargetA, fixtureMetadata, profileA, profileB, validSpecA, validSpecB,
} from '../../../tests/fixtures/index.js';

const compiledA = compile(validSpecA, [profileA]);
const compiledB = compile(validSpecB, [profileB]);
if (!compiledA.ok || !compiledB.ok) throw new Error('Expected compiled development artifacts');
const artifact = compiledA.value;
const manifest = baselineManifestA;
const previewPlan = planBatch(artifact, profileA, baselineEventsA, emptyTargetA).plans[0];
if (!previewPlan) throw new Error('Expected a development preview plan');

const review = {
  id: 'development-review', revision: 1, scope: profileA.scope,
  artifactHash: artifact.hash, profileHash: profileA.hash, manifestHash: manifest.hash,
  verificationReportId: 'development-report', previewPlanHash: previewPlan.hash, expectedTargetVersion: 0,
  ready: false, diagnostics: [
    { code: 'UNAVAILABLE', severity: 'blocker' as const, message: 'Development example', sourceIds: ['a', 'b'], fieldPaths: ['/id', '/name'] },
    { code: 'SYNTHETIC', severity: 'warning' as const, message: 'Synthetic report', sourceIds: ['development'], fieldPaths: ['/report'] },
  ],
};
const reviewPackage = { ...review, hash: hashCanonical(review) };
const snapshot = {
  id: 'development-snapshot', manifestId: manifest.id, sourceRef: manifest.sourceRef, capturedAt: manifest.asOf,
  evidenceIds: ['ev-a-identity', 'ev-a-contract'], eventIds: baselineEventsA.map(event => event.id),
};

const bundleInput: Omit<ActivationBundle, 'hash'> = {
  schemaVersion: '1', artifact, manifest, previewPlan, snapshot: { ...snapshot, contentHash: hashCanonical(snapshot) },
  profiles: [profileA], bootstrapEvents: baselineEventsA, reviewPackage,
  request: {
    reviewPackageId: reviewPackage.id, expectedPackageHash: reviewPackage.hash, expectedArtifactHash: artifact.hash,
    expectedProfileHash: profileA.hash, expectedTargetVersion: 0, idempotencyKey: 'development-request',
  },
  reviewer: { reviewerId: 'development-reviewer', sessionId: 'development-session' },
  verificationReport: {
    id: review.verificationReportId, artifactHash: artifact.hash, profileHashes: [profileA.hash], manifestHash: manifest.hash,
    harnessVersion: '1', evaluatorBuildHash: hashCanonical('development-only'), fixtureSetId: 'development-fixtures',
    fixtureSetVersion: '1', checks: [], unexplainedDifferenceCents: 0, eligible: false, createdAt: manifest.asOf,
    coverage: { required: [], executed: [], sourceRefs: [manifest.sourceRef], profileHashes: [profileA.hash], eventKinds: [] },
  },
  semanticPreflight: { sourceRef: manifest.sourceRef, checkedAt: manifest.asOf, versions: manifest.semanticVersions },
};

test('preserves the profile, compiled artifact and bundle hashes from 12b1b2b', () => {
  expect(fixtureMetadata.classification).toBe('development-only');
  expect(CustomerProfileSchema.parse(profileA)).toEqual(profileA);
  expect(CustomerProfileSchema.parse(profileB)).toEqual(profileB);
  const bundle = ActivationBundleSchema.parse({ ...bundleInput, hash: hashBundle(bundleInput) });
  expect(hashProfile(profileA)).toBe('f68f5593688f4d3cbd09047abec9dc2fb1053998354892a87fc7766b500aa42c');
  expect(hashProfile(profileB)).toBe('44df59aea25a0f570cf69ff635bc75357a99f3e445af4cfeb6e85ca8f4f78ce5');
  expect(compiledA.value.hash).toBe('c4a8da281c0aa822f0eee1cf34316f6310ae2fe08383ed876bc27842fd6efe58');
  expect(compiledB.value.hash).toBe('e7a263ded9e00b8611d999f98f9fb6f8420b09468700d098996482cb1f246ccd');
  expect(hashBundle(bundle)).toBe('27aab62ba80bb32f2fb0161f6b17836565fef3f21bf07f4dca4039883f8301ed');
});

const bootstrap = {
  customer: { id: 'buyer-shared-1', displayName: 'Shared Buyer', evidenceRefs: ['ev-a-identity', 'ev-a-support'] },
  billingConfigurationIds: [{ termId: 'term-a-1', id: 'config-a-1' }, { termId: 'term-a-2', id: 'config-a-2' }],
};
const metadataProfile = {
  ...profileA, contractTerms: [...profileA.contractTerms, { ...profileA.contractTerms[0], id: 'term-a-2' }], bootstrap,
};

test('profile and bundle canonicalize the same bootstrap sets', () => {
  const reordered = {
    ...metadataProfile,
    bootstrap: {
      billingConfigurationIds: [...bootstrap.billingConfigurationIds].reverse().map(({ termId, id }) => ({ id, termId })),
      customer: { evidenceRefs: [...bootstrap.customer.evidenceRefs].reverse(), displayName: 'Shared Buyer', id: 'buyer-shared-1' },
    },
  };
  const hash = hashProfile(metadataProfile);
  expect(hashProfile(reordered)).toBe(hash);
  expect(hashProfile({ ...metadataProfile, hash: 'f'.repeat(64) })).toBe(hash);
  const first = { ...bundleInput, profiles: [{ ...metadataProfile, hash }] };
  const second = { ...bundleInput, profiles: [{ ...reordered, hash }] };
  const bundleHash = hashBundle(first);
  expect(hashBundle(ActivationBundleSchema.parse({ ...first, hash: bundleHash }))).toBe(bundleHash);
  expect(hashBundle(ActivationBundleSchema.parse({ ...second, hash: bundleHash }))).toBe(bundleHash);
});

test('profile hashing binds the exact bootstrap name, citations, configuration IDs and assignments', () => {
  const hash = hashProfile(metadataProfile);
  const [first, second] = bootstrap.billingConfigurationIds;
  for (const changed of [
    { ...bootstrap, customer: { ...bootstrap.customer, displayName: ' Shared Buyer' } },
    { ...bootstrap, customer: { ...bootstrap.customer, evidenceRefs: ['ev-a-other'] } },
    { ...bootstrap, billingConfigurationIds: [{ ...first, id: 'config-a-other' }, second] },
    { ...bootstrap, billingConfigurationIds: [{ ...first, id: second.id }, { ...second, id: first.id }] },
  ]) {
    expect(hashProfile({ ...metadataProfile, bootstrap: changed })).not.toBe(hash);
    expect(hashBundle({ ...bundleInput, profiles: [{ ...metadataProfile, bootstrap: changed }] }))
      .not.toBe(hashBundle({ ...bundleInput, profiles: [metadataProfile] }));
  }
  for (const duplicate of [
    { ...bootstrap, customer: { ...bootstrap.customer, evidenceRefs: ['ev-a-identity', 'ev-a-identity'] } },
    { ...bootstrap, billingConfigurationIds: [first, { ...second, termId: first.termId }] },
    { ...bootstrap, billingConfigurationIds: [first, { ...second, id: first.id }] },
  ]) {
    expect(() => hashProfile({ ...metadataProfile, bootstrap: duplicate })).toThrow();
    expect(() => hashBundle({ ...bundleInput, profiles: [{ ...metadataProfile, bootstrap: duplicate }] })).toThrow();
  }
});

test('explicit undefined bootstrap is omitted from the profile and bundle preimages', () => {
  const profile = { ...profileA, bootstrap: undefined };
  expect(hashProfile(profile)).toBe(profileA.hash);
  expect(hashBundle({ ...bundleInput, profiles: [profile] })).toBe(hashBundle(bundleInput));
});

test('review hash covers every field except its own hash and preserves diagnostic order', () => {
  expect(contracts.hashReviewPackage).toBeTypeOf('function');
  const hash = contracts.hashReviewPackage(reviewPackage);
  const permuted = Object.fromEntries(Object.entries(reviewPackage).reverse()) as typeof reviewPackage;
  expect(hash).toBe(reviewPackage.hash);
  expect(contracts.hashReviewPackage({ ...permuted, hash: 'f'.repeat(64) })).toBe(hash);
  const [first, second] = review.diagnostics;
  for (const changed of [
    { id: 'different-review' }, { revision: 2 }, { scope: profileB.scope },
    { artifactHash: compiledB.value.hash }, { profileHash: profileB.hash }, { manifestHash: 'a'.repeat(64) },
    { verificationReportId: 'other-report' }, { previewPlanHash: 'b'.repeat(64) },
    { expectedTargetVersion: 1 }, { ready: true },
    { diagnostics: [second, first] },
    { diagnostics: [{ ...first, message: 'Different message' }, second] },
    { diagnostics: [{ ...first, sourceIds: ['b', 'a'] }, second] },
    { diagnostics: [{ ...first, fieldPaths: ['/name', '/id'] }, second] },
  ]) {
    expect(contracts.hashReviewPackage({ ...review, ...changed })).not.toBe(hash);
  }
});
