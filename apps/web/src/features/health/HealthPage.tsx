import { useEffect, useState } from 'react';
import { HealthResponseSchema, type HealthResponse } from '../../../../../packages/contracts/src/activity.js';

const readiness = {
  ready: 'Ready', unavailable: 'Unavailable', migration_required: 'Migration required',
};

export function HealthPage() {
  const [attempt, setAttempt] = useState(0);
  const [health, setHealth] = useState<HealthResponse>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    async function refresh() {
      setFailed(false);
      try {
        const response = await fetch('/api/health', { signal: abort.signal, cache: 'no-store' });
        if (response.status !== 200 && response.status !== 503) throw new Error('Health request failed');
        const next = HealthResponseSchema.parse(await response.json());
        if (!abort.signal.aborted) setHealth(next);
      } catch {
        if (!abort.signal.aborted) {
          setHealth(undefined);
          setFailed(true);
        }
      }
    }
    void refresh();
    return () => abort.abort();
  }, [attempt]);

  return (
    <main>
      <h1>Acquisition connector health</h1>
      <p role="status">{health ? (health.status === 'ready' ? 'System ready' : 'System not ready') :
        failed ? 'Control service unreachable' : 'Checking readiness…'}</p>
      <dl aria-label="Service readiness">
        <dt>Control database</dt>
        <dd>{health ? readiness[health.controlDb] : 'Unknown'}</dd>
        <dt>Control migration</dt>
        <dd>{health?.migrationVersions.control ?? 'Unobserved'}</dd>
        <dt>Runtime database</dt>
        <dd>{health ? readiness[health.runtimeDb] : 'Unknown'}</dd>
        <dt>Runtime migration</dt>
        <dd>{health?.migrationVersions.runtime ?? 'Unobserved'}</dd>
      </dl>
      {health?.diagnostics.length ? <ul>{health.diagnostics.map(diagnostic =>
        <li key={diagnostic.code}>{diagnostic.message}</li>)}</ul> : null}
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry health check</button>
    </main>
  );
}
