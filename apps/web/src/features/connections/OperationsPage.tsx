import { useEffect, useState } from 'react';
import {
  changeAuthority, readConnectionState, readCurrentAuthority, type AuthorityAction,
} from '../../../../../packages/client/src/parent.js';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import type { LocalSession } from '../../../../../packages/client/src/session.js';
import {
  AuthorityOperationV1Schema, type AuthorityOperationV1,
} from '../../../../../packages/contracts/src/authority-ingress.js';
import type { ConnectionStateV1 } from '../../../../../packages/contracts/src/connection-state.js';
import type { CurrentAuthorityV1 } from '../../../../../packages/contracts/src/current-authority.js';
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
      <dt>Runtime model calls</dt>
      <dd>AI-off / forbidden by worker posture · {state.runtimeModelCalls ?? unmeasured}</dd>
    </dl>
    <p>Unmeasured values are not zero. Pending, quarantine and lag appear only when the worker records them.
      This single-customer fixture view does not establish isolation for customers that share a capture lane.</p>
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

const actionsFor: Record<CurrentAuthorityV1['status'], AuthorityAction[]> = {
  active: ['pause', 'revoke'], paused: ['resume', 'revoke'], revoked: [],
};
const actionLabel: Record<AuthorityAction, string> = {
  pause: 'Pause', resume: 'Resume', revoke: 'Revoke',
};
const storagePrefix = 'eapr-authority-operation:';

function sameIdentity(left: CurrentAuthorityV1, right: CurrentAuthorityV1) {
  return left.identity.activationId === right.identity.activationId &&
    left.identity.bundleHash === right.identity.bundleHash &&
    left.identity.scope.companyId === right.identity.scope.companyId &&
    left.identity.scope.sellerEntityId === right.identity.scope.sellerEntityId &&
    left.identity.scope.accountId === right.identity.scope.accountId;
}

function readPending(accountId: string): AuthorityOperationV1 | undefined {
  try {
    const value = sessionStorage.getItem(storagePrefix + accountId);
    if (value === null) return;
    const parsed = AuthorityOperationV1Schema.safeParse(JSON.parse(value));
    if (!parsed.success || parsed.data.accountId !== accountId || parsed.data.action === 'read') {
      sessionStorage.removeItem(storagePrefix + accountId);
      return;
    }
    return parsed.data;
  } catch {
    return;
  }
}

function storePending(operation: AuthorityOperationV1 | undefined, accountId: string) {
  if (operation === undefined) sessionStorage.removeItem(storagePrefix + accountId);
  else sessionStorage.setItem(storagePrefix + accountId, JSON.stringify(operation));
}

function AuthorityControls({
  authority, pending, busy, error, outcome, confirming, onConfirming, onRun,
}: {
  authority?: CurrentAuthorityV1;
  pending?: AuthorityOperationV1;
  busy: boolean;
  error?: unknown;
  outcome?: string;
  confirming?: AuthorityAction;
  onConfirming(action?: AuthorityAction): void;
  onRun(operation: AuthorityOperationV1): void;
}) {
  const actions = authority ? actionsFor[authority.status] : [];
  function operation(action: AuthorityAction): AuthorityOperationV1 {
    if (!authority) throw new Error('Authority is unavailable');
    return AuthorityOperationV1Schema.parse({
      schemaVersion: '1',
      accountId: authority.identity.scope.accountId,
      action,
      body: { expectedEpoch: authority.epoch, idempotencyKey: globalThis.crypto.randomUUID() },
    });
  }

  return <section className="review-card" aria-label="Current authority">
    <h2>Current authority</h2>
    {authority && <>
      <p><strong>{authority.status}</strong> · committed epoch {authority.epoch}</p>
      <dl className="review-facts">
        <dt>Activation</dt><dd>{authority.identity.activationId}</dd>
        <dt>Artifact hash</dt><dd>{authority.artifactHash}</dd>
        <dt>Profile hash</dt><dd>{authority.profileHash}</dd>
        <dt>Manifest hash</dt><dd>{authority.manifestHash}</dd>
      </dl>
    </>}
    {error != null && <RequestFailure error={error}
      next="Authority commands are unavailable. Refresh the dedicated authority read before taking a new action." />}
    {!authority && error == null && <p role="status">Loading current authority…</p>}
    {pending && pending.action !== 'read' && <>
      <p>An earlier {pending.action} command has an unresolved outcome. Retry sends its exact saved epoch and key.</p>
      <div className="review-actions">
        <button type="button" disabled={busy} onClick={() => onRun(pending)}>
          Retry original {pending.action}
        </button>
      </div>
    </>}
    {authority && error == null && pending === undefined && <>
      {authority.status === 'revoked'
        ? <p>Authority is revoked and cannot be resumed. A new customer approval is required.</p>
        : <p>Changes apply to this customer only and are checked against authority epoch {authority.epoch}.</p>}
      <div className="review-actions">
        {actions.map(action => <button key={action} type="button" disabled={busy}
          onClick={() => action === 'revoke' ? onConfirming(action) : onRun(operation(action))}>
          {actionLabel[action]} this customer
        </button>)}
      </div>
    </>}
    {confirming === 'revoke' && authority && <div role="alertdialog" aria-label="Confirm revoke">
      <p>Revoking permanently withdraws automatic synchronization for this customer. It cannot be resumed.</p>
      <div className="review-actions">
        <button type="button" disabled={busy} onClick={() => onRun(operation('revoke'))}>Confirm revoke</button>
        <button type="button" disabled={busy} onClick={() => onConfirming(undefined)}>Cancel</button>
      </div>
    </div>}
    {outcome && <p role="status">{outcome}</p>}
  </section>;
}

