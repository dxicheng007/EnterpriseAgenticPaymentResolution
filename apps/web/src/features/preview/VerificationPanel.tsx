import { useEffect, useRef, useState } from 'react';
import { LocalApiError } from '../../../../../packages/client/src/http.js';
import { getVerificationJob, requestVerification } from '../../../../../packages/client/src/verification.js';
import { IdSchema } from '../../../../../packages/contracts/src/common.js';
import type { CompiledArtifact } from '../../../../../packages/contracts/src/connector.js';
import type { VerificationJob } from '../../../../../packages/contracts/src/review.js';
import { RequestFailure } from '../sources/review-details.js';
import { VerificationReport } from './VerificationReport.js';

const pollDelays = [400, 750, 1000, 1500, 2000, 2000, 2000, 2000];

function isPending(job?: VerificationJob) {
  return job?.state === 'queued' || job?.state === 'running';
}

export function VerificationPanel({ available, connectorId, snapshotId, artifact }: {
  available: boolean;
  connectorId: string;
  snapshotId: string;
  artifact: CompiledArtifact | null;
}) {
  const [job, setJob] = useState<VerificationJob>();
  const [error, setError] = useState<unknown>();
  const [starting, setStarting] = useState(false);
  const [slow, setSlow] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const current = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const abort = new AbortController();
    current.current = abort;
    return () => abort.abort();
  }, []);

  const manifest = IdSchema.safeParse(snapshotId.startsWith('snapshot:') ? snapshotId.slice('snapshot:'.length) : '');
  const pendingJobId = isPending(job) ? job?.jobId : undefined;
  useEffect(() => {
    if (!pendingJobId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let index = 0;
    const schedule = () => {
      if (index >= pollDelays.length) {
        setSlow(true);
        return;
      }
      timer = setTimeout(() => void poll(), pollDelays[index++]);
    };
    async function poll() {
      try {
        const next = await getVerificationJob(pendingJobId!, abort.signal);
        if (abort.signal.aborted) return;
        setJob(next);
        if (isPending(next)) schedule();
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure);
      }
    }
    schedule();
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [pendingJobId, pollAttempt]);

  async function verify() {
    if (!available || !artifact || !manifest.success || starting || job) return;
    const abort = current.current;
    setStarting(true);
    setError(undefined);
    try {
      const next = await requestVerification(connectorId, {
        artifactHash: artifact.hash, profileHashes: artifact.requiredProfileHashes, manifestId: manifest.data,
      });
      if (!abort?.signal.aborted) setJob(next);
    } catch (failure) {
      if (!abort?.signal.aborted) setError(failure);
    } finally {
      if (!abort?.signal.aborted) setStarting(false);
    }
  }

  const summary = job?.summary;
  const summaryMatches = !summary || (summary.artifactHash === artifact?.hash &&
    summary.profileHashes.length === artifact.requiredProfileHashes.length &&
    summary.profileHashes.every(hash => artifact.requiredProfileHashes.includes(hash)));
  const unavailable = !available || (error instanceof LocalApiError && [404, 503].includes(error.status) && !job);
  return <section className="review-card">
    <h2>Verification</h2>
    {unavailable && <p>Independent verification unavailable.</p>}
    {available && (!artifact
      ? <p>Run a preview with a compiled artifact to request verification.</p>
      : !manifest.success
        ? <p>Verification unavailable because the preview lacks a pinned manifest.</p>
        : !job && <button type="button" disabled={starting} onClick={() => void verify()}>Verify artifact</button>)}
    {starting && <p role="status">Requesting verification…</p>}
    {error != null && <RequestFailure error={error}
      next={job ? 'Refresh the existing job to check its status.' : 'Check the preview and service before requesting verification again.'} />}
    {job && (summaryMatches ? <VerificationReport job={job} /> : <p role="alert">
      Verification report unavailable because its artifact or profile binding differs from this preview.
    </p>)}
    {pendingJobId && (slow || error != null) && <>
      {slow && <p>Verification is still pending.</p>}
      <button type="button" onClick={() => {
        setSlow(false);
        setError(undefined);
        setPollAttempt(value => value + 1);
      }}>Refresh verification status</button>
    </>}
  </section>;
}
