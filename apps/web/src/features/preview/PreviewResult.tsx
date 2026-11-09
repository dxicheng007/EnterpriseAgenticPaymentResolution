import { useState, type ReactNode } from 'react';
import type { Hold, Scope } from '../../../../../packages/contracts/src/common.js';
import type { DemoCandidatesResponse } from '../../../../../packages/contracts/src/local-demo.js';
import type { PreviewRequest, PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import { EvidencePanel } from '../sources/EvidencePanel.js';
import { Diagnostics } from '../sources/review-details.js';
import { formatUsdCents, partitionPreviewHolds, previewIssues, recordField } from './preview-values.js';
import type { SourceCoverageSummary } from './source-coverage-values.js';

function HoldGroup({ title, holds, accountReferences, explanation, openByDefault = false }: {
  title: string;
  holds: readonly Hold[];
  accountReferences?: ReturnType<typeof partitionPreviewHolds>['accountReferences'];
  explanation?: string;
  openByDefault?: boolean;
}) {
  if (!holds.length) return null;
  const distinctEvents = new Set(holds.flatMap(hold => hold.eventIds)).size;
  return <section>
    <h3>{title}</h3>
    {explanation && <p>{explanation}</p>}
    <p>{holds.length} hold {holds.length === 1 ? 'entry' : 'entries'} affecting {distinctEvents} distinct source {distinctEvents === 1 ? 'event' : 'events'}</p>
    <ul className="preview-holds">{holds.map((hold, index) => {
      const groups = accountReferences?.get(hold) ?? [];
      const open = openByDefault || hold.diagnostics.some(item => item.severity === 'blocker' && item.code !== 'UNKNOWN_ACCOUNT');
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

export function PreviewResult({ result, evidenceRefs, asOf, targetMode, profileScopes = [], coverage, sourceCoverage }: {
  result?: PreviewResponse;
  evidenceRefs: string[];
  asOf: PreviewRequest['asOf'];
  targetMode?: DemoCandidatesResponse['targetMode'];
  profileScopes?: readonly Scope[];
  coverage?: SourceCoverageSummary;
  sourceCoverage?: ReactNode;
}) {
  const emptyTarget = targetMode === 'empty-fixture';
  return <div role={result ? 'region' : undefined} aria-label={result ? 'Preview result' : undefined}>
    {result && <section className="review-card">
      <h2>Preview result</h2>
      {result.diffs.length === 0 && <p>No balance differences were returned.</p>}
      {result.diffs.map((diff, index) => <section key={index} className="preview-diff" aria-label={`Balance diff for ${diff.scope.accountId}`}>
        <h3>{diff.scope.companyId} / {diff.scope.sellerEntityId} / {diff.scope.accountId}</h3>
        <dl className="review-facts balance-diff">
          <dt>Amount still owed after proposed import</dt>
          <dd>
            <span>{formatUsdCents(diff.afterBalanceCents)}</span>
            <p className="preview-balance-note">Unpaid invoice amount as of {asOf}, after applying payments and credits allocated to those invoices. Unallocated payments and credits do not reduce this amount.</p>
          </dd>
          <dt>{emptyTarget ? 'Empty demo target before import' : 'Target balance before proposed import'}</dt>
          <dd>{formatUsdCents(diff.beforeBalanceCents)}</dd>
        </dl>
        {emptyTarget && <p>The demo target starts empty. Its starting balance does not describe the acquired customer's payment history or mean that nothing was owed.</p>}
        <details><summary>Target details</summary><p>Target version {diff.beforeVersion}</p></details>
      </section>)}
      {!result.artifact && <p>Compilation blocked. Review the diagnostics below.</p>}
      <p>Preview only. No records have been imported.</p>
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
  const groups = partitionPreviewHolds(issues, coverage);
  const oneProfile = profileScopes.length === 1;
  const hasOtherAccounts = groups.otherAccounts.length > 0;
  const hasInvestigation = groups.investigation.length > 0;
  const operationCount = result.outcome.plans.reduce((count, plan) => count + plan.operations.length, 0);
  return <>
    {(issues.count > 0 || issues.additional.length > 0) && <section className="review-card">
      <h2>{oneProfile ? "Records not included in this customer's preview" : 'Records not included in this preview'}</h2>
      {issues.count > 0 && <p>
        {hasOtherAccounts && 'Some records belong to other documented source accounts. '}
        {hasInvestigation && (hasOtherAccounts ? 'Others need investigation. ' : 'Some records need investigation. ')}
        These records remain held; this explanation does not clear their blockers.
      </p>}
      <HoldGroup title={oneProfile ? 'Issues affecting this customer' : 'Issues affecting the selected customers'}
        holds={groups.selected} openByDefault />
      {issues.additional.length > 0 && <section>
        <h3>Preview-wide and additional issues</h3>
        <Diagnostics items={issues.additional} />
      </section>}
      <HoldGroup title="Other accounts needing connectors" holds={groups.otherAccounts}
        accountReferences={groups.accountReferences}
        explanation="These records belong to documented source accounts with no profile in this candidate. Each account needs separate connector construction, verification, and customer review. This does not mean its records or contract terms have been cleared." />
      <HoldGroup title="Records needing investigation" holds={groups.investigation}
        explanation={coverage
          ? 'These records could not be safely assigned to the other-account group. Inspect their original reasons and source evidence.'
          : 'Records not mapped by these profiles. Source-account ownership has not been established for this explanation.'} />
      {issues.count > 0 && <details>
        <summary>Technical hold details</summary>
        <p>Returned as {result.outcome.holds.length} hold entries and {result.unsupportedRows.length} unsupported rows.
          {' '}{issues.matched} matching {issues.matched === 1 ? 'entry' : 'entries'} shown once.</p>
      </details>}
    </section>}
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
