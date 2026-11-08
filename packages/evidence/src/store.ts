import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HashSchema, hashBytes, type Hash } from '@eapr/contracts';

export class EvidenceStorageError extends Error {
  constructor(readonly code: 'SOURCE_UNAVAILABLE' | 'SOURCE_HASH_CONFLICT', cause?: Error) {
    super(code, {cause});
  }
}

export async function createEvidenceStore(path: string) {
  const requestedRoot = resolve(path);
  await mkdir(requestedRoot, {recursive:true, mode:0o700});
  if (!(await lstat(requestedRoot)).isDirectory()) throw new EvidenceStorageError('SOURCE_UNAVAILABLE');
  const root = await realpath(requestedRoot);

  async function verifyRoot() {
    if (!(await lstat(root)).isDirectory() || await realpath(root) !== root) {
      throw new EvidenceStorageError('SOURCE_UNAVAILABLE');
    }
  }

  async function get(hash: Hash): Promise<Buffer> {
    const file = join(root, HashSchema.parse(hash));
    await verifyRoot();
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (!(await handle.stat()).isFile()) throw new EvidenceStorageError('SOURCE_UNAVAILABLE');
      const bytes = await handle.readFile();
      if (hashBytes(bytes) !== hash) throw new EvidenceStorageError('SOURCE_HASH_CONFLICT');
      return bytes;
    } finally {
      await handle.close();
    }
  }

  async function put(bytes: Uint8Array): Promise<Hash> {
    const hash = hashBytes(bytes);
    await verifyRoot();
    const temporary = join(root, '.pending-' + randomUUID());
    await writeFile(temporary, bytes, {flag:'wx', mode:0o400, flush:true});
    try {
      try {
        await link(temporary, join(root, hash));
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
      await get(hash);
      return hash;
    } finally {
      await unlink(temporary);
    }
  }

  return {get, put};
}

export type EvidenceStore = Awaited<ReturnType<typeof createEvidenceStore>>;
