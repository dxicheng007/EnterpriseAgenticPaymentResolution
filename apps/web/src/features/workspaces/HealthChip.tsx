import { useEffect, useState } from 'react';
import { HealthResponseSchema, type HealthResponse } from '../../../../../packages/contracts/src/activity.js';

export function HealthChip() {
  const [health, setHealth] = useState<HealthResponse>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/health', { signal: abort.signal, cache: 'no-store' }).then(async response => {
      if (response.status !== 200 && response.status !== 503) throw new Error('Health request failed');
      const next = HealthResponseSchema.parse(await response.json());
      if (!abort.signal.aborted) {
        setHealth(next);
        setFailed(false);
      }
    }, () => {
      if (!abort.signal.aborted) {
        setHealth(undefined);
        setFailed(true);
      }
    });
    return () => abort.abort();
  }, []);

  const ready = health?.status === 'ready';
  const label = failed ? 'System unreachable' : !health ? 'Checking system…' : ready ? 'System ready' : 'System not ready';
  return <a className="health-chip" href="#health" data-tone={failed || (health && !ready) ? 'blocked' : ready ? 'ready' : undefined}
    title="Open system status">
    <span className="health-chip-dot" aria-hidden="true" />
    <span>{label}</span>
  </a>;
}
