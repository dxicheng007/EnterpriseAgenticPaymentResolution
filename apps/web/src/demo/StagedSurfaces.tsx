import { useCallback, useState } from 'react';
import { formatUsdCents } from '../features/preview/preview-values.js';
import { DemoWorking } from './DemoWorking.js';
import { stagedCompanyA } from './staged-company-a.js';

function StagedDisclaimer() {
  return <p className="demo-stub-note" role="note">{stagedCompanyA.disclaimer}</p>;
}

export function StagedHealthPanel() {
  return <section className="review-card" aria-label="Staged health">
    <p className="review-eyebrow">{stagedCompanyA.label}</p>
    <p role="status">System ready</p>
    <dl className="review-facts">
      <dt>Control database</dt><dd>Ready</dd>
      <dt>Runtime database</dt><dd>Ready</dd>
      <dt>Control migration</dt><dd>staged</dd>
      <dt>Runtime migration</dt><dd>staged</dd>
    </dl>
    <StagedDisclaimer />
  </section>;
}

export function StagedPreviewPanel() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const finish = useCallback(() => setPhase('done'), []);
  return <section className="review-card" aria-label="Staged preview">
    <p className="review-eyebrow">Development fixture · staged parent records</p>
    <h2>Company A · Shared Buyer d22feb38e846</h2>
    <dl className="review-facts">
      <dt>Candidate</dt><dd>{stagedCompanyA.candidateId}</dd>
      <dt>Account</dt><dd>{stagedCompanyA.accountId}</dd>
      <dt>Source</dt><dd>{stagedCompanyA.sourceRef}</dd>
      <dt>As of</dt><dd>{stagedCompanyA.cutoverAsOf}</dd>
    </dl>
    <button type="button" disabled={phase === 'working'} onClick={() => setPhase('working')}>Run preview</button>
    {phase === 'working' && <DemoWorking title="Running staged preview…" onDone={finish} />}
    {phase === 'done' && <div className="balance-diff">
      <p>Preview only. No records have been imported.</p>
      <dl className="review-facts">
        <dt>Parent writes</dt><dd>{stagedCompanyA.parentWrites}</dd>
        <dt>Amount still owed after proposed import</dt>
        <dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
      </dl>
      <StagedDisclaimer />
    </div>}
  </section>;
}

export function StagedReviewPanel() {
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'ready' | 'approving' | 'approved'>('idle');
  const finishPrepare = useCallback(() => setPhase('ready'), []);
  const finishApprove = useCallback(() => setPhase('approved'), []);
  return <section className="review-card" aria-label="Staged customer review">
    <p className="review-eyebrow">Per-customer review · staged</p>
    <h2>{stagedCompanyA.accountId}</h2>
    <p>Approve this customer only. Staged mode does not publish a real activation bundle.</p>
    <div className="review-actions">
      <button type="button" disabled={phase === 'preparing' || phase === 'approving'}
        onClick={() => setPhase('preparing')}>Prepare review package</button>
      <button type="button" disabled={phase !== 'ready'}
        onClick={() => setPhase('approving')}>Approve this customer only</button>
    </div>
    {(phase === 'preparing' || phase === 'approving') &&
      <DemoWorking title={phase === 'preparing' ? 'Preparing staged package…' : 'Recording staged approval…'}
        onDone={phase === 'preparing' ? finishPrepare : finishApprove} />}
    {(phase === 'ready' || phase === 'approved') && <dl className="review-facts">
      <dt>Package hash</dt><dd><code>{stagedCompanyA.packageHash}</code></dd>
      <dt>Artifact</dt><dd><code>{stagedCompanyA.artifactHash}</code></dd>
      <dt>Profile</dt><dd><code>{stagedCompanyA.profileHash}</code></dd>
      <dt>Ready</dt><dd>Ready for reviewer decision</dd>
      <dt>Expected cutover balance</dt><dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
    </dl>}
    {phase === 'approved' && <section aria-label="Activation receipt">
      <h3>Activation receipt</h3>
      <dl className="review-facts">
        <dt>Receipt</dt><dd>{stagedCompanyA.receiptId}</dd>
        <dt>Activation</dt><dd>{stagedCompanyA.activationId}</dd>
        <dt>Epoch</dt><dd>{stagedCompanyA.epoch}</dd>
        <dt>Balance after</dt><dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
        <dt>Replayed</dt><dd>false</dd>
      </dl>
      <StagedDisclaimer />
    </section>}
  </section>;
}

