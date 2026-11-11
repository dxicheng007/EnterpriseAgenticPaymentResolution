import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUsdCents } from '../features/preview/preview-values.js';
import { DemoWorking } from './DemoWorking.js';
import {
  connectionBalanceCents,
  connectionCompanies,
  connectionCompanyOptions,
  getConnectionBeat,
  getConnectionCompany,
  onConnectionBeatChange,
  setConnectionBeat,
  type ConnectionCompany,
} from './connection-catalog.js';
import { formatDisplayDate } from './staged-company-a.js';

function useBeat(accountId: string) {
  const [beat, setBeat] = useState(() => getConnectionBeat(accountId));
  useEffect(() => {
    // Re-read when the selected account changes; listeners alone only fire on writes.
    setBeat(getConnectionBeat(accountId));
    return onConnectionBeatChange(() => setBeat(getConnectionBeat(accountId)));
  }, [accountId]);
  return beat;
}

function CompanyPicker({
  value,
  onChange,
  allowedSourceRefs,
}: {
  value: string;
  onChange: (id: string) => void;
  allowedSourceRefs?: readonly string[];
}) {
  const options = connectionCompanyOptions(allowedSourceRefs);
  return <label className="review-selection">Registered company
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Select a company</option>
      {options.map(item => <option key={item.id} value={item.id}>
        {item.name} · {item.sourceRef}
      </option>)}
    </select>
  </label>;
}

function AccountPicker({
  value,
  onChange,
  allowedAccountIds,
}: {
  value: string;
  onChange: (id: string) => void;
  allowedAccountIds?: readonly string[];
}) {
  const options = connectionCompanies.filter(item =>
    !allowedAccountIds || allowedAccountIds.includes(item.accountId));
  return <label className="review-selection">Registered account
    <select value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Select an account</option>
      {options.map(item => <option key={item.accountId} value={item.accountId}>
        {item.name} · {item.parentCustomerName}
      </option>)}
    </select>
  </label>;
}

function companyFromAccount(accountId: string): ConnectionCompany | undefined {
  return connectionCompanies.find(item => item.accountId === accountId);
}

export function ConnectionSourcesPanel({ allowedSourceRefs }: { allowedSourceRefs?: readonly string[] }) {
  const [companyId, setCompanyId] = useState('');
  const company = companyId ? getConnectionCompany(companyId) : undefined;
  const allowed = !company || !allowedSourceRefs || allowedSourceRefs.includes(company.sourceRef);

  return <section className="workspace-section" aria-label="Sources and evidence">
    <header>
      <p className="review-eyebrow">Evidence</p>
      <h2>Sources and evidence</h2>
      <p>Inspect the coordinated capture and open the original records behind each citation.</p>
    </header>
    <CompanyPicker value={companyId} onChange={setCompanyId} allowedSourceRefs={allowedSourceRefs} />
    {!company && <p>Select a company to inspect its source evidence.</p>}
    {company && !allowed && <p role="alert">This source is outside the current reviewer grants.</p>}
    {company && allowed && <SourceDossier company={company} />}
  </section>;
}

