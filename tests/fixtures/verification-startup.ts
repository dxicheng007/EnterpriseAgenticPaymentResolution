// Invoked only in a disposable copy whose module-relative .local belongs to this test.
import { strict as assert } from 'node:assert';
import { appendFile, chmod, lstat, mkdir, readFile, readdir, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createControlDb } from '../../packages/storage/src/control-db.js';
import { hashBytes, hashCanonical } from '@eapr/contracts';
import { loadVisible } from '../../scripts/load-demo.js';
import { prepareSelectedVerificationPins, upgradeVerification } from '../../scripts/prepare-verification.js';

const setupRequired = { code: 'VERIFICATION_FIXTURE_SETUP_REQUIRED' };
const conflict = { code: 'VERIFICATION_FIXTURE_CONFLICT' };

async function run() {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error('Test database is required');
  const db = createControlDb({ connectionString: url });
  const local = join(process.cwd(), '.local');
  const demo = join(local, 'demo');
  const visible = join(demo, 'visible');
  const privateRoot = join(demo, 'protected');
  const expected = ['expected-a.json', 'expected-b.json'].map(name => join(privateRoot, name));
  const selection = join(demo, 'verification-selection.json');
  const candidateDirectory = (name: string) => join(local, name);
  const fingerprint = async (path: string) => hashBytes(await readFile(path));
  const pinFingerprint = async () => {
    const store = join(local, 'protected-evaluator');
    return Promise.all((await readdir(store)).sort().map(name => fingerprint(join(store, name))));
  };
  try {
    const captures = await Promise.all((['a', 'b'] as const).map(async company => (await loadVisible(visible, company)).capture));
    const prepare = () => prepareSelectedVerificationPins({ db, captures });
    // The parent captured the visible dataset in this isolated module copy.
    // Represent old private files with harmless summary JSON before any pin exists.
    for (const file of expected) await writeFile(file, '{"legacySummary":"startup-upgrade-test-sentinel"}');
    const legacy = await Promise.all(expected.map(fingerprint));
    await assert.rejects(prepare, setupRequired);

    const blocked = candidateDirectory('symlink-parent');
    await mkdir(candidateDirectory('other'), { mode: 0o700 });
    await symlink(candidateDirectory('other'), blocked);
    for (const path of [blocked + '/child', visible + '/child', demo + '/../dotdot', join(process.cwd(), 'outside'), local]) {
      await assert.rejects(upgradeVerification(db, path), setupRequired);
    }

    const selected = await upgradeVerification(db, candidateDirectory('first-selection'));
    assert.equal(selected.length, 2);
    assert.deepEqual(await prepare(), selected);
    assert.deepEqual(await prepare(), selected);
    assert.deepEqual(await Promise.all(expected.map(fingerprint)), legacy);
    assert.equal((await lstat(selection)).mode & 0o777, 0o600);
    const first = await fingerprint(selection);
    const protectedBefore = await pinFingerprint();
    await assert.rejects(upgradeVerification(db, candidateDirectory('first-selection')), setupRequired);

    const accounts = join(visible, 'accounts-a.json');
    const oldAccounts = await readFile(accounts);
    await writeFile(accounts, '{}');
    const mismatch = candidateDirectory('mismatched-dataset');
    try {
      await assert.rejects(upgradeVerification(db, mismatch), conflict);
      assert.equal(await fingerprint(selection), first);
      assert.deepEqual(await pinFingerprint(), protectedBefore);
      assert.ok((await lstat(join(mismatch, 'generated-visible'))).isDirectory());
    } finally {
      await writeFile(accounts, oldAccounts);
    }

    const generator = join(process.cwd(), 'scripts', 'generate-fixtures.ts');
    const generatorBytes = await readFile(generator);
    await appendFile(generator, '\n// Disposable test identity change.\n');
    try {
      await assert.rejects(upgradeVerification(db, candidateDirectory('conflicting-fixture')), conflict);
      assert.equal(await fingerprint(selection), first);
      assert.deepEqual(await pinFingerprint(), protectedBefore);
    } finally {
      await writeFile(generator, generatorBytes);
    }

    assert.deepEqual(await upgradeVerification(db, candidateDirectory('second-selection')), selected);
    const backup = (await readdir(demo)).find(name => name.startsWith('verification-selection.json.backup-'));
    assert.ok(backup);
    assert.equal(await fingerprint(join(demo, backup)), first);
    assert.deepEqual(await pinFingerprint(), protectedBefore);
    assert.deepEqual(await Promise.all(expected.map(fingerprint)), legacy);

    const bytes = await readFile(selection);
    await chmod(selection, 0o644);
    await assert.rejects(prepare, setupRequired);
    await chmod(selection, 0o600);
    const moved = selection + '.test-moving';
    await rename(selection, moved);
    await symlink(moved, selection);
    try {
      await assert.rejects(prepare, setupRequired);
    } finally {
      await unlink(selection);
      await rename(moved, selection);
    }
    const bindingsMismatch = JSON.parse(bytes.toString('utf8'));
    bindingsMismatch.bindings[0].snapshotHash = hashCanonical('not-the-captured-snapshot');
    await writeFile(selection, JSON.stringify(bindingsMismatch));
    await assert.rejects(prepare, conflict);
    const outside = JSON.parse(bytes.toString('utf8'));
    outside.truthRoot = join(process.cwd(), 'outside', 'protected');
    await writeFile(selection, JSON.stringify(outside));
    await assert.rejects(prepare, setupRequired);
    await writeFile(selection, bytes);
    assert.deepEqual(await prepare(), selected);
    assert.deepEqual(await pinFingerprint(), protectedBefore);
  } finally {
    await db.end();
  }
}

try {
  await run();
  process.stdout.write('UPGRADE_FIXTURE_CASES_PASSED\n');
} catch {
  process.stderr.write('UPGRADE_FIXTURE_CASE_FAILED\n');
  process.exitCode = 1;
}
