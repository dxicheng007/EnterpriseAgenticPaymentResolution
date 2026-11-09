import { useState } from 'react';
import { EventKindSchema, type EventKind } from '../../../../../packages/contracts/src/common.js';
import type { SourceCoverageResponse } from '../../../../../packages/contracts/src/source-coverage.js';
import { EvidencePanel } from '../sources/EvidencePanel.js';
import { Diagnostics, RequestFailure } from '../sources/review-details.js';
import type { SourceCoverageSummary } from './source-coverage-values.js';

function KindCounts({ counts }: { counts: Partial<Record<EventKind, number>> }) {
  return <ul className="coverage-kinds" aria-label="Event kinds">{EventKindSchema.options
    .filter(kind => counts[kind])
    .map(kind => <li key={kind}>{kind === 'semantic_change' ? 'source-change event' : kind} {counts[kind]}</li>)}
  </ul>;
}

function eventCounts(financial: number, sourceChanges: number): string {
  return `${financial} financial ${financial === 1 ? 'event' : 'events'} · ${sourceChanges} source-change ${sourceChanges === 1 ? 'event' : 'events'}`;
}

function ProfileMembership({ profiles }: { profiles: SourceCoverageSummary['accounts'][number]['profiles'] }) {
  if (!profiles.length) return <p>No profile in this candidate. Separate construction and verification needed.</p>;
  return <>
    <p>{profiles.length > 1
      ? 'Profile conflict. Multiple profiles in this candidate match the same source account.'
      : 'Profile supplied in this candidate.'}</p>
    <ul className="coverage-profiles">{profiles.map(({ id, hash }, index) => <li key={index}>
      {id}
      <details><summary>Profile hash</summary><code>{hash}</code></details>
    </li>)}</ul>
  </>;
}

export function SourceCoverage({ response, summary, failure, retry }: {
  response?: SourceCoverageResponse;
  summary?: SourceCoverageSummary;
  failure?: unknown;
  retry: () => void;
}) {
  const [citation, setCitation] = useState<{ accountKey: string; evidenceId: string }>();
  const unresolvedOutside = summary ? summary.outside.eventIds.length - summary.documentedOutsideCount : 0;
  const unresolvedTotal = summary?.undocumented.reduce((total, group) => total + group.eventIds.length, 0) ?? 0;
  return <section className="review-card" aria-label="Captured source coverage">
    <h2>Captured source coverage</h2>
    {failure != null ? <>
      <h3>Source-account explanation unavailable</h3>
      <RequestFailure error={failure} next="Preview and its original holds can still be inspected." />
      <button type="button" onClick={retry}>Retry source coverage</button>
    </> : !response || !summary ? <p role="status">Loading captured source coverage…</p> : <>
      <dl className="coverage-totals">
        <div><dt>{summary.totalEvents} captured events</dt><dd>Complete captured snapshot</dd></div>
        <div><dt>{summary.selected.eventIds.length} selected-profile events</dt>
          <dd>{eventCounts(summary.selected.financialEventIds.length, summary.selected.semanticEventIds.length)}</dd></div>
        <div><dt>{summary.outside.eventIds.length} outside-profile events</dt>
          <dd>{eventCounts(summary.outside.financialEventIds.length, summary.outside.semanticEventIds.length)}</dd>
          <dd>{summary.documentedOutsideCount} documented · {unresolvedOutside} unresolved</dd></div>
      </dl>
      <p>Counts show raw source event membership. Proposed imports and hold entries are counted separately in the preview.</p>
      <p>Source-change events describe changes such as contract amendments; they are not amounts of money.</p>
      <h3>Documented source accounts</h3>
      <p>Buyer IDs and names are observations from captured source evidence. Parent identity requires explicit per-customer review.</p>
      {!summary.accounts.length && <p>The supported evidence read established no documented source accounts.</p>}
      <div className="coverage-accounts">
        {summary.accounts.map(row => {
          const { account } = row;
          const accountKey = account.sellerEntityId + '/' + account.sourceAccountId;
          return <article key={accountKey}
            aria-label={`Source account ${account.sourceAccountId} · ${account.sellerEntityId}`}>
            <h4>{account.displayName}</h4>
            <dl className="review-facts">
              <dt>Source buyer</dt><dd>{account.sourceBuyerId}</dd>
              <dt>Source seller</dt><dd>{account.sellerEntityId}</dd>
              <dt>Source account</dt><dd>{account.sourceAccountId}</dd>
            </dl>
            <p>{row.eventIds.length} captured events</p>
            <KindCounts counts={row.kindCounts} />
            <ProfileMembership profiles={row.profiles} />
            {account.identityEvidenceRefs.map((id, index) => <button key={id} type="button" title={id} className="citation-button"
              onClick={() => setCitation({ accountKey, evidenceId: id })}>
              {account.identityEvidenceRefs.length === 1 ? 'Identity citation' : `Identity citation ${index + 1}`}
            </button>)}
            {account.relatedEvidenceRefs.length > 0 && <>
              <p>Related evidence. Amendments require separate terms review.</p>
              {account.relatedEvidenceRefs.map((id, index) => <button key={id} type="button" title={id} className="citation-button"
                onClick={() => setCitation({ accountKey, evidenceId: id })}>
                {account.relatedEvidenceRefs.length === 1 ? 'Related citation' : `Related citation ${index + 1}`}
              </button>)}
            </>}
            {citation?.accountKey === accountKey && <EvidencePanel evidenceId={citation.evidenceId} />}
          </article>;
        })}
      </div>
      {summary.undocumented.length > 0 && <section className="coverage-unresolved">
        <h3>Source identity unresolved</h3>
        <p>Source identity is unresolved for {unresolvedTotal} captured {unresolvedTotal === 1 ? 'event' : 'events'}.</p>
        {summary.undocumented.map(row => <div key={row.key}>
          <p>Raw seller {row.rawIdentity.sellerEntityId ?? 'unspecified'} / account {row.rawIdentity.sourceAccountId ?? 'unspecified'}</p>
          <KindCounts counts={row.kindCounts} />
          <ProfileMembership profiles={row.profiles} />
          <details><summary>Source event IDs</summary><p>{row.eventIds.join(', ')}</p></details>
        </div>)}
      </section>}
      {response.diagnostics.length > 0 && <section>
        <h3>Source evidence diagnostics</h3>
        <Diagnostics items={response.diagnostics} />
      </section>}
      <details>
        <summary>Capture provenance</summary>
        <dl className="review-facts">
          <dt>Capture recorded</dt><dd>{response.snapshot.capturedAt}</dd>
          <dt>Snapshot SHA-256</dt><dd><code>{response.snapshot.contentHash}</code></dd>
          <dt>Manifest SHA-256</dt><dd><code>{response.manifestHash}</code></dd>
          <dt>Derivation</dt><dd><code>{response.derivation}</code></dd>
        </dl>
      </details>
    </>}
  </section>;
}