function SourceDossier({ company }: { company: ConnectionCompany }) {
  return <>
    <section className="review-card" aria-label={company.name + ' source explanation'}>
      <h2>{company.name}</h2>
      <p>{company.tagline}</p>
      <dl className="review-facts">
        <dt>What this source is</dt><dd>{company.explanation.source}</dd>
        <dt>What the records are</dt><dd>{company.explanation.records}</dd>
        <dt>What they mean</dt><dd>{company.explanation.meaning}</dd>
        <dt>Finance stack</dt><dd>{company.financeStack}</dd>
        <dt>Source reference</dt><dd><code>{company.sourceRef}</code></dd>
        <dt>Evidence package</dt><dd>{company.authorize.manifest} · <code>{company.manifestId}</code></dd>
        <dt>Capture status</dt><dd>Complete</dd>
      </dl>
    </section>

    <section className="review-card" aria-label="Source systems">
      <h3>Source systems</h3>
      <p>Systems agents read when assembling the dossier for {company.name}.</p>
      <table className="review-table">
        <thead>
          <tr><th>System</th><th>Kind</th><th>Vendor</th><th>Records</th><th>Freshness</th></tr>
        </thead>
        <tbody>{company.systems.map(system => <tr key={system.id}>
          <td>{system.name}</td>
          <td>{system.kind}</td>
          <td>{system.vendor}</td>
          <td>{system.records}</td>
          <td>{system.freshness}</td>
        </tr>)}</tbody>
      </table>
    </section>

    <section className="review-card" aria-label="Captured documents">
      <h3>Captured documents</h3>
      <p>Pinned originals. Citations open these files — they are not rewritten by review.</p>
      <ul>{company.documents.map(doc => <li key={doc.id}>
        <strong>{doc.title}</strong> · {doc.kind} · as of {doc.asOf}
        {doc.amountLabel ? ' · ' + doc.amountLabel : ''}
      </li>)}</ul>
    </section>

    <section className="review-card" aria-label="Invoice records">
      <h3>Invoice records in the capture</h3>
      <table className="review-table">
        <thead>
          <tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th></tr>
        </thead>
        <tbody>{company.invoices.map(invoice => <tr key={invoice.id}>
          <td>{invoice.id}</td>
          <td>{invoice.customer}</td>
          <td>{invoice.issued}</td>
          <td>{invoice.due}</td>
          <td>{formatUsdCents(invoice.amountCents)}</td>
          <td>{invoice.status}</td>
        </tr>)}</tbody>
      </table>
    </section>
  </>;
}

export function ConnectionDiscoveryPanel({ allowedSourceRefs }: { allowedSourceRefs?: readonly string[] }) {
  const [companyId, setCompanyId] = useState<string>(connectionCompanies[0]!.id);
  const company = getConnectionCompany(companyId);
  const allowed = !allowedSourceRefs || allowedSourceRefs.includes(company.sourceRef);

  return <section className="workspace-section" aria-label="Find mappings">
    <header>
      <p className="review-eyebrow">Mappings</p>
      <h2>Find mappings</h2>
      <p>Inspect translation proposals agents derived from the captured source systems.</p>
    </header>
    <CompanyPicker value={companyId} onChange={setCompanyId} allowedSourceRefs={allowedSourceRefs} />
    {!allowed ? <p role="alert">This source is outside the current reviewer grants.</p> : <>
      <p role="status">Exploration complete for {company.name}. {company.translations.length} mapping proposals ready for Connect.</p>
      <section className="review-card">
        <h3>Proposed mappings</h3>
        <ul>{company.translations.map(chunk => <li key={chunk.id}>
          <strong>{chunk.sourceLabel}</strong> → {chunk.targetLabel}
          <br />
          <small>{chunk.sourceSystem} · {chunk.rule} · evidence {chunk.evidence}</small>
        </li>)}</ul>
      </section>
    </>}
  </section>;
}

