import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { HashSchema, IdSchema, hashCanonical } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService } from '@eapr/sources';
import { localSourceCatalog } from '../apps/control/src/composition.js';
import { pinBootstrapExpectation, type BootstrapExpectationReview } from '../packages/evaluator/src/bootstrap-fixtures.js';
import { createCandidateRegistry } from '../packages/evaluator/src/registry.js';
import { createControlDb } from '../packages/storage/src/control-db.js';
import { getDemoPair } from './native-db.js';

type Registry = Pick<ReturnType<typeof createCandidateRegistry>, 'getCandidate'>;
type Source = Pick<ReturnType<typeof createSourceService>, 'getSnapshotRecords'>;

/** Resolve an immutable candidate and its capture before trusting the object digest. */
export async function prepareBootstrapVerification(
  registry: Registry, source: Source,
  selection: { artifactHash: string; manifestId: string; review: BootstrapExpectationReview },
  roots?: Parameters<typeof pinBootstrapExpectation>[2],
) {
  const artifactHash = HashSchema.parse(selection.artifactHash);
  const manifestId = IdSchema.parse(selection.manifestId);
  const { artifact, profiles, manifest, snapshot } = await registry.getCandidate(artifactHash, manifestId);
  if (artifact.hash !== artifactHash || manifest.id !== manifestId) throw new Error('Protected bootstrap fixture invalid');
  const events = await source.getSnapshotRecords(snapshot.id);
  return pinBootstrapExpectation(selection.review, {
    artifact, profiles, manifest, snapshot, events,
    registration: { artifactHash, manifestHash: manifest.hash, snapshotId: snapshot.id, snapshotObjectHash: hashCanonical(snapshot) },
  }, roots);
}

const repository = fileURLToPath(new URL('..', import.meta.url));
const maxReviewBytes = 1024 * 1024;
async function readReview(path: string): Promise<BootstrapExpectationReview> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid?.() ||
      (stat.mode & 0o077) !== 0 || stat.size > maxReviewBytes) throw new Error('Protected bootstrap fixture invalid');
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('Protected bootstrap fixture invalid');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: {
      'artifact-hash': { type: 'string' }, 'manifest-id': { type: 'string' }, 'review-file': { type: 'string' },
    } });
    const artifactHash = HashSchema.parse(values['artifact-hash']);
    const manifestId = IdSchema.parse(values['manifest-id']);
    if (!values['review-file']) throw new Error('Protected bootstrap fixture invalid');
    const review = await readReview(values['review-file']);
    const db = createControlDb({ connectionString: getDemoPair().control.appUrl });
    try {
      const store = await createEvidenceStore(join(repository, '.local/demo/evidence'));
      const source = createSourceService({ db, store, clock: () => new Date() }, localSourceCatalog);
      const registry = createCandidateRegistry(db, join(repository, '.local/artifacts'));
      const { hash } = await prepareBootstrapVerification(registry, source, { artifactHash, manifestId, review });
      console.log('BOOTSTRAP_FIXTURE_PINNED ' + hash);
    } finally {
      await db.end();
    }
  } catch {
    console.error('BOOTSTRAP_FIXTURE_SETUP_REQUIRED');
    process.exitCode = 1;
  }
}
