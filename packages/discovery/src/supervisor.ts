import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ModelResultV2Schema, ModelTurnV2Schema, IdSchema, NonnegativeIntegerSchema, createToolStepId, hashCanonical,
  type DiscoveryBinding, type ModelMessageV2, type ModelResultV2, type ModelTurnV2,
} from '../../contracts/src/index.js';
import { budgets, safeCounter } from './budgets.js';
import type { ModelClient } from './model.js';
import { unavailableToolCode, toolSchemas } from './roles.js';
import { executeDelegation, validateDelegation, type CaptureAccess, type CaptureFacts } from './tasks.js';
import {
  coversGrant, discoveryError, insertSpecialist, lockRun, lockTask, markBlocker, publishDiscovery, runnable,
  type RepositoryOptions, type RunRow, type TaskRow,
} from './repository.js';

// The EAPR discovery session lock uses a dedicated two-int namespace in the control database.
const advisoryKey = [1161908306, 4];
// Process-wide across pools and replacement supervisors. A timed-out call holds its permit
// until the underlying adapter promise settles.
let unsettled = 0;

type Dispatch = {
  id: string; run_id: string; task_id: string; generation: string; task_revision: string;
  state: 'reserved' | 'returned' | 'interrupted'; result_hash: string | null; accepted: ModelResultV2 | null;
};
type Step = {
  id: string; dispatch_id: string; native_id: string; name: string; state: string; arguments: ModelResultV2['toolCalls'][number]['arguments'];
  result: { ok: false; code: string } | { ok: true; taskId: string; investigationId: string; revision: number };
};
type Reservation = { turn: ModelTurnV2; revision: number };
type Options = RepositoryOptions & {
  model: ModelClient;
  capture?: CaptureAccess;
  // Named test boundaries. No hook is configured by the runtime composition.
  testHooks?: {
    beforeReservationCommit?: () => Promise<void>;
    afterReservationCommit?: () => Promise<void>;
    beforeDelegationCommit?: () => Promise<void>;
  };
};

const usageEnvelope = z.object({
  schemaVersion: z.literal(2), dispatchId: IdSchema, providerCallId: IdSchema,
  usage: z.strictObject({ inputTokens: NonnegativeIntegerSchema, outputTokens: NonnegativeIntegerSchema }),
});

function postgresJsonCompatible(value: ModelResultV2) {
  // PostgreSQL JSONB rejects escaped NUL and unpaired UTF-16 surrogates.
  let compatible = true;
  function inspect(text: string) {
    if (text.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) {
      compatible = false;
    }
  }
  JSON.stringify(value, (key, entry) => {
    inspect(key);
    if (typeof entry === 'string') inspect(entry);
    return entry;
  });
  return compatible;
}

