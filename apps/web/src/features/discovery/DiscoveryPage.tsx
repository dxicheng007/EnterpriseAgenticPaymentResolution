import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  changeDiscoveryStatus, createDiscoveryMonitor, readDiscoveryCapabilities,
} from '../../../../../packages/client/src/discovery.js';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import type { ActivityEvent } from '../../../../../packages/contracts/src/activity.js';
import { IdSchema, type Diagnostic } from '../../../../../packages/contracts/src/common.js';
import type {
  DiscoveryCapabilitiesResponseV2, DiscoveryStateV2,
} from '../../../../../packages/contracts/src/discovery.js';
import { DiscoveryConstruction } from './DiscoveryConstruction.js';

function Diagnostics({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (!diagnostics.length) return null;
  return <ul className="review-diagnostics">{diagnostics.map(({ code, message }, index) =>
    <li key={code + ':' + index}><strong>{code}</strong> · {message}</li>)}</ul>;
}

function ModelAvailability() {
  const [capabilities, setCapabilities] = useState<DiscoveryCapabilitiesResponseV2>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readDiscoveryCapabilities(signal).then(
      value => { if (!signal.aborted) setCapabilities(value); },
      () => { if (!signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, []);
  if (failed) return <p role="status">Discovery capabilities could not be checked.</p>;
  if (!capabilities) return <p role="status">Checking discovery capabilities…</p>;
  return <>
    <p>{capabilities.mode === 'unconfigured' ? 'Discovery model is unavailable.' :
      'Configured model mode ' + capabilities.mode + '.'}{' '}
    {capabilities.startAvailable ? 'Open a saved run to monitor it.' : 'Starting a run is unavailable.'}</p>
    <Diagnostics diagnostics={capabilities.diagnostics} />
  </>;
}

function runFromLocation() {
  const [page, query] = window.location.hash.slice(1).split('?', 2);
  if (page !== 'discovery') return '';
  return new URLSearchParams(query).get('runId') ?? '';
}

export function DiscoveryPage() {
  const [selected, setSelected] = useState(runFromLocation);
  const [input, setInput] = useState(selected);
  const [invalid, setInvalid] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    function navigate() {
      const run = runFromLocation();
      setSelected(run);
      setInput(run);
      setInvalid(false);
    }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  function openRun(event: FormEvent) {
    event.preventDefault();
    const run = input.trim();
    if (!IdSchema.safeParse(run).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (run === selected) setRetry(value => value + 1);
    window.location.hash = 'discovery?' + new URLSearchParams({ runId: run });
  }

  const invalidLink = selected !== '' && !IdSchema.safeParse(selected).success;
  return <main className="review-main">
    <h1>Discovery</h1>
    <ModelAvailability />
    <form className="review-actions review-selection" onSubmit={openRun}>
      <label>Run ID
        <input value={input} maxLength={160} onChange={event => {
          setInput(event.target.value);
          setInvalid(false);
        }} />
      </label>
      <button type="submit">Open run</button>
    </form>
    {(invalid || invalidLink) && <p role="alert">Enter a valid run ID.</p>}
    {!selected && <p>Enter a saved discovery run ID to see its state and recent activity.</p>}
    {selected && !invalidLink && <RunMonitor key={selected + '/' + retry} runId={selected}
      retry={() => setRetry(value => value + 1)} />}
  </main>;
}

function monitorError(error: unknown) {
  if (error instanceof LocalApiError) {
    if (error.status === 401) return 'The reviewer session is unavailable.';
    if (error.status === 403) return 'The reviewer is forbidden from opening this run.';
    if (error.status === 404) return 'This discovery run was not found.';
  }
  return 'Discovery monitoring is unavailable.';
}

const connectionLabel = {
  connecting: 'Opening discovery run…',
  connected: 'Activity connected',
  reconnecting: 'Reconnecting activity…',
  resynchronizing: 'Resynchronizing activity…',
} as const;

function RunMonitor({ runId, retry }: { runId: string; retry: () => void }) {
  const [state, setState] = useState<DiscoveryStateV2>();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [status, setStatus] = useState<keyof typeof connectionLabel>('connecting');
  const [failure, setFailure] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [mutating, setMutating] = useState(false);
  const generation = useRef<{
    signal: AbortSignal;
    monitor: ReturnType<typeof createDiscoveryMonitor>;
    mutating: boolean;
  }>(null);
  useLayoutEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const monitor = createDiscoveryMonitor(runId, signal, {
      state: setState,
      activity: event => setEvents(previous => [event, ...previous].slice(0, 200)),
      connection: setStatus,
    });
    generation.current = { signal, monitor, mutating: false };
    void monitor.watch().catch(error => {
      if (signal.aborted) return;
      setFailure(monitorError(error));
      if (error instanceof LocalApiError && (error.status === 401 || error.status === 403)) {
        setState(undefined);
        setEvents([]);
      }
    });
    return () => {
      generation.current = null;
      controller.abort();
    };
  }, [runId]);

  async function change(action: 'pause' | 'resume') {
    const current = generation.current;
    if (!state || !current || current.mutating) return;
    const { monitor, signal } = current;
    current.mutating = true;
    setMutating(true);
    setActionError(undefined);
    try {
      monitor.publish(await changeDiscoveryStatus(runId, action, state.revision, signal));
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof LocalApiError && error.status === 409) {
        setActionError('The run changed before the action could be applied. Review the latest state before trying again.');
        try {
          await monitor.refresh();
        } catch (refreshError) {
          if (!signal.aborted) setFailure(monitorError(refreshError));
        }
      } else {
        setActionError('The discovery action failed. Review the run before trying again.');
      }
    } finally {
      current.mutating = false;
      if (!signal.aborted) setMutating(false);
    }
  }

  return <>
    {failure ? <div className="review-error" role="alert">
      <p>{failure}</p><button type="button" onClick={retry}>Retry monitoring</button>
    </div> : <p role="status">{connectionLabel[status]}</p>}
    {state && <>
      <RunDetails state={state} />
      {state.status !== 'completed' && state.status !== 'failed' &&
        <button type="button" disabled={mutating || status === 'resynchronizing' || !!failure}
          onClick={() => void change(state.status === 'paused' ? 'resume' : 'pause')}>
          {state.status === 'paused' ? 'Resume run' : 'Pause run'}
        </button>}
      {actionError && <p role="alert">{actionError}</p>}
      <section className="review-card" aria-labelledby="discovery-recent">
        <h2 id="discovery-recent">Recent activity</h2>
        {events.length === 0 ? <p>No recent activity has arrived since opening this view.</p> :
          <ol>{events.map(event => <li key={event.stream + ':' + event.sequence}>
            <time dateTime={event.at}>{event.at}</time>{' · '}
            <code>{event.type}</code>{event.role && ' · ' + event.role}
            {event.taskId && ' · ' + event.taskId}
          </li>)}</ol>}
      </section>
    </>}
  </>;
}

function RunDetails({ state }: { state: DiscoveryStateV2 }) {
  const { binding, usage } = state;
  return <>
    <section className="review-card" aria-labelledby="discovery-run">
      <h2 id="discovery-run">Run {state.id}</h2>
      <p>Run status {state.status}</p>
      {state.status === 'paused' && <p>Paused. Work already in flight can still finish.</p>}
      <dl className="review-facts">
        <dt>Revision</dt><dd>{state.revision}</dd>
        <dt>Mode</dt><dd>{state.mode}</dd>
        <dt>Model</dt><dd>{state.modelId}</dd>
        <dt>Company</dt><dd>{binding.companyId}</dd>
        <dt>Source</dt><dd>{binding.sourceRef}</dd>
        <dt>Manifest</dt><dd>{binding.manifestId}<small>{binding.manifestHash}</small></dd>
        <dt>Snapshot</dt><dd>{binding.snapshotId}<small>{binding.snapshotHash}</small></dd>
      </dl>
      <Diagnostics diagnostics={state.diagnostics} />
    </section>
    <section className="review-card" aria-labelledby="discovery-usage">
      <h2 id="discovery-usage">Model usage</h2>
      <p>These are design-time discovery counters. Runtime model usage is not reported by this API.</p>
      <p>In-flight model calls {state.inFlightModelCalls}</p>
      <p>In-flight tool steps {state.inFlightToolSteps}</p>
      <p>Model calls {usage.modelCalls}</p>
      <p>Input tokens {usage.inputTokens} · Output tokens {usage.outputTokens}</p>
      <p>Unknown usage calls {usage.unknownUsageCalls}</p>
      <p>Cost unavailable</p>
    </section>
    <section className="review-card" aria-labelledby="discovery-tasks">
      <h2 id="discovery-tasks">Tasks</h2>
      <p>{state.tasks.length} total</p>
      <ul>{state.tasks.map(task => <li key={task.id}>
        <h3>{task.role} · {task.status}</h3>
        <p>{task.id}</p>
        <p>{task.subject.kind === 'source' ? 'Source-wide' :
          task.subject.sellerEntityId + ' / ' + task.subject.sourceAccountId}</p>
        <p>Dependencies {task.dependencyIds.join(', ') || 'none'}</p>
        <p>Attempts {task.attempt} · Tool rounds {task.toolRounds} · Repair rounds {task.repairRound}</p>
        {task.diagnosticCodes.length > 0 && <p>{task.diagnosticCodes.join(', ')}</p>}
      </li>)}</ul>
    </section>
    <DiscoveryConstruction state={state} />
  </>;
}
