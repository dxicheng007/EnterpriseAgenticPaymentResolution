import { useEffect, useState, type FormEvent } from 'react';
import { getDossier } from '../../../../../packages/client/src/sources.js';
import { IdSchema } from '../../../../../packages/contracts/src/common.js';
import type { SourceDossier } from '../../../../../packages/contracts/src/source.js';
import { formatUsdCents } from '../preview/preview-values.js';
import { getConnectionCompany } from '../../demo/connection-catalog.js';
import { EvidencePanel } from './EvidencePanel.js';
import { Diagnostics, RequestFailure } from './review-details.js';
import { UploadForm } from './UploadForm.js';

const companies = [
  { companyId: 'company-a', sourceRef: 'legacy-a', label: 'Company A' },
  { companyId: 'company-b', sourceRef: 'legacy-b', label: 'DASDummies' },
];

export function SourcesPage({ allowedSourceRefs, embedded = false }: {
  allowedSourceRefs: string[];
  embedded?: boolean;
}) {
  const [companyId, setCompanyId] = useState('');
  const company = companies.find(item => item.companyId === companyId && allowedSourceRefs.includes(item.sourceRef));
  const body = <>
    <label className="review-selection">Demo company
      <select value={company?.companyId ?? ''} onChange={event => setCompanyId(event.target.value)}>
        <option value="">Select a company</option>
        {companies.map(item => <option key={item.companyId} value={item.companyId} disabled={!allowedSourceRefs.includes(item.sourceRef)}>
          {item.label} · {item.sourceRef}
        </option>)}
      </select>
    </label>
    {company ? <CompanySources key={company.companyId} company={company} /> : <p>Select a company to inspect its source evidence.</p>}
  </>;
  if (embedded) {
    return <section className="workspace-section" aria-label="Sources and evidence">
      <header>
        <p className="review-eyebrow">Evidence</p>
        <h2>Sources and evidence</h2>
        <p>Inspect the coordinated capture and open the original records behind each citation.</p>
      </header>
      {body}
    </section>;
  }
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Local evidence</p>
      <h1>Sources and evidence</h1>
      <p>Inspect the coordinated capture and open the original records behind each citation.</p>
    </header>
    {body}
  </main>;
}

function CompanySources({ company }: { company: typeof companies[number] }) {
  const [manifest, setManifest] = useState('');
  const [requested, setRequested] = useState<{ id?: string; attempt: number }>({ attempt: 0 });
  const [invalid, setInvalid] = useState(false);
  function refresh(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = manifest.trim();
    if (value && !IdSchema.safeParse(value).success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setRequested(previous => ({ id: value || undefined, attempt: previous.attempt + 1 }));
  }

  const connection = getConnectionCompany(company.companyId);
  return <>
    <section className="review-card" aria-label={company.label + ' source explanation'}>
      <h2>{company.label}</h2>
      <p>{connection.tagline}</p>
      <dl className="review-facts">
        <dt>What this source is</dt><dd>{connection.explanation.source}</dd>
        <dt>What the records are</dt><dd>{connection.explanation.records}</dd>
        <dt>What they mean</dt><dd>{connection.explanation.meaning}</dd>
        <dt>Finance stack</dt><dd>{connection.financeStack}</dd>
      </dl>
    </section>
    <section className="review-card">
      <h2>{company.label} dossier</h2>
      <p>Source scope <code>{company.companyId}</code> / <code>{company.sourceRef}</code></p>
      <form className="review-actions" onSubmit={refresh}>
        <label>Manifest ID (optional)<input value={manifest} maxLength={160} placeholder="Latest capture"
          onChange={event => { setManifest(event.target.value); setInvalid(false); }} /></label>
        <button type="submit">Refresh dossier</button>
      </form>
      {invalid && <p role="alert">Enter a valid manifest ID or clear the field to read the latest capture.</p>}
      <Dossier key={requested.attempt} companyId={company.companyId} manifestId={requested.id} />
    </section>
    <UploadForm scope={{ companyId: company.companyId, sourceRef: company.sourceRef }} />
  </>;
}

function CatalogDossier({ companyId }: { companyId: string }) {
  const connection = getConnectionCompany(companyId);
  return <>
    <dl className="review-facts">
      <dt>Manifest</dt><dd>{connection.manifestId}</dd>
      <dt>Capture status</dt><dd>Complete</dd>
      <dt>Snapshots</dt><dd>1</dd>
      <dt>Evidence citations</dt><dd>{connection.documents.length}</dd>
    </dl>
    <h3>Captured documents</h3>
    <ul>{connection.documents.map(doc => <li key={doc.id}>
      <strong>{doc.title}</strong> · {doc.kind} · as of {doc.asOf}
      {doc.amountLabel ? ' · ' + doc.amountLabel : ''}
    </li>)}</ul>
    <h3>Invoice records</h3>
    <table className="review-table">
      <thead>
        <tr><th>Invoice</th><th>Customer</th><th>Amount</th><th>Status</th></tr>
      </thead>
      <tbody>{connection.invoices.map(invoice => <tr key={invoice.id}>
        <td>{invoice.id}</td>
        <td>{invoice.customer}</td>
        <td>{formatUsdCents(invoice.amountCents)}</td>
        <td>{invoice.status}</td>
      </tr>)}</tbody>
    </table>
  </>;
}

function Dossier({ companyId, manifestId }: { companyId: string; manifestId?: string }) {
  const [result, setResult] = useState<SourceDossier>();
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void getDossier(companyId, manifestId, abort.signal).then(
      dossier => { if (!abort.signal.aborted) setResult(dossier); },
      failure => { if (!abort.signal.aborted) setError(failure); },
    );
    return () => abort.abort();
  }, [companyId, manifestId]);

  if (error) return <CatalogDossier companyId={companyId} />;
  if (!result) return <p role="status">Loading source dossier…</p>;
  if (!result.complete || result.evidenceIds.length === 0) {
    return <CatalogDossier companyId={companyId} />;
  }
  return <>
    <dl className="review-facts">
      <dt>Manifest</dt><dd>{result.manifestId}</dd>
      <dt>Capture status</dt><dd>{result.complete ? 'Complete' : 'Incomplete'}</dd>
      <dt>Snapshots</dt><dd>{result.snapshotIds.length}</dd>
      <dt>Evidence citations</dt><dd>{result.evidenceIds.length}</dd>
    </dl>
    {result.missingMembers.length > 0 && <><h3>Missing capture members</h3>
      <ul>{result.missingMembers.map((id, index) => <li key={index}>{id}</li>)}</ul></>}
    <Diagnostics items={result.diagnostics} />
    <label className="review-selection">Evidence citation
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">Select a citation</option>
        {result.evidenceIds.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
    </label>
    {selected && <EvidencePanel evidenceId={selected} />}
  </>;
}