export function ConnectionPreviewPanel() {
  const [companyId, setCompanyId] = useState('');
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const company = companyId ? getConnectionCompany(companyId) : undefined;
  const finish = useCallback(() => setPhase('done'), []);

  useEffect(() => { setPhase('idle'); }, [companyId]);

  return <section className="workspace-section" aria-label="Connector preview">
    <header>
      <p className="review-eyebrow">Dry-run</p>
      <h2>Connector preview</h2>
      <p>Review proposed imports and the amount still owed using the scoped parent records.</p>
    </header>
    <CompanyPicker value={companyId} onChange={setCompanyId} />
    {!company && <p>Select a company to dry-run its connector against parent books.</p>}
    {company && <>
      <section className="review-card">
        <h3>{company.candidateLabel}</h3>
        <dl className="review-facts">
          <dt>Account</dt><dd>{company.accountId}</dd>
          <dt>Source</dt><dd>{company.sourceRef}</dd>
          <dt>Seller</dt><dd>{company.sellerEntityId}</dd>
          <dt>Evaluated as of</dt><dd>{formatDisplayDate(company.preview.asOf)}</dd>
          <dt>Import rules</dt><dd>{company.authorize.connector}</dd>
          <dt>Matching profile</dt><dd>{company.authorize.profile}</dd>
          <dt>Parent writes during preview</dt><dd>0</dd>
        </dl>
        {phase !== 'working' && <div className="review-actions">
          <button type="button" onClick={() => setPhase('working')}>Run connector preview</button>
        </div>}
        {phase === 'working' && <DemoWorking title="Previewing import…" variant="meter" onDone={finish} />}
      </section>

      {phase === 'done' && <>
        <section className="review-card" aria-label="Preview result">
          <h3>Preview result</h3>
          <p>Dry-run only. Nothing was written to parent books.</p>
          <dl className="review-facts">
            <dt>Balance before</dt><dd>{formatUsdCents(company.preview.beforeBalanceCents)}</dd>
            <dt>Balance after proposed import</dt><dd>{formatUsdCents(company.preview.afterBalanceCents)}</dd>
            <dt>Proposed operations</dt><dd>{company.preview.operations.length}</dd>
            <dt>Holds</dt><dd>None</dd>
          </dl>
          <h4>Proposed operations</h4>
          <ol>{company.preview.operations.map(op => <li key={op.recordId}>
            {op.kind} · {op.recordId}
            {op.amountCents ? ' · ' + formatUsdCents(op.amountCents) : ''}
            {' — '}{op.note}
          </li>)}</ol>
        </section>
        <section className="review-card" aria-label="Source coverage">
          <h3>Source-account coverage</h3>
          <table className="review-table">
            <thead><tr><th>Source account</th><th>Events</th><th>Evidence</th><th>Status</th></tr></thead>
            <tbody>{company.preview.coverage.map(row => <tr key={row.accountId}>
              <td>{row.accountId}</td>
              <td>{row.events}</td>
              <td>{row.evidence}</td>
              <td>{row.status}</td>
            </tr>)}</tbody>
          </table>
        </section>
      </>}
    </>}
  </section>;
}

export function ConnectionAuthorizePanel({ allowedAccountIds }: { allowedAccountIds?: readonly string[] }) {
  const [accountId, setAccountId] = useState('');
  const company = accountId ? companyFromAccount(accountId) : undefined;
  const beat = useBeat(accountId || 'none');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'ready' | 'approving'>('idle');

  useEffect(() => {
    setPhase(beat === 'fresh' ? 'idle' : 'ready');
  }, [accountId, beat]);

  const approved = beat !== 'fresh';
  const finishPrepare = useCallback(() => setPhase('ready'), []);
  const finishApprove = useCallback(() => {
    if (accountId) setConnectionBeat(accountId, 'approved');
    setPhase('ready');
  }, [accountId]);

  return <section className="workspace-section" aria-label="Customer review">
    <header>
      <p className="review-eyebrow">Per-customer review</p>
      <h2>Customer review</h2>
      <p>Review one customer’s prepared package. Approval grants bounded standing authority for that customer only.</p>
    </header>
    <AccountPicker value={accountId} onChange={setAccountId} allowedAccountIds={allowedAccountIds} />
    {!company && <p>Select an account to prepare and approve its package.</p>}
    {company && <section className="review-card" aria-label="Review package">
      <h3>{company.candidateLabel}</h3>
      <p>Approve this customer only. That grants bounded standing authority for automatic sync under the reviewed rules.</p>
      <dl className="review-facts">
        <dt>Company</dt><dd>{company.name}</dd>
        <dt>Account</dt><dd>{company.accountId}</dd>
        <dt>Customer in books</dt><dd>{company.parentCustomerName}</dd>
        <dt>Evidence package</dt><dd>{company.authorize.manifest}</dd>
        <dt>Import rules</dt><dd>{company.authorize.connector}</dd>
        <dt>Matching profile</dt><dd>{company.authorize.profile}</dd>
        <dt>Expected starting balance</dt><dd>{formatUsdCents(company.authorize.startingBalanceCents)}</dd>
        <dt>Status</dt>
        <dd>{approved ? 'Approved' : phase === 'ready' ? 'Ready for your decision' : 'Not prepared'}</dd>
      </dl>
      {(phase === 'preparing' || phase === 'approving') && <DemoWorking
        title={phase === 'preparing' ? 'Preparing review package…' : 'Recording approval…'}
        variant={phase === 'preparing' ? 'checklist' : 'pulse'}
        onDone={phase === 'preparing' ? finishPrepare : finishApprove} />}
      {phase !== 'preparing' && phase !== 'approving' && <div className="review-actions">
        <button type="button" disabled={approved} onClick={() => setPhase('preparing')}>
          Prepare review package
        </button>
        <button type="button" className="secondary" disabled={phase !== 'ready' || approved}
          onClick={() => setPhase('approving')}>
          Approve this customer only
        </button>
      </div>}
      {approved && <section aria-label="Activation receipt">
        <h3>Worker receipt</h3>
        <dl className="review-facts">
          <dt>Receipt</dt><dd>{company.authorize.receiptId}</dd>
          <dt>Activation</dt><dd>{company.authorize.activationId} · epoch 1</dd>
          <dt>Balance before</dt><dd>{formatUsdCents(0)}</dd>
          <dt>Balance after</dt><dd>{formatUsdCents(company.authorize.startingBalanceCents)}</dd>
          <dt>Records written</dt><dd>{company.preview.operations.length}</dd>
        </dl>
      </section>}
    </section>}
  </section>;
}

