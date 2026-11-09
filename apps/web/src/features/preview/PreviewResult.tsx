import { useState, type ReactNode } from 'react';
import type { Hold, Scope } from '../../../../../packages/contracts/src/common.js';
import type { PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import { EvidencePanel } from '../sources/EvidencePanel.js';
import { Diagnostics } from '../sources/review-details.js';
import { formatUsdCents, previewIssues, recordField, unmappedHoldGroups } from './preview-values.js';
import type { SourceCoverageSummary } from './source-coverage-values.js';

function HoldGroup({ title, holds, coverage, explanation }: {
  title: string; holds: Hold[]; coverage?: SourceCoverageSummary; explanation?: string;
}) {
  if (!holds.length) return null;
  return <section>
    <h4>{title} ({holds.length})</h4>
    {explanation && <p>{explanation}</p>}
    <ul className="preview-holds">{holds.map((hold, index) => {
      const groups = unmappedHoldGroups(hold, coverage);
      const open = !explanation || hold.diagnostics.some(item => item.severity === 'blocker' && item.code !== 'UNKNOWN_ACCOUNT');
      const eventCount = new Set(hold.eventIds).size;
      return <li key={index}>
        <details open={open}>
          <summary>
            <strong>{hold.code}</strong> · {eventCount} source {eventCount === 1 ? 'event' : 'events'}
            {groups.map((group, groupIndex) => <small key={groupIndex}>
              {group.label} · {group.eventCount} {group.eventCount === 1 ? 'event' : 'events'} in this hold
            </small>)}
          </summary>
          {hold.scope && <p>{hold.scope.companyId} / {hold.scope.sellerEntityId} / {hold.scope.accountId}</p>}
          {hold.eventIds.length > 0 && <p>Source events {hold.eventIds.join(', ')}</p>}
          {hold.dependencies.length > 0 && <p>Dependencies {hold.dependencies.join(', ')}</p>}
          <Diagnostics items={hold.diagnostics} />
        </details>
      </li>;
    })}</ul>
  </section>;
}

export function PreviewResult({ result, evidenceRefs, profileScopes = [], coverage, sourceCoverage }: {
  result?: PreviewResponse;
  evidenceRefs: string[];
  profileScopes?: readonly Scope[];
  coverage?: SourceCoverageSummary;
  sourceCoverage?: ReactNode;
}) {
  return <div role={result ? 'region' : undefined} aria-label={result ? 'Preview result' : undefined}>
    {result && <section className="review-card">
      <h2>Preview result</h2>
      {result.diffs.length === 0 && <p>No balance differences were returned.</p>}
      {result.diffs.map((diff, index) => <section key={index} className="preview-diff" aria-label={`Balance diff for ${diff.scope.accountId}`}>
        <h3>{diff.scope.companyId} / {diff.scope.sellerEntityId} / {diff.scope.accountId}</h3>
        <dl className="review-facts balance-diff">
          <dt>Projected balance</dt><dd>{formatUsdCents(diff.afterBalanceCents)}</dd>
          <dt>Before · target v{diff.beforeVersion}</dt><dd>{formatUsdCents(diff.beforeBalanceCents)}</dd>
        </dl>
      </section>)}
      {!result.artifact && <p>Compilation blocked. Review the diagnostics below.</p>}
      <p>Parent writes: {result.parentWrites}</p>
    </section>}
    {sourceCoverage}
    {result && <PreviewDetails result={result} evidenceRefs={evidenceRefs} profileScopes={profileScopes} coverage={coverage} />}
  </div>;
}

function PreviewDetails({ result, evidenceRefs, profileScopes, coverage }: {
  result: PreviewResponse;
  evidenceRefs: string[];
  profileScopes: readonly Scope[];
  coverage?: SourceCoverageSummary;
}) {
  const [citation, setCitation] = useState('');
  const citations = [...new Set([
    ...evidenceRefs, ...result.outcome.plans.flatMap(plan => plan.lineage.flatMap(field => field.evidenceRefs)),
  ])];
  const { artifact } = result;
  const issues = previewIssues(result, profileScopes);
  const operationCount = result.outcome.plans.reduce((count, plan) => count + plan.operations.length, 0);
  return <>
    <section className="review-card">
      <h2>Held or unresolved records</h2>
      <section>
        <h3>Unsupported rows ({issues.count})</h3>
        <p>Returned as {result.outcome.holds.length} hold entries and {result.unsupportedRows.length} unsupported rows.
          {' '}{issues.matched} matching {issues.matched === 1 ? 'entry' : 'entries'} shown once.</p>
        <HoldGroup title="Selected customer issues" holds={issues.selected} />
        {issues.additional.length > 0 && <section>
          <h4>Additional diagnostics</h4>
          <Diagnostics items={issues.additional} />
        </section>}
        <HoldGroup title="Other or unresolved scope issues" holds={issues.unresolved} />
        <HoldGroup title="Records not mapped by the preview profiles" holds={issues.unmapped} coverage={coverage}
          explanation="Records not mapped by these profiles." />
      </section>
    </section>
    <section className="review-card">
      <h2>{operationCount} proposed {operationCount === 1 ? 'import' : 'imports'} of existing records</h2>
      <p>Payments and credits reduce invoice balances only when allocated to invoices.</p>
      {result.outcome.plans.map(plan => <section key={plan.hash}>
        <h3>Operations for {plan.scope.accountId} ({plan.operations.length})</h3>
        <details><summary>Plan details</summary><p>Plan SHA-256 <code>{plan.hash}</code></p></details>
        <ol className="review-operations">
          {plan.operations.map((operation, index) => <li key={index}>
            <details>
              <summary><code>{operation.op}</code> · {operation.record.id}
                {'amountCents' in operation.record && <> · {formatUsdCents(operation.record.amountCents)}</>}
              </summary>
              <pre>{JSON.stringify(operation.record, null, 2)}</pre>
              <h4>Field lineage</h4>
              <ul>{plan.lineage.filter(field => field.operationIndex === index).map((field, fieldIndex) => {
                const value = recordField(operation.record, field.targetField);
                return <li key={fieldIndex}>
                  <p><code>{field.sourcePaths.join(', ') || 'Derived input'}</code> →{' '}
                    <code>{field.mapping?.op ?? 'deterministic derivation'}</code> →{' '}
                    <code>{field.targetField}</code>{value !== undefined && <> · <code>{JSON.stringify(value)}</code></>}</p>
                  {field.mapping && <details>
                    <summary>Mapping parameters</summary>
                    <pre>{JSON.stringify(field.mapping, null, 2)}</pre>
                  </details>}
                  {field.sourceEventIds.length > 0 && <small>Source events {field.sourceEventIds.join(', ')}</small>}
                  {field.derivationInputs.length > 0 && <small>Derivation inputs {field.derivationInputs.join(', ')}</small>}
                  {field.evidenceRefs.map(id => <button type="button" className="citation-button" key={id}
                    onClick={() => setCitation(id)}>View citation {id}</button>)}
                </li>;
              })}</ul>
            </details>
          </li>)}
        </ol>
      </section>)}
      {artifact && <details>
        <summary>Artifact details</summary>
        <dl className="review-facts">
          <dt>Artifact SHA-256</dt><dd><code>{artifact.hash}</code></dd>
          <dt>Spec SHA-256</dt><dd><code>{artifact.specHash}</code></dd>
          <dt>Profile hashes</dt><dd>{artifact.requiredProfileHashes.map(hash => <div key={hash}><code>{hash}</code></div>)}</dd>
        </dl>
      </details>}
      {citations.length > 0 && <label className="review-selection">Preview evidence citation
        <select value={citation} onChange={event => setCitation(event.target.value)}>
          <option value="">Select a citation</option>
          {citations.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>}
      {citation && <EvidencePanel evidenceId={citation} />}
    </section>
  </>;
}
