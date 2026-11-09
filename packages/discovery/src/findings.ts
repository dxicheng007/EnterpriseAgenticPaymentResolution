import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  DiscoveryFindingV2Schema, SourceReadGrantSchema, hashCanonical, type DiscoveryFindingV2, type DiscoverySubject, type SourceReadGrant,
} from '../../contracts/src/index.js';
import {
  ReadFindingResultSchema, type PublishFindingInput, type PublishFindingResult, type ReadFindingInput, type ReadFindingResult,
} from '../../contracts/src/discovery-construction-tools.js';
import type { PreparedFindingEvidence } from './construction-evidence.js';
import { coversGrant, discoveryError, type RunRow, type TaskRow } from './repository.js';

type Context = { run: RunRow; task: TaskRow; step: { id: string } };
type Publication = {
  finding: DiscoveryFindingV2;
  isNew: boolean;
  blockers: { investigationId: string; code: string }[];
};

const accountMatch = (
  left: { sellerEntityId: string; sourceAccountId: string }, right: { sellerEntityId: string; sourceAccountId: string },
) => left.sellerEntityId === right.sellerEntityId && left.sourceAccountId === right.sourceAccountId;

function permitsSubject(grant: SourceReadGrant, subject: DiscoverySubject) {
  return grant.sourceWide || (subject.kind === 'source_account' && grant.accounts.some(account => accountMatch(account, subject)));
}

async function authorizedFinding(
  client: PoolClient, { run, task }: Context, { findingId, revision }: ReadFindingInput,
) {
  const { rows } = await client.query<{ finding_id: string; revision: number; payload: unknown; source_read: unknown }>(`
    WITH RECURSIVE exact_refs(finding_id,revision) AS (
      VALUES ($2::text,$3::integer)
      UNION
      SELECT d.input_finding_id,d.input_revision FROM discovery_finding_derivations d JOIN exact_refs e
        ON d.finding_id=e.finding_id AND d.revision=e.revision WHERE d.run_id=$1
    )
    SELECT e.finding_id,e.revision,r.payload,publisher.grants->'sourceRead' AS source_read
    FROM exact_refs e LEFT JOIN discovery_finding_revisions r
      ON r.run_id=$1 AND r.finding_id=e.finding_id AND r.revision=e.revision
    LEFT JOIN discovery_tasks publisher ON publisher.run_id=r.run_id AND publisher.id=r.task_id`, [run.id, findingId, revision]);
  let finding: DiscoveryFindingV2 | undefined;
  for (const row of rows) {
    const parsed = DiscoveryFindingV2Schema.safeParse(row.payload);
    if (!parsed.success || parsed.data.id !== row.finding_id || parsed.data.revision !== row.revision) {
      throw discoveryError(409);
    }
    // The publishing ceiling bounds the citations in this immutable revision.
    const sourceRead = SourceReadGrantSchema.safeParse(row.source_read);
    if (!sourceRead.success) throw discoveryError(409);
    if (!permitsSubject(task.grants.sourceRead, parsed.data.subject) ||
        !coversGrant(task.grants, { sourceRead: sourceRead.data, allowedAccountIds: [] })) {
      throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    }
    if (row.finding_id === findingId && row.revision === revision) finding = parsed.data;
  }
  if (!finding) throw discoveryError(409);
  return finding;
}

export async function readFinding(client: PoolClient, context: Context, input: ReadFindingInput): Promise<ReadFindingResult> {
  if (input.revision > 10) throw discoveryError(409);
  const finding = await authorizedFinding(client, context, input);
  const parsed = ReadFindingResultSchema.safeParse({ ok: true, finding });
  if (!parsed.success) throw discoveryError(409, 'TOOL_RESULT_LIMIT');
  return parsed.data;
}

export function classifyFindingBlockers(
  finding: Pick<DiscoveryFindingV2, 'provenanceClass' | 'evidenceStatus'>, applicable: boolean,
) {
  const pending = finding.evidenceStatus !== 'supported' || finding.provenanceClass === 'inferred' ||
    finding.provenanceClass === 'unresolved';
  return { pending, applicabilityUnresolved: !applicable };
}

