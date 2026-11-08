import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Pool } from 'pg';
import { z } from 'zod';
import { HashSchema, IdSchema, canonicalJson, hashBytes, strict } from '@eapr/contracts';
import { createEvidenceStore, type EvidenceStore } from '@eapr/evidence';
import { createSourceService, readDossier, readManifest } from '@eapr/sources';
import type { DemoCapture } from '../apps/control/src/demo-candidates.js';
import { localSourceCatalog } from '../apps/control/src/composition.js';
import {
  createVerificationSelector, type SafeVerificationPin, type VerificationSetupCode,
} from '../apps/control/src/verification-composition.js';
import { pinProtectedFixture } from '../packages/evaluator/src/fixture-store.js';
import { decodeTruth } from '../packages/evaluator/src/fixtures.js';
import { createControlDb } from '../packages/storage/src/control-db.js';
import { generateFixtures } from './generate-fixtures.js';
import { loadVisible, localDemoRecipe } from './load-demo.js';
import { getDemoPair } from './native-db.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const localRoot = join(repositoryRoot, '.local');
const demoRoot = join(localRoot, 'demo');
const originalTruthRoot = join(demoRoot, 'protected');
const visibleRoot = join(demoRoot, 'visible');
const evidenceRoot = join(demoRoot, 'evidence');
const fixedProtectedRoot = join(localRoot, 'protected-evaluator');
const registryRoot = join(localRoot, 'artifacts');
const selectionPath = join(demoRoot, 'verification-selection.json');
const maxPrivateBytes = 10 * 1024 * 1024;
const maxSelectionBytes = 4096;
const companies = ['a', 'b'] as const;
const selectionSchema = strict({
  schemaVersion: z.literal(1),
  truthRoot: z.string().min(1),
  bindings: strict({ manifestId: IdSchema, manifestHash: HashSchema, snapshotHash: HashSchema }).array().length(2),
});

export class VerificationSetupError extends Error {
  constructor(readonly code: VerificationSetupCode) {
    super(code);
  }
}

const setupRequired = () => new VerificationSetupError('VERIFICATION_FIXTURE_SETUP_REQUIRED');
const conflict = () => new VerificationSetupError('VERIFICATION_FIXTURE_CONFLICT');

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function inside(root: string, path: string) {
  const difference = relative(root, path);
  return difference === '' || (!isAbsolute(difference) && difference !== '..' && !difference.startsWith('..' + sep));
}

async function physicalDirectory(path: string) {
  if (!(await lstat(path)).isDirectory() || await realpath(path) !== path) throw setupRequired();
}

