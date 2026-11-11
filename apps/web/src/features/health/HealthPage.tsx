import { useEffect, useState } from 'react';
import { HealthResponseSchema, type HealthResponse } from '../../../../../packages/contracts/src/activity.js';
import { DemoWorking } from '../../demo/DemoWorking.js';

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
      setHealth(undefined);
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
    <main className="review-main">
      <p className="review-eyebrow">System</p>
      <h1>Acquisition connector health</h1>
      {!health && !failed ? (
        <DemoWorking title="Checking readiness…" variant="orbit" mode="wait" />
      ) : (
        <section className="review-card" aria-label="Service readiness">
          <p role="status" className={health?.status === 'ready' ? 'status-ready' : 'status-blocked'}>
            {health ? (health.status === 'ready' ? 'System ready' : 'System not ready') :
              failed ? 'Control service unreachable' : 'Checking readiness…'}
          </p>
          <dl className="review-facts">
            <dt>Control database</dt>
            <dd>{health ? readiness[health.controlDb] : 'Unknown'}</dd>
            <dt>Control migration</dt>
            <dd>{health?.migrationVersions.control ?? 'Unobserved'}</dd>
            <dt>Runtime database</dt>
            <dd>{health ? readiness[health.runtimeDb] : 'Unknown'}</dd>
            <dt>Runtime migration</dt>
            <dd>{health?.migrationVersions.runtime ?? 'Unobserved'}</dd>
          </dl>
          {health?.diagnostics.length ? <ul className="review-diagnostics">{health.diagnostics.map(diagnostic =>
            <li key={diagnostic.code}>{diagnostic.message}</li>)}</ul> : null}
          <div className="review-actions">
            <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>
              Retry health check
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
