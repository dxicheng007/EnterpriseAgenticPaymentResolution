import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUsdCents } from '../features/preview/preview-values.js';
import { DemoWorking } from './DemoWorking.js';
import {
  formatDisplayDate,
  getStagedBeat,
  onStagedBeatChange,
  setStagedBeat,
  stagedBalanceCents,
  stagedCompanyA,
  type StagedBeat,
} from './staged-company-a.js';

const labels = stagedCompanyA.display;

function useBeat() {
  const [beat, setBeat] = useState<StagedBeat>(getStagedBeat);
  useEffect(() => onStagedBeatChange(() => setBeat(getStagedBeat())), []);
  return beat;
}

export function StagedHealthPanel() {
  return <section className="review-card" aria-label="Service readiness">
    <p className="review-eyebrow">System</p>
    <p role="status" className="status-ready">System ready</p>
    <dl className="review-facts">
      <dt>Control service</dt><dd>Ready</dd>
      <dt>Worker service</dt><dd>Ready</dd>
      <dt>Control schema</dt><dd>Version {stagedCompanyA.controlMigration}</dd>
      <dt>Worker schema</dt><dd>Version {stagedCompanyA.runtimeMigration}</dd>
    </dl>
  </section>;
}

export function StagedPreviewPanel() {
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const finish = useCallback(() => setPhase('done'), []);
  return <section className="review-card" aria-label="Import preview">
    <p className="review-eyebrow">Preview</p>
    <h2>{labels.candidate}</h2>
    <p>See what would be imported for this customer — nothing is written to the books yet.</p>
    <dl className="review-facts">
      <dt>Customer</dt><dd>{labels.customer}</dd>
      <dt>Account</dt><dd>{labels.account}</dd>
      <dt>Source system</dt><dd>{labels.source}</dd>
      <dt>Seller</dt><dd>{labels.seller}</dd>
      <dt>Balance as of</dt><dd>{formatDisplayDate(stagedCompanyA.cutoverAsOf)}</dd>
      <dt>Import rules</dt><dd>{labels.connector} · v{stagedCompanyA.connectorVersion}</dd>
      <dt>Matching profile</dt><dd>{labels.profile} · v{stagedCompanyA.profileVersion}</dd>
      <dt>Data set</dt><dd>{labels.catalogMode}</dd>
      <dt>Books target</dt><dd>{labels.targetMode}</dd>
    </dl>
    {phase !== 'working' ? (
      <button type="button" className="secondary" onClick={() => setPhase('working')}>
        Preview import
      </button>
    ) : null}
    {phase === 'working' && <DemoWorking title="Previewing import…" variant="meter" onDone={finish} />}
    {phase === 'done' && <div className="balance-diff">
      <p>Preview only. Nothing has been imported yet.</p>
      <dl className="review-facts">
        <dt>Changes to books</dt><dd>{stagedCompanyA.parentWrites}</dd>
        <dt>Balance still owed after proposed import</dt>
        <dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
      </dl>
    </div>}
  </section>;
}

export function StagedReviewPanel() {
  const beat = useBeat();
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'ready' | 'approving' | 'approved'>(
    () => (getStagedBeat() === 'fresh' ? 'idle' : 'approved'),
  );
  const finishPrepare = useCallback(() => setPhase('ready'), []);
  const finishApprove = useCallback(() => {
    setStagedBeat('approved');
    setPhase('approved');
  }, []);
  const approved = phase === 'approved' || beat !== 'fresh';

  return <section className="review-card" aria-label="Approve customer">
    <p className="review-eyebrow">Approve</p>
    <h2>{labels.account}</h2>
    <p>
      Approve this customer only. That gives the worker standing authority to keep this one customer
      in sync — no one else.
    </p>
    {phase === 'preparing' || phase === 'approving' ? (
      <DemoWorking
        title={phase === 'preparing' ? 'Preparing approval package…' : 'Recording approval…'}
        variant={phase === 'preparing' ? 'checklist' : 'pulse'}
        onDone={phase === 'preparing' ? finishPrepare : finishApprove} />
    ) : (
      <div className="review-actions">
        <button type="button" disabled={approved} onClick={() => setPhase('preparing')}>
          Prepare approval package
        </button>
        <button type="button" className="secondary" disabled={phase !== 'ready' || approved}
          onClick={() => setPhase('approving')}>
          Approve this customer
        </button>
      </div>
    )}
    {(phase === 'ready' || approved) && <dl className="review-facts">
      <dt>Status</dt><dd>{approved ? 'Approved' : 'Ready for your decision'}</dd>
      <dt>Expected starting balance</dt><dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
      <dt>Evidence package</dt><dd>{labels.manifest}</dd>
      <dt>Customer in books</dt><dd>{labels.parentCustomer}</dd>
      <dt>Import rules</dt><dd>{labels.connector}</dd>
      <dt>Matching profile</dt><dd>{labels.profile}</dd>
    </dl>}
    {approved && <section aria-label="Go-live confirmation">
      <h3>Go-live confirmation</h3>
      <dl className="review-facts">
        <dt>Confirmation</dt><dd>{labels.activationReceipt}</dd>
        <dt>Go-live</dt><dd>{labels.activation}</dd>
        <dt>Authority version</dt><dd>{stagedCompanyA.epoch}</dd>
        <dt>Balance before</dt><dd>{formatUsdCents(0)}</dd>
        <dt>Balance after</dt><dd>{formatUsdCents(stagedCompanyA.cutoverCents)}</dd>
        <dt>Replayed</dt><dd>No</dd>
      </dl>
    </section>}
  </section>;
}

