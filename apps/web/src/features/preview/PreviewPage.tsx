import { useEffect, useRef, useState } from 'react';
import { LocalApiError, requestLocal } from '../../../../../packages/client/src/http.js';
import { previewConnector } from '../../../../../packages/client/src/preview.js';
import { DemoCandidatesResponseSchema, type DemoCandidatesResponse } from '../../../../../packages/contracts/src/local-demo.js';
import type { PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import { Diagnostics, RequestFailure } from '../sources/review-details.js';
import { PreviewResult } from './PreviewResult.js';
import { VerificationPanel } from './VerificationPanel.js';

type Candidate = DemoCandidatesResponse['candidates'][number];

export function PreviewPage() {
  const [attempt, setAttempt] = useState(0);
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Development fixtures</p>
      <h1>Connector preview</h1>
      <p>Inspect executable mappings and projected balances against an empty target fixture.</p>
    </header>
    <CandidateList key={attempt} refresh={() => setAttempt(value => value + 1)} />
  </main>;
}

function CandidateList({ refresh }: { refresh: () => void }) {
  const [catalog, setCatalog] = useState<DemoCandidatesResponse>();
  const [error, setError] = useState<unknown>();
  const [candidateId, setCandidateId] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void requestLocal('/api/demo/candidates', DemoCandidatesResponseSchema, { signal: abort.signal }).then(response => {
      if (abort.signal.aborted) return;
      if (new Set(response.candidates.map(item => item.id)).size !== response.candidates.length ||
        response.candidates.some(item => item.companyId !== item.scope.companyId ||
          item.sourceRef !== item.request.spec.sourceRef || item.snapshotId !== item.request.snapshotId ||
          !item.request.profiles.some(profile => profile.sourceRef === item.sourceRef &&
            profile.scope.companyId === item.companyId && profile.scope.sellerEntityId === item.scope.sellerEntityId &&
            profile.scope.accountId === item.scope.accountId))) {
        setError(new LocalApiError(200, 'MALFORMED_RESPONSE', 'A candidate did not match its declared source and scope.'));
      } else {
        setCatalog(response);
      }
    }, failure => { if (!abort.signal.aborted) setError(failure); });
    return () => abort.abort();
  }, []);

  if (error != null) return <>
    <h2>Preview candidates unavailable</h2>
    <RequestFailure error={error} next="Refresh the candidate list after the local source service is ready." />
    <button type="button" onClick={refresh}>Refresh candidates</button>
  </>;
  if (!catalog) return <p role="status">Loading preview candidates…</p>;
  if (!catalog.candidates.length) return <>
    <h2>Preview candidates unavailable</h2>
    <p>Completed source captures are needed to bind development candidates to evidence.</p>
    <Diagnostics items={catalog.diagnostics} />
    <button type="button" onClick={refresh}>Refresh candidates</button>
  </>;
  const candidate = catalog.candidates.find(item => item.id === candidateId);
  return <>
    <Diagnostics items={catalog.diagnostics} />
    <div className="review-actions">
      <label>Development candidate
        <select value={candidateId} onChange={event => setCandidateId(event.target.value)}>
          <option value="">Select a candidate</option>
          {catalog.candidates.map(item => <option key={item.id} value={item.id}>
            {item.label} · {item.companyId} / {item.scope.accountId}
          </option>)}
        </select>
      </label>
      <button type="button" onClick={refresh}>Refresh candidates</button>
    </div>
    {candidate && <CandidatePreview key={candidate.id} candidate={candidate} verificationAvailable={catalog.verificationAvailable} />}
  </>;
}

function CandidatePreview({ candidate, verificationAvailable }: { candidate: Candidate; verificationAvailable: boolean }) {
  const [result, setResult] = useState<PreviewResponse>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const current = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => current.current?.abort(), []);

  async function runPreview() {
    if (current.current) return;
    const abort = new AbortController();
    current.current = abort;
    setPending(true);
    setResult(undefined);
    setError(undefined);
    try {
      const response = await previewConnector(candidate.request, abort.signal);
      if (!abort.signal.aborted) setResult(response);
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure);
    } finally {
      current.current = undefined;
      if (!abort.signal.aborted) setPending(false);
    }
  }

  const { scope, request } = candidate;
  const evidenceRefs = [
    ...request.spec.evidenceRefs,
    ...request.profiles.flatMap(profile => [
      ...profile.approvedLookups.flatMap(table => table.entries.flatMap(entry => entry.evidenceRefs)),
      ...profile.contractTerms.flatMap(term => term.evidenceRefs),
      ...profile.findings.flatMap(finding => finding.evidenceRefs),
    ]),
  ];
  return <>
    <section className="review-card">
      <h2>{candidate.label}</h2>
      <dl className="review-facts">
        <dt>Company</dt><dd>{scope.companyId}</dd>
        <dt>Seller</dt><dd>{scope.sellerEntityId}</dd>
        <dt>Account</dt><dd>{scope.accountId}</dd>
        <dt>Source</dt><dd>{candidate.sourceRef}</dd>
        <dt>Snapshot</dt><dd>{candidate.snapshotId}</dd>
        <dt>As of</dt><dd>{request.asOf}</dd>
        <dt>Target</dt><dd>Empty development fixture</dd>
      </dl>
      <details>
        <summary>Source contracts</summary>
        <ul>{request.spec.sourceContracts.map(contract => <li key={contract.resource}>
          <strong>{contract.resource}</strong> · {contract.schemaVersion}
          <p>Fields <code>{Object.keys(contract.fields).join(', ')}</code></p>
        </li>)}</ul>
      </details>
      <button type="button" onClick={() => void runPreview()} disabled={pending}>Run preview</button>
      {pending && <p role="status">Running preview…</p>}
      {error != null && <RequestFailure error={error} next="Retry the preview or refresh the candidate list." />}
    </section>
    {result && <PreviewResult result={result} evidenceRefs={result.artifact ? evidenceRefs : []}
      profileScopes={request.profiles.map(profile => profile.scope)} />}
    <VerificationPanel key={result?.artifact?.hash ?? 'no-artifact'}
      available={verificationAvailable} connectorId={request.spec.id} snapshotId={candidate.snapshotId}
      artifact={result?.artifact ?? null} />
  </>;
}
