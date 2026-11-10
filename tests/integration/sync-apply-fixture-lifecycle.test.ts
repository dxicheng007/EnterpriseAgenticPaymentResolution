import { lstat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Pool } from 'pg';
import { expect, test, vi } from 'vitest';
import { scopeValues } from '@eapr/parent/snapshots';
import { createSyncApplyFixture, type SyncApplyFixture } from '../fixtures/sync-apply.js';

type SetupStage = 'start' | 'provision' | 'owner pool' | 'migration' | 'proof';
type Faults = {
  setup?: { stage: SetupStage; error: unknown };
  end?: Error;
  drop?: Error;
  remove?: Error;
};
type ObservedPool = {
  end: () => Promise<void>;
  completion?: Promise<void>;
  ended: boolean;
  restore: () => void;
};
type Observation = {
  faults: Faults;
  root?: string;
  namespace?: string;
  pools: ObservedPool[];
  setup: SetupStage[];
  cleanup: string[];
  dropped: boolean;
  removed: boolean;
};

let active: Observation | undefined;

// Plain pass-through wrappers avoid retaining database credentials or proof results in mock history.
vi.mock(import('node:fs/promises'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    mkdtemp: (async (...args: Parameters<typeof actual.mkdtemp>) => {
      const root = await actual.mkdtemp(...args);
      if (active && typeof root === 'string' && basename(args[0]) === 'eapr-sync-apply-') active.root = root;
      return root;
    }) as typeof actual.mkdtemp,
    async rm(...args: Parameters<typeof actual.rm>) {
      const observed = active;
      if (!observed?.root || args[0] !== observed.root) return actual.rm(...args);
      observed.cleanup.push('remove root');
      if (observed.faults.remove) throw observed.faults.remove;
      await actual.rm(...args);
      observed.removed = true;
    },
  };
});

vi.mock(import('../../scripts/native-db.js'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    async startNativeDb() {
      reach('start');
      await actual.startNativeDb();
    },
    async provisionTest(namespace: string) {
      reach('provision');
      const pair = await actual.provisionTest(namespace);
      if (active) active.namespace = namespace;
      return pair;
    },
    async dropTest(namespace: string) {
      const observed = active;
      if (!observed) return actual.dropTest(namespace);
      observed.cleanup.push('drop namespace');
      if (namespace !== observed.namespace) throw new Error('Fixture attempted to drop an unowned namespace');
      await actual.dropTest(namespace);
      observed.dropped = true;
      if (observed.faults.drop) throw observed.faults.drop;
    },
  };
});

vi.mock(import('@eapr/storage/runtime-db'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRuntimeDb(options: Parameters<typeof actual.createRuntimeDb>[0]) {
      const owner = active?.pools.length === 1;
      if (owner) reach('owner pool');
      return observePool(actual.createRuntimeDb(options), owner ? 'runtime owner' : 'runtime app');
    },
  };
});

vi.mock(import('@eapr/storage/control-db'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createControlDb(options: Parameters<typeof actual.createControlDb>[0]) {
      return observePool(actual.createControlDb(options), 'control app');
    },
  };
});

vi.mock(import('../../scripts/migrate.js'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    async migrate(...args: Parameters<typeof actual.migrate>) {
      await actual.migrate(...args);
      reach('migration');
    },
  };
});

vi.mock(import('../fixtures/activation-proof.js'), async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    async issueActivationProofs(...args: Parameters<typeof actual.issueActivationProofs>) {
      const proofs = await actual.issueActivationProofs(...args);
      reach('proof');
      return proofs;
    },
  };
});

function reach(stage: SetupStage) {
  active?.setup.push(stage);
  if (active?.faults.setup?.stage === stage) throw active.faults.setup.error;
}

function observePool(pool: Pool, label: string) {
  const observed = active;
  if (!observed) return pool;
  const entry: ObservedPool = {
    end: pool.end.bind(pool),
    ended: false,
    restore: () => spy.mockRestore(),
  };
  const spy = vi.spyOn(pool, 'end').mockImplementation((async () => {
    observed.cleanup.push(label);
    if (entry.completion) throw new Error('Fixture attempted to end a pool twice');
    entry.completion = entry.end().then(() => { entry.ended = true; });
    await entry.completion;
    if (label === 'control app' && observed.faults.end) throw observed.faults.end;
  }) as Pool['end']);
  observed.pools.push(entry);
  return pool;
}