export function StagedParentPanel() {
  const beat = useBeat();
  const [asOf, setAsOf] = useState<string>(stagedCompanyA.cutoverAsOf);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [shownAsOf, setShownAsOf] = useState<string>(stagedCompanyA.cutoverAsOf);
  const pendingAsOf = useRef<string>(stagedCompanyA.cutoverAsOf);
  const finish = useCallback(() => {
    setShownAsOf(pendingAsOf.current);
    setPhase('done');
  }, []);
  const cents = stagedBalanceCents(shownAsOf);

  function startRead(nextAsOf: string) {
    pendingAsOf.current = nextAsOf;
    setAsOf(nextAsOf);
    setPhase('working');
  }

  return <section className="review-card" aria-label="Customer balances">
    <p className="review-eyebrow">Balances</p>
    <h2>Stored balances in books</h2>
    <p>Check what the books show for {labels.customer} on a given date.</p>
    <label>Balance date
      <select value={asOf} onChange={event => setAsOf(event.target.value)}>
        <option value={stagedCompanyA.cutoverAsOf}>
          Go-live · {formatDisplayDate(stagedCompanyA.cutoverAsOf)}
        </option>
        <option value={stagedCompanyA.currentAsOf}>
          Latest · {formatDisplayDate(stagedCompanyA.currentAsOf)}
        </option>
      </select>
    </label>
    {phase === 'working' ? (
      <DemoWorking title="Reading balances…" variant="shimmer" onDone={finish} />
    ) : (
      <div className="review-actions">
        <button type="button" onClick={() => startRead(asOf)}>Read balances</button>
        <button type="button" className="secondary" onClick={() => startRead(stagedCompanyA.cutoverAsOf)}>
          Go-live date
        </button>
        <button type="button" className="ghost" onClick={() => startRead(stagedCompanyA.currentAsOf)}>
          Latest date
        </button>
      </div>
    )}
    {phase === 'done' && <dl className="review-facts">
      <dt>Account</dt><dd>{labels.account}</dd>
      <dt>Source account</dt><dd>{labels.sourceAccount}</dd>
      <dt>Customer in books</dt><dd>{labels.parentCustomer}</dd>
      <dt>Balance as of</dt><dd>{formatDisplayDate(shownAsOf)}</dd>
      <dt>Stored balance</dt><dd>{formatUsdCents(cents)}</dd>
      <dt>Go-live status</dt><dd>{beat === 'fresh' ? 'Not live yet' : 'Live'}</dd>
      <dt>Starting balance still</dt>
      <dd>{formatUsdCents(stagedCompanyA.cutoverCents)} on {formatDisplayDate(stagedCompanyA.cutoverAsOf)}</dd>
    </dl>}
  </section>;
}

