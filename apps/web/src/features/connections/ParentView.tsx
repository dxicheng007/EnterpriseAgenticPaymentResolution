import { useEffect, useRef, useState, type FormEvent } from 'react';
import { readAccountActivation, readParentAccount } from '../../../../../packages/client/src/parent.js';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import type { LocalSession } from '../../../../../packages/client/src/session.js';
import type { ActivationStateV1 } from '../../../../../packages/contracts/src/activation-authority.js';
import { ParentReadQuerySchema } from '../../../../../packages/contracts/src/runtime.js';
import type { ParentReadQuery, ParentView as ParentViewState, SyncReceipt } from '../../../../../packages/contracts/src/runtime.js';
import { formatUsdCents } from '../preview/preview-values.js';
import { RequestFailure } from '../sources/review-details.js';

function inspectionStatus(view: ParentViewState, activation: ActivationStateV1) {
  if (view.version === 0 && activation.activation === null && activation.initialReceipt === null) return 'Not imported';
  if (activation.activation) return 'Activation ' + activation.activation.status;
  return 'No activation is stored';
}

function RecordTable({ records }: { records: ParentViewState['records'] }) {
  const financial = [
    ...records.invoices, ...records.payments, ...records.credits, ...records.allocations, ...records.reversals,
  ];
  if (financial.length === 0 && records.customers.length === 0 && records.accounts.length === 0 &&
    records.billingConfigurations.length === 0) {
    return <p>No financial or metadata records are stored.</p>;
  }
  return <>
    <h3>Financial records</h3>
    {financial.length === 0 ? <p>No financial records are stored.</p> : <table className="review-table">
      <thead><tr><th>Kind</th><th>Record</th><th>Amount</th><th>Effective time</th><th>Source event</th></tr></thead>
      <tbody>{financial.map(record => <tr key={record.id}>
        <td>{record.kind}</td>
        <td>{record.id}</td>
        <td>{'amountCents' in record ? formatUsdCents(record.amountCents) : 'None'}</td>
        <td>{record.effectiveAt}</td>
        <td>{record.sourceEventId}</td>
      </tr>)}</tbody>
    </table>}
    <h3>Metadata records</h3>
    {records.customers.length === 0 && records.accounts.length === 0 && records.billingConfigurations.length === 0
      ? <p>No metadata records are stored.</p>
      : <ul>
        {records.customers.map(customer => <li key={customer.id}>Customer {customer.id} · {customer.displayName}</li>)}
        {records.accounts.map(account => <li key={account.id}>Account {account.id} · source accounts {account.sourceAccountIds.join(', ') || 'none'}</li>)}
        {records.billingConfigurations.map(configuration => <li key={configuration.id}>Billing configuration {configuration.id}</li>)}
      </ul>}
  </>;
}

function ReceiptFacts({ receipt }: { receipt: SyncReceipt }) {
  return <>
    <dt>Initial receipt</dt><dd>{receipt.id}</dd>
    <dt>Receipt epoch</dt><dd>{receipt.epoch}</dd>
    <dt>Receipt committed at</dt><dd>{receipt.committedAt}</dd>
    <dt>Receipt balance before</dt><dd>{formatUsdCents(receipt.beforeBalanceCents)}</dd>
    <dt>Receipt balance after</dt><dd>{formatUsdCents(receipt.afterBalanceCents)}</dd>
  </>;
}

export function ParentInspection({ accountId, view, activation }: {
  accountId: string;
  view: ParentViewState;
  activation: ActivationStateV1;
}) {
  const sameAccount = view.scope.accountId === accountId && activation.scope.accountId === accountId &&
    view.scope.companyId === activation.scope.companyId && view.scope.sellerEntityId === activation.scope.sellerEntityId;
  if (!sameAccount) {
    return <p role="alert">The parent response did not match the selected account.</p>;
  }
  const authority = activation.activation;
  const status = inspectionStatus(view, activation);
  return <section className="review-card" aria-label="Parent inspection">
    <h2>Stored parent state</h2>
    <p><strong>{status}</strong></p>
    {status === 'Not imported' && <p>A registered scope with parent version zero and no activation or initial receipt has no imported records.</p>}
    <dl className="review-facts">
      <dt>Company</dt><dd>{view.scope.companyId}</dd>
      <dt>Seller</dt><dd>{view.scope.sellerEntityId}</dd>
      <dt>Account</dt><dd>{view.scope.accountId}</dd>
      <dt>Parent version</dt><dd>{view.version}</dd>
      <dt>Balance evaluation time</dt><dd>{view.asOf}</dd>
      <dt>Recorded snapshot time</dt><dd>{view.records.asOf}</dd>
      <dt>Recorded snapshot hash</dt><dd><code>{view.snapshotHash}</code></dd>
      <dt>Stored balance</dt><dd>{formatUsdCents(view.balanceCents)}</dd>
      <dt>Activation</dt><dd>{authority ? authority.status : 'Absent'}</dd>
      {authority && <>
        <dt>Activation ID</dt><dd>{authority.id}</dd>
        <dt>Activation epoch</dt><dd>{authority.epoch}</dd>
        <dt>Approved at</dt><dd>{authority.approvedAt}</dd>
        <dt>Reviewer</dt><dd>{authority.reviewerId}</dd>
      </>}
      {activation.initialReceipt ? <ReceiptFacts receipt={activation.initialReceipt} /> :
        <><dt>Initial receipt</dt><dd>Absent</dd></>}
    </dl>
    <RecordTable records={view.records} />
    <h3>Legacy references</h3>
    {view.legacyReferences.length === 0 ? <p>No legacy references are stored.</p> : <ul>
      {view.legacyReferences.map(reference => <li key={reference.targetRecordId}>
        {reference.targetRecordId} · {reference.identity.kind} {reference.identity.recordId} · source event {reference.sourceEventId}
      </li>)}
    </ul>}
  </section>;
}