function AccountOperations({ accountId, session }: { accountId: string; session: LocalSession }) {
  const [state, setState] = useState<ConnectionStateV1>();
  const [overviewError, setOverviewError] = useState<unknown>();
  const [authority, setAuthority] = useState<CurrentAuthorityV1>();
  const [authorityError, setAuthorityError] = useState<unknown>();
  const [pending, setPending] = useState<AuthorityOperationV1 | undefined>(() => readPending(accountId));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string>();
  const [confirming, setConfirming] = useState<AuthorityAction>();
  const [attempt, setAttempt] = useState(0);

  function acceptAuthority(value: CurrentAuthorityV1) {
    setAuthority(current => current && sameIdentity(current, value) && value.epoch < current.epoch ? current : value);
  }

  useEffect(() => {
    const controller = new AbortController();
    setOverviewError(undefined);
    setAuthorityError(undefined);
    void readConnectionState(accountId, controller.signal).then(value => {
      if (!controller.signal.aborted) setState(value);
    }, failure => {
      if (!controller.signal.aborted) setOverviewError(failure);
    });
    void readCurrentAuthority(accountId, controller.signal).then(value => {
      if (!controller.signal.aborted) acceptAuthority(value);
    }, failure => {
      if (!controller.signal.aborted) setAuthorityError(failure);
    });
    return () => controller.abort();
  }, [accountId, session, attempt]);

  async function run(operation: AuthorityOperationV1) {
    if (operation.action === 'read' || operation.accountId !== accountId) return;
    storePending(operation, accountId);
    setPending(operation);
    setBusy(true);
    setAuthorityError(undefined);
    setOutcome(undefined);
    setConfirming(undefined);
    try {
      const response = await changeAuthority(accountId, operation.action, operation.body);
      storePending(undefined, accountId);
      setPending(undefined);
      if (!response.replayed) acceptAuthority(response.result.state);
      setOutcome(actionLabel[operation.action] + ' recorded: ' + response.result.state.status +
        ' at epoch ' + response.result.state.epoch +
        (response.replayed ? ' (replayed historical result)' : response.result.changed ? '' : ' (already in that state)') + '.');
      setAttempt(value => value + 1);
    } catch (failure) {
      setAuthorityError(failure);
      if (failure instanceof LocalApiError && failure.status === 409) {
        storePending(undefined, accountId);
        setPending(undefined);
        setAuthority(undefined);
        setOutcome('The saved command was rejected as stale. Current reads were refreshed; choose a new action deliberately.');
        setAttempt(value => value + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="review-actions"><button type="button" onClick={() => setAttempt(value => value + 1)}>
      Refresh authority and connection state
    </button></div>
    <AuthorityControls authority={authority} pending={pending} busy={busy} error={authorityError}
      outcome={outcome} confirming={confirming} onConfirming={setConfirming} onRun={operation => void run(operation)} />
    {overviewError != null &&
      <RequestFailure error={overviewError} next="Nothing was assumed. Refresh to read the stored overview again." />}
    {state === undefined && overviewError == null && <p role="status">Loading connection state…</p>}
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
