import { useEffect, useState } from 'react';
import type { EvidenceRef, EvidenceResponse } from '../../../../../packages/contracts/src/evidence.js';
import { getEvidence } from '../../../../../packages/client/src/sources.js';
import { LocalApiError } from '../../../../../packages/client/src/http.js';

function locatorLabel(locator: EvidenceRef['locator']): string {
  switch (locator.kind) {
    case 'pdf': return `PDF page ${locator.page}, offsets ${locator.start}–${locator.end}`;
    case 'csv': return `CSV data row ${locator.row}, column ${locator.column}`;
    case 'json': return `JSON pointer ${locator.pointer || '(root)'}`;
    case 'email': return `Email ${locator.messageId}, offsets ${locator.start}–${locator.end}`;
  }
}

export function EvidenceCitation({ response }: { response: EvidenceResponse }) {
  const { evidence, text, original } = response;
  const originalUrl = original.url + (evidence.locator.kind === 'pdf' ? '#page=' + evidence.locator.page : '');
  return (
    <article aria-label="Evidence citation">
      <h3>{evidence.id}</h3>
      <dl className="review-facts">
        <dt>Snapshot</dt><dd>{evidence.snapshotId}</dd>
        <dt>Source record</dt><dd>{evidence.sourceId}</dd>
        <dt>Location</dt><dd>{locatorLabel(evidence.locator)}</dd>
        <dt>Original SHA-256</dt><dd><code>{original.sha256}</code></dd>
      </dl>
      <pre className="evidence-excerpt" aria-label="Citation text">{text.value.slice(0, text.startInclusive)}
        <mark>{text.value.slice(text.startInclusive, text.endExclusive)}</mark>
        {text.value.slice(text.endExclusive)}</pre>
      <a href={originalUrl} target="_blank" rel="noopener noreferrer">Open original ({original.byteLength} bytes)</a>
    </article>
  );
}

export function EvidencePanel({ evidenceId, expectedSnapshotId }: { evidenceId: string; expectedSnapshotId?: string }) {
  return <EvidenceSelection key={evidenceId + '@' + (expectedSnapshotId ?? '')} evidenceId={evidenceId} expectedSnapshotId={expectedSnapshotId} />;
}

function EvidenceSelection({ evidenceId, expectedSnapshotId }: { evidenceId: string; expectedSnapshotId?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<EvidenceResponse>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const abort = new AbortController();
    void getEvidence(evidenceId, abort.signal).then(
      next => { if (!abort.signal.aborted) setResponse(next); },
      failure => { if (!abort.signal.aborted) setError(failure); },
    );
    return () => abort.abort();
  }, [evidenceId, attempt]);

  if (response && expectedSnapshotId !== undefined && response.evidence.snapshotId !== expectedSnapshotId) {
    return <p role="alert">This citation is from snapshot {response.evidence.snapshotId}, not the reviewed snapshot {expectedSnapshotId}.
      It is not shown as support for this approval.</p>;
  }
  if (response) return <EvidenceCitation response={response} />;
  if (!error) return <p role="status">Loading evidence…</p>;
  const action = error instanceof LocalApiError && (error.status === 403 || error.status === 404)
    ? 'Select a citation available in this dossier.' : 'Retry the evidence read.';
  return <div role="alert">
    <p>{error instanceof LocalApiError ? error.message : 'The citation could not be opened.'} {action}</p>
    <button type="button" onClick={() => { setError(undefined); setAttempt(value => value + 1); }}>Retry evidence</button>
  </div>;
}