export async function acquireDiscoverySupervisor({ db, clock, model, resolveAuthority, capture, testHooks }: Options) {
  const { modelId, mode } = model;
  const client = await db.connect();
  let valid = true;
  let released = false;
  let serial: Promise<unknown> = Promise.resolve();
  let generation = 0;

  function invalidate() {
    valid = false;
  }
  function connectionLost() {
    invalidate();
    void serial.then(discard);
  }
  client.on('error', connectionLost);
  client.on('end', connectionLost);

  function discard() {
    if (released) return;
    released = true;
    client.removeListener('error', connectionLost);
    client.removeListener('end', connectionLost);
    client.release(true);
  }

  function transact<T>(fn: (connection: PoolClient) => Promise<T>): Promise<T | undefined> {
    const next = serial.then(async () => {
      if (!valid) {
        discard();
        return;
      }
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        if (!valid) throw new Error('Discovery owner lost');
        await client.query('COMMIT');
        return valid ? result : undefined;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { invalidate(); }
        if (valid) throw error;
        return undefined;
      } finally {
        if (!valid) discard();
      }
    });
    serial = next.catch(() => undefined);
    return next;
  }

  function permits(run: RunRow, task: TaskRow) {
    const current = resolveAuthority(run.reviewer_id, run.binding);
    return coversGrant(run.grants, task.grants) && coversGrant(current, task.grants);
  }

  async function publishBlock(connection: PoolClient, run: RunRow, task: TaskRow, code: string) {
    await markBlocker(connection, run.id, code);
    await publishDiscovery(connection, clock, run.id, 'discovery.blocked',
      { status: run.status === 'paused' ? 'paused' : 'blocked', diagnosticCodes: [code] }, task);
  }

  async function failTask(connection: PoolClient, run: RunRow, task: TaskRow, code: string, interrupted = false) {
    await connection.query(`UPDATE discovery_tasks SET status=$2, revision=revision+1,
      diagnostics=array_append(diagnostics,$3) WHERE id=$1`, [task.id, interrupted ? 'interrupted' : 'failed', code]);
    const { rowCount: dependents } = await connection.query(`UPDATE discovery_tasks t SET status='waiting',revision=revision+1,
      diagnostics=array_append(diagnostics,'DEPENDENCY_BLOCKED')
      FROM discovery_task_dependencies d WHERE d.run_id=$1 AND d.predecessor_id=$2
      AND t.run_id=d.run_id AND t.id=d.task_id AND t.status IN ('queued','waiting')
      AND NOT 'DEPENDENCY_BLOCKED'=ANY(t.diagnostics)`, [run.id, task.id]);
    await markBlocker(connection, run.id, code);
    if (dependents) await markBlocker(connection, run.id, 'DEPENDENCY_BLOCKED');
    if (!interrupted) {
      await publishDiscovery(connection, clock, run.id, 'task.blocked', {
        status: run.status === 'paused' ? 'paused' : 'blocked', taskState: 'failed',
        count: task.attempt, toolRounds: task.tool_rounds, diagnosticCodes: [code],
      }, task);
    }
  }

  async function interrupt(connection: PoolClient, dispatch: Dispatch, code: 'MODEL_TIMEOUT' | 'MODEL_INTERRUPTED') {
    const run = await lockRun(connection, dispatch.run_id);
    const task = await lockTask(connection, run.id, dispatch.task_id);
    if (!task || safeCounter(task.revision) !== safeCounter(dispatch.task_revision)) return;
    const { rowCount } = await connection.query(`UPDATE discovery_dispatches SET state='interrupted',accounting='unknown'
      WHERE id=$1 AND state='reserved' AND accounting IS NULL`, [dispatch.id]);
    if (!rowCount) return;
    await connection.query('UPDATE discovery_runs SET unknown_calls=unknown_calls+1 WHERE id=$1', [run.id]);
    await failTask(connection, run, task, code, true);
    await publishDiscovery(connection, clock, run.id, 'discovery.interrupted', {
      status: run.status === 'paused' ? 'paused' : 'blocked', dispatchId: dispatch.id,
      taskState: 'interrupted', diagnosticCodes: [code], unknownUsageCalls: safeCounter(run.unknown_calls) + 1,
    }, task);
  }

  async function reconcile() {
    const oldClaims = await transact(connection => connection.query<Dispatch>(`SELECT * FROM discovery_dispatches
      WHERE state='reserved' AND generation<$1 ORDER BY run_id,task_id,id`, [generation]));
    // Each recovery locks one run before publishing activity. Holding the activity
    // counter while acquiring another run could deadlock a concurrent reviewer action.
    for (const dispatch of oldClaims?.rows ?? []) {
      await transact(connection => interrupt(connection, dispatch, 'MODEL_INTERRUPTED'));
    }
  }

  try {
    const { rows: [lock] } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1,$2) AS locked', advisoryKey);
    if (!lock.locked || !valid) {
      invalidate();
      discard();
      return;
    }
    const acquired = await transact(async connection => {
      const { rows: [owner] } = await connection.query<{ generation: string }>(
        'UPDATE discovery_supervisor SET generation=generation+1 WHERE singleton RETURNING generation');
      generation = safeCounter(owner.generation);
      return true;
    });
    if (!acquired) return;
    await reconcile();
    if (!valid) return;
  } catch (error) {
    invalidate();
    discard();
    throw error;
  }

  async function transcript(connection: PoolClient, task: TaskRow): Promise<ModelMessageV2[]> {
    const { rows } = await connection.query<Pick<Dispatch, 'id' | 'accepted'>>(`
      SELECT id,accepted FROM discovery_dispatches WHERE task_id=$1 AND accepted IS NOT NULL ORDER BY attempt`, [task.id]);
    const messages: ModelMessageV2[] = [{ kind: 'text', role: 'user', text: task.question }];
    for (const { id, accepted } of rows) {
      if (accepted?.message !== undefined) messages.push({ kind: 'text', role: 'assistant', text: accepted.message });
      if (!accepted?.toolCalls.length) continue;
      const { rows: steps } = await connection.query<Step>(
        'SELECT * FROM discovery_tool_steps WHERE dispatch_id=$1 ORDER BY ordinal', [id]);
      messages.push({ kind: 'assistant_tool_calls', calls: steps.map(step => ({
        toolStepId: step.id, providerToolCallId: step.native_id, name: step.name, arguments: step.arguments,
      })) });
      for (const step of steps) messages.push({ kind: 'tool_result', toolStepId: step.id, name: step.name, result: step.result });
    }
    return messages;
  }

  async function reserve(connection: PoolClient, runId: string, taskId: string): Promise<Reservation | undefined> {
    const run = await lockRun(connection, runId);
    if (!runnable(run) || run.model_id !== modelId || run.mode !== mode) return;
    const task = await lockTask(connection, run.id, taskId);
    if (!task || !['queued', 'waiting'].includes(task.status) || !permits(run, task)) return;
    const { rows: [dependency] } = await connection.query(`SELECT 1 FROM discovery_task_dependencies d
      JOIN discovery_tasks predecessor ON predecessor.run_id=d.run_id AND predecessor.id=d.predecessor_id
      WHERE d.run_id=$1 AND d.task_id=$2 AND predecessor.status<>'succeeded' LIMIT 1`, [run.id, task.id]);
    if (dependency) return;
    if (task.attempt >= budgets.attempts) {
      await failTask(connection, run, task, 'MODEL_ATTEMPT_LIMIT');
      return;
    }
    const revision = safeCounter(task.revision) + 1;
    const dispatchId = randomUUID();
    const parsed = ModelTurnV2Schema.safeParse({
      schemaVersion: 2, dispatchId, runId, taskId, role: task.role, instructions: 'Investigate the pinned source capture.',
      messages: await transcript(connection, task), toolSchemas: capture ? toolSchemas(task.role) : [], limits: run.policy,
    });
    if (!parsed.success) {
      await failTask(connection, run, task, 'MODEL_STOPPED');
      return;
    }
    const turn = parsed.data;
    await connection.query(`INSERT INTO discovery_dispatches (id,run_id,task_id,attempt,generation,task_revision,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [dispatchId, runId, taskId, task.attempt + 1, generation, revision, hashCanonical(turn)]);
    await connection.query(`UPDATE discovery_tasks SET status='running',attempt=attempt+1,revision=$2 WHERE id=$1`, [taskId, revision]);
    await connection.query(`UPDATE discovery_runs SET status='running',model_calls=model_calls+1,revision=revision+1 WHERE id=$1`, [runId]);
    await publishDiscovery(connection, clock, run.id, 'task.started', {
      dispatchId, taskRevision: revision, taskState: 'running', modelCalls: safeCounter(run.model_calls) + 1,
    }, task);
    await testHooks?.beforeReservationCommit?.();
    return { turn, revision };
  }

  async function timeout(reservation: Reservation) {
    return transact(async connection => {
      const { rows: [dispatch] } = await connection.query<Dispatch>(
        'SELECT * FROM discovery_dispatches WHERE id=$1 AND generation=$2', [reservation.turn.dispatchId, generation]);
      if (dispatch?.state === 'reserved' && safeCounter(dispatch.task_revision) === reservation.revision) {
        await interrupt(connection, dispatch, 'MODEL_TIMEOUT');
      }
    });
  }

  async function accept(reservation: Reservation, raw: unknown, rejected = false) {
    if (!valid) return;
    const parsed = ModelResultV2Schema.safeParse(raw);
    const result = parsed.success && parsed.data.dispatchId === reservation.turn.dispatchId ? parsed.data : undefined;
    const resultHash = result && hashCanonical(result);
    const envelope = usageEnvelope.safeParse(raw);
    const usage = envelope.success && envelope.data.dispatchId === reservation.turn.dispatchId ? envelope.data.usage : undefined;
    const storable = result && postgresJsonCompatible(result);
    return transact(async connection => {
      const { turn, revision } = reservation;
      const run = await lockRun(connection, turn.runId);
      const task = await lockTask(connection, run.id, turn.taskId);
      const { rows: [dispatch] } = await connection.query<Dispatch>(`
        SELECT * FROM discovery_dispatches WHERE run_id=$1 AND task_id=$2 AND id=$3 AND generation=$4 AND task_revision=$5`,
      [turn.runId, turn.taskId, turn.dispatchId, generation, revision]);
      if (!task || !dispatch || dispatch.state === 'interrupted') return;
      if (dispatch.state === 'returned') {
        if (dispatch.result_hash !== (resultHash ?? null)) throw discoveryError(409);
        return;
      }
      if (task.status !== 'running' || safeCounter(task.revision) !== revision ||
          run.model_id !== modelId || run.mode !== mode) return;

      const withinTokens = usage && usage.inputTokens <= turn.limits.maxInputTokens && usage.outputTokens <= turn.limits.maxOutputTokens;
      const roundAvailable = !result?.toolCalls.length || task.tool_rounds < budgets.toolRounds;
      const accepted = storable && withinTokens && roundAvailable ? result : undefined;
      await connection.query(`UPDATE discovery_dispatches SET state='returned',accounting=$2,result_hash=$3,accepted=$4 WHERE id=$1`,
        [dispatch.id, usage ? 'known' : 'unknown', resultHash ?? null, accepted ?? null]);
      await connection.query(`UPDATE discovery_runs SET input_tokens=input_tokens+$2,output_tokens=output_tokens+$3,
        unknown_calls=unknown_calls+$4 WHERE id=$1`, [run.id, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, usage ? 0 : 1]);

      if (!accepted) {
        const code = rejected ? 'MODEL_CALL_FAILED' : (!storable || !withinTokens) ? 'MODEL_INVALID_RESULT' : 'MODEL_TOOL_ROUND_LIMIT';
        await failTask(connection, run, task, code);
        return;
      }
      if (accepted.stopReason === 'error' || accepted.stopReason === 'limit') {
        await failTask(connection, run, task, 'MODEL_STOPPED');
        return;
      }

      for (const [ordinal, call] of accepted.toolCalls.entries()) {
        const stepId = createToolStepId({ dispatchId: dispatch.id, providerToolCallId: call.id });
        await connection.query(`INSERT INTO discovery_tool_steps
          (id,dispatch_id,run_id,task_id,native_id,ordinal,name,input_hash,arguments,generation)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [stepId, dispatch.id, run.id, task.id, call.id, ordinal, call.name, hashCanonical(call.arguments), call.arguments, generation]);
      }
      const withTools = accepted.toolCalls.length > 0;
      await connection.query('UPDATE discovery_tasks SET status=$2,revision=revision+1,tool_rounds=tool_rounds+$3 WHERE id=$1',
        [task.id, withTools ? 'running' : 'succeeded', withTools ? 1 : 0]);
      await connection.query('UPDATE discovery_runs SET revision=revision+1 WHERE id=$1', [run.id]);
      if (withTools) {
        await publishDiscovery(connection, clock, run.id, 'system.status', {
          dispatchId: dispatch.id, status: run.status, taskState: 'running', toolRounds: task.tool_rounds + 1,
          ...accepted.usage,
        }, task);
      } else {
        await publishDiscovery(connection, clock, run.id, 'task.completed',
          { dispatchId: dispatch.id, taskState: 'succeeded', ...accepted.usage }, task);
        const { rowCount } = await connection.query(
          "SELECT 1 FROM discovery_tasks WHERE run_id=$1 AND status<>'succeeded' LIMIT 1", [run.id]);
        if (!rowCount) await publishBlock(connection, run, task, 'CONSTRUCTION_UNAVAILABLE');
      }
    });
  }

  function dispatchTask(runId: string, taskId: string) {
    if (!valid || unsettled >= budgets.slots) return;
    unsettled++;
    let reservation: Reservation | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (async () => {
      try {
        reservation = await transact(connection => reserve(connection, runId, taskId));
        if (!reservation || !valid) return;
        await testHooks?.afterReservationCommit?.();
        if (!valid) return;
        const reserved = reservation;
        timer = setTimeout(() => {
          // Timer failure fails the owner closed, but cannot settle the adapter's permit.
          void timeout(reserved).catch(connectionLost);
        }, reserved.turn.limits.timeoutMs);
        timer.unref();
        let result: unknown;
        try {
          result = await model.run(reserved.turn);
        } catch {
          await accept(reserved, undefined, true);
          return;
        }
        await accept(reserved, result);
      } catch (error) {
        if (reservation) connectionLost();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        unsettled--;
      }
    })();
    return {
      done,
      async timeout() { if (reservation) await timeout(reservation); },
      ...(testHooks ? {
        async replayTestResult(result: unknown) { if (reservation) await accept(reservation, result); },
      } : {}),
    };
  }

  async function executePendingStep(runId: string, taskId: string, stepId: string) {
    let facts: CaptureFacts | undefined;
    let captureReadAttempted = false;
    if (valid && capture) {
      // The read is only a hint for external validation. The owner transaction authenticates
      // the exact dispatch, run and task again before using the resulting capture facts.
      const { rows: [selected] } = await db.query<{ binding: DiscoveryBinding; reviewer_id: string; grants: TaskRow['grants'] }>(`
        SELECT r.binding,r.reviewer_id,t.grants FROM discovery_runs r
        JOIN discovery_tasks t ON t.run_id=r.id AND t.role='coordinator'
        JOIN discovery_tool_steps s ON s.run_id=r.id AND s.task_id=t.id
        WHERE r.id=$1 AND t.id=$2 AND s.id=$3 AND s.state='pending' AND r.status IN ('queued','running')
          AND EXISTS (SELECT 1 FROM discovery_tool_steps batch WHERE batch.dispatch_id=s.dispatch_id
            AND batch.name='delegateTask' AND batch.state='pending')`, [runId, taskId, stepId]);
      if (selected && coversGrant(resolveAuthority(selected.reviewer_id, selected.binding), selected.grants)) {
        captureReadAttempted = true;
        try { facts = await capture.readCapture(selected.binding); } catch { /* The guarded claim fails closed. */ }
      }
    }
    return transact(async connection => {
      const run = await lockRun(connection, runId);
      const task = await lockTask(connection, runId, taskId);
      if (!task || !permits(run, task)) return;
      const { rows: [step] } = await connection.query<Step & { task_revision: string }>(`SELECT s.*,d.task_revision
        FROM discovery_tool_steps s
        JOIN discovery_dispatches d ON d.run_id=s.run_id AND d.task_id=s.task_id AND d.id=s.dispatch_id
        WHERE s.run_id=$1 AND s.task_id=$2 AND s.id=$3 AND s.generation<=$4 AND d.generation<=$4 AND d.state='returned'
        AND (s.state IN ('failed','succeeded') OR d.attempt=$5) FOR UPDATE OF s`,
      [runId, taskId, stepId, generation, task.attempt]);
      if (!step || !permits(run, task)) return;
      if (step.state === 'failed' || step.state === 'succeeded') return step.result;
      if (!runnable(run) || task.status !== 'running' || step.state !== 'pending' ||
          run.model_id !== modelId || run.mode !== mode) return;
      const { rows: batch } = await connection.query<Step>(
        'SELECT * FROM discovery_tool_steps WHERE dispatch_id=$1 ORDER BY ordinal', [step.dispatch_id]);
      const pending = batch.filter(item => item.state === 'pending');
      // Result acceptance and each earlier resolved step increment the task revision once.
      if (pending[0]?.id !== step.id || !permits(run, task) ||
          safeCounter(task.revision) !== safeCounter(step.task_revision) + 1 + batch.length - pending.length) return;

      const delegates = capture && task.role === 'coordinator' ? pending.filter(item => item.name === 'delegateTask') : [];
      let input: Awaited<ReturnType<typeof validateDelegation>> | undefined;
      if (capture && delegates.length) {
        // A pause or policy change may have suppressed the speculative read before
        // this transaction. Let a later claim validate rather than blocking a valid run.
        if (!captureReadAttempted) return;
        let failure: string | undefined;
        if (!facts || hashCanonical(run.binding) !== hashCanonical(facts.binding)) {
          failure = 'DISCOVERY_CONFLICT';
        } else {
          try {
            await capture.recheckCapture(connection, facts);
            for (const delegate of delegates) {
              const validated = await validateDelegation(connection, run, facts, delegate.arguments);
              if (delegate.id === step.id) input = validated;
            }
          } catch (error) {
            const code = error instanceof Error && 'code' in error && error.code;
            if (code !== 'DISCOVERY_INVALID' && code !== 'DISCOVERY_CONFLICT' && code !== 'DISCOVERY_FORBIDDEN') throw error;
            failure = code;
          }
        }
        if (!permits(run, task)) return;
        if (failure) {
          // Record safe terminal results for transcript consistency, without publishing a
          // call/result event or applying any effect from the rejected batch.
          for (const item of pending) {
            const code = item.name === 'delegateTask' ? failure : unavailableToolCode(task.role, item.name);
            await connection.query(`UPDATE discovery_tool_steps SET state='failed',result=$2,generation=$3
              WHERE id=$1 AND state='pending'`, [item.id, { ok: false, code }, generation]);
          }
          await failTask(connection, run, task, failure);
          return { ok: false, code: step.name === 'delegateTask' ? failure : unavailableToolCode(task.role, step.name) } as const;
        }
      }

      const result = input ? await executeDelegation(connection, run, input) : {
        ok: false as const, code: unavailableToolCode(task.role, step.name),
      };
      const status = result.ok ? 'succeeded' : 'failed';
      if (!result.ok && (result.code === 'INVESTIGATION_LIMIT' || result.code === 'SPECIALIST_LIMIT')) {
        await publishBlock(connection, run, task, result.code);
      }
      await publishDiscovery(connection, clock, run.id, 'tool.called', { dispatchId: step.dispatch_id, toolStepId: step.id }, task);
      await connection.query("UPDATE discovery_tool_steps SET state=$2,result=$3,generation=$4 WHERE id=$1 AND state='pending'",
        [step.id, status, result, generation]);
      await connection.query('UPDATE discovery_tasks SET status=$2,revision=revision+1 WHERE id=$1',
        [task.id, pending.length > 1 ? 'running' : 'queued']);
      await connection.query('UPDATE discovery_runs SET revision=revision+1 WHERE id=$1', [run.id]);
      await publishDiscovery(connection, clock, run.id, 'tool.result', {
        dispatchId: step.dispatch_id, toolStepId: step.id, toolStatus: status,
        ...(!result.ok ? { diagnosticCodes: [result.code] } : {}),
      }, task);
      if (result.ok) await testHooks?.beforeDelegationCommit?.();
      return result;
    });
  }

  return {
    generation, dispatchTask,
    isValid: () => valid,
    executePendingStep,
    resolveUnavailableStep: executePendingStep,
    // This seam seeds ready tasks only in trusted tests.
    ...(testHooks ? {
      addTestSpecialist: (runId: string, input: Parameters<typeof insertSpecialist>[2]) => transact(async connection => {
        const run = await lockRun(connection, runId);
        if (!runnable(run) || !coversGrant(resolveAuthority(run.reviewer_id, run.binding), run.grants)) return;
        const result = await insertSpecialist(connection, run, input);
        if ('blocker' in result && result.blocker) {
          await markBlocker(connection, run.id, result.blocker);
          await publishDiscovery(connection, clock, run.id, 'discovery.blocked', { status: 'blocked', diagnosticCodes: [result.blocker] });
        }
        return result;
      }),
    } : {}),
    reconcile,
    async close() {
      invalidate();
      await serial;
      discard();
    },
  };
}
