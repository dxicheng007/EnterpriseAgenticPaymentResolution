import { useEffect, useState } from 'react';
import { stagedWorkingSteps } from './staged-company-a.js';
import { stageDelay } from './stub-mode.js';

export function DemoWorking({
  title = 'Working…',
  steps = stagedWorkingSteps,
  totalMs = 2400,
  onDone,
}: {
  title?: string;
  steps?: readonly string[];
  totalMs?: number;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    const slice = Math.max(400, Math.floor(totalMs / Math.max(steps.length, 1)));
    void (async () => {
      for (let step = 0; step < steps.length; step += 1) {
        if (abort.signal.aborted) return;
        setIndex(step);
        try {
          await stageDelay(slice, abort.signal);
        } catch {
          return;
        }
      }
      if (!abort.signal.aborted) onDone();
    })();
    return () => abort.abort();
  }, [onDone, steps, totalMs]);

  return <div className="demo-working" role="status" aria-live="polite">
    <div className="demo-working-card">
      <p className="review-eyebrow">Staged demo</p>
      <h2>{title}</h2>
      <div className="demo-working-meter" aria-hidden="true"><span style={{ animationDuration: totalMs + 'ms' }} /></div>
      <ol>{steps.map((step, stepIndex) =>
        <li key={step} aria-current={stepIndex === index ? 'step' : undefined}
          className={stepIndex <= index ? 'demo-working-active' : undefined}>{step}</li>)}</ol>
    </div>
  </div>;
}

export function DemoStubBanner({ enabled, onEnable, onDisable }: {
  enabled: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return <aside className="demo-stub-banner" aria-label="Demo response mode">
    {enabled
      ? <>
        <p><strong>Staged demo responses are on.</strong> Buttons show fixture loading theater and hardcoded Company A
          outcomes. They are not live worker receipts.</p>
        <button type="button" onClick={onDisable}>Use live local APIs</button>
      </>
      : <>
        <p>Local services unavailable or incomplete? Enable staged demo responses for a fixture walkthrough with fake
          loading.</p>
        <button type="button" onClick={onEnable}>Enable staged demo responses</button>
      </>}
  </aside>;
}
