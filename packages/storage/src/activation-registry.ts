import { open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ActivationBundleV2Schema, BootstrapManifestSchema, CustomerProfileSchema, RegisteredScopeIndexV1Schema,
  canonicalJson, hashBundleV2, hashManifest, hashProfile, hashRegisteredScopeIndex,
  type BootstrapManifest, type CustomerProfile, type RegisteredScopeIndexEntryV1,
} from '@eapr/contracts';
import { decodeCanonical, digestPath, freezeJson, hasFileCode, maxActivationBytes, publishBytes, readPrivateBytes, trustedDirectory } from './activation-files.js';

type RegistryOptions = { registryRoot: string };
type Member = { entry: RegisteredScopeIndexEntryV1; profile: CustomerProfile; manifest: BootstrapManifest };

function bindMember(entry: RegisteredScopeIndexEntryV1, profile: CustomerProfile, manifest: BootstrapManifest): Member {
  if (profile.hash !== entry.profileHash || hashProfile(profile) !== entry.profileHash ||
    manifest.hash !== entry.manifestHash || hashManifest(manifest) !== entry.manifestHash ||
    manifest.id !== entry.manifestId || manifest.asOf !== entry.manifestAsOf ||
    profile.scope.companyId !== manifest.companyId || profile.sourceRef !== manifest.sourceRef ||
    canonicalJson(profile.scope) !== canonicalJson(entry.scope)) throw new Error('REGISTERED_SCOPE_MISMATCH');
  return { entry, profile, manifest };
}

async function readScopeIndex(root: string) {
  const index = decodeCanonical(await readPrivateBytes(join(root, 'current.json')), RegisteredScopeIndexV1Schema);
  if (index.hash !== hashRegisteredScopeIndex(index)) throw new Error('REGISTERED_SCOPE_MISMATCH');
  return index;
}

async function readMembers(root: string, entries: RegisteredScopeIndexEntryV1[]) {
  const members = new Map<string, Member>();
  for (const entry of entries) {
    const profile = decodeCanonical(
      await readPrivateBytes(digestPath(join(root, 'profiles'), entry.profileHash)), CustomerProfileSchema,
    );
    const manifest = decodeCanonical(
      await readPrivateBytes(digestPath(join(root, 'manifests'), entry.manifestHash)), BootstrapManifestSchema,
    );
    members.set(entry.accountId, freezeJson(bindMember(entry, profile, manifest)));
  }
  return members;
}

export function createRegisteredScopeReader({ registryRoot }: RegistryOptions) {
  const root = join(registryRoot, 'activation-registry');
  return {
    async readSnapshot() {
      try {
        await trustedDirectory(registryRoot);
        const index = freezeJson(await readScopeIndex(root));
        const members = await readMembers(root, index.entries);
        return { index, resolveRegisteredScope: (accountId: string) => members.get(accountId) ?? null };
      } catch {
        throw new Error('REGISTERED_SCOPE_UNAVAILABLE');
      }
    },
  };
}

/** Trusted publisher. Control derives these members from the candidate registry. */
export async function publishRegisteredScopeMembers({ registryRoot }: RegistryOptions, selections: Member[]) {
  const root = join(registryRoot, 'activation-registry');
  const lockPath = join(root, '.writer-lock');
  try {
    await trustedDirectory(registryRoot, true);
    await trustedDirectory(root, true);
    const lock = await open(lockPath, 'wx', 0o600);
    try {
      const previous = await readScopeIndex(root).catch(error => {
        if (!hasFileCode(error, 'ENOENT')) throw error;
        return null;
      });
      const members = await readMembers(root, previous?.entries ?? []);
      const selectedIndex = RegisteredScopeIndexV1Schema.parse({
        schemaVersion: '1', hash: '0'.repeat(64), entries: selections.map(({ entry }) => entry),
      });
      const selectionsByAccount = new Map(selections.map(member => [member.entry.accountId, member]));
      for (const entry of selectedIndex.entries) {
        const selected = selectionsByAccount.get(entry.accountId)!;
        const member = bindMember(entry, CustomerProfileSchema.parse(selected.profile), BootstrapManifestSchema.parse(selected.manifest));
        const existing = members.get(entry.accountId);
        if (existing && canonicalJson(existing.entry.scope) !== canonicalJson(entry.scope)) {
          throw new Error('REGISTERED_SCOPE_MISMATCH');
        }
        members.set(entry.accountId, member);
      }
      const input = { schemaVersion: '1' as const, entries: [...members.values()].map(({ entry }) => entry) };
      const index = RegisteredScopeIndexV1Schema.parse({ ...input, hash: hashRegisteredScopeIndex(input) });
      for (const { profile, manifest } of members.values()) {
        await publishBytes(digestPath(join(root, 'profiles'), profile.hash), Buffer.from(canonicalJson(profile)));
        await publishBytes(digestPath(join(root, 'manifests'), manifest.hash), Buffer.from(canonicalJson(manifest)));
      }
      const bytes = Buffer.from(canonicalJson(index));
      await publishBytes(digestPath(join(root, 'indexes'), index.hash), bytes);
      await publishBytes(join(root, 'current.json'), bytes, true);
      return freezeJson(index);
    } finally {
      try {
        await lock.close();
      } finally {
        await unlink(lockPath);
      }
    }
  } catch {
    throw new Error('REGISTERED_SCOPE_PUBLICATION_FAILED');
  }
}

export function validateActivationBundleBytes(bytes: Uint8Array, bundleHash: string) {
  try {
    const bundle = decodeCanonical(bytes, ActivationBundleV2Schema);
    if (bundle.hash !== bundleHash || hashBundleV2(bundle) !== bundleHash) throw new Error('Wrong bundle hash');
    return bundle;
  } catch {
    throw new Error('ACTIVATION_BUNDLE_MISMATCH');
  }
}

export async function readActivationBundle({ registryRoot }: RegistryOptions, bundleHash: string) {
  try {
    await trustedDirectory(registryRoot);
    const bytes = await readPrivateBytes(digestPath(join(registryRoot, 'activation-bundles'), bundleHash));
    return validateActivationBundleBytes(bytes, bundleHash);
  } catch {
    throw new Error('ACTIVATION_BUNDLE_MISMATCH');
  }
}

/** Publish the exact bytes of a committed reviewer intent. */
export async function publishActivationBundle({ registryRoot }: RegistryOptions, bundleHash: string, input: Uint8Array) {
  try {
    if (input.byteLength > maxActivationBytes) throw new Error('Activation file too large');
    const bytes = Buffer.from(input);
    validateActivationBundleBytes(bytes, bundleHash);
    await trustedDirectory(registryRoot, true);
    await publishBytes(digestPath(join(registryRoot, 'activation-bundles'), bundleHash), bytes);
  } catch {
    throw new Error('ACTIVATION_BUNDLE_MISMATCH');
  }
}