async function boundedPrivateFile(path: string, maxBytes: number, mode?: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes || (mode !== undefined && (stat.mode & 0o7777) !== mode)) throw setupRequired();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw setupRequired();
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Buffer) {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

type PinPreparation = { db: Pool; captures: DemoCapture[]; truthRoot: string; store?: EvidenceStore };

async function readCaptured({ db, captures, store }: Omit<PinPreparation, 'truthRoot'>) {
  const service = createSourceService({ db, store: store ?? await createEvidenceStore(evidenceRoot), clock: () => new Date() },
    localSourceCatalog);
  if (captures.length !== companies.length) throw conflict();
  return Promise.all(companies.map(async company => {
    const companyId = 'company-' + company;
    const capture = captures.find(entry => entry.companyId === companyId);
    const source = localSourceCatalog.get(companyId);
    if (!capture || !source) throw conflict();
    const [manifest, dossier, snapshot] = await Promise.all([
      readManifest(db, companyId, capture.manifestId),
      readDossier(db, companyId, capture.manifestId),
      service.getSnapshot('snapshot:' + capture.manifestId),
    ]);
    if (!dossier.complete || dossier.companyId !== companyId || dossier.manifestId !== manifest.id ||
      !dossier.snapshotIds.includes(snapshot.id) || snapshot.manifestId !== manifest.id ||
      snapshot.sourceRef !== source.sourceRef || manifest.sourceRef !== source.sourceRef ||
      manifest.companyId !== companyId) throw conflict();
    const events = await service.getSnapshotRecords(snapshot.id);
    return {
      company, manifest, snapshot, events,
      binding: { companyId, sourceRef: source.sourceRef, manifestId: manifest.id, manifestHash: manifest.hash,
        snapshotHash: snapshot.contentHash },
    };
  }));
}

type Captured = Awaited<ReturnType<typeof readCaptured>>;

async function requireSafeProtectedStore() {
  await physicalDirectory(localRoot);
  try {
    await physicalDirectory(fixedProtectedRoot);
  } catch (error) {
    if (!missing(error)) throw error;
  }
}

async function pinCaptured(captured: Captured, truthRoot: string): Promise<SafeVerificationPin[]> {
  const inputs = await Promise.all(captured.map(async ({ company, manifest, snapshot, events }) => {
    try {
      await physicalDirectory(truthRoot);
      const truthJson = decodeUtf8(await boundedPrivateFile(join(truthRoot, 'expected-' + company + '.json'), maxPrivateBytes));
      return { truthJson, manifest, snapshot, events, truth: decodeTruth(truthJson) };
    } catch {
      throw setupRequired();
    }
  }));

  try {
    if (inputs.some(({ truth }) => truth.purpose !== 'construction')) throw conflict();
    await requireSafeProtectedStore();
    const pins: SafeVerificationPin[] = [];
    for (const [index, input] of inputs.entries()) {
      const result = await pinProtectedFixture(input);
      if (result.purpose !== 'construction' || result.snapshotHash !== captured[index]!.binding.snapshotHash) throw conflict();
      pins.push({
        ...captured[index]!.binding, fixtureSetId: result.fixtureSetId, fixtureSetVersion: result.fixtureSetVersion,
        purpose: result.purpose,
      });
    }
    createVerificationSelector(pins, captured.map(({ binding }) => binding));
    return pins;
  } catch {
    throw conflict();
  }
}

export async function prepareVerificationPins({ truthRoot, ...options }: PinPreparation) {
  let captured: Captured;
  try {
    captured = await readCaptured(options);
  } catch {
    throw conflict();
  }
  return pinCaptured(captured, truthRoot);
}

function selectionBindings(captured: Captured) {
  return captured.map(({ binding: { manifestId, manifestHash, snapshotHash } }) => ({ manifestId, manifestHash, snapshotHash }));
}

const reservedRoots = [
  originalTruthRoot, visibleRoot, evidenceRoot, selectionPath, selectionPath + '.lock', fixedProtectedRoot, registryRoot,
  join(localRoot, 'pgdata'), join(localRoot, 'env'), join(localRoot, 'postgres.log'), join(localRoot, 'bootstrap-pw'),
];

function assertNewRoot(root: string) {
  if (root === localRoot || !inside(localRoot, root) ||
    reservedRoots.some(reserved => inside(reserved, root) || inside(root, reserved))) throw setupRequired();
}

async function previousSelection() {
  await physicalDirectory(demoRoot);
  try {
    return await boundedPrivateFile(selectionPath, maxSelectionBytes, 0o600);
  } catch (error) {
    if (missing(error)) return undefined;
    throw setupRequired();
  }
}

export async function prepareSelectedVerificationPins(options: Omit<PinPreparation, 'truthRoot'>) {
  let captured: Captured;
  try {
    captured = await readCaptured(options);
  } catch {
    throw conflict();
  }
  let selection: z.infer<typeof selectionSchema>;
  try {
    const bytes = await previousSelection();
    if (!bytes) return pinCaptured(captured, originalTruthRoot);
    selection = selectionSchema.parse(JSON.parse(decodeUtf8(bytes)));
    if (!isAbsolute(selection.truthRoot) || resolve(selection.truthRoot) !== selection.truthRoot ||
      selection.truthRoot !== join(dirname(selection.truthRoot), 'protected')) throw setupRequired();
    assertNewRoot(dirname(selection.truthRoot));
  } catch {
    throw setupRequired();
  }
  if (canonicalJson(selection.bindings) !== canonicalJson(selectionBindings(captured))) throw conflict();
  return pinCaptured(captured, selection.truthRoot);
}

type Visible = Awaited<ReturnType<typeof loadVisible>>;

function visibleFingerprint({ manifest, documents, records, capture, accountDirectoryHash }: Visible) {
  const sorted = <T>(values: T[], key: (value: T) => string) =>
    values.sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  return canonicalJson({
    manifest, capture, accountDirectoryHash,
    documents: sorted(documents.map(({ metadata, path, fileId, bytes }) => ({
      metadata, path, fileId, hash: hashBytes(bytes),
    })), doc => doc.fileId),
    records: sorted(records.map(({ event, path, bytes }) => ({ event, path, hash: hashBytes(bytes) })), record => record.event.id),
  });
}

async function verifyVisibleCapture(db: Pool, store: EvidenceStore, dataset: Visible, captured: Captured[number]) {
  if (canonicalJson(dataset.manifest) !== canonicalJson(captured.manifest)) throw conflict();
  const { documents, records } = dataset;
  const files = (await db.query(
    'SELECT file_id, content_hash, metadata FROM source_files WHERE file_id = ANY($1)', [documents.map(doc => doc.fileId)],
  )).rows;
  if (files.length !== documents.length) throw conflict();
  for (const { fileId, bytes, metadata } of documents) {
    const file = files.find(row => row.file_id === fileId);
    const hash = hashBytes(bytes);
    if (!file || file.content_hash !== hash || canonicalJson(file.metadata) !== canonicalJson(metadata)) throw conflict();
    await store.get(hash);
  }
  const apiRows = (await db.query(
    'SELECT event_id, api_original_hash FROM source_events WHERE source_ref = $1 AND event_id = ANY($2)',
    [dataset.manifest.sourceRef, records.map(({ event }) => event.id)],
  )).rows;
  if (apiRows.length !== records.length) throw conflict();
  const events = new Map(captured.events.map(event => [event.id, event]));
  for (const { event, bytes } of records) {
    const hash = hashBytes(bytes);
    const actual = events.get(event.id);
    if (!actual || canonicalJson(actual) !== canonicalJson(event) ||
      apiRows.find(row => row.event_id === event.id)?.api_original_hash !== hash) throw conflict();
    await store.get(hash);
  }
  // Complete event membership, including CSV events, is checked by pinProtectedFixture
  // against the independent regenerated truth and the original captured aggregate.
}

async function publishSelection(truthRoot: string, captured: Captured) {
  const lockPath = selectionPath + '.lock';
  const lock = await open(lockPath, 'wx', 0o600);
  const id = randomUUID();
  const temporary = selectionPath + '.pending-' + id;
  try {
    const previous = await previousSelection();
    const selection = selectionSchema.parse({ schemaVersion: 1, truthRoot, bindings: selectionBindings(captured) });
    await writeFile(temporary, canonicalJson(selection), { flag: 'wx', mode: 0o600, flush: true });
    if (previous) await writeFile(selectionPath + '.backup-' + id, previous, { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, selectionPath);
  } finally {
    try {
      await unlink(temporary).catch(error => { if (!missing(error)) throw error; });
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
}

export async function upgradeVerification(db: Pool, newRoot: string) {
  const requestedRoot = resolve(newRoot);
  try {
    if (newRoot.split(sep).includes('..')) throw setupRequired();
    assertNewRoot(requestedRoot);
    await physicalDirectory(dirname(requestedRoot));
    await mkdir(requestedRoot, { mode: 0o700 });
    await physicalDirectory(requestedRoot);
  } catch {
    throw setupRequired();
  }

  try {
    await physicalDirectory(visibleRoot);
    await physicalDirectory(evidenceRoot);
    const store = await createEvidenceStore(evidenceRoot);
    const original = await Promise.all(companies.map(company => loadVisible(visibleRoot, company)));
    const captures = original.map(({ capture }) => capture);
    const captured = await readCaptured({ db, store, captures });
    const generatedVisible = join(requestedRoot, 'generated-visible');
    const truthRoot = join(requestedRoot, 'protected');
    await generateFixtures({ ...localDemoRecipe, visibleRoot: generatedVisible, truthRoot });
    const regenerated = await Promise.all(companies.map(company => loadVisible(generatedVisible, company)));
    for (const [index, dataset] of original.entries()) {
      if (visibleFingerprint(regenerated[index]!) !== visibleFingerprint(dataset)) throw conflict();
      await verifyVisibleCapture(db, store, dataset, captured[index]!);
    }
    const pins = await pinCaptured(captured, truthRoot);
    await publishSelection(truthRoot, captured);
    return pins;
  } catch {
    throw conflict();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { upgrade: { type: 'boolean' }, 'new-root': { type: 'string' } } });
    if (!values.upgrade || !values['new-root'] || process.cwd() !== resolve(repositoryRoot)) throw setupRequired();
    const db = createControlDb({ connectionString: getDemoPair().control.appUrl });
    try {
      const pins = await upgradeVerification(db, values['new-root']);
      console.log('VERIFICATION_FIXTURES_SELECTED ' + pins.map(pin => pin.manifestId).join(' '));
    } finally {
      await db.end();
    }
  } catch (error) {
    console.error(error instanceof VerificationSetupError ? error.code : 'VERIFICATION_FIXTURE_SETUP_REQUIRED');
    process.exitCode = 1;
  }
}
