import type { DiscoveryStateV2 } from '../../../../../packages/contracts/src/discovery.js';

const proposalLabel = { draft: 'Draft', compile_blocked: 'Compile blocked', compiled: 'Compiled' } as const;

export function DiscoveryConstruction({ state }: { state: DiscoveryStateV2 }) {
  return <section className="review-card" aria-labelledby="discovery-construction">
    <h2 id="discovery-construction">Connector construction</h2>
    <p>Agent interpretations are not independently verified facts or reviewer decisions.</p>
    <h3>Finding references</h3>
    <p>{state.findings.length ? 'Finding references ' + state.findings.length : 'No findings recorded.'}</p>
    <p>Finding bodies, citations, and document associations are not exposed by this run read API.</p>
    {state.findings.length > 0 && <ul>{state.findings.map(finding => <li key={finding.id}>
      <details>
        <summary>{finding.id}</summary>
        <p>Revision {finding.revision}</p>
        <dl className="review-facts">
          <dt>Task</dt><dd>{finding.taskId}</dd>
          <dt>Subject</dt><dd>{finding.subject.kind === 'source' ? 'Source-wide' :
            finding.subject.sellerEntityId + ' / ' + finding.subject.sourceAccountId}</dd>
        </dl>
      </details>
    </li>)}</ul>}
    <h3>Proposal assessments</h3>
    <p>{state.proposals.length ? 'Proposal results ' + state.proposals.length : 'No proposals recorded.'}</p>
    <p>Compilation does not establish independent verification, review readiness, approval, or activation.</p>
    {state.proposals.length > 0 && <ul>{state.proposals.map(proposal => <li key={proposal.proposalId}>
      <details>
        <summary>{proposal.proposalId} · {proposalLabel[proposal.state]}</summary>
        <dl className="review-facts">
          <dt>Proposal revision</dt><dd>{proposal.revision}</dd>
          <dt>Assessment revision</dt><dd>{proposal.assessment.revision}</dd>
          <dt>Observed run revision</dt><dd>{proposal.assessment.observedRunRevision}</dd>
          <dt>Investigations</dt><dd>{proposal.assessment.investigationIds.join(', ') || 'none'}</dd>
          <dt>Assessment diagnostics</dt><dd>{proposal.assessment.diagnosticCodes.join(', ') || 'none'}</dd>
        </dl>
        <h4>Blocker references</h4>
        {proposal.assessment.blockerRefs.length === 0 ? <p>No blocker references in this assessment.</p> :
          <ul>{proposal.assessment.blockerRefs.map(blocker =>
            <li key={JSON.stringify([blocker.findingId, blocker.revision, blocker.code])}>
              {blocker.findingId + ' · revision ' + blocker.revision} · <code>{blocker.code}</code>
            </li>)}</ul>}
        {proposal.diagnostics.length > 0 && <ul className="review-diagnostics">{proposal.diagnostics.map((item, index) =>
          <li key={item.code + ':' + index}>
            <p><strong>{item.code}</strong> · {item.severity} · {item.message}</p>
            {item.sourceIds.length > 0 && <p>Source IDs: {item.sourceIds.join(', ')}</p>}
            {item.fieldPaths.length > 0 && <p>Field paths: {item.fieldPaths.join(', ')}</p>}
          </li>)}</ul>}
        {(proposal.artifactHash !== undefined || proposal.profileHashes.length > 0) && <>
          <h4>{proposal.state === 'compiled' ? 'Compiled candidate hashes' :
            'Historical hashes - not a current compiled candidate'}</h4>
          <dl className="review-facts">
            <dt>Artifact hash</dt><dd>{proposal.artifactHash ?? 'Not recorded'}</dd>
            <dt>Profile hashes</dt><dd>{proposal.profileHashes.length > 0
              ? proposal.profileHashes.map(hash => <code key={hash}>{hash}<br /></code>) : 'Not recorded'}</dd>
          </dl>
        </>}
        <p>Artifact mappings and profile bodies are not exposed by this run read API.</p>
      </details>
    </li>)}</ul>}
    <h3>Verification job references</h3>
    <p>Job references are not verification results or evidence of eligibility.</p>
    {state.verificationJobs.length === 0 ? <p>No verification jobs linked to this run.</p> :
      <ul>{state.verificationJobs.map(job =>
        <li key={JSON.stringify([job.proposalId, job.proposalRevision, job.jobId])}>
          <p>Job {job.jobId}</p><p>{job.proposalId + ' · revision ' + job.proposalRevision}</p>
        </li>)}</ul>}
  </section>;
}
