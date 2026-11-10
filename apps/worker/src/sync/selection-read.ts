import type { PoolClient, QueryResultRow } from 'pg';
import {
  CommittedAuthorityIdentityV1Schema, FinancialKindSchema, HashSchema, IdSchema, IsoInstantSchema,
  canonicalJson, hashCanonical, hashProfile, hashTargetSnapshot,
  type CommittedAuthorityIdentityV1, type Hash, type Scope,
} from '@eapr/contracts';
import { financialRecords, sameScope } from '@eapr/finance/validate';
import {
  encodeCanonical, readStoredTarget, readVersion, scopeOf, scopeValues, type ScopeRow, type StoredTarget,
} from '@eapr/parent/snapshots';
import { compare, equal, selectedProfile } from '../activation-validation.js';
import { readAuthoritySnapshotInTransaction } from './current-authority-store.js';
import type {
  CutSummary, EvidenceFamily, IncompleteReason, SelectionEvidence, SelectionInput,
  SelectionReadResult, SelectionReadSummary, SelectionSubject,
} from './selection.js';

const importColumns = [
  'activation', 'bundle', 'plan', 'planner_target', 'receipt', 'recorded_target', 'request', 'reviewer',
] as const;

const physicalTables = {
  runtime_activation_imports: { family: 'import', keys: 1, columns: importColumns },
  runtime_authority_heads: { family: 'authority', keys: 1, columns: ['grant_canonical'] },
  parent_targets: { family: 'target', keys: 1, columns: [] },
  parent_snapshots: { family: 'target', keys: 2, columns: ['canonical'] },
  parent_financial_records: { family: 'financial', keys: 1, columns: ['canonical'] },
  parent_metadata: { family: 'metadata', keys: 3, columns: ['canonical'] },
  runtime_capture_lanes: { family: 'lane', keys: 2, columns: ['capture_canonical', 'manifest_canonical'] },
  runtime_capture_checkpoints: { family: 'checkpoint', keys: 3, columns: [] },
  runtime_source_positions: { family: 'position', keys: 3, columns: [] },
  runtime_deliveries: { family: 'delivery', keys: 2, columns: ['canonical'] },
  runtime_capture_pages: { family: 'page', keys: 4, columns: ['canonical'] },
  runtime_inbox: { family: 'inbox', keys: 4, columns: [] },
  runtime_capture_incidents: { family: 'incident', keys: 4, columns: ['source_ids_canonical'] },
  runtime_sync_units: { family: 'unit', keys: 1, columns: ['audit'] },
  runtime_sync_event_outcomes: { family: 'outcome', keys: 2, columns: ['canonical'] },
  runtime_delivery_outcomes: { family: 'outcome', keys: 2, columns: [] },
  runtime_sync_delivery_outcomes: { family: 'outcome', keys: 2, columns: [] },
  runtime_sync_receipts: { family: 'receipt', keys: 1, columns: ['plan', 'receipt'] },
  runtime_financial_origins: { family: 'origin', keys: 1, columns: [] },
  runtime_economic_outcomes: { family: 'origin', keys: 4, columns: [] },
  runtime_sync_economic_outcomes: { family: 'origin', keys: 1, columns: [] },
  runtime_sync_application_heads: { family: 'application_head', keys: 4, columns: [] },
} as const satisfies Record<string, { family: EvidenceFamily; keys: number; columns: readonly string[] }>;

const graphDomains = {
  runtime_activation_imports: 'import',
  parent_snapshots: 'target',
  runtime_capture_pages: 'page',
  runtime_inbox: 'inbox',
  runtime_capture_incidents: 'incident',
  runtime_sync_units: 'unit',
  runtime_sync_event_outcomes: 'outcome',
  runtime_delivery_outcomes: 'outcome',
  runtime_sync_delivery_outcomes: 'outcome',
  runtime_sync_application_heads: 'application_head',
  logical_receipts: 'receipt',
} as const;

type SelectionCause = CutSummary['causes'][number];
type SelectionReadTable = keyof typeof physicalTables;
type SelectionCanonicalColumn = typeof physicalTables[SelectionReadTable]['columns'][number];
type PhysicalRow = { table: SelectionReadTable; key: readonly string[]; family: EvidenceFamily };
type PhysicalValue = { row: PhysicalRow; column: SelectionCanonicalColumn; bytes: number; digest: Hash };
type SelectionCountDomain =
  | { kind: 'enrollment' }
  | { kind: 'lanes' }
  | { kind: 'streams' }
  | { kind: 'ongoing_deliveries' }
  | { kind: 'source_originals' }
  | { kind: 'target_records'; owner: readonly string[] }
  | { kind: 'family'; family: EvidenceFamily; domain: string };

