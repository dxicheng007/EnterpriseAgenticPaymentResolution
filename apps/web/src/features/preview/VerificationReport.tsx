import { VerificationCheckIdSchema, type VerificationJob } from '../../../../../packages/contracts/src/review.js';

export function VerificationReport({ job }: { job: VerificationJob }) {
  const summary = job.state === 'completed' ? job.summary : undefined;
  const mandatory = VerificationCheckIdSchema.options.map(id => ({
    id, check: summary?.checks.find(item => item.id === id),
  }));
  const complete = !!summary?.coverageComplete && mandatory.every(({ check }) =>
    check && check.status !== 'unavailable');
  const eligible = complete && summary.eligible && mandatory.every(({ check }) => check?.status === 'passed');

  return <section aria-label="Independent verification">
    <h3>Independent verification</h3>
    <p>Job {job.jobId} · {job.state}</p>
    {job.diagnostics.length > 0 && <ul>{job.diagnostics.map((item, index) =>
      <li key={index}>{item.code} · {item.message}</li>)}</ul>}
    {job.state === 'completed' && !summary && <p>Verification report unavailable.</p>}
    {summary && <>
      <p>{complete ? 'Mandatory coverage complete' : 'Mandatory coverage incomplete'}</p>
      <p>{eligible ? 'Eligible for review' : 'Eligibility not established'}</p>
      <p>Report {summary.reportId} · Manifest <code>{summary.manifestHash}</code></p>
      <table className="review-table">
        <thead><tr><th scope="col">Mandatory check</th><th scope="col">Status</th><th scope="col">Diagnostics</th></tr></thead>
        <tbody>{mandatory.map(({ id, check }) => <tr key={id}>
          <th scope="row">{id.replaceAll('_', ' ')}</th>
          <td>{check?.status === 'passed' ? 'Passed' : check?.status === 'failed' ? 'Failed' : 'Unavailable'}</td>
          <td>{check?.diagnosticCodes.join(', ') || '—'}</td>
        </tr>)}</tbody>
      </table>
    </>}
    <p>Agent-authored tests are unavailable in this development workspace.</p>
  </section>;
}