function AccountInspection({ accountId, session }: { accountId: string; session: LocalSession }) {
  const [asOf, setAsOf] = useState('');
  const [snapshotHash, setSnapshotHash] = useState('');
  const [applied, setApplied] = useState<ParentReadQuery>({});
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<ParentViewState>();
  const [activation, setActivation] = useState<ActivationStateV1>();
  const [parentError, setParentError] = useState<unknown>();
  const [activationError, setActivationError] = useState<unknown>();
  const parentRequest = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    setActivation(undefined);
    setActivationError(undefined);
    void readAccountActivation(accountId, controller.signal).then(state => {
      if (!controller.signal.aborted) setActivation(state);
    }, failure => {
      if (!controller.signal.aborted) setActivationError(failure);
    });
    return () => controller.abort();
  }, [accountId, session]);

  useEffect(() => {
    const controller = new AbortController();
    parentRequest.current?.abort();
    parentRequest.current = controller;
    setView(undefined);
    setParentError(undefined);
    void readParentAccount(accountId, applied, controller.signal).then(state => {
      if (!controller.signal.aborted) setView(state);
    }, failure => {
      if (!controller.signal.aborted) setParentError(failure);
    });
    return () => controller.abort();
  }, [accountId, applied, attempt, session]);

  function applySelectors(event: FormEvent) {
    event.preventDefault();
    const selection: ParentReadQuery = {};
    if (asOf !== '') selection.asOf = asOf;
    if (snapshotHash !== '') selection.snapshotHash = snapshotHash;
    const parsed = ParentReadQuerySchema.safeParse(selection);
    if (!parsed.success) {
      parentRequest.current?.abort();
      setView(undefined);
      setParentError(new LocalApiError(400, 'PARENT_READ_INVALID', 'Parent read selectors are invalid.'));
      return;
    }
    setApplied(parsed.data);
    setAttempt(value => value + 1);
  }

  const ready = view !== undefined && activation !== undefined && parentError == null && activationError == null;
  return <>
    <form className="review-fields" onSubmit={applySelectors}>
      <label>Balance evaluation time
        <input value={asOf} onChange={event => setAsOf(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <label>Historical snapshot hash
        <input value={snapshotHash} onChange={event => setSnapshotHash(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <button type="submit">Apply parent selectors</button>
    </form>
    <p>The evaluation time selects the stored balance. The snapshot hash selects a recorded snapshot. An unknown hash remains unavailable.</p>
    {parentError != null && <RequestFailure error={parentError} next="Adjust the selectors or choose the account again." />}
    {activationError != null && <RequestFailure error={activationError} next="Choose the account again." />}
    {!ready && parentError == null && activationError == null && <p role="status">Loading parent records…</p>}
    {ready && <ParentInspection accountId={accountId} view={view} activation={activation} />}
  </>;
}

export function ParentView({ session }: { session: LocalSession }) {
  const [chosen, setAccountId] = useState('');
  const accountId = session.allowedAccountIds.includes(chosen) ? chosen : '';

  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Registered parent</p>
      <h1>Parent records</h1>
      <p>Parent reads return the stored records and activation state for one account.</p>
    </header>
    {session.allowedAccountIds.length === 0 && <p>No accounts are authorized for this reviewer session.</p>}
    {session.allowedAccountIds.length > 0 && <>
      <label className="review-selection">Registered account
        <select value={accountId} onChange={event => setAccountId(event.target.value)}>
          <option value="">Select an account</option>
          {session.allowedAccountIds.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      {accountId && <AccountInspection key={accountId} accountId={accountId} session={session} />}
    </>}
  </main>;
}