const targetArrays = [
  'invoices', 'payments', 'credits', 'allocations', 'reversals', 'customers', 'accounts', 'billingConfigurations',
] as const;
type TargetCounts = Readonly<Record<typeof targetArrays[number], number>>;

export type SelectionReadAdmission = {
  observeRows(rows: readonly PhysicalRow[]): void;
  observeCount(domain: SelectionCountDomain, keys: readonly (readonly string[])[], cause: SelectionCause): void;
  admitValues(values: readonly PhysicalValue[], cause: SelectionCause): void;
  admitTargetCardinality(value: Pick<PhysicalValue, 'row' | 'column'>, counts: TargetCounts, cause: SelectionCause): void;
  snapshot(): SelectionReadSummary;
};
export type SelectionReadContext = { admission: SelectionReadAdmission; assertActive(): void };

const maxEnrollment = 8;
const maxGraphRows = 1_000;
const maxTargetRecords = 10_000;
const maxValueBytes = 1_048_576;
const maxCanonicalBytes = 16_777_216;
const rootDomains = {
  enrollment: { cap: maxEnrollment, keys: 1 },
  lanes: { cap: 8, keys: 2 },
  streams: { cap: 32, keys: 3 },
  ongoing_deliveries: { cap: 1_000, keys: 2 },
  source_originals: { cap: 1_000, keys: 1 },
} as const;

class SelectionReadLimit extends Error {
  constructor(readonly cause: SelectionCause) { super('Selection read limit reached'); }
}

class SelectionReadStorageError extends Error {
  readonly code = 'SELECTION_STORAGE_INVALID';
  constructor() { super('Selection storage is inconsistent'); }
}

function requireStorage(condition: unknown): asserts condition {
  if (!condition) throw new SelectionReadStorageError();
}

function parseStorage<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new SelectionReadStorageError();
  }
}

function validKey(key: readonly string[], length: number) {
  return key.length === length && key.every(part => IdSchema.safeParse(part).success);
}

function rowKey(row: PhysicalRow) {
  requireStorage(Object.hasOwn(physicalTables, row.table));
  const table = physicalTables[row.table];
  requireStorage(table.family === row.family && validKey(row.key, table.keys));
  return JSON.stringify([row.table, ...row.key]);
}

function valueKey({ row, column }: Pick<PhysicalValue, 'row' | 'column'>) {
  const key = rowKey(row);
  requireStorage((physicalTables[row.table].columns as readonly string[]).includes(column));
  return JSON.stringify([key, column]);
}

function countDomain(domain: SelectionCountDomain) {
  if (domain.kind === 'target_records') {
    requireStorage(validKey(domain.owner, 3));
    return {
      name: JSON.stringify([domain.kind, ...domain.owner]), cap: maxTargetRecords,
      accepts: (key: readonly string[]) => key[0] === 'parent_metadata'
        ? validKey(key, 4) && key[1] === domain.owner[0] : key[0] === 'parent_financial_records' && validKey(key, 2),
    };
  }
  if (domain.kind === 'family') {
    requireStorage(Object.hasOwn(graphDomains, domain.domain));
    const tag = domain.domain as keyof typeof graphDomains;
    requireStorage(graphDomains[tag] === domain.family);
    return {
      name: tag, cap: maxGraphRows, accepts: (key: readonly string[]) => tag === 'logical_receipts'
        ? (key[0] === 'initial' && validKey(key, 3)) || (key[0] === 'sync' && validKey(key, 2))
        : validKey(key, physicalTables[tag].keys),
    };
  }
  requireStorage(Object.hasOwn(rootDomains, domain.kind));
  const { cap, keys } = rootDomains[domain.kind];
  return { name: domain.kind, cap, accepts: (key: readonly string[]) => validKey(key, keys) };
}