export function ConnectionParentPanel({
  allowedAccountIds,
  accountId,
  onAccountIdChange,
}: {
  allowedAccountIds?: readonly string[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
}) {
  const company = accountId ? companyFromAccount(accountId) : undefined;
  const beat = useBeat(accountId || 'none');
  const [asOf, setAsOf] = useState('');
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [shownAsOf, setShownAsOf] = useState('');

  useEffect(() => {
    if (!company) return;
    setAsOf(company.operate.cutoverAsOf);
    setPhase('idle');
    setShownAsOf('');
  }, [accountId]);

  const finish = useCallback(() => {
    setShownAsOf(asOf);
    setPhase('done');
  }, [asOf]);

  return <section className="workspace-section" aria-label="Parent records">
    <header>
      <p className="review-eyebrow">Balances</p>
      <h2>Parent records</h2>
      <p>Read stored balances and imported records for an authorized customer.</p>
    </header>
    <AccountPicker value={accountId} onChange={onAccountIdChange} allowedAccountIds={allowedAccountIds} />
    {!company && <p>Select an account to inspect parent books.</p>}
    {company && <>
      <label className="review-selection">Balance date
        <select value={asOf} onChange={event => setAsOf(event.target.value)}>
          <option value={company.operate.cutoverAsOf}>
            Go-live · {formatDisplayDate(company.operate.cutoverAsOf)}
          </option>
          <option value={company.operate.currentAsOf}>
            Latest · {formatDisplayDate(company.operate.currentAsOf)}
          </option>
        </select>
      </label>
      {phase === 'working' ? <DemoWorking title="Reading balances…" variant="shimmer" onDone={finish} /> : (
        <div className="review-actions">
          <button type="button" onClick={() => setPhase('working')}>Read balances</button>
        </div>
      )}
      {phase === 'done' && shownAsOf && <section className="review-card" aria-label="Parent inspection">
        <h3>Stored parent state</h3>
        <p><strong>{beat === 'fresh' ? 'Not imported' : 'Activation active'}</strong></p>
        <dl className="review-facts">
          <dt>Company</dt><dd>{company.name}</dd>
          <dt>Seller</dt><dd>{company.operate.seller}</dd>
          <dt>Account</dt><dd>{company.accountId}</dd>
          <dt>Customer in books</dt><dd>{company.parentCustomerName}</dd>
          <dt>Balance as of</dt><dd>{formatDisplayDate(shownAsOf)}</dd>
          <dt>Stored balance</dt><dd>{formatUsdCents(connectionBalanceCents(company, shownAsOf))}</dd>
          <dt>Go-live status</dt><dd>{beat === 'fresh' ? 'Not live yet' : 'Live'}</dd>
        </dl>
        <h4>Imported line items</h4>
        <table className="review-table">
          <thead><tr><th>Label</th><th>Source</th><th>Parent</th><th>Amount</th></tr></thead>
          <tbody>{company.operate.lines.map(line => <tr key={line.label}>
            <td>{line.label}</td>
            <td>{line.source}</td>
            <td>{line.parent}</td>
            <td>{formatUsdCents(line.amountCents)}</td>
          </tr>)}</tbody>
        </table>
      </section>}
    </>}
  </section>;
}

export function ConnectionOperationsPanel({
  allowedAccountIds,
  accountId,
  onAccountIdChange,
}: {
  allowedAccountIds?: readonly string[];
  accountId: string;
  onAccountIdChange: (id: string) => void;
}) {
  const company = accountId ? companyFromAccount(accountId) : undefined;
  const beat = useBeat(accountId || 'none');
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [action, setAction] = useState<'refresh' | 'inject' | 'replay'>('refresh');
  const actionRef = useRef(action);
  actionRef.current = action;

  useEffect(() => { setPhase('idle'); }, [accountId]);

  const activated = beat !== 'fresh';
  const synced = beat === 'synced' || beat === 'replayed';
  const replayed = beat === 'replayed';

  const finish = useCallback(() => {
    if (!accountId) return;
    const completed = actionRef.current;
    if (completed === 'inject') setConnectionBeat(accountId, 'synced');
    else if (completed === 'replay') setConnectionBeat(accountId, 'replayed');
    setPhase('done');
  }, [accountId]);

  function start(next: 'refresh' | 'inject' | 'replay') {
    setAction(next);
    setPhase('working');
  }

  return <section className="workspace-section" aria-label="Keep in sync">
    <header>
      <p className="review-eyebrow">Sync</p>
      <h2>Connection operations</h2>
      <p>Apply new source activity after go-live, or safely replay the last sync.</p>
    </header>
    <AccountPicker value={accountId} onChange={onAccountIdChange} allowedAccountIds={allowedAccountIds} />
    {!company && <p>Select an account to manage its connection.</p>}
    {company && <>
      {phase === 'working' ? (
        <DemoWorking
          title={action === 'inject' ? 'Applying new payment…'
            : action === 'replay' ? 'Replaying last sync…' : 'Refreshing sync status…'}
          variant={action === 'refresh' ? 'orbit' : 'meter'}
          onDone={finish} />
      ) : (
        <div className="review-actions">
          <button type="button" onClick={() => start('refresh')}>Refresh status</button>
          <button type="button" className="secondary" disabled={!activated || synced}
            onClick={() => start('inject')}>
            Apply new payment
          </button>
          <button type="button" className="ghost" disabled={!synced} onClick={() => start('replay')}>
            Replay last sync
          </button>
        </div>
      )}
      {phase === 'done' && !activated && <p role="status">
        Approve this customer on Authorize first, then refresh.
      </p>}
      {phase === 'done' && activated && <section className="review-card" aria-label="Sync status">
        <h3>Sync status</h3>
        <dl className="review-facts">
          <dt>Status</dt><dd>Live</dd>
          <dt>Authority version</dt><dd>1</dd>
          <dt>Go-live</dt><dd>{company.authorize.activationId}</dd>
          <dt>Latest confirmation</dt>
          <dd>{synced ? company.operate.syncReceiptId : company.authorize.receiptId}</dd>
          <dt>Runtime model calls</dt><dd>Off — not used</dd>
          <dt>Balance owed</dt>
          <dd>{formatUsdCents(connectionBalanceCents(company, company.operate.currentAsOf))}</dd>
        </dl>
        {action === 'inject' && <p role="status">{company.operate.syncPaymentLabel}.</p>}
        {action === 'replay' && <p role="status">
          Replay kept the same confirmation ({company.operate.syncReceiptId}) — no second money movement.
        </p>}
        <h4>Confirmation history</h4>
        <table className="review-table">
          <thead>
            <tr>
              <th>Confirmation</th><th>Type</th><th>Balance before</th><th>Balance after</th><th>When</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{company.authorize.receiptId}</td>
              <td>Go-live</td>
              <td>{formatUsdCents(0)}</td>
              <td>{formatUsdCents(company.operate.cutoverCents)}</td>
              <td>{formatDisplayDate(company.operate.cutoverAsOf)}</td>
            </tr>
            {synced ? <tr>
              <td>{company.operate.syncReceiptId}</td>
              <td>Sync{replayed ? ' · replayed' : ''}</td>
              <td>{formatUsdCents(company.operate.cutoverCents)}</td>
              <td>{formatUsdCents(company.operate.currentCents)}</td>
              <td>{formatDisplayDate(company.operate.currentAsOf)}</td>
            </tr> : null}
          </tbody>
        </table>
      </section>}
    </>}
  </section>;
}
