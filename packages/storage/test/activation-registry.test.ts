import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { hashProfile, type BootstrapManifest, type CustomerProfile } from '@eapr/contracts';
import { baselineManifestA, baselineManifestB, profileA, profileB } from '../../../tests/fixtures/index.js';
import { createRegisteredScopeReader, publishRegisteredScopeMembers, readActivationBundle } from '../src/activation-registry.js';

function member(profile: CustomerProfile, manifest: BootstrapManifest) {
  return { profile, manifest, entry: {
    accountId: profile.scope.accountId, scope: profile.scope, profileHash: profile.hash,
    manifestId: manifest.id, manifestHash: manifest.hash, manifestAsOf: manifest.asOf,
  } };
}
const a = member(profileA, baselineManifestA);
const b = member(profileB, baselineManifestB);
let registryRoot: string;
let scopeRoot: string;
beforeEach(async () => {
  registryRoot = await mkdtemp(join(await realpath(tmpdir()), 'eapr-registry-'));
  scopeRoot = join(registryRoot, 'activation-registry');
});
afterEach(async () => { await rm(registryRoot, { recursive: true, force: true }); });

test('reads one fully bound snapshot with no later file I/O', async () => {
  const reader = createRegisteredScopeReader({ registryRoot });
  await expect(reader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
  const oldIndex = await publishRegisteredScopeMembers({ registryRoot }, [a]);
  const old = await reader.readSnapshot();
  const nextProfile = { ...profileA, version: profileA.version + 1 };
  nextProfile.hash = hashProfile(nextProfile);
  await publishRegisteredScopeMembers({ registryRoot }, [member(nextProfile, baselineManifestA), b]);
  const next = await reader.readSnapshot();
  expect(next.resolveRegisteredScope(a.entry.accountId)?.profile).toEqual(nextProfile);
  expect(next.resolveRegisteredScope(b.entry.accountId)?.profile).toEqual(profileB);
  expect(await readFile(join(scopeRoot, 'indexes', oldIndex.hash + '.json'), 'utf8')).toContain(profileA.hash);
  expect(await readFile(join(scopeRoot, 'profiles', profileA.hash + '.json'), 'utf8')).toContain(profileA.hash);
  await rm(scopeRoot, { recursive: true });
  expect(old.resolveRegisteredScope(a.entry.accountId)?.profile).toEqual(profileA);
  expect(old.resolveRegisteredScope(b.entry.accountId)).toBeNull();
  expect(Object.isFrozen(old.resolveRegisteredScope(a.entry.accountId)?.entry.scope)).toBe(true);
});

test('fails closed on stale writer lock, scope change, duplicates and missing member', async () => {
  const first = await publishRegisteredScopeMembers({ registryRoot }, [a]);
  const lock = join(scopeRoot, '.writer-lock');
  await writeFile(lock, '', { mode: 0o600 });
  await expect(publishRegisteredScopeMembers({ registryRoot }, [b])).rejects.toThrow('REGISTERED_SCOPE_PUBLICATION_FAILED');
  await rm(lock);
  const changedScope = { ...profileA, scope: { ...profileA.scope, sellerEntityId: 'different-seller' } };
  changedScope.hash = hashProfile(changedScope);
  for (const invalid of [[a, a], [member(changedScope, baselineManifestA)], [member(profileA, baselineManifestB)]]) {
    await expect(publishRegisteredScopeMembers({ registryRoot }, invalid)).rejects.toThrow('REGISTERED_SCOPE_PUBLICATION_FAILED');
  }
  const reader = createRegisteredScopeReader({ registryRoot });
  expect((await reader.readSnapshot()).index).toEqual(first);
  const path = join(scopeRoot, 'profiles', profileA.hash + '.json');
  await rm(path);
  await symlink(join(scopeRoot, 'manifests', baselineManifestA.hash + '.json'), path);
  await expect(reader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
  await rm(path);
  await expect(reader.readSnapshot()).rejects.toThrow('REGISTERED_SCOPE_UNAVAILABLE');
  await expect(readActivationBundle({ registryRoot }, '../outside')).rejects.toThrow('ACTIVATION_BUNDLE_MISMATCH');
});

test('concurrent publications retain both accounts after retrying a contended writer', async () => {
  const selections = [a, b];
  const outcomes = await Promise.allSettled(selections.map(member => publishRegisteredScopeMembers({ registryRoot }, [member])));
  expect(outcomes.some(result => result.status === 'fulfilled')).toBe(true);
  for (const [index, result] of outcomes.entries()) {
    if (result.status === 'rejected') await publishRegisteredScopeMembers({ registryRoot }, [selections[index]!]);
  }
  const snapshot = await createRegisteredScopeReader({ registryRoot }).readSnapshot();
  expect(snapshot.index.entries.map(entry => entry.accountId)).toEqual([a.entry.accountId, b.entry.accountId].sort());
});
