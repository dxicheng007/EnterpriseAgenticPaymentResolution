import { useEffect, useState } from 'react';
import { changeAuthority, readConnectionState, type AuthorityAction } from '../../../../../packages/client/src/parent.js';
import type { LocalSession } from '../../../../../packages/client/src/session.js';
import type { ConnectionStateV1 } from '../../../../../packages/contracts/src/connection-state.js';
import { formatUsdCents } from '../preview/preview-values.js';
import { RequestFailure } from '../sources/review-details.js';

const statusText: Record<ConnectionStateV1['status'], string> = {
  inactive: 'Inactive: no approved activation is stored for this account.',
  active: 'Active: bounded automatic synchronization is authorized for this customer.',
  paused: 'Paused: no new input is applied until a reviewer resumes this customer.',
  revoked: 'Revoked: authority was withdrawn and cannot be resumed.',
};

const unmeasured = 'Not measured';

export function ConnectionInspection({ state }: { state: ConnectionStateV1 }) {
  const { counts } = state;
  return <section className="review-card" aria-label="Connection state">
    <h2>Connection state</h2>
    <p><strong>{state.status}</strong> · {statusText[state.status]}</p>
    <dl className="review-facts">
      <dt>Account</dt><dd>{state.scope.accountId}</dd>
      <dt>Authority epoch</dt><dd>{state.epoch}</dd>
      <dt>Activation</dt><dd>{state.activationId ?? 'None'}</dd>
      <dt>Status changed at</dt><dd>{state.statusChangedAt ?? 'Never'}</dd>
      <dt>Parent version</dt><dd>{state.parentVersion}</dd>
      <dt>Last receipt</dt><dd>{state.lastReceiptId ?? 'None'}</dd>
      <dt>Applied batches</dt><dd>{counts.appliedBatches}</dd>
      <dt>Pending events</dt><dd>{counts.pendingEvents ?? unmeasured}</dd>
      <dt>Quarantined events</dt><dd>{counts.quarantinedEvents ?? unmeasured}</dd>
      <dt>Runtime model calls</dt><dd>{state.runtimeModelCalls}</dd>
    </dl>
    <p>Unmeasured values are not zero. Pending, quarantine and lag appear only when the worker records them.</p>
    <h3>Captured streams</h3>
    {state.streams.length === 0 ? <p>No captured streams are recorded for this account.</p> : <table className="review-table">
      <thead><tr><th>Source</th><th>Stream</th><th>Transport</th><th>Baseline</th><th>Captured through</th><th>Pages</th><th>Last captured</th><th>Lag</th></tr></thead>
      <tbody>{state.streams.map(stream => <tr key={stream.sourceRef + '/' + stream.streamId}>
        <td>{stream.sourceRef}</td><td>{stream.streamId}</td><td>{stream.transport}</td>
        <td>{stream.baselineCursor}</td><td>{stream.capturedThrough}</td><td>{stream.capturedPages}</td>
        <td>{stream.lastCapturedAt ?? 'Never'}</td><td>{stream.lagEvents ?? unmeasured}</td>
      </tr>)}</tbody>
    </table>}
    <h3>Gaps and conflicts</h3>
    {state.incidents.length === 0 ? <p>No capture gaps or conflicts are recorded.</p> : <ul>
      {state.incidents.map(incident => <li key={incident.sourceRef + incident.streamId + incident.code + incident.observedAt}>
        <strong>{incident.code}</strong> · {incident.sourceRef}/{incident.streamId} · observed {incident.observedAt}
        {incident.sourceIds.length > 0 && <> · source events {incident.sourceIds.join(', ')}</>}
      </li>)}
    </ul>}
    <h3>Receipt history</h3>
    {state.receipts.length === 0 ? <p>No receipts are stored for this account.</p> : <table className="review-table">
      <thead><tr><th>Receipt</th><th>Kind</th><th>Epoch</th><th>Versions</th><th>Events</th><th>Records</th><th>Balance before</th><th>Balance after</th><th>Committed</th></tr></thead>
      <tbody>{state.receipts.map(receipt => <tr key={receipt.id}>
        <td>{receipt.id}</td><td>{receipt.kind}</td><td>{receipt.epoch}</td>
        <td>{receipt.beforeVersion ?? 'n/a'} → {receipt.afterVersion}</td>
        <td>{receipt.eventCount}</td><td>{receipt.recordCount}</td>
        <td>{formatUsdCents(receipt.beforeBalanceCents)}</td><td>{formatUsdCents(receipt.afterBalanceCents)}</td>
        <td>{receipt.committedAt}</td>
      </tr>)}</tbody>
    </table>}
  </section>;
}