function checkedSize(value: unknown): asserts value is number {
  requireStorage(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

export function createSelectionReadAdmission(): SelectionReadAdmission {
  const observed = new Set<string>();
  const domains = new Map<string, Set<string>>();
  const values = new Map<string, { bytes: number; digest: Hash }>();
  const targetSizes = new Map<string, number[]>();
  const counts: SelectionReadSummary['counts'] = {};
  let canonicalBytes = 0;
  return {
    observeRows(rows) {
      for (const row of rows) {
        const key = rowKey(row);
        if (observed.has(key)) continue;
        observed.add(key);
        counts[row.family] = (counts[row.family] ?? 0) + 1;
      }
    },
    observeCount(domain, keys, cause) {
      const { name, cap, accepts } = countDomain(domain);
      const set = domains.get(name) ?? new Set<string>();
      domains.set(name, set);
      for (const key of keys) {
        requireStorage(accepts(key));
        set.add(JSON.stringify(key));
        if (set.size > cap) throw new SelectionReadLimit({ ...cause, reason: 'limit' });
      }
    },
    admitValues(entries, cause) {
      for (const value of entries) {
        const key = valueKey(value);
        requireStorage(observed.has(rowKey(value.row)) && HashSchema.safeParse(value.digest).success);
        checkedSize(value.bytes);
        const previous = values.get(key);
        if (previous) {
          requireStorage(previous.bytes === value.bytes && previous.digest === value.digest);
          continue;
        }
        if (value.bytes > maxValueBytes || canonicalBytes + value.bytes > maxCanonicalBytes) {
          throw new SelectionReadLimit({ ...cause, reason: 'limit' });
        }
        values.set(key, { bytes: value.bytes, digest: value.digest });
        canonicalBytes += value.bytes;
      }
    },
    admitTargetCardinality(value, countsByArray, cause) {
      const key = valueKey(value);
      requireStorage(values.has(key) && (value.row.table === 'parent_snapshots' ||
        (value.row.table === 'runtime_activation_imports' && ['recorded_target', 'planner_target'].includes(value.column))));
      const sizes = targetArrays.map(field => countsByArray[field]);
      let count = 0;
      for (const size of sizes) {
        checkedSize(size);
        count += size;
        checkedSize(count);
      }
      const previous = targetSizes.get(key);
      requireStorage(previous === undefined || previous.every((size, index) => size === sizes[index]));
      if (count > maxTargetRecords) throw new SelectionReadLimit({ ...cause, reason: 'limit' });
      targetSizes.set(key, sizes);
    },
    snapshot: () => ({ counts: { ...counts }, canonicalBytes }),
  };
}

type CatalogSubject = Omit<SelectionSubject, 'origins' | 'units' | 'outcomes' | 'heads'>;
export type SelectionCatalogResult = { subjects: CatalogSubject[]; evidence: SelectionEvidence[]; boundedFacts: CutSummary } |
  Extract<SelectionReadResult, { kind: 'incomplete' }>;

type ImportColumn = typeof importColumns[number];
type ImportPins = ScopeRow & {
  idempotency_key: string; activation_id: string; receipt_id: string; bundle_hash: string; plan_hash: string;
  recorded_snapshot_hash: string; planner_snapshot_hash: string; approved_snapshot_hash: string; target_version: string;
  capture_source_ref: string; capture_manifest_hash: string;
};
type ImportLengths = ImportPins & Record<`${ImportColumn}_digest`, string> & Record<`${ImportColumn}_bytes`, number>;
type HeadRow = ScopeRow & {
  initial_import_key: string; initial_receipt_id: string; grant_digest: string; status: string; epoch: string;
  changed_at: string; bytes: number;
};
type PointerRow = ScopeRow & { target_version: string; snapshot_hash: string };
type SnapshotRow = PointerRow & { recorded_as_of: string; digest: string; bytes: number };
type MetadataRow = ScopeRow & {
  family: string; record_id: string; customer_id: string | null; has_customer: boolean; digest: string; bytes: number;
};
type FinancialRow = ScopeRow & {
  record_id: string; source_ref: string; kind: string; source_record_id: string; source_record_version: string;
  event_id: string; digest: string; bytes: number;
};
type ReadRows = <Row extends QueryResultRow>(sql: string, values: unknown[]) => Promise<Row[]>;

function catalogCause(reason: IncompleteReason, family: EvidenceFamily | null = null,
  identity: CommittedAuthorityIdentityV1 | null = null): SelectionCause {
  return { reason, identity, lane: null, streamId: null, event: null, family };
}

function catalogFacts(context: SelectionReadContext, causes: SelectionCause[] = []): CutSummary {
  return { ...context.admission.snapshot(), sourceContractChecksComplete: false, sourceContractObservations: [], causes };
}

function incompleteCatalog(context: SelectionReadContext, cause: SelectionCause): SelectionCatalogResult {
  return { kind: 'incomplete', reason: cause.reason, boundedFacts: catalogFacts(context, [cause]) };
}

function physicalRow(table: SelectionReadTable, key: string[]): PhysicalRow {
  return { table, key, family: physicalTables[table].family };
}

function observeRows<T>(admission: SelectionReadAdmission, table: SelectionReadTable, rows: readonly T[],
  keyOf: (row: T) => string[]) {
  const physical = rows.map(row => physicalRow(table, keyOf(row)));
  admission.observeRows(physical);
  return physical;
}

function boundedText(column: string, alias = column, bytes = 160) {
  return `CASE WHEN octet_length(${column}) <= ${bytes} THEN ${column} END AS ${alias}`;
}

const importPins = [
  'account_id', 'company_id', 'seller_entity_id', boundedText('idempotency_key'), boundedText('activation_id'),
  boundedText('receipt_id'), 'bundle_hash', 'plan_hash', 'recorded_snapshot_hash', 'planner_snapshot_hash',
  'approved_snapshot_hash', 'target_version', boundedText('capture_source_ref'),
  boundedText('capture_manifest_hash', 'capture_manifest_hash', 64),
].join(', ');

function validateImportPins(row: ImportPins, input: SelectionInput) {
  return parseStorage(() => {
    const identity = CommittedAuthorityIdentityV1Schema.parse({
      scope: scopeOf(row), activationId: row.activation_id, bundleHash: row.bundle_hash,
    });
    for (const field of [row.idempotency_key, row.receipt_id, row.capture_source_ref]) IdSchema.parse(field);
    for (const field of [row.plan_hash, row.recorded_snapshot_hash, row.planner_snapshot_hash,
      row.approved_snapshot_hash, row.capture_manifest_hash]) HashSchema.parse(field);
    requireStorage(row.capture_source_ref === input.sourceRef);
    readVersion(row.target_version);
    return identity;
  });
}

function observeCatalogImportValues(admission: SelectionReadAdmission, row: ImportLengths, physical: PhysicalRow,
  identity: CommittedAuthorityIdentityV1) {
  const values = importColumns.map(column => ({
    row: physical, column, bytes: row[`${column}_bytes`], digest: row[`${column}_digest`],
  }));
  admission.admitValues(values, catalogCause('limit', 'import', identity));
  return values.map(({ column, bytes, digest }) => ({ column, bytes, digest }));
}

function validateScope(row: ScopeRow, scope: Scope) {
  requireStorage(sameScope(parseStorage(() => scopeOf(row)), scope));
}

async function readTargetScalars(read: ReadRows, admission: SelectionReadAdmission, pins: ImportPins,
  identity: CommittedAuthorityIdentityV1) {
  const { scope } = identity;
  const { accountId } = scope;
  const headRows = await read<HeadRow>(`SELECT account_id, company_id, seller_entity_id, initial_import_key,
    initial_receipt_id, status, epoch, changed_at, grant_digest, octet_length(grant_canonical) AS bytes
    FROM runtime_authority_heads WHERE account_id = $1`, [accountId]);
  const heads = observeRows(admission, 'runtime_authority_heads', headRows, row => [row.account_id]);
  requireStorage(headRows.length <= 1);
  const head = headRows[0];
  if (head) {
    validateScope(head, scope);
    requireStorage(head.initial_import_key === pins.idempotency_key && head.initial_receipt_id === pins.receipt_id &&
      ['active', 'paused', 'revoked'].includes(head.status) && parseStorage(() => readVersion(head.epoch)) > 0 &&
      IsoInstantSchema.safeParse(head.changed_at).success);
    admission.admitValues([{ row: heads[0]!, column: 'grant_canonical', bytes: head.bytes, digest: head.grant_digest }],
      catalogCause('limit', 'authority', identity));
  }

  const pointers = await read<PointerRow>(`SELECT account_id, company_id, seller_entity_id, target_version, snapshot_hash
    FROM parent_targets WHERE account_id = $1`, [accountId]);
  observeRows(admission, 'parent_targets', pointers, row => [row.account_id]);
  requireStorage(pointers.length === 1);
  const pointer = pointers[0]!;
  validateScope(pointer, scope);
  requireStorage(HashSchema.safeParse(pointer.snapshot_hash).success &&
    parseStorage(() => readVersion(pointer.target_version)) >= parseStorage(() => readVersion(pins.target_version)));

  const hashes = [...new Set([pins.approved_snapshot_hash, pointer.snapshot_hash])];
  const snapshots = await read<SnapshotRow>(`SELECT account_id, company_id, seller_entity_id, snapshot_hash,
    target_version, recorded_as_of, digest, octet_length(canonical) AS bytes
    FROM parent_snapshots WHERE account_id = $1 AND snapshot_hash = ANY($2::text[]) ORDER BY snapshot_hash`,
  [accountId, hashes]);
  const snapshotKeys = observeRows(admission, 'parent_snapshots', snapshots, row => [row.account_id, row.snapshot_hash]);
  const snapshotCause = catalogCause('limit', 'target', identity);
  admission.observeCount({ kind: 'family', family: 'target', domain: 'parent_snapshots' },
    snapshotKeys.map(row => row.key), snapshotCause);
  requireStorage(snapshots.length === hashes.length && new Set(snapshots.map(row => row.snapshot_hash)).size === hashes.length);
  for (const [index, snapshot] of snapshots.entries()) {
    validateScope(snapshot, scope);
    const hash = snapshot.snapshot_hash;
    requireStorage(hashes.includes(hash) && IsoInstantSchema.safeParse(snapshot.recorded_as_of).success &&
      (hash !== pins.approved_snapshot_hash || snapshot.target_version === pins.target_version) &&
      (hash !== pointer.snapshot_hash || snapshot.target_version === pointer.target_version));
    admission.admitValues([{ row: snapshotKeys[index]!, column: 'canonical', bytes: snapshot.bytes, digest: snapshot.digest }],
      snapshotCause);
  }

  const metadata = await read<MetadataRow>(`SELECT m.account_id, m.company_id, m.seller_entity_id, m.family,
    ${boundedText('m.record_id', 'record_id')}, ${boundedText('m.customer_id', 'customer_id')},
    m.customer_id IS NOT NULL AS has_customer, m.digest, octet_length(m.canonical) AS bytes
    FROM parent_metadata m WHERE m.account_id = $1 ORDER BY m.family, m.record_id LIMIT ${maxTargetRecords + 1}`, [accountId]);
  const metadataKeys = observeRows(admission, 'parent_metadata', metadata, row => [row.account_id, row.family, row.record_id]);
  const targetDomain = { kind: 'target_records', owner: scopeValues(scope) } as const;
  const metadataCause = catalogCause('limit', 'metadata', identity);
  admission.observeCount(targetDomain, metadataKeys.map(row => [row.table, ...row.key]), metadataCause);
  for (const [index, row] of metadata.entries()) {
    validateScope(row, scope);
    requireStorage(['customer', 'account', 'billing_configuration'].includes(row.family) &&
      row.has_customer === (row.family === 'account') &&
      (row.has_customer ? IdSchema.safeParse(row.customer_id).success : row.customer_id === null));
    admission.admitValues([{ row: metadataKeys[index]!, column: 'canonical', bytes: row.bytes, digest: row.digest }],
      metadataCause);
  }

  const financial = await read<FinancialRow>(`SELECT f.account_id, f.company_id, f.seller_entity_id,
    ${boundedText('f.record_id', 'record_id')}, ${boundedText('f.source_ref', 'source_ref')}, f.kind,
    ${boundedText('f.source_record_id', 'source_record_id')}, f.source_record_version, ${boundedText('f.event_id', 'event_id')},
    f.digest, octet_length(f.canonical) AS bytes FROM parent_financial_records f
    WHERE (f.account_id, f.company_id, f.seller_entity_id) = ($1,$2,$3)
    ORDER BY f.source_ref, f.kind, f.source_record_id, f.record_id LIMIT $4`,
  [...scopeValues(scope), maxTargetRecords + 1 - metadata.length]);
  const financialKeys = observeRows(admission, 'parent_financial_records', financial, row => [row.record_id]);
  const financialCause = catalogCause('limit', 'financial', identity);
  admission.observeCount(targetDomain, financialKeys.map(row => [row.table, ...row.key]), financialCause);
  for (const [index, row] of financial.entries()) {
    validateScope(row, scope);
    requireStorage(FinancialKindSchema.safeParse(row.kind).success &&
      [row.source_ref, row.source_record_id, row.event_id].every(value => IdSchema.safeParse(value).success) &&
      parseStorage(() => readVersion(row.source_record_version)) > 0);
    admission.admitValues([{ row: financialKeys[index]!, column: 'canonical', bytes: row.bytes, digest: row.digest }],
      financialCause);
  }
  return { head, pointer, snapshots, metadata, financial };
}

type CatalogScalars = Awaited<ReturnType<typeof readTargetScalars>>;
const arrayCounts = targetArrays.map(field => `CASE WHEN jsonb_typeof(projected.target->'${field}') = 'array'
  THEN jsonb_array_length(projected.target->'${field}') END AS "${field}"`).join(', ');

async function admitTargetSizes(read: ReadRows, admission: SelectionReadAdmission, pins: ImportPins,
  identity: CommittedAuthorityIdentityV1, snapshots: SnapshotRow[]) {
  // OFFSET 0 shares one bounded server-side projection across the eight scalar counts.
  const columns = await read<TargetCounts & { column_name: string }>(`SELECT v.column_name, ${arrayCounts}
    FROM runtime_activation_imports i
    CROSS JOIN LATERAL (VALUES ('planner_target', i.planner_target), ('recorded_target', i.recorded_target)) v(column_name, body)
    CROSS JOIN LATERAL (SELECT parent_index_projection(v.body) AS target OFFSET 0) projected
    WHERE i.idempotency_key = $1 ORDER BY v.column_name`, [pins.idempotency_key]);
  const importRow = physicalRow('runtime_activation_imports', [pins.idempotency_key]);
  requireStorage(columns.length === 2 && columns[0]?.column_name === 'planner_target' &&
    columns[1]?.column_name === 'recorded_target');
  admission.admitTargetCardinality({ row: importRow, column: 'planner_target' }, columns[0]!,
    catalogCause('limit', 'import', identity));
  admission.admitTargetCardinality({ row: importRow, column: 'recorded_target' }, columns[1]!,
    catalogCause('limit', 'import', identity));

  const counted = await read<TargetCounts & { snapshot_hash: string }>(`SELECT s.snapshot_hash, ${arrayCounts}
    FROM parent_snapshots s
    CROSS JOIN LATERAL (SELECT parent_index_projection(s.canonical) AS target OFFSET 0) projected
    WHERE s.account_id = $1 AND s.snapshot_hash = ANY($2::text[]) ORDER BY s.snapshot_hash`,
  [pins.account_id, snapshots.map(row => row.snapshot_hash)]);
  requireStorage(counted.length === snapshots.length);
  for (const [index, row] of counted.entries()) {
    requireStorage(row.snapshot_hash === snapshots[index]!.snapshot_hash);
    const physical = physicalRow('parent_snapshots', [pins.account_id, row.snapshot_hash]);
    admission.admitTargetCardinality({ row: physical, column: 'canonical' }, row, catalogCause('limit', 'target', identity));
  }
}

async function decodeAdmitted<T>(client: PoolClient, context: SelectionReadContext, decode: (reader: PoolClient) => Promise<T>) {
  context.assertActive();
  // The accepted readers combine queries with strict validation. Keep the original query
  // failure even if a decoder translates it. Task 8 owns deadline and transport classification.
  let queryFailure: { error: unknown } | undefined;
  const reader = new Proxy(client, {
    get(target, key, receiver) {
      if (key !== 'query') return Reflect.get(target, key, receiver);
      return async (sql: string, values?: unknown[]) => {
        try {
          return await (values === undefined ? target.query(sql) : target.query(sql, values));
        } catch (error) {
          queryFailure = { error };
          throw error;
        }
      };
    },
  });
  let decoded: T;
  try {
    decoded = await decode(reader);
  } catch {
    if (queryFailure) throw queryFailure.error;
    throw new SelectionReadStorageError();
  }
  context.assertActive();
  return decoded;
}

function snapshotReference(snapshot: SnapshotRow, target: StoredTarget): SelectionEvidence {
  requireStorage(target.digest === snapshot.digest && target.snapshotHash === snapshot.snapshot_hash &&
    target.records.version === parseStorage(() => readVersion(snapshot.target_version)) &&
    target.records.asOf === snapshot.recorded_as_of);
  return { family: 'target', key: ['parent_snapshots', snapshot.account_id, snapshot.snapshot_hash],
    bytes: snapshot.bytes, digest: snapshot.digest };
}

function checkCommittedPins(pins: ImportPins, identity: CommittedAuthorityIdentityV1,
  { stored, state, command }: Awaited<ReturnType<typeof readAuthoritySnapshotInTransaction>>, head: HeadRow | undefined) {
  const { request, bundle, plan, activation, receipt } = stored;
  const { manifest, artifact, profiles } = bundle;
  const selected = parseStorage(() => selectedProfile(bundle));
  const profileHashes = profiles.map(profile => profile.hash).sort();
  requireStorage(command === null && equal(state.identity, identity) && sameScope(activation.scope, identity.scope) &&
    activation.id === pins.activation_id && request.idempotencyKey === pins.idempotency_key && receipt.id === pins.receipt_id &&
    stored.bundleHash === pins.bundle_hash && plan.hash === pins.plan_hash &&
    hashTargetSnapshot(stored.recordedTarget) === pins.recorded_snapshot_hash &&
    hashTargetSnapshot(stored.plannerTarget) === pins.planner_snapshot_hash &&
    stored.approvedTarget.snapshotHash === pins.approved_snapshot_hash &&
    stored.approvedTarget.records.version === parseStorage(() => readVersion(pins.target_version)) &&
    state.artifactHash === activation.artifactHash && state.profileHash === activation.profileHash &&
    state.sourceRef === pins.capture_source_ref && state.manifestHash === pins.capture_manifest_hash &&
    activation.manifestHash === manifest.hash && manifest.hash === pins.capture_manifest_hash &&
    artifact.sourceRef === manifest.sourceRef && artifact.normalizedPlan.sourceRef === manifest.sourceRef &&
    manifest.sourceRef === pins.capture_source_ref &&
    selected.hash === activation.profileHash && sameScope(selected.scope, identity.scope) &&
    new Set(profiles.map(profile => profile.id)).size === profiles.length &&
    new Set(profileHashes).size === profiles.length && equal(profileHashes, [...artifact.requiredProfileHashes].sort()) &&
    profiles.every(profile => profile.hash === hashProfile(profile) && profile.sourceRef === manifest.sourceRef &&
      profile.scope.companyId === manifest.companyId));
  if (head) {
    requireStorage(head.status === state.status && parseStorage(() => readVersion(head.epoch)) === state.epoch &&
      head.changed_at === state.changedAt);
  } else {
    requireStorage(state.status === 'active' && state.epoch === 1 && state.changedAt === activation.approvedAt);
  }
}

async function checkRelationalTarget(read: ReadRows, scalars: CatalogScalars, target: StoredTarget, evidence: SelectionEvidence[]) {
  const { scope, customers, accounts, billingConfigurations } = target.records;
  const { metadata, financial } = scalars;
  const metadataByKey = new Map<string, { record: object; customer: string | null }>([
    ...customers.map(record => [JSON.stringify(['customer', record.id]), { record, customer: null }] as const),
    ...accounts.map(record => [JSON.stringify(['account', record.id]), { record, customer: record.parentCustomerId }] as const),
    ...billingConfigurations.map(record => [JSON.stringify(['billing_configuration', record.id]), { record, customer: null }] as const),
  ]);
  const financialById = new Map(financialRecords(target.records).map(record => [record.id, record]));
  requireStorage(metadata.length === metadataByKey.size && financial.length === financialById.size);
  if (metadata.length) {
    const rows = await read<{ family: string; record_id: string; canonical: string }>(`SELECT family, record_id, canonical
      FROM parent_metadata WHERE account_id = $1 AND (family, record_id) IN (SELECT * FROM unnest($2::text[], $3::text[]))
      ORDER BY family, record_id`, [scope.accountId, metadata.map(row => row.family), metadata.map(row => row.record_id)]);
    requireStorage(rows.length === metadata.length);
    for (const [index, row] of rows.entries()) {
      const scalar = metadata[index]!;
      const key = JSON.stringify([row.family, row.record_id]);
      const expected = metadataByKey.get(key);
      requireStorage(expected && row.family === scalar.family && row.record_id === scalar.record_id &&
        expected.customer === scalar.customer_id);
      const [canonical, digest] = encodeCanonical(expected.record);
      requireStorage(row.canonical === canonical && scalar.digest === digest && Buffer.byteLength(canonical) === scalar.bytes);
      metadataByKey.delete(key);
      evidence.push({ family: 'metadata', key: [scope.accountId, row.family, row.record_id], digest, bytes: scalar.bytes });
    }
  }
  if (financial.length) {
    const rows = await read<{ record_id: string; canonical: string }>(`SELECT record_id, canonical FROM parent_financial_records
      WHERE record_id = ANY($1::text[]) ORDER BY record_id`, [financial.map(row => row.record_id)]);
    requireStorage(rows.length === financial.length);
    const byId = new Map(rows.map(row => [row.record_id, row.canonical]));
    for (const scalar of financial) {
      const expected = financialById.get(scalar.record_id);
      requireStorage(expected && expected.identity.sourceRef === scalar.source_ref && expected.kind === scalar.kind &&
        expected.identity.recordId === scalar.source_record_id && expected.sourceEventId === scalar.event_id &&
        expected.sourceRecordVersion === parseStorage(() => readVersion(scalar.source_record_version)));
      const [canonical, digest] = encodeCanonical(expected);
      requireStorage(byId.get(scalar.record_id) === canonical && scalar.digest === digest &&
        Buffer.byteLength(canonical) === scalar.bytes);
      financialById.delete(scalar.record_id);
      evidence.push({ family: 'financial', key: [scalar.record_id], digest, bytes: scalar.bytes });
    }
  }
}

export async function readSelectionCatalog(
  client: PoolClient, input: SelectionInput, context: SelectionReadContext,
): Promise<SelectionCatalogResult> {
  const { admission } = context;
  const read: ReadRows = async <Row extends QueryResultRow>(sql: string, values: unknown[]) => {
    context.assertActive();
    const { rows } = await client.query<Row>(sql, values);
    context.assertActive();
    return rows;
  };

  try {
    const roots = await read<ImportPins>(`SELECT ${importPins} FROM runtime_activation_imports
      WHERE capture_source_ref = $1 ORDER BY account_id LIMIT ${maxEnrollment + 1}`, [input.sourceRef]);
    const imports = observeRows(admission, 'runtime_activation_imports', roots, row => [row.idempotency_key]);
    const importCause = catalogCause('limit', 'import');
    const keys = imports.map(row => row.key);
    admission.observeCount({ kind: 'enrollment' }, keys, importCause);
    if (!roots.length) return incompleteCatalog(context, catalogCause('no_committed_subjects'));
    const identities = roots.map(row => validateImportPins(row, input));
    admission.observeCount({ kind: 'family', family: 'import', domain: 'runtime_activation_imports' }, keys, importCause);
    admission.observeCount({ kind: 'family', family: 'receipt', domain: 'logical_receipts' },
      roots.map(row => ['initial', row.idempotency_key, row.receipt_id]), catalogCause('limit', 'receipt'));

    const lengths = await read<ImportLengths>(`SELECT ${importPins}, ${importColumns.flatMap(column =>
      [`${column}_digest`, `octet_length(${column}) AS ${column}_bytes`]).join(', ')}
      FROM runtime_activation_imports WHERE idempotency_key = ANY($1::text[]) ORDER BY account_id`,
    [roots.map(row => row.idempotency_key)]);
    requireStorage(lengths.length === roots.length);
    const importValues = lengths.map((row, index) => {
      const pins = roots[index]!;
      requireStorage(Object.entries(pins).every(([key, value]) => row[key as keyof ImportPins] === value));
      return observeCatalogImportValues(admission, row, imports[index]!, identities[index]!);
    });

    const scalars: CatalogScalars[] = [];
    for (const [index, pins] of roots.entries()) {
      scalars.push(await readTargetScalars(read, admission, pins, identities[index]!));
    }
    for (const [index, pins] of roots.entries()) {
      await admitTargetSizes(read, admission, pins, identities[index]!, scalars[index]!.snapshots);
    }

    const subjects: CatalogSubject[] = [];
    const evidence: SelectionEvidence[] = [];
    for (const [index, pins] of roots.entries()) {
      const identity = identities[index]!;
      const scalar = scalars[index]!;
      const { pointer, snapshots, head } = scalar;
      const resolved = await decodeAdmitted(client, context, reader => readAuthoritySnapshotInTransaction(reader, identity));
      checkCommittedPins(pins, identity, resolved, head);
      const { stored, state: authority } = resolved;
      const columns = importValues[index]!;
      requireStorage(stored.requestHash === lengths[index]!.request_digest);
      const { manifest, artifact } = stored.bundle;
      if (artifact.normalizedPlan.capture.some(stream => stream.transport === 'csv') ||
          manifest.files.some(file => file.kind === 'event_csv')) {
        return incompleteCatalog(context, catalogCause('unsupported_transport', 'import', identity));
      }

      const approved = stored.approvedTarget;
      const target = pointer.snapshot_hash === approved.snapshotHash ? approved
        : await decodeAdmitted(client, context, reader => readStoredTarget(reader, identity.scope, pointer.snapshot_hash));
      requireStorage(target && sameScope(target.records.scope, identity.scope) &&
        target.records.version === parseStorage(() => readVersion(pointer.target_version)));
      for (const snapshot of snapshots) {
        evidence.push(snapshotReference(snapshot, snapshot.snapshot_hash === approved.snapshotHash ? approved : target));
      }
      evidence.push({
        family: 'target', key: ['parent_targets', pointer.account_id], bytes: 0, digest: hashCanonical(pointer),
      }, {
        family: 'import', key: [pins.idempotency_key], bytes: columns.reduce((sum, column) => sum + column.bytes, 0),
        digest: hashCanonical({ pins, columns }),
      });
      if (head) {
        evidence.push({ family: 'authority', key: [head.account_id], bytes: head.bytes,
          digest: hashCanonical({ authority, grantDigest: head.grant_digest,
            importKey: head.initial_import_key, receiptId: head.initial_receipt_id }) });
      }
      await checkRelationalTarget(read, scalar, target, evidence);
      context.assertActive();
      subjects.push({ identity, stored, authority, target });
    }
    subjects.sort((a, b) => compare(canonicalJson(a.identity), canonicalJson(b.identity)));
    evidence.sort((a, b) => compare(a.family, b.family) || compare(canonicalJson(a.key), canonicalJson(b.key)));
    context.assertActive();
    return { subjects, evidence, boundedFacts: catalogFacts(context) };
  } catch (error) {
    if (error instanceof SelectionReadLimit) return incompleteCatalog(context, error.cause);
    throw error;
  }
}
