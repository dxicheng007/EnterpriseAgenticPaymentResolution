import { useEffect, useMemo, useRef, useState } from 'react';
import { stagedWorkingSteps } from './staged-company-a.js';
import { stageDelay } from './stub-mode.js';

export type WorkingVariant = 'meter' | 'pulse' | 'orbit' | 'checklist' | 'shimmer';

type Presentation = {
  variant: WorkingVariant;
  eyebrow: string;
  steps: readonly string[];
  totalMs: number;
};

const variantByTitle: Array<{ match: RegExp } & Presentation> = [
  {
    match: /preview/i,
    variant: 'meter',
    eyebrow: 'Preview',
    totalMs: 5600,
    steps: [
      'Building the import plan…',
      'Checking balances…',
      'Comparing proposed changes…',
      'Confirming books stay untouched…',
      'Packaging the preview…',
    ],
  },
  {
    match: /preparing approval|approval package|review package|preparing review/i,
    variant: 'checklist',
    eyebrow: 'Approval package',
    totalMs: 4800,
    steps: [
      'Gathering evidence…',
      'Attaching import rules and profile…',
      'Recording the expected starting balance…',
      'Ready for your decision…',
    ],
  },
  {
    match: /approval|recording approval/i,
    variant: 'pulse',
    eyebrow: 'Approval',
    totalMs: 6200,
    steps: [
      'Confirming this is one customer only…',
      'Creating the go-live request…',
      'Setting first-import limits…',
      'Waiting for worker confirmation…',
      'Confirming go-live version…',
    ],
  },
  {
    match: /balance|parent/i,
    variant: 'shimmer',
    eyebrow: 'Balances',
    totalMs: 2800,
    steps: [
      'Choosing the balance date…',
      'Reading stored balances…',
      'Keeping the go-live snapshot…',
    ],
  },
  {
    match: /refresh|status|connection/i,
    variant: 'orbit',
    eyebrow: 'Status',
    totalMs: 2600,
    steps: [
      'Reading go-live version…',
      'Loading confirmation history…',
      'Confirming AI stays off…',
    ],
  },
  {
    match: /payment|sync|inject|applying/i,
    variant: 'meter',
    eyebrow: 'Sync',
    totalMs: 7200,
    steps: [
      'Reading new source activity…',
      'Normalizing payment amounts…',
      'Applying the sync…',
      'Updating allocations in books…',
      'Saving confirmation…',
      'Checking there is no double apply…',
    ],
  },
  {
    match: /replay/i,
    variant: 'meter',
    eyebrow: 'Replay',
    totalMs: 4800,
    steps: [
      'Loading the last sync confirmation…',
      'Replaying the same sync…',
      'Confirming the balance is unchanged…',
      'Keeping the original confirmation…',
    ],
  },
  {
    match: /session|opening/i,
    variant: 'shimmer',
    eyebrow: 'Session',
    totalMs: 3600,
    steps: [
      'Opening your demo session…',
      'Checking reviewer access…',
      'Loading the workspace…',
    ],
  },
  {
    match: /readiness|health/i,
    variant: 'orbit',
    eyebrow: 'Status',
    totalMs: 3200,
    steps: [
      'Checking the control service…',
      'Checking databases…',
      'Confirming schema versions…',
    ],
  },
];

function resolvePresentation(title: string, steps: readonly string[], totalMs?: number): Presentation {
  const found = variantByTitle.find(entry => entry.match.test(title));
  return {
    variant: found?.variant ?? 'checklist',
    eyebrow: found?.eyebrow ?? 'Working',
    steps: found?.steps ?? steps,
    totalMs: totalMs ?? found?.totalMs ?? 3200,
  };
}