const actionsFor: Record<ConnectionStateV1['status'], AuthorityAction[]> = {
  inactive: [], active: ['pause', 'revoke'], paused: ['resume', 'revoke'], revoked: [],
};
const actionLabel: Record<AuthorityAction, string> = { pause: 'Pause', resume: 'Resume', revoke: 'Revoke' };

function AuthorityControls({ state, onChanged }: { state: ConnectionStateV1; onChanged(): void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [outcome, setOutcome] = useState<string>();
  const [confirming, setConfirming] = useState<AuthorityAction>();
  // A retry after a lost reply reuses the key so the worker replays instead of repeating the change.
  const [keys] = useState(() => new Map<string, string>());
  const actions = actionsFor[state.status];

  async function run(action: AuthorityAction) {
    const keyName = action + ':' + state.epoch;
    const key = keys.get(keyName) ?? globalThis.crypto.randomUUID();
    keys.set(keyName, key);
    setBusy(true);
    setError(undefined);
    setOutcome(undefined);
    setConfirming(undefined);
    try {
      const { result, replayed } = await changeAuthority(state.scope.accountId, action, state.epoch, key);
      setOutcome(actionLabel[action] + ' recorded: ' + result.state.status + ' at epoch ' + result.state.epoch +
        (replayed ? ' (replayed original result)' : result.changed ? '' : ' (already in that state)') + '.');
      onChanged();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return <section className="review-card" aria-label="Authority controls">
    <h2>Authority controls</h2>
    {state.status === 'inactive' && <p>No approved activation exists, so there is no authority to change.</p>}
    {state.status === 'revoked' && <p>Authority is revoked and cannot be resumed. A new customer approval is required.</p>}
    {actions.length > 0 && <>
      <p>Changes apply to this customer only and are checked against authority epoch {state.epoch}.</p>
      <div className="review-actions">
        {actions.map(action => <button key={action} type="button" disabled={busy}
          onClick={() => action === 'revoke' ? setConfirming('revoke') : void run(action)}>{actionLabel[action]} this customer</button>)}
      </div>
    </>}
    {confirming === 'revoke' && <div role="alertdialog" aria-label="Confirm revoke">
      <p>Revoking permanently withdraws automatic synchronization for this customer. It cannot be resumed.</p>
      <div className="review-actions">
        <button type="button" disabled={busy} onClick={() => void run('revoke')}>Confirm revoke</button>
        <button type="button" disabled={busy} onClick={() => setConfirming(undefined)}>Cancel</button>
      </div>
    </div>}
    {outcome && <p role="status">{outcome}</p>}
    {error != null && <RequestFailure error={error} next="The stored state is unchanged unless a receipt shows otherwise. Refresh, then retry; a retry reuses the same request key." />}
  </section>;
}

function AccountOperations({ accountId, session }: { accountId: string; session: LocalSession }) {
  const [state, setState] = useState<ConnectionStateV1>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    void readConnectionState(accountId, controller.signal).then(value => {
      if (!controller.signal.aborted) setState(value);
    }, failure => {
      if (!controller.signal.aborted) setError(failure);
    });
    return () => controller.abort();
  }, [accountId, session, attempt]);

  return <>
    <div className="review-actions"><button type="button" onClick={() => setAttempt(value => value + 1)}>Refresh connection state</button></div>
    {error != null && <RequestFailure error={error} next="Nothing was assumed. Refresh to read the stored state again." />}
    {state === undefined && error == null && <p role="status">Loading connection state…</p>}
    {state && <AuthorityControls state={state} onChanged={() => setAttempt(value => value + 1)} />}
    {state && <ConnectionInspection state={state} />}
  </>;
}

export function OperationsPage({ session }: { session: LocalSession }) {
  const [chosen, setAccountId] = useState('');
  const accountId = session.allowedAccountIds.includes(chosen) ? chosen : '';
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Operations</p>
      <h1>Connection operations</h1>
      <p>Authoritative worker reads for one customer: authority state, captured streams, gaps and receipts.</p>
    </header>
    {session.allowedAccountIds.length === 0 && <p>No accounts are authorized for this reviewer session.</p>}
    {session.allowedAccountIds.length > 0 && <>
      <label className="review-selection">Registered account
        <select value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">Select an account</option>
          {session.allowedAccountIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {accountId && <AccountOperations key={accountId} accountId={accountId} session={session} />}
    </>}
  </main>;
}
