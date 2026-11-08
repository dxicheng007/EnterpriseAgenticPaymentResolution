import { useEffect, useRef, useState, type FormEvent } from 'react';
import { uploadSource } from '../../../../../packages/client/src/sources.js';
import type { UploadMetadata, UploadResponse } from '../../../../../packages/contracts/src/evidence.js';
import { Diagnostics, RequestFailure } from './review-details.js';

type UploadScope = Pick<UploadMetadata, 'companyId' | 'sourceRef'>;

export function UploadForm({ scope }: { scope: UploadScope }) {
  const [kind, setKind] = useState<UploadMetadata['kind']>('contract_pdf');
  const [state, setState] = useState<
    { status: 'idle' | 'pending' } | { status: 'stored'; response: UploadResponse } | { status: 'error'; error: unknown }
  >({ status: 'idle' });
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const values = new FormData(event.currentTarget);
    const file = values.get('file');
    if (!(file instanceof File)) return;
    const batch = kind === 'event_csv' ? {
      batchId: String(values.get('batchId') ?? '').trim(),
      sequence: Number(values.get('sequence')),
      streamId: String(values.get('streamId') ?? '').trim(),
    } : undefined;
    const abort = new AbortController();
    pending.current = abort;
    setState({ status: 'pending' });
    try {
      const response = await uploadSource({
        ...scope, kind, documentId: String(values.get('documentId') ?? '').trim(),
        documentVersion: Number(values.get('documentVersion')), originalName: file.name,
        ...(batch ? { batch } : {}),
      }, file, abort.signal);
      if (!abort.signal.aborted) setState({ status: 'stored', response });
    } catch (error) {
      if (!abort.signal.aborted) setState({ status: 'error', error });
    } finally {
      pending.current = undefined;
    }
  }

  return <section className="review-card">
    <h2>Upload source evidence</h2>
    <p>Selected source <strong>{scope.companyId} / {scope.sourceRef}</strong></p>
    <p>Uploaded files become citations after a complete capture includes them.</p>
    <form onSubmit={event => void submit(event)} onChange={() => {
      if (state.status === 'stored' || state.status === 'error') setState({ status: 'idle' });
    }}>
      <fieldset disabled={state.status === 'pending'}>
        <legend>Document metadata</legend>
        <div className="review-fields">
          <label>Document ID<input name="documentId" required maxLength={160} /></label>
          <label>Document version<input name="documentVersion" required type="number" min={1} step={1} defaultValue={1} /></label>
          <label>Document kind<select value={kind} onChange={event => setKind(event.target.value as UploadMetadata['kind'])}>
            <option value="contract_pdf">Contract PDF</option>
            <option value="amendment_pdf">Amendment PDF</option>
            <option value="event_csv">Event CSV</option>
            <option value="email_json">Email JSON</option>
          </select></label>
          <label>Source file<input name="file" type="file" required
            accept={kind === 'event_csv' ? '.csv,text/csv' : kind === 'email_json' ? '.json,application/json' : '.pdf,application/pdf'} /></label>
          {kind === 'event_csv' && <>
            <label>Batch ID<input name="batchId" required maxLength={160} /></label>
            <label>Sequence<input name="sequence" required type="number" min={1} step={1} /></label>
            <label>Stream ID<input name="streamId" required maxLength={160} /></label>
          </>}
        </div>
        <button type="submit">Store file</button>
      </fieldset>
    </form>
    {state.status === 'pending' && <p role="status">Storing file…</p>}
    {state.status === 'stored' && <div role="status">
      <p>{state.response.duplicate ? 'Exact duplicate already stored.' : 'File stored.'} Waiting for a complete capture.</p>
      <p>File <code>{state.response.fileId}</code> · SHA-256 <code>{state.response.contentHash}</code></p>
      <Diagnostics items={state.response.diagnostics} />
    </div>}
    {state.status === 'error' && <RequestFailure error={state.error}
      next="Check the file and metadata before submitting again." />}
  </section>;
}
