import { useEffect, useState, type FormEvent } from 'react';
import { getDossier } from '../../../../../packages/client/src/sources.js';
import { IdSchema } from '../../../../../packages/contracts/src/common.js';
import type { SourceDossier } from '../../../../../packages/contracts/src/source.js';
import { EvidencePanel } from './EvidencePanel.js';
import { Diagnostics, RequestFailure } from './review-details.js';
import { UploadForm } from './UploadForm.js';

const companies = [
  { companyId: 'company-a', sourceRef: 'legacy-a', label: 'Company A' },
  { companyId: 'company-b', sourceRef: 'legacy-b', label: 'Company B' },
];

export function SourcesPage({ allowedSourceRefs }: { allowedSourceRefs: string[] }) {
  const [companyId, setCompanyId] = useState('');
  const company = companies.find(item => item.companyId === companyId && allowedSourceRefs.includes(item.sourceRef));
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Local evidence</p>
      <h1>Sources and evidence</h1>
      <p>Inspect the coordinated capture and open the original records behind each citation.</p>
    </header>
    <label className="review-selection">Demo company
      <select value={company?.companyId ?? ''} onChange={event => setCompanyId(event.target.value)}>
        <option value="">Select a company</option>
        {companies.map(item => <option key={item.companyId} value={item.companyId} disabled={!allowedSourceRefs.includes(item.sourceRef)}>
          {item.label} · {item.sourceRef}
        </option>)}
      </select>
    </label>
    {company ? <CompanySources key={company.companyId} company={company} /> : <p>Select a company to inspect its source evidence.</p>}
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

  return <>
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

  if (error) return <RequestFailure error={error} next="Select a different manifest or refresh the dossier." />;
  if (!result) return <p role="status">Loading source dossier…</p>;
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
    {!result.complete ? <p>Evidence becomes available after a complete capture.</p> : !result.evidenceIds.length
      ? <p>This capture contains no citations.</p>
      : <>
        <label className="review-selection">Evidence citation
          <select value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">Select a citation</option>
            {result.evidenceIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        {selected && <EvidencePanel evidenceId={selected} />}
      </>}
  </>;
}
