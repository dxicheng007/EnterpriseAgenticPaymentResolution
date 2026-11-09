import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  ActivationTrustPolicyV1Schema, canonicalJson, HashSchema, hashActivationTrustPolicy, type ActivationTrustPolicyV1,
} from '@eapr/contracts';
import type { ZodType } from 'zod';

export const maxActivationBytes = 10 * 1024 * 1024;

export function hasFileCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function digestPath(root: string, hash: string) {
  return join(root, HashSchema.parse(hash) + '.json');
}

export async function trustedDirectory(path: string, create = false): Promise<void> {
  const absolute = resolve(path);
  let stat;
  try {
    stat = await lstat(absolute);
  } catch (error) {
    if (!create || !hasFileCode(error, 'ENOENT')) throw error;
    await trustedDirectory(dirname(absolute), true);
    try {
      await mkdir(absolute, { mode: 0o700 });
    } catch (mkdirError) {
      if (!hasFileCode(mkdirError, 'EEXIST')) throw mkdirError;
    }
    stat = await lstat(absolute);
  }
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 || await realpath(absolute) !== absolute) {
    throw new Error('Untrusted activation directory');
  }
}

function requirePrivateFile(stat: Stats, limit: number) {
  if (!stat.isFile() || stat.uid !== process.getuid?.() ||
    (stat.mode & 0o077) !== 0 || stat.size > limit) throw new Error('Invalid activation file');
}

export async function readPrivateBytes(path: string, limit = maxActivationBytes): Promise<Buffer> {
  const absolute = resolve(path);
  await trustedDirectory(dirname(absolute));
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    requirePrivateFile(stat, limit);
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('Invalid activation file size');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export function decodeCanonical<T>(bytes: Uint8Array, schema: ZodType<T>): T {
  if (bytes.byteLength > maxActivationBytes) throw new Error('Activation file too large');
  const value = schema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (!Buffer.from(canonicalJson(value)).equals(bytes)) throw new Error('Noncanonical activation file');
  return value;
}

export async function publishBytes(path: string, bytes: Buffer, replace = false): Promise<void> {
  if (bytes.length > maxActivationBytes) throw new Error('Activation file too large');
  const directory = dirname(path);
  await trustedDirectory(directory, true);
  const temporary = join(directory, '.' + randomUUID());
  const handle = await open(temporary, 'wx', 0o400);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (replace) {
      try {
        requirePrivateFile(await lstat(path), maxActivationBytes);
      } catch (error) {
        if (!hasFileCode(error, 'ENOENT')) throw error;
      }
      await rename(temporary, path);
    } else {
      try {
        await link(temporary, path);
      } catch (error) {
        if (!hasFileCode(error, 'EEXIST')) throw error;
        if (!(await readPrivateBytes(path)).equals(bytes)) throw new Error('Activation file conflict');
      }
    }
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (!hasFileCode(error, 'ENOENT')) throw error;
    }
  }
}

export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const member of Object.values(value)) freezeJson(member);
    Object.freeze(value);
  }
  return value;
}

export function validateActivationPolicy(policy: ActivationTrustPolicyV1) {
  if (policy.entries.length === 0 || policy.hash !== hashActivationTrustPolicy(policy)) {
    throw new Error('ACTIVATION_POLICY_MISMATCH');
  }
  return policy;
}

/** Operator setup only. Preparation and proof validation are owned by the operator command. */
export async function publishActivationPolicy(
  { policyRoot }: { policyRoot: string }, input: ActivationTrustPolicyV1, install = false,
): Promise<void> {
  try {
    const policy = validateActivationPolicy(ActivationTrustPolicyV1Schema.parse(input));
    await trustedDirectory(policyRoot, true);
    const bytes = Buffer.from(canonicalJson(policy));
    await publishBytes(digestPath(join(policyRoot, 'policies'), policy.hash), bytes);
    if (install) await publishBytes(join(policyRoot, 'current.json'), bytes, true);
  } catch {
    throw new Error('ACTIVATION_POLICY_MISMATCH');
  }
}