export async function validateFindingPublication(
  client: PoolClient, context: Context, input: PublishFindingInput, prepared: PreparedFindingEvidence,
  previous: readonly Publication[],
): Promise<Publication> {
  const { run, task } = context;
  const { findingId, expectedRevision, ...fields } = input;
  const { rows: [investigation] } = await client.query<{ seller_entity_id: string | null; source_account_id: string | null }>(
    'SELECT seller_entity_id,source_account_id FROM discovery_investigations WHERE run_id=$1 AND id=$2',
    [run.id, task.investigation_id]);
  if (!investigation) throw discoveryError(409);
  const subject: DiscoverySubject = investigation.seller_entity_id === null ? { kind: 'source' } : {
    kind: 'source_account', sellerEntityId: investigation.seller_entity_id, sourceAccountId: investigation.source_account_id!,
  };
  if (hashCanonical(subject) !== hashCanonical(fields.subject) || !permitsSubject(task.grants.sourceRead, subject)) {
    throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
  }
  if (findingId) {
    const { rows: [identity] } = await client.query<{ investigation_id: string; current_revision: number }>(
      'SELECT investigation_id,current_revision FROM discovery_finding_identities WHERE run_id=$1 AND id=$2', [run.id, findingId]);
    if (!identity) throw discoveryError(409);
    if (identity.investigation_id !== task.investigation_id) throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    const projected = previous.findLast(plan => plan.finding.id === findingId)?.finding.revision ?? identity.current_revision;
    if (projected !== expectedRevision) throw discoveryError(409);
    if (projected >= 10) throw discoveryError(409, 'FINDING_REVISION_LIMIT');
  } else {
    const { rows: [count] } = await client.query<{ total: number }>(
      'SELECT count(*)::integer AS total FROM discovery_finding_identities WHERE run_id=$1 AND investigation_id=$2',
      [run.id, task.investigation_id]);
    if (count!.total + previous.filter(plan => plan.isNew).length >= 100) {
      throw discoveryError(409, 'FINDING_IDENTITY_LIMIT');
    }
  }

  for (const ref of fields.derivationInputs) {
    if (ref.revision > 10) throw discoveryError(409);
    await authorizedFinding(client, context, ref);
  }
  if (findingId && fields.derivationInputs.length) {
    const projectedEdges = previous.flatMap(({ finding }) => finding.derivationInputs.map(ref => ({
      finding_id: finding.id, input_finding_id: ref.findingId,
    })));
    const { rowCount } = await client.query(`
      WITH RECURSIVE edges(finding_id,input_finding_id) AS (
        SELECT finding_id,input_finding_id FROM discovery_finding_derivations WHERE run_id=$1
        UNION ALL
        SELECT finding_id,input_finding_id FROM jsonb_to_recordset($4::jsonb)
          AS projected(finding_id text,input_finding_id text)
      ), ancestors(id) AS (
        SELECT unnest($2::text[])
        UNION
        SELECT d.input_finding_id FROM edges d JOIN ancestors a ON d.finding_id=a.id
      )
      SELECT 1 FROM ancestors WHERE id=$3`,
    [run.id, fields.derivationInputs.map(ref => ref.findingId), findingId, JSON.stringify(projectedEdges)]);
    if (rowCount) throw discoveryError(409);
  }

  const finding = DiscoveryFindingV2Schema.parse({
    ...fields, schemaVersion: 2, id: findingId ?? randomUUID(), revision: expectedRevision + 1, taskId: task.id,
    reviewDisposition: 'pending', origin: 'agent',
  });
  const blockers: Publication['blockers'] = [];
  const classification = classifyFindingBlockers(finding, prepared.applicable);
  if (classification.pending) blockers.push({ investigationId: task.investigation_id, code: 'FINDING_RESOLUTION_PENDING' });
  if (classification.applicabilityUnresolved) {
    const { rows: [source] } = await client.query<{ id: string }>(
      'SELECT id FROM discovery_investigations WHERE run_id=$1 AND seller_entity_id IS NULL', [run.id]);
    if (!source) throw discoveryError(409);
    blockers.push({ investigationId: source.id, code: 'FINDING_APPLICABILITY_UNRESOLVED' });
  }
  return { finding, isNew: findingId === undefined, blockers };
}

export async function publishFinding(
  client: PoolClient, { run, task, step }: Context, { finding, isNew, blockers }: Publication,
): Promise<Extract<PublishFindingResult, { ok: true }>> {
  if (isNew) {
    await client.query(`INSERT INTO discovery_finding_identities(run_id,id,investigation_id,current_revision)
      VALUES ($1,$2,$3,$4)`, [run.id, finding.id, task.investigation_id, finding.revision]);
  }
  await client.query(`INSERT INTO discovery_finding_revisions(run_id,finding_id,revision,investigation_id,task_id,tool_step_id,payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [run.id, finding.id, finding.revision, task.investigation_id, task.id, step.id, finding]);
  for (const ref of finding.derivationInputs) {
    await client.query(`INSERT INTO discovery_finding_derivations(run_id,finding_id,revision,input_finding_id,input_revision)
      VALUES ($1,$2,$3,$4,$5)`, [run.id, finding.id, finding.revision, ref.findingId, ref.revision]);
  }
  for (const { investigationId, code } of blockers) {
    await client.query(`INSERT INTO discovery_finding_blockers(run_id,finding_id,origin_revision,investigation_id,code)
      VALUES ($1,$2,$3,$4,$5)`, [run.id, finding.id, finding.revision, investigationId, code]);
  }
  if (!isNew) {
    await client.query('UPDATE discovery_finding_identities SET current_revision=$3 WHERE run_id=$1 AND id=$2',
      [run.id, finding.id, finding.revision]);
  }
  return { ok: true, findingId: finding.id, revision: finding.revision };
}