export function DemoWorking({
  title = 'Working…',
  steps = stagedWorkingSteps,
  totalMs,
  variant,
  mode = 'complete',
  onDone,
}: {
  title?: string;
  steps?: readonly string[];
  totalMs?: number;
  variant?: WorkingVariant;
  /** complete: run once then call onDone. wait: loop until unmounted. */
  mode?: 'complete' | 'wait';
  onDone?: () => void;
}) {
  const presentation = useMemo(() => {
    const resolved = resolvePresentation(title, steps, totalMs);
    return {
      ...resolved,
      variant: variant ?? resolved.variant,
    };
  }, [steps, title, totalMs, variant]);
  const [index, setIndex] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const abort = new AbortController();
    const activeSteps = presentation.steps;
    const slice = Math.max(550, Math.floor(presentation.totalMs / Math.max(activeSteps.length, 1)));

    void (async () => {
      let step = 0;
      while (!abort.signal.aborted) {
        setIndex(step);
        try {
          await stageDelay(slice, abort.signal);
        } catch {
          return;
        }
        const next = step + 1;
        if (next >= activeSteps.length) {
          if (mode === 'wait') {
            step = 0;
            continue;
          }
          onDoneRef.current?.();
          return;
        }
        step = next;
      }
    })();

    return () => abort.abort();
  }, [mode, presentation.steps, presentation.totalMs]);

  const current = presentation.steps[Math.min(index, presentation.steps.length - 1)] ?? title;
  const progress = mode === 'wait'
    ? undefined
    : Math.round(((index + 1) / presentation.steps.length) * 100);

  return <div className="demo-working" role="status" aria-live="polite" aria-busy="true">
    <div className={'demo-working-card demo-working-' + presentation.variant}>
      <header>
        <p className="review-eyebrow">{presentation.eyebrow}</p>
        <h2>{title}</h2>
      </header>

      <div className="demo-working-body">
        {presentation.variant === 'meter' ? (
          <>
            <div className={'demo-working-meter' + (mode === 'wait' ? ' is-indeterminate' : '')}
              aria-hidden="true">
              <span style={progress === undefined ? undefined : { width: progress + '%' }} />
            </div>
            <p className="demo-working-caption">{current}</p>
          </>
        ) : null}

        {presentation.variant === 'pulse' ? (
          <div className="demo-working-pulse">
            <div className="demo-working-pulse-rings" aria-hidden="true">
              <span className="demo-working-pulse-ring" />
              <span className="demo-working-pulse-ring" />
              <span className="demo-working-pulse-ring" />
              <span className="demo-working-pulse-core" />
            </div>
            <p className="demo-working-caption">{current}</p>
          </div>
        ) : null}

        {presentation.variant === 'orbit' ? (
          <div className="demo-working-orbit">
            <div className="demo-working-orbit-track" aria-hidden="true">
              <span className="demo-working-orbit-dot" />
            </div>
            <p className="demo-working-caption">{current}</p>
          </div>
        ) : null}

        {presentation.variant === 'shimmer' ? (
          <>
            <div className="demo-working-shimmer" aria-hidden="true">
              <span /><span /><span />
            </div>
            <p className="demo-working-caption">{current}</p>
          </>
        ) : null}

        {presentation.variant === 'checklist' ? (
          <ol className="demo-working-checklist">
            {presentation.steps.map((step, stepIndex) =>
              <li key={step} aria-current={stepIndex === index ? 'step' : undefined}
                className={stepIndex < index ? 'demo-working-done'
                  : stepIndex === index ? 'demo-working-active' : undefined}>
                <span className="demo-working-check" aria-hidden="true" />
                <span>{step}</span>
              </li>)}
          </ol>
        ) : null}
      </div>

      <p className="demo-working-meta">
        <span>Step {index + 1} of {presentation.steps.length}</span>
        <span>{progress === undefined ? 'In progress' : progress + '%'}</span>
      </p>
    </div>
  </div>;
}

/** Offline demo banner: enter when the live session cannot open, leave when returning to live APIs. */
export function DemoStubBanner({ enabled, onEnable, onDisable }: {
  enabled: boolean;
  onEnable: () => void;
  onDisable?: () => void;
}) {
  if (enabled) {
    if (!onDisable) return null;
    return <aside className="demo-stub-banner" aria-label="Local demo session">
      <p>Local walkthrough active. Live reviewer APIs are paused in this tab.</p>
      <button type="button" className="ghost" onClick={onDisable}>Use live session</button>
    </aside>;
  }
  return <aside className="demo-stub-banner" aria-label="Local demo session">
    <p>Demo reviewer session unavailable. Continue with the local Company A walkthrough.</p>
    <button type="button" className="secondary" onClick={onEnable}>Continue</button>
  </aside>;
}
