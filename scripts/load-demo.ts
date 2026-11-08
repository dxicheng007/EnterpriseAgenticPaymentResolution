import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import {
  BootstrapManifestSchema, IdSchema, RawSourceEventSchema, UploadMetadataSchema,
  hashBytes, hashCanonical, hashManifest, strict,
} from '@eapr/contracts';
import {
  MAX_UPLOAD_BYTES, createSourceService, prepareApiRecord, publishManifest, sourceFileId, storeSourceUpload,
  type UploadDependencies,
} from '@eapr/sources';
import { localSourceCatalog } from '../apps/control/src/composition.js';
import type { DemoCapture } from '../apps/control/src/demo-candidates.js';
import { generateFixtures } from './generate-fixtures.js';

const seed = 'local-demo-v1';
const asOf = '2026-10-01T00:00:00.000Z';
const uploadsSchema = z.array(strict({ metadata: UploadMetadataSchema, path: z.string() }));
const originalsSchema = z.array(strict({ eventId: IdSchema, path: z.string() }));

type DemoRoots = { visibleRoot: string; truthRoot: string };

function inside(root: string, target: string) {
  const path = relative(root, target);
  return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}

async function directory(path: string) {
  try {
    if (!(await lstat(path)).isDirectory()) throw new Error('Demo fixture root must be a directory');
    return await realpath(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function visibleBytes(root: string, path: string) {
  if (!path.split('/').every(part => /^[A-Za-z0-9._-]+$/.test(part) && part !== '.' && part !== '..')) {
    throw new Error('Invalid visible demo fixture member');
  }
  const physical = await realpath(resolve(root, path));
  if (!inside(root, physical)) throw new Error('Visible demo fixture member escapes its root');
  const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_UPLOAD_BYTES) throw new Error('Invalid visible demo fixture size');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== stat.size) throw new Error('Visible demo fixture changed while reading');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

async function loadVisible(root: string, company: 'a' | 'b') {
  const source = localSourceCatalog.get('company-' + company)!;
  const json = async (path: string): Promise<unknown> =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await visibleBytes(root, path)));
  const manifest = BootstrapManifestSchema.parse(await json('manifest-' + company + '.json'));
  const tag = hashCanonical(seed).slice(0, 12);
  const manifestId = 'manifest-' + company + '-' + tag + '-' + hashCanonical(asOf).slice(0, 12);
  if (manifest.id !== manifestId || manifest.epoch !== 1 || manifest.asOf !== asOf ||
    manifest.sourceRef !== source.sourceRef || manifest.companyId !== source.companyId || hashManifest(manifest) !== manifest.hash) {
    throw new Error('Visible demo manifest does not match the pinned dataset');
  }
  // The public account directory is generated alongside the manifest. Candidate facts come from captured evidence.
  await visibleBytes(root, 'accounts-' + company + '.json');
  const uploads = uploadsSchema.parse(await json('uploads-' + company + '.json'));
  if (new Set(uploads.map(upload => upload.path)).size !== uploads.length) {
    throw new Error('Visible demo upload paths conflict');
  }
  const manifestFiles = new Map(manifest.files.map(file => [file.fileId, file]));
  const documents = [];
  for (const { metadata, path } of uploads) {
    const fileId = sourceFileId(metadata);
    const pinned = manifestFiles.get(fileId);
    const bytes = await visibleBytes(root, path);
    if (!pinned || pinned.sha256 !== hashBytes(bytes) || pinned.kind !== metadata.kind ||
      pinned.documentId !== metadata.documentId || pinned.documentVersion !== metadata.documentVersion ||
      pinned.batchId !== metadata.batch?.batchId || pinned.sequence !== metadata.batch?.sequence ||
      pinned.streamId !== metadata.batch?.streamId || metadata.companyId !== source.companyId ||
      metadata.sourceRef !== source.sourceRef || metadata.originalName !== path) {
      throw new Error('Visible demo upload does not match its manifest association');
    }
    manifestFiles.delete(fileId);
    documents.push({ metadata, path, fileId, bytes });
  }
  if (manifestFiles.size) throw new Error('Visible demo manifest uploads are incomplete');

  const events = RawSourceEventSchema.array().parse(await json('api-' + company + '.json'));
  const expectedIds = new Set(manifest.streams.filter(member =>
    source.streams.some(stream => stream.streamId === member.streamId && stream.transport !== 'csv'),
  ).flatMap(stream => stream.eventIds));
  const originals = originalsSchema.parse(await json('api-originals-' + company + '.json'));
  const paths = new Map(originals.map(({ eventId, path }) => [eventId, path]));
  if (new Set(originals.map(original => original.path)).size !== originals.length ||
    paths.size !== originals.length || paths.size !== events.length || expectedIds.size !== events.length) {
    throw new Error('Visible demo API originals are incomplete');
  }
  const records = [];
  for (const event of events) {
    const path = paths.get(event.id);
    if (!path || !expectedIds.delete(event.id)) throw new Error('Visible demo API membership conflicts');
    records.push({ event, bytes: await visibleBytes(root, path) });
  }
  const contractPath = company === 'a' ? 'contract-1.pdf' : 'b-contract-1.pdf';
  const capture: DemoCapture = {
    companyId: source.companyId, manifestId: manifest.id,
    contractFileId: documents.find(document => document.path === contractPath)?.fileId ?? null,
  };
  // CSV batches append in predecessor order through the accepted ingestion service.
  documents.sort((left, right) => (left.metadata.batch?.sequence ?? 0) - (right.metadata.batch?.sequence ?? 0));
  return { source, manifest, documents, records, capture };
}

export async function loadDemo(dependencies: UploadDependencies, roots: DemoRoots) {
  const requestedVisible = resolve(roots.visibleRoot);
  const requestedTruth = resolve(roots.truthRoot);
  let [visible, truth] = await Promise.all([directory(requestedVisible), directory(requestedTruth)]);
  if (!visible && !truth) {
    await generateFixtures({ seed, asOf, visibleRoot: requestedVisible, truthRoot: requestedTruth });
    [visible, truth] = await Promise.all([directory(requestedVisible), directory(requestedTruth)]);
  }
  if (!visible || !truth || visible === truth || inside(visible, truth) || inside(truth, visible)) {
    throw new Error('Local demo requires complete, separate visible and protected fixture roots');
  }
  // Check generation completed without opening either protected expectation.
  for (const name of ['expected-a.json', 'expected-b.json']) {
    if (!(await lstat(resolve(truth, name))).isFile()) throw new Error('Protected demo fixture generation is incomplete');
  }
  const datasets = await Promise.all([loadVisible(visible, 'a'), loadVisible(visible, 'b')]);
  const prepared = await Promise.all(datasets.map(({ source, records }) => Promise.all(records.map(({ event, bytes }) =>
    prepareApiRecord(source, dependencies.store, event, bytes)))));
  const service = createSourceService(dependencies, localSourceCatalog);
  let fileCount = 0;
  let eventCount = 0;
  for (const [index, { manifest, documents }] of datasets.entries()) {
    for (const { metadata, bytes } of documents) await storeSourceUpload(dependencies, metadata, bytes);
    await publishManifest(dependencies, localSourceCatalog, manifest, prepared[index]!);
    const result = await service.captureSnapshot(manifest.id);
    if (!result.ok || !result.dossier.complete) throw new Error('Local demo source capture is incomplete');
    fileCount += documents.length;
    eventCount += result.snapshot.eventIds.length;
  }
  return { captures: datasets.map(dataset => dataset.capture), fileCount, eventCount };
}
