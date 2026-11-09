import { DiscoveryCapabilitiesResponseV2Schema, hashCanonical, type DiscoveryBinding, type DiscoveryActionRequestV2,
  type StartDiscoveryRequestV2 } from '../../contracts/src/index.js';
import type { CompileRegisterCandidate, ConstructionCaptureReader } from './compilation.js';
import type { DiscoveryReadTools } from './read-tools.js';
import type { ModelClient } from './model.js';
import { coversGrant, createDiscoveryRepository, discoveryError, type Grants, type RepositoryOptions } from './repository.js';
import { acquireDiscoverySupervisor } from './supervisor.js';
import type { CaptureAccess, CaptureFacts } from './tasks.js';

export type DiscoveryReviewer = {
  reviewerId: string;
  allowedSourceRefs: readonly string[];
};

type Options = RepositoryOptions & CaptureAccess & {
  modelClient?: ModelClient;
  readTools?: DiscoveryReadTools;
  constructionCapture?: ConstructionCaptureReader;
  registerCandidate?: CompileRegisterCandidate;
  sourceRefForCompany: (companyId: string) => string | undefined;
};

export async function createDiscoveryService(options: Options) {
  const { db, modelClient, readCapture, recheckCapture, sourceRefForCompany } = options;
  const repository = createDiscoveryRepository(options);
  const supervisorOptions = () => ({
    ...options, model: modelClient!, capture: options,
    constructionCapture: options.constructionCapture,
    registerCandidate: options.registerCandidate,
  });
  let owner = modelClient && await acquireDiscoverySupervisor(supervisorOptions());
  let closed = false;
  let active: Promise<void> | undefined;
  const pendingTasks = new Set<string>();
  const pendingSteps = new Map<string, number>();

  async function tick() {
    if (!modelClient) return;
    if (!owner || !owner.isValid()) owner = await acquireDiscoverySupervisor(supervisorOptions());
    if (!owner || closed) return;
    const { rows } = await db.query<{
      run_id: string; task_id: string; step_id: string | null; recovering_read: boolean | null; reviewer_id: string;
      binding: DiscoveryBinding; run_grants: Grants; task_grants: Grants;
    }>(`
      SELECT r.id AS run_id, t.id AS task_id, p.id AS step_id, p.state='interrupted' AS recovering_read, r.binding, r.reviewer_id,
        r.grants AS run_grants, t.grants AS task_grants
      FROM discovery_runs r JOIN discovery_tasks t ON t.run_id=r.id
      LEFT JOIN LATERAL (
        SELECT s.id,s.state,s.generation FROM discovery_tool_steps s
        JOIN discovery_dispatches d ON d.id=s.dispatch_id AND d.run_id=s.run_id AND d.task_id=s.task_id
        WHERE s.run_id=r.id AND s.task_id=t.id AND s.state IN ('pending','running','interrupted') AND d.attempt=t.attempt
        ORDER BY s.ordinal LIMIT 1
      ) p ON true
      WHERE r.status IN ('queued','running') AND r.model_id=$1 AND r.mode=$2 AND (
        (t.status='running' AND (p.state='pending' OR ($4 AND p.state='interrupted' AND p.generation<$3))) OR
        (t.status IN ('queued','waiting') AND NOT EXISTS (
          SELECT 1 FROM discovery_task_dependencies edge
          JOIN discovery_tasks predecessor ON predecessor.run_id=edge.run_id AND predecessor.id=edge.predecessor_id
          WHERE edge.run_id=r.id AND edge.task_id=t.id AND predecessor.status<>'succeeded'
        ))
      ) ORDER BY r.id,t.id`, [modelClient.modelId, modelClient.mode, owner.generation, !!options.readTools]);
    for (const row of rows) {
      if (closed) break;
      if (pendingTasks.has(row.task_id)) continue;
      // Recovery must observe policy under the owner fence so revocation becomes durable.
      if (!row.recovering_read && (!coversGrant(row.run_grants, row.task_grants) ||
          !coversGrant(options.resolveAuthority(row.reviewer_id, row.binding), row.task_grants))) continue;
      if (row.step_id) {
        const generation = owner.generation;
        if (pendingSteps.get(row.task_id) === generation) continue;
        pendingSteps.set(row.task_id, generation);
        void owner.executePendingStep(row.run_id, row.task_id, row.step_id).catch(() => undefined).finally(() => {
          if (pendingSteps.get(row.task_id) === generation) pendingSteps.delete(row.task_id);
        });
      } else {
        const claim = owner.dispatchTask(row.run_id, row.task_id);
        if (!claim) continue;
        pendingTasks.add(row.task_id);
        void claim.done.catch(() => undefined).finally(() => pendingTasks.delete(row.task_id));
      }
    }
  }

  const timer = modelClient && setInterval(() => {
    if (!closed && !active) active = tick().catch(() => undefined).finally(() => { active = undefined; });
  }, 50);
  timer?.unref();

  function scopedActor(reviewer: DiscoveryReviewer, sourceRef: string) {
    if (!reviewer.allowedSourceRefs.includes(sourceRef)) throw discoveryError(403, 'DISCOVERY_FORBIDDEN');
    return { reviewerId: reviewer.reviewerId, sourceRef };
  }

  async function runActor(reviewer: DiscoveryReviewer, runId: string) {
    const { rows: [saved] } = await db.query<{ source_ref: string }>(
      "SELECT binding->>'sourceRef' AS source_ref FROM discovery_runs WHERE id=$1", [runId]);
    if (!saved) throw discoveryError(404, 'DISCOVERY_NOT_FOUND');
    return scopedActor(reviewer, saved.source_ref);
  }

  return {
    capabilities() {
      return DiscoveryCapabilitiesResponseV2Schema.parse({
        schemaVersion: 2, mode: modelClient?.mode ?? 'unconfigured', startAvailable: !!modelClient,
        diagnostics: modelClient ? [] : [{ code: 'MODEL_UNAVAILABLE', severity: 'blocker',
          message: 'Discovery model configuration is unavailable.', sourceIds: [], fieldPaths: [] }],
      });
    },
    async startDiscovery(reviewer: DiscoveryReviewer, input: StartDiscoveryRequestV2) {
      const sourceRef = sourceRefForCompany(input.companyId);
      if (!sourceRef) throw discoveryError(404, 'DISCOVERY_NOT_FOUND');
      let facts: CaptureFacts | undefined;
      return repository.start(input, scopedActor(reviewer, sourceRef), {
        model: modelClient,
        async readCapture(selection) {
          facts = await readCapture(selection);
          return facts.binding;
        },
        async recheckCapture(client, binding) {
          if (!facts || hashCanonical(facts.binding) !== hashCanonical(binding)) throw discoveryError(409);
          await recheckCapture(client, facts);
        },
      });
    },
    async readState(reviewer: DiscoveryReviewer, runId: string) {
      return repository.readState(runId, await runActor(reviewer, runId));
    },
    async pause(reviewer: DiscoveryReviewer, runId: string, input: DiscoveryActionRequestV2) {
      return repository.action(runId, await runActor(reviewer, runId), 'pause', input);
    },
    async resume(reviewer: DiscoveryReviewer, runId: string, input: DiscoveryActionRequestV2) {
      return repository.action(runId, await runActor(reviewer, runId), 'resume', input);
    },
    async close() {
      closed = true;
      clearInterval(timer || undefined);
      await active;
      await owner?.close();
    },
  };
}