export function StagedOperationsPanel() {
  const beat = useBeat();
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [action, setAction] = useState<'refresh' | 'inject' | 'replay'>('refresh');
  const pendingAction = useRef<'refresh' | 'inject' | 'replay'>('refresh');
  const finish = useCallback(() => {
    const next = pendingAction.current;
    if (next === 'inject') setStagedBeat('synced');
    else if (next === 'replay') setStagedBeat('replayed');
    setAction(next);
    setPhase('done');
  }, []);

  const activated = beat !== 'fresh';
  const synced = beat === 'synced' || beat === 'replayed';
  const replayed = beat === 'replayed';

  function startAction(next: 'refresh' | 'inject' | 'replay') {
    pendingAction.current = next;
    setAction(next);
    setPhase('working');
  }

  return <section className="review-card" aria-label="Keep in sync">
    <p className="review-eyebrow">Sync</p>
    <h2>Keep {labels.customer} in sync</h2>
    <p>Apply new source activity after go-live, or safely replay the last sync.</p>
    {phase === 'working' ? (
      <DemoWorking
        title={action === 'inject'
          ? 'Applying new payment…'
          : action === 'replay'
            ? 'Replaying last sync…'
            : 'Refreshing sync status…'}
        variant={action === 'refresh' ? 'orbit' : 'meter'}
        onDone={finish} />
    ) : (
      <div className="review-actions">
        <button type="button" onClick={() => startAction('refresh')}>Refresh status</button>
        <button type="button" className="secondary" disabled={!activated || synced}
          onClick={() => startAction('inject')}>
          Apply new payment
        </button>
        <button type="button" className="ghost" disabled={!synced} onClick={() => startAction('replay')}>
          Replay last sync
        </button>
      </div>
    )}
    {phase === 'done' && !activated && <p role="status">Approve this customer on the Approve page first, then refresh.</p>}
    {phase === 'done' && activated && <section aria-label="Sync status">
      <h3>Sync status</h3>
      <dl className="review-facts">
        <dt>Status</dt><dd>Live</dd>
        <dt>Authority version</dt><dd>{stagedCompanyA.epoch}</dd>
        <dt>Go-live</dt><dd>{labels.activation}</dd>
        <dt>Latest confirmation</dt>
        <dd>{synced ? labels.syncReceipt : labels.activationReceipt}</dd>
        <dt>AI in the worker</dt><dd>Off — not used</dd>
        <dt>Backlog</dt><dd>None measured</dd>
      </dl>
      {action === 'inject' && <p role="status">
        Applied a ${stagedCompanyA.injectPayment.amount} payment effective{' '}
        {formatDisplayDate(stagedCompanyA.injectPayment.observedAt)}.
      </p>}
      {action === 'replay' && <p role="status">
        Replay kept the same confirmation ({labels.syncReceipt}) — no second money movement.
      </p>}
      <h3>Confirmation history</h3>
      <table className="review-table">
        <thead>
          <tr>
            <th>Confirmation</th>
            <th>Type</th>
            <th>Version</th>
            <th>Balance before</th>
            <th>Balance after</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{labels.activationReceipt}</td>
            <td>Go-live</td>
            <td>{stagedCompanyA.epoch}</td>
            <td>{formatUsdCents(0)}</td>
            <td>{formatUsdCents(stagedCompanyA.cutoverCents)}</td>
            <td>{formatDisplayDate(stagedCompanyA.cutoverAsOf)}</td>
          </tr>
          {synced ? <tr>
            <td>{labels.syncReceipt}</td>
            <td>Sync{replayed ? ' · replayed' : ''}</td>
            <td>{stagedCompanyA.epoch}</td>
            <td>{formatUsdCents(stagedCompanyA.cutoverCents)}</td>
            <td>{formatUsdCents(stagedCompanyA.currentCents)}</td>
            <td>{formatDisplayDate(stagedCompanyA.currentAsOf)}</td>
          </tr> : null}
        </tbody>
      </table>
    </section>}
  </section>;
}

export function StagedSourcesPanel() {
  return <section className="review-card" aria-label="Evidence">
    <p className="review-eyebrow">Evidence</p>
    <h2>Source evidence</h2>
    <p>Original captured files stay separate from interpretations and imported records.</p>
    <dl className="review-facts">
      <dt>Company</dt><dd>{labels.company}</dd>
      <dt>Source system</dt><dd>{labels.source}</dd>
      <dt>Evidence package</dt><dd>{labels.manifest}</dd>
      <dt>Seller</dt><dd>{labels.seller}</dd>
      <dt>Source account</dt><dd>{labels.sourceAccount}</dd>
    </dl>
  </section>;
}

export function StagedDiscoveryPanel() {
  return <section className="review-card" aria-label="Find mappings">
    <p className="review-eyebrow">Mappings</p>
    <h2>Find mappings</h2>
    <p role="status">Mapping suggestions are unavailable.</p>
    <p>The worker does not call a model, so starting a discovery run is unavailable here.</p>
  </section>;
}
