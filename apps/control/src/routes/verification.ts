import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  IdSchema, ReviewerContextSchema, TaskContextSchema, VerifyRequestSchema,
  type ApiError, type Id, type ReviewerContext, type TaskContext,
} from '@eapr/contracts';
import type { ControlServices } from '../server.js';
import type { createCandidateRegistry } from '../../../../packages/evaluator/src/registry.js';
import type { createVerificationJobs } from '../../../../packages/evaluator/src/jobs.js';

export type VerificationAuthorization =
  | { caller: 'reviewer'; reviewer: ReviewerContext; allowedSourceRefs: Id[]; allowedAccountIds: Id[] }
  | { caller: 'task'; task: TaskContext; accountId: Id };

type Dependencies = {
  authorizeVerification(request: FastifyRequest): Promise<VerificationAuthorization>;
  registry: ReturnType<typeof createCandidateRegistry>;
  jobs: ReturnType<typeof createVerificationJobs>;
};

const failures = {
  400: { code: 'VERIFICATION_INVALID', message: 'Verification request is malformed' },
  401: { code: 'VERIFICATION_UNAUTHORIZED', message: 'Verification requires an authorized caller' },
  403: { code: 'VERIFICATION_FORBIDDEN', message: 'Caller lacks the requested verification capability' },
  404: { code: 'VERIFICATION_REFERENCE_NOT_FOUND', message: 'A required verification reference was not found' },
  409: { code: 'VERIFICATION_CONFLICT', message: 'Verification reference or attempt reservation conflicts' },
  503: { code: 'VERIFICATION_UNAVAILABLE', message: 'A verification dependency is unavailable' },
} as const;

type FailureStatus = keyof typeof failures;

function reject(statusCode: FailureStatus): never {
  throw Object.assign(new Error(failures[statusCode].message), { statusCode });
}

function publicStatus(error: unknown): FailureStatus {
  const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409) return status;
  if (status === 413 || status === 415) return 400;
  return 503;
}

function callerScope(authorization: VerificationAuthorization) {
  if (authorization?.caller === 'task') {
    const { task, accountId } = authorization;
    if (!TaskContextSchema.safeParse(task).success || !IdSchema.safeParse(accountId).success ||
      !task.allowedAccountIds.includes(accountId)) reject(403);
    return { sourceRefs: task.allowedSourceRefs, accountIds: [accountId], task: { runId: task.runId, accountId } };
  }
  if (authorization?.caller !== 'reviewer' || !ReviewerContextSchema.safeParse(authorization.reviewer).success ||
    !IdSchema.array().safeParse(authorization.allowedSourceRefs).success ||
    !IdSchema.array().safeParse(authorization.allowedAccountIds).success) reject(403);
  return { sourceRefs: authorization.allowedSourceRefs, accountIds: authorization.allowedAccountIds };
}

function assertScope(caller: ReturnType<typeof callerScope>, sourceRefs: string[], accountIds: string[]) {
  if (sourceRefs.some(source => !caller.sourceRefs.includes(source)) ||
    accountIds.some(account => !caller.accountIds.includes(account))) reject(403);
}

export function createVerificationPlugin(deps: Dependencies): FastifyPluginAsync<ControlServices> {
  if (typeof deps.authorizeVerification !== 'function') throw new Error('Verification authorizer is required');
  return async app => {
    app.addHook('onClose', async () => deps.jobs.drain());
    app.setErrorHandler((error, request, reply) => {
      const status = publicStatus(error);
      const body: ApiError = { ...failures[status], diagnostics: [], correlationId: request.id };
      return reply.header('Cache-Control', 'no-store').code(status).send(body);
    });
    app.post<{ Params: { id: string } }>('/api/connectors/:id/verify', async (request, reply) => {
      const caller = callerScope(await deps.authorizeVerification(request));
      const parsed = VerifyRequestSchema.safeParse(request.body);
      if (!IdSchema.safeParse(request.params.id).success || !parsed.success) reject(400);
      const { artifactHash, profileHashes, manifestId } = parsed.data;
      const candidate = await deps.registry.getCandidate(artifactHash, manifestId);
      assertScope(caller, [candidate.artifact.sourceRef], candidate.profiles.map(profile => profile.scope.accountId));
      if (candidate.spec.id !== request.params.id || profileHashes.length !== candidate.profiles.length ||
        !candidate.profiles.every(profile => profileHashes.includes(profile.hash))) reject(409);
      return reply.header('Cache-Control', 'no-store').code(202).send(await deps.jobs.enqueue(candidate, caller.task));
    });
    app.get<{ Params: { jobId: string } }>('/api/verification-jobs/:jobId', async (request, reply) => {
      const caller = callerScope(await deps.authorizeVerification(request));
      if (!IdSchema.safeParse(request.params.jobId).success) reject(400);
      const stored = await deps.jobs.get(request.params.jobId);
      assertScope(caller, stored.sourceRefs, stored.accountIds);
      if (caller.task && stored.taskRunId !== caller.task.runId) reject(403);
      return reply.header('Cache-Control', 'no-store').send(stored.job);
    });
  };
}