export function StagedParentPanel() {
  const [asOf, setAsOf] = useState<string>(stagedCompanyA.currentAsOf);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [shownAsOf, setShownAsOf] = useState<string>(stagedCompanyA.currentAsOf);
  const finish = useCallback(() => {
    setShownAsOf(asOf);
    setPhase('done');
  }, [asOf]);
  const cents = shownAsOf <= stagedCompanyA.cutoverAsOf
    ? stagedCompanyA.cutoverCents
    : stagedCompanyA.currentCents;
  return <section className="review-card" aria-label="Staged parent inspection">
    <p className="review-eyebrow">{stagedCompanyA.label}</p>
    <h2>Stored parent state</h2>
    <label>As of
      <input value={asOf} onChange={event => setAsOf(event.target.value)} />
    </label>
    <button type="button" disabled={phase === 'working'} onClick={() => setPhase('working')}>
      Read parent
    </button>
    {phase === 'working' && <DemoWorking title="Reading staged parent state…" onDone={finish} totalMs={1600} />}
    {phase === 'done' && <dl className="review-facts">
      <dt>Account</dt><dd>{stagedCompanyA.accountId}</dd>
      <dt>Balance evaluation time</dt><dd>{shownAsOf}</dd>
      <dt>Stored balance</dt><dd>{formatUsdCents(cents)}</dd>
      <dt>Activation</dt><dd>active</dd>
      <dt>Cutover asOf still</dt><dd>{formatUsdCents(stagedCompanyA.cutoverCents)} at {stagedCompanyA.cutoverAsOf}</dd>
    </dl>}
    <StagedDisclaimer />
  </section>;
}

export function StagedOperationsPanel() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [injected, setInjected] = useState(false);
  const finish = useCallback(() => setPhase('done'), []);
  return <section className="review-card" aria-label="Staged connection operations">
    <p className="review-eyebrow">{stagedCompanyA.label}</p>
    <h2>Connection operations</h2>
    <p>Account {stagedCompanyA.accountId}</p>
    <div className="review-actions">
      <button type="button" disabled={phase === 'working'} onClick={() => setPhase('working')}>
        Refresh connection state
      </button>
      <button type="button" disabled={phase === 'working'} onClick={() => {
        setInjected(true);
        setPhase('working');
      }}>Simulate inject + sync</button>
    </div>
    {phase === 'working' && <DemoWorking
      title={injected ? 'Applying staged post-cutover payment…' : 'Refreshing staged connection…'}
      onDone={finish} />}
    {phase === 'done' && <dl className="review-facts">
      <dt>Status</dt><dd>active</dd>
      <dt>Epoch</dt><dd>{stagedCompanyA.epoch}</dd>
      <dt>Runtime model calls</dt><dd>AI-off / forbidden by worker posture (staged; not measured)</dd>
      <dt>Last sync receipt</dt><dd>{injected ? stagedCompanyA.syncReceiptId : stagedCompanyA.receiptId}</dd>
      <dt>Balance before</dt><dd>{formatUsdCents(injected ? stagedCompanyA.cutoverCents : 0)}</dd>
      <dt>Balance after</dt>
      <dd>{formatUsdCents(injected ? stagedCompanyA.currentCents : stagedCompanyA.cutoverCents)}</dd>
      <dt>Pending / quarantine / lag</dt><dd>Not measured</dd>
    </dl>}
    <StagedDisclaimer />
  </section>;
}

export function StagedSourcesPanel() {
  return <section className="review-card" aria-label="Staged sources">
    <p className="review-eyebrow">{stagedCompanyA.label}</p>
    <h2>Sources and evidence</h2>
    <dl className="review-facts">
      <dt>Company</dt><dd>{stagedCompanyA.companyId}</dd>
      <dt>Source</dt><dd>{stagedCompanyA.sourceRef}</dd>
      <dt>Manifest</dt><dd>{stagedCompanyA.manifestId}</dd>
    </dl>
    <p>Original captured evidence remains distinct from staged interpretations. Open live Sources when the control
      service is available.</p>
    <StagedDisclaimer />
  </section>;
}

export function StagedDiscoveryPanel() {
  return <section className="review-card" aria-label="Staged discovery">
    <p className="review-eyebrow">{stagedCompanyA.label}</p>
    <h2>Discovery</h2>
    <p role="status">Discovery model is unavailable.</p>
    <p>The runtime worker has no model client. This demo uses a pregenerated development fixture, not live construction.</p>
    <StagedDisclaimer />
  </section>;
}