async function recoverOwned(observed: Observation) {
  const [{ rm }, { dropTest }] = await Promise.all([
    vi.importActual<typeof import('node:fs/promises')>('node:fs/promises'),
    vi.importActual<typeof import('../../scripts/native-db.js')>('../../scripts/native-db.js'),
  ]);
  // RED's Promise.all may reject while other real ends are still pending.
  const poolResults = await Promise.allSettled(observed.pools.map(async pool => {
    await (pool.completion ?? pool.end());
  }));
  const failures = poolResults.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  const { namespace, root } = observed;
  if (namespace && !observed.dropped) {
    try {
      await dropTest(namespace);
    } catch (cause) {
      failures.push(new Error('Fallback drop failed for ' + namespace, { cause }));
    }
  }
  if (root && !observed.removed) {
    try {
      await rm(root, { recursive: true, force: true });
      await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    } catch (cause) {
      failures.push(new Error('Fallback removal failed for ' + root, { cause }));
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Fixture test fallback failed');
}

async function observe(faults: Faults, run: (observed: Observation) => Promise<void>) {
  const observed: Observation = { faults, pools: [], setup: [], cleanup: [], dropped: false, removed: false };
  active = observed;
  let primaryFailure: { cause: unknown } | undefined;
  try {
    await run(observed);
  } catch (cause) {
    primaryFailure = { cause };
    throw cause;
  } finally {
    active = undefined;
    for (const pool of observed.pools) pool.restore();
    await recoverOwned(observed).catch(failure => {
      if (!primaryFailure) throw failure;
      throw new AggregateError([failure], 'Fixture test and fallback failed', primaryFailure);
    });
  }
}

async function constructionRejection(): Promise<unknown> {
  const result = await createSyncApplyFixture(6).then(
    fixture => ({ fixture } as const),
    (error: unknown) => ({ error } as const),
  );
  if ('error' in result) return result.error;
  await result.fixture.close();
  throw new Error('Expected fixture construction to reject');
}

const completeCleanup = ['control app', 'runtime owner', 'runtime app', 'drop namespace', 'remove root'];
const proofTimeout = 120_000;

async function expectRootRemoved(observed: Observation) {
  expect(observed.root).toBeDefined();
  await expect(lstat(observed.root!)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(observed.removed).toBe(true);
}

function expectPoolAndDropCleanup(observed: Observation, poolCount: number) {
  expect(observed.pools.map(pool => pool.ended)).toEqual(Array<boolean>(poolCount).fill(true));
  expect(observed.namespace).toBeDefined();
  expect(observed.dropped).toBe(true);
}

test('fixture_lifecycle_start_failure', async () => {
  const error = new Error('Injected startup failure');
  await observe({ setup: { stage: 'start', error } }, async observed => {
    expect(await constructionRejection()).toBe(error);
    expect(observed.setup).toEqual(['start']);
    expect(observed.namespace).toBeUndefined();
    expect(observed.pools).toHaveLength(0);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(['remove root']);
  });
});

test('fixture_lifecycle_provision_failure', async () => {
  const error = new Error('Injected provisioning failure');
  await observe({ setup: { stage: 'provision', error } }, async observed => {
    expect(await constructionRejection()).toBe(error);
    expect(observed.setup).toEqual(['start', 'provision']);
    expect(observed.namespace).toBeUndefined();
    expect(observed.pools).toHaveLength(0);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(['remove root']);
  });
});

test('fixture_lifecycle_partial_pool_failure', async () => {
  const error = new Error('Injected runtime owner pool failure');
  await observe({ setup: { stage: 'owner pool', error } }, async observed => {
    expect(await constructionRejection()).toBe(error);
    expect(observed.setup).toEqual(['start', 'provision', 'owner pool']);
    expectPoolAndDropCleanup(observed, 1);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(['runtime app', 'drop namespace', 'remove root']);
  });
});

test('fixture_lifecycle_migration_failure', async () => {
  const error = new Error('Injected post-migration failure');
  await observe({ setup: { stage: 'migration', error } }, async observed => {
    expect(await constructionRejection()).toBe(error);
    expect(observed.setup).toEqual(['start', 'provision', 'owner pool', 'migration']);
    expectPoolAndDropCleanup(observed, 3);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(completeCleanup);
  });
});

const originalCause = new Error('Original cause');
test.each([
  { name: 'Error', error: new Error('Injected post-proof failure', { cause: originalCause }) },
  { name: 'frozen non-Error', error: Object.freeze({ stage: 'proof' }) },
])('fixture_lifecycle_proof_failure_and_cleanup_failures ($name)', async ({ error }) => {
  const end = new Error('Injected rejection after pool end');
  const drop = new Error('Injected rejection after namespace drop');
  const remove = new Error('Injected root removal failure');
  await observe({ setup: { stage: 'proof', error }, end, drop, remove }, async observed => {
    const rejected = await constructionRejection();
    expect(observed.setup).toEqual(['start', 'provision', 'owner pool', 'migration', 'proof']);
    expect.soft(observed.cleanup).toEqual(completeCleanup);
    expect.soft(observed.pools.map(pool => pool.ended)).toEqual([true, true, true]);
    expect.soft(observed.dropped).toBe(true);
    expect.soft(observed.removed).toBe(false);
    expect((await lstat(observed.root!)).isDirectory()).toBe(true);
    expect(rejected).toBeInstanceOf(AggregateError);
    const aggregate = rejected as AggregateError;
    expect(aggregate.cause).toBe(error);
    expect(aggregate.errors).toHaveLength(3);
    [end, drop, remove].forEach((failure, index) => expect(aggregate.errors[index]).toBe(failure));
    if (error instanceof Error) expect(error.cause).toBe(originalCause);
  });
}, proofTimeout);

async function expectCommittedA5({ db, identity, stored }: SyncApplyFixture) {
  const { accountId, companyId, sellerEntityId } = identity.scope;
  const imports = await db.query(`
    SELECT account_id, company_id, seller_entity_id, activation_id, receipt_id, bundle_hash
    FROM runtime_activation_imports
  `);
  expect(imports.rows).toEqual([{
    account_id: accountId, company_id: companyId, seller_entity_id: sellerEntityId,
    activation_id: identity.activationId, receipt_id: stored.receipt.id, bundle_hash: identity.bundleHash,
  }]);
  const { rows: [counts] } = await db.query<{ targets: number; financial: number }>(`
    SELECT (SELECT count(*)::int FROM parent_targets
      WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3) AS targets,
      (SELECT count(*)::int FROM parent_financial_records
      WHERE account_id = $1 AND company_id = $2 AND seller_entity_id = $3) AS financial
  `, scopeValues(identity.scope));
  expect(counts?.targets).toBeGreaterThan(0);
  expect(counts?.financial).toBeGreaterThan(0);
}

test('fixture_lifecycle_genuine_A5_close_twice', async () => {
  await observe({}, async observed => {
    const fixture = await createSyncApplyFixture(6);
    await expectCommittedA5(fixture);
    const first = fixture.close();
    const overlapping = fixture.close();
    await Promise.all([first, overlapping]);
    expect(overlapping).toBe(first);
    expect(fixture.close()).toBe(first);
    expectPoolAndDropCleanup(observed, 3);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(completeCleanup);
  });
}, proofTimeout);

test('fixture_lifecycle_normal_close_failure_is_shared', async () => {
  const end = new Error('Injected rejection after pool end');
  await observe({ end }, async observed => {
    const fixture = await createSyncApplyFixture(6);
    await expectCommittedA5(fixture);
    const first = fixture.close();
    const overlapping = fixture.close();
    const [outcome] = await Promise.allSettled([first, overlapping]);
    expect(overlapping).toBe(first);
    expect(fixture.close()).toBe(first);
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') throw new Error('Expected fixture close to reject');
    expect(outcome.reason).toBeInstanceOf(AggregateError);
    expect(outcome.reason.errors).toHaveLength(1);
    expect(outcome.reason.errors[0]).toBe(end);
    expectPoolAndDropCleanup(observed, 3);
    await expectRootRemoved(observed);
    expect(observed.cleanup).toEqual(completeCleanup);
  });
}, proofTimeout);
