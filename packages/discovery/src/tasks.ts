import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DiscoverySubjectSchema, IdSchema, VersionSchema, strict, type DiscoveryBinding, type DiscoverySubject } from '../../contracts/src/index.js';
import { safeCounter } from './budgets.js';
import { coversGrant, discoveryError, insertSpecialist, type RunRow } from './repository.js';

export type CaptureFacts = {
  readonly binding: DiscoveryBinding;
  readonly sourceAccounts: readonly Extract<DiscoverySubject, { kind: 'source_account' }>[];
  readonly evidenceIds: readonly string[];
};

export type CaptureAccess = {
  readCapture: (selection: Pick<DiscoveryBinding, 'companyId' | 'sourceRef' | 'manifestId'>) => Promise<CaptureFacts>;
  recheckCapture: (client: PoolClient, facts: CaptureFacts) => Promise<void>;
};

const roles = ['identity', 'contract', 'receivables', 'connector'] as const;
export const delegateTaskInput = strict({
  subject: DiscoverySubjectSchema,
  role: z.enum(roles),
  question: z.string().min(1).refine(question => Buffer.byteLength(question) <= 8192),
  dependencyIds: z.array(IdSchema).refine(ids => new Set(ids).size === ids.length).transform(ids => ids.sort()),
});

export const delegateTaskTool = {
  name: 'delegateTask',
  description: 'Assign a bounded specialist investigation of the pinned source or a captured seller/account tuple.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['subject', 'role', 'question', 'dependencyIds'],
    properties: {
      subject: {
        oneOf: [
          { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'source' } } },
          { type: 'object', additionalProperties: false, required: ['kind', 'sellerEntityId', 'sourceAccountId'],
            properties: { kind: { const: 'source_account' }, sellerEntityId: { type: 'string' }, sourceAccountId: { type: 'string' } } },
        ],
      },
      role: { enum: [...roles] },
      question: { type: 'string', minLength: 1, description: 'At most 8192 UTF-8 bytes.' },
      dependencyIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
  },
};

export async function validateDelegation(connection: PoolClient, run: RunRow, facts: CaptureFacts, raw: unknown) {
  const parsed = delegateTaskInput.safeParse(raw);
  if (!parsed.success) throw discoveryError(400, 'DISCOVERY_INVALID');
  const { subject, dependencyIds } = parsed.data;
  const sourceRead = run.grants.sourceRead;
  if (subject.kind === 'source_account' && !facts.sourceAccounts.some(account =>
    account.sellerEntityId === subject.sellerEntityId && account.sourceAccountId === subject.sourceAccountId)) {
    throw discoveryError(409);
  }
  const narrowed = subject.kind === 'source' ? run.grants : {
    ...run.grants, sourceRead: {
      ...sourceRead, sourceWide: false,
      accounts: [{ sellerEntityId: subject.sellerEntityId, sourceAccountId: subject.sourceAccountId }],
    },
  };
  if ((subject.kind === 'source' && !sourceRead.sourceWide) || !coversGrant(run.grants, narrowed)) {
    throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
  }
  const { rowCount } = await connection.query(
    'SELECT id FROM discovery_tasks WHERE run_id=$1 AND id=ANY($2)', [run.id, dependencyIds]);
  if (rowCount !== dependencyIds.length) throw discoveryError(409);
  return parsed.data;
}

export async function executeDelegation(connection: PoolClient, run: RunRow, input: z.infer<typeof delegateTaskInput>) {
  const child = await insertSpecialist(connection, run, input);
  if (child.blocker) return { ok: false, code: child.blocker } as const;
  const { rows: [task] } = await connection.query<{ revision: string }>(
    'SELECT revision FROM discovery_tasks WHERE run_id=$1 AND id=$2', [run.id, child.taskId]);
  return { ok: true, investigationId: child.investigationId, taskId: child.taskId,
    revision: VersionSchema.parse(safeCounter(task.revision)) } as const;
}
