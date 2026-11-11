import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { LocalApiError, requestLocal } from '../../../../../packages/client/src/http.js';
import { getSourceCoverage } from '../../../../../packages/client/src/sources.js';
import { previewConnector } from '../../../../../packages/client/src/preview.js';
import { DemoCandidatesResponseSchema, type DemoCandidatesResponse } from '../../../../../packages/contracts/src/local-demo.js';
import type { SourceCoverageResponse } from '../../../../../packages/contracts/src/source-coverage.js';
import type { PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import { ConnectionPreviewPanel } from '../../demo/ConnectionPanels.js';
import { Diagnostics, RequestFailure } from '../sources/review-details.js';
import { PreviewResult } from './PreviewResult.js';
import { SourceCoverage } from './SourceCoverage.js';
import { summarizeSourceCoverage } from './source-coverage-values.js';
import { VerificationPanel } from './VerificationPanel.js';

type Candidate = DemoCandidatesResponse['candidates'][number];

export function PreviewPage({ embedded = false }: { embedded?: boolean }) {
  const [attempt, setAttempt] = useState(0);
  const body = <CandidateList key={attempt} refresh={() => setAttempt(value => value + 1)} />;
  if (embedded) {
    return <section className="workspace-section" aria-label="Connector preview">
      <header>
        <p className="review-eyebrow">Dry-run</p>
        <h2>Connector preview</h2>
        <p>Review proposed imports and the amount still owed using the scoped parent records.</p>
      </header>
      {body}
    </section>;
  }
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Development fixtures</p>
      <h1>Connector preview</h1>
      <p>Review proposed imports and the amount still owed using the scoped parent records.</p>
    </header>
    {body}
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

  if (error != null || (catalog && catalog.candidates.length === 0)) {
    return <ConnectionPreviewPanel />;
  }
  if (!catalog) return <p role="status">Loading preview candidates…</p>;
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
    {candidate && <CandidatePreview key={JSON.stringify([candidate.id, candidate.snapshotId])} candidate={candidate}
      targetMode={catalog.targetMode} verificationAvailable={catalog.verificationAvailable} />}
  </>;
}

function CandidatePreview({ candidate, targetMode, verificationAvailable }: {
  candidate: Candidate;
  targetMode: DemoCandidatesResponse['targetMode'];
  verificationAvailable: boolean;
}) {
  const [result, setResult] = useState<PreviewResponse>();
  const [error, setError] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const current = useRef<AbortController | undefined>(undefined);
  const [coverage, setCoverage] = useState<SourceCoverageResponse>();
  const [coverageError, setCoverageError] = useState<unknown>();
  const [coverageAttempt, setCoverageAttempt] = useState(0);
  const { companyId, sourceRef, snapshotId, request, scope } = candidate;
  useEffect(() => () => current.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController();
    void getSourceCoverage(companyId, snapshotId, abort.signal).then(response => {
      if (abort.signal.aborted) return;
      if (response.sourceRef !== sourceRef) {
        setCoverageError(new LocalApiError(200, 'MALFORMED_RESPONSE', 'Source coverage did not match the selected candidate source.'));
        return;
      }
      setCoverage(response);
    }, failure => {
      if (!abort.signal.aborted) setCoverageError(failure);
    });
    return () => abort.abort();
  }, [companyId, sourceRef, snapshotId, coverageAttempt]);

  const summary = useMemo(() => coverage && summarizeSourceCoverage(coverage, request.profiles),
    [coverage, request.profiles]);

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
      <p className="review-eyebrow">{targetMode === 'empty-fixture'
        ? 'Development fixture · empty target' : 'Development fixture · parent records'}</p>
      <h2>{candidate.label}</h2>
      <p>{request.profiles.length === 1
        ? 'This preview covers one customer from the company snapshot.'
        : `This preview uses ${request.profiles.length} submitted profiles from the company snapshot.`}</p>
      <dl className="review-facts">
        <dt>Company</dt><dd>{scope.companyId}</dd>
        <dt>Seller</dt><dd>{scope.sellerEntityId}</dd>
        <dt>Candidate scope account</dt><dd>{scope.accountId}</dd>
        {request.profiles.map((profile, index) => <Fragment key={index}>
          <dt>{request.profiles.length === 1 ? 'Source account IDs' : `Source account IDs for ${profile.id}`}</dt>
          <dd>{profile.sourceAccountIds.join(', ') || 'None supplied'}</dd>
        </Fragment>)}
        <dt>Source</dt><dd>{sourceRef}</dd>
        <dt>Snapshot</dt><dd>{snapshotId}</dd>
        <dt>Captured as of</dt><dd>{request.asOf}</dd>
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
    <PreviewResult result={result} evidenceRefs={result?.artifact ? evidenceRefs : []}
      asOf={request.asOf} targetMode={targetMode} profileScopes={request.profiles.map(profile => profile.scope)} coverage={summary}
      sourceCoverage={<SourceCoverage response={coverage} summary={summary} failure={coverageError} retry={() => {
        setCoverageError(undefined);
        setCoverageAttempt(value => value + 1);
      }} />} />
    <section className="review-card">
      <h2>Next available step</h2>
      {result ? <p>Review the proposed imports, holds, and their citations.
        {verificationAvailable && result.artifact && ' Request independent verification for this artifact below.'}
        {verificationAvailable && !result.artifact && ' Review the compilation blockers before requesting independent verification.'}
      </p> : <p>Inspect the captured citations, then run the preview to review proposed imports and holds.</p>}
      <p>Live agent construction is pending. It will investigate source identities, contracts, and receivables and propose separate profiles.
        Later enablement requires explicit per-customer review.</p>
    </section>
    <VerificationPanel key={result?.artifact?.hash ?? 'no-artifact'}
      available={verificationAvailable} connectorId={request.spec.id} snapshotId={snapshotId}
      artifact={result?.artifact ?? null} />
  </>;
}
