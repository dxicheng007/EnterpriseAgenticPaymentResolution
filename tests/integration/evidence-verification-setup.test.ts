import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { canonicalJson, hashBytes, hashCanonical } from '@eapr/contracts';
import { createEvidenceStore } from '@eapr/evidence';
import { createSourceService, readDossier, readEvidence, readManifest } from '@eapr/sources';
import { localSourceCatalog } from '../../apps/control/src/composition.js';
import { decodeEvidenceProducer } from '../../packages/evaluator/src/evidence-fixtures.js';
import { readProtectedFixture } from '../../packages/evaluator/src/fixture-store.js';
import { decodeTruth } from '../../packages/evaluator/src/fixtures.js';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { loadDemo } from '../../scripts/load-demo.js';
import { migrate, migrationStreams, readMigrationCatalog } from '../../scripts/migrate.js';
import { dropTest, provisionTest, startNativeDb } from '../../scripts/native-db.js';
import { prepareVerificationPins } from '../../scripts/prepare-verification.js';
import { testNamespace } from '../fixtures/harness.js';

const setupRequired = { code: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' };
const conflict = { code: 'VERIFICATION_FIXTURE_CONFLICT' };
const sealed = <T extends { hash: string }>({ hash: _hash, ...value }: T) =>
  canonicalJson({ ...value, hash: hashCanonical(value) });
const fingerprint = async (path: URL) => hashBytes(await readFile(path));
const fixturePath = (id: string, version: string) =>
  new URL('../../.local/protected-evaluator/' + hashCanonical([id, version]) + '.json', import.meta.url);

test('paired operator inputs pin the exact stored captures and reject incomplete or conflicting evidence', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'eapr-evidence-setup-'));
  const namespace = testNamespace('evsetup');
  const ownedPins: URL[] = [];
  try {
    await startNativeDb();
    const pair = await provisionTest(namespace);
    const db = createControlDb({ connectionString: pair.control.appUrl });
    const owner = createControlDb({ connectionString: pair.control.migrationUrl });
    try {
      await migrate(pair, migrationStreams, readMigrationCatalog());
      const roots = { visibleRoot: join(directory, 'visible'), truthRoot: join(directory, 'protected') };
      const storeRoot = join(directory, 'evidence');
      const store = await createEvidenceStore(storeRoot);
      const dependencies = { db, store, clock: () => new Date('2026-11-08T00:00:00.000Z') };
      const { captures } = await loadDemo(dependencies, roots);
      const prepare = () => prepareVerificationPins({ db, store, captures, truthRoot: roots.truthRoot });
      const inputs = await Promise.all((['a', 'b'] as const).map(async company => {
        const truthPath = join(roots.truthRoot, 'expected-' + company + '.json');
        const producerPath = join(roots.truthRoot, 'evidence-' + company + '.json');
        const originalTruth = decodeTruth(await readFile(truthPath, 'utf8'));
        const originalProducer = decodeEvidenceProducer(await readFile(producerPath, 'utf8'));
        const fixtureSetId = 'evidence-setup-test:' + randomUUID();
        const truth = decodeTruth(sealed({ ...originalTruth, fixtureSetId }));
        const producer = decodeEvidenceProducer(sealed({ ...originalProducer, fixtureSetId, producerTruthHash: truth.hash }));
        expect(decodeTruth(sealed({ ...truth, fixtureSetId: originalTruth.fixtureSetId })).hash).toBe(originalTruth.hash);
        expect(decodeEvidenceProducer(sealed({
          ...producer, fixtureSetId: originalProducer.fixtureSetId, producerTruthHash: originalTruth.hash,
        })).hash).toBe(originalProducer.hash);
        await writeFile(truthPath, canonicalJson(truth));
        for (const version of ['1', '2']) {
          const path = fixturePath(fixtureSetId, version);
          await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
          ownedPins.push(path);
        }
        await unlink(producerPath);
        return { truthPath, producerPath, truth, producer, v1: fixturePath(fixtureSetId, '1'), v2: fixturePath(fixtureSetId, '2') };
      }));
      const [a, b] = inputs as [typeof inputs[number], typeof inputs[number]];
      const legacy = await prepare();
      expect(legacy.map(pin => pin.fixtureSetVersion)).toEqual(['1', '1']);
      const historical = await Promise.all(inputs.map(input => fingerprint(input.v1)));
      const service = createSourceService(dependencies, localSourceCatalog);
      const manifests = await Promise.all(captures.map(({ companyId, manifestId }) => readManifest(db, companyId, manifestId)));
      expect((await readProtectedFixture(a.truth.fixtureSetId, '1', manifests[0]!)).evidence).toBeUndefined();

      await writeFile(b.truthPath, sealed({ ...b.truth, fixtureSetVersion: '2' }));
      await expect(prepare()).rejects.toMatchObject(conflict);
      await writeFile(b.truthPath, canonicalJson(b.truth));
      await expect(lstat(b.v2)).rejects.toMatchObject({ code: 'ENOENT' });

      const writeProducer = (input: typeof a) => writeFile(input.producerPath, canonicalJson(input.producer));
      const assertUnpublished = async () => {
        for (const input of inputs) await expect(lstat(input.v2)).rejects.toMatchObject({ code: 'ENOENT' });
      };
      await writeProducer(a);
      await expect(prepare()).rejects.toMatchObject(setupRequired);
      await assertUnpublished();
      for (const invalid of ['{', '{}', sealed({ ...b.producer, unknown: true }), canonicalJson({ ...b.producer, hash: '0'.repeat(64) })]) {
        await writeFile(b.producerPath, invalid);
        await expect(prepare()).rejects.toMatchObject(setupRequired);
        await assertUnpublished();
      }
      await truncate(b.producerPath, 10 * 1024 * 1024 + 1);
      await expect(prepare()).rejects.toMatchObject(setupRequired);
      await unlink(b.producerPath);
      await symlink(a.producerPath, b.producerPath);
      await expect(prepare()).rejects.toMatchObject(setupRequired);
      await unlink(b.producerPath);
      await assertUnpublished();

      await writeFile(b.producerPath, sealed({ ...b.producer, producerTruthHash: '0'.repeat(64) }));
      await expect(prepare()).rejects.toMatchObject(conflict);
      const contracts = structuredClone(b.producer.contracts);
      contracts[0]!.support[0]!.expectedLiteral = 'unsupported-private-literal';
      for (const contract of contracts) {
        const key = ({ field, fileId, expectedLiteral }: typeof contract.support[number]) => canonicalJson([field, fileId, expectedLiteral]);
        contract.support.sort((left, right) => key(left) < key(right) ? -1 : 1);
      }
      await writeFile(b.producerPath, sealed({ ...b.producer, contracts }));
      await expect(prepare()).rejects.toMatchObject(conflict);
      await assertUnpublished();
      await writeProducer(b);

      const manifest = manifests[1]!;
      const snapshot = await service.getSnapshot('snapshot:' + manifest.id);
      const [api, document] = await Promise.all([
        owner.query<{ evidence_id: string; api_source_id: string }>(
          'SELECT evidence_id, api_source_id FROM source_evidence WHERE snapshot_id = $1 AND api_source_id IS NOT NULL ORDER BY evidence_id',
          [snapshot.id],
        ).then(result => result.rows),
        owner.query<{ evidence_id: string; file_id: string }>(
          'SELECT evidence_id, file_id FROM source_evidence WHERE snapshot_id = $1 AND file_id IS NOT NULL ORDER BY evidence_id',
          [snapshot.id],
        ).then(result => result.rows),
      ]);
      const firstApi = api[0]!;
      const firstDocument = document[0]!;
      const otherDocument = document.find(row => row.file_id !== firstDocument.file_id)!;
      const rejectMutation = async (mutate: string, before: unknown[], after: unknown[]) => {
        await owner.query(mutate, before);
        try {
          await expect(prepare()).rejects.toMatchObject(conflict);
          await assertUnpublished();
        } finally {
          await owner.query(mutate, after);
        }
      };
      await rejectMutation('UPDATE source_evidence SET api_source_id = $2 WHERE evidence_id = $1',
        [firstApi.evidence_id, api[1]!.api_source_id], [firstApi.evidence_id, firstApi.api_source_id]);
      await rejectMutation('UPDATE source_evidence SET file_id = $2 WHERE evidence_id = $1',
        [firstDocument.evidence_id, otherDocument.file_id], [firstDocument.evidence_id, firstDocument.file_id]);
      await rejectMutation('UPDATE source_files SET company_id = $2 WHERE file_id = $1',
        [firstDocument.file_id, 'different-company'], [firstDocument.file_id, manifest.companyId]);
      await rejectMutation('UPDATE source_evidence SET snapshot_id = $2 WHERE evidence_id = $1',
        [firstDocument.evidence_id, 'different-snapshot'], [firstDocument.evidence_id, snapshot.id]);

      const original = join(storeRoot, manifest.files[0]!.sha256);
      const saved = original + '.saved';
      await rename(original, saved);
      try {
        await expect(prepare()).rejects.toMatchObject(conflict);
        await writeFile(original, 'changed-original');
        await expect(prepare()).rejects.toMatchObject(conflict);
        await assertUnpublished();
      } finally {
        await rename(saved, original);
      }

      // Force publication of B to fail after both captures preflight. A's
      // successfully written immutable pin must survive the interrupted pair.
      await mkdir(b.v2);
      try {
        await expect(prepare()).rejects.toMatchObject(conflict);
        expect((await lstat(a.v2)).isFile()).toBe(true);
      } finally {
        await rm(b.v2, { recursive: true });
      }
      const pins = await prepare();
      expect(pins.map(pin => pin.fixtureSetVersion)).toEqual(['2', '2']);
      expect(await prepare()).toEqual(pins);
      for (const [index, input] of inputs.entries()) {
        const manifest = manifests[index]!;
        const pin = pins[index]!;
        expect(Object.keys(pin).sort()).toEqual([
          'companyId', 'fixtureSetId', 'fixtureSetVersion', 'manifestHash', 'manifestId', 'purpose', 'snapshotHash', 'sourceRef',
        ]);
        const actual = await service.getSnapshot('snapshot:' + manifest.id);
        const result = await readProtectedFixture(pin.fixtureSetId, pin.fixtureSetVersion, manifest);
        expect(hashCanonical(result.snapshot)).toBe(hashCanonical(actual));
        const actualEvents = (await service.getSnapshotRecords(actual.id)).sort((left, right) => left.id < right.id ? -1 : 1);
        expect(hashCanonical(result.events)).toBe(hashCanonical(actualEvents));
        const evidence = result.evidence!;
        expect(hashCanonical(evidence.producer)).toBe(hashCanonical(input.producer));
        expect(evidence.producer.producerTruthHash).toBe(input.truth.hash);
        expect(evidence.financialTruthHash).toBe(result.truth.hash);
        expect(evidence.financialTruthHash).not.toBe(input.truth.hash);
        expect(decodeTruth(sealed({ ...result.truth, fixtureSetVersion: '1' })).hash).toBe(input.truth.hash);
        const dossier = await readDossier(db, manifest.companyId, manifest.id);
        expect(evidence.citations.map(citation => citation.evidence.id)).toEqual(dossier.evidenceIds);
        expect(evidence.originals.map(item => item.sourceId)).toEqual([...new Set(evidence.citations.map(item => item.evidence.sourceId))].sort());
        for (const citation of evidence.citations) {
          const observed = await readEvidence(db, citation.evidence.id, async scope => {
            expect(scope).toMatchObject({ companyId: manifest.companyId, sourceRef: manifest.sourceRef });
          });
          expect(hashCanonical(citation)).toBe(hashCanonical(observed));
        }
        const storedApi = await db.query<{ api_source_id: string; event_id: string }>(
          'SELECT api_source_id, event_id FROM source_events WHERE source_ref = $1 AND api_source_id IS NOT NULL', [manifest.sourceRef]);
        expect(evidence.originals.filter(item => item.binding.kind === 'api-json').map(item => [item.sourceId, item.binding]))
          .toEqual(storedApi.rows.sort((left, right) => left.api_source_id < right.api_source_id ? -1 : 1)
            .map(row => [row.api_source_id, { kind: 'api-json', eventId: row.event_id }]));
        for (const item of evidence.originals) {
          expect(Buffer.from(item.bytesBase64, 'base64').equals(await store.get(item.sha256))).toBe(true);
        }
        for (const file of manifest.files.filter(file => file.kind === 'event_csv')) {
          const original = evidence.originals.find(item => item.sourceId === file.fileId);
          expect(original?.sha256 === file.sha256 &&
            original.binding.kind === 'document' && original.binding.fileId === file.fileId).toBe(true);
        }
      }

      const v2Hashes = await Promise.all(inputs.map(input => fingerprint(input.v2)));
      const generator = { ...b.truth.generator, buildHash: 'a'.repeat(64) };
      const changedTruth = decodeTruth(sealed({ ...b.truth, generator }));
      await writeFile(b.truthPath, canonicalJson(changedTruth));
      await writeFile(b.producerPath, sealed({ ...b.producer, generator, producerTruthHash: changedTruth.hash }));
      await expect(prepare()).rejects.toMatchObject(conflict);
      expect(await Promise.all(inputs.map(input => fingerprint(input.v2)))).toEqual(v2Hashes);
      expect(await Promise.all(inputs.map(input => fingerprint(input.v1)))).toEqual(historical);
    } finally {
      await Promise.all([db.end(), owner.end()]);
      await dropTest(namespace);
    }
  } finally {
    for (const path of ownedPins) {
      if (await lstat(path).catch(() => undefined)) await unlink(path);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
