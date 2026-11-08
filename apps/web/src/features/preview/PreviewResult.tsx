import { useState } from 'react';
import type { Hold } from '../../../../../packages/contracts/src/common.js';
import type { PreviewResponse } from '../../../../../packages/contracts/src/runtime.js';
import { EvidencePanel } from '../sources/EvidencePanel.js';
import { Diagnostics } from '../sources/review-details.js';
import { formatUsdCents, recordField } from './preview-values.js';

function Holds({ title, holds }: { title: string; holds: Hold[] }) {
  return <section>
    <h3>{title} ({holds.length})</h3>
    {holds.length > 0 && <ul>{holds.map((hold, index) => <li key={index}>
      <strong>{hold.code}</strong>
      {hold.scope && <p>{hold.scope.companyId} / {hold.scope.sellerEntityId} / {hold.scope.accountId}</p>}
      {hold.eventIds.length > 0 && <p>Source events {hold.eventIds.join(', ')}</p>}
      {hold.dependencies.length > 0 && <p>Dependencies {hold.dependencies.join(', ')}</p>}
      <Diagnostics items={hold.diagnostics} />
    </li>)}</ul>}
  </section>;
}

export function PreviewResult({ result, evidenceRefs }: { result: PreviewResponse; evidenceRefs: string[] }) {
  const [citation, setCitation] = useState('');
  const citations = [...new Set([
    ...evidenceRefs, ...result.outcome.plans.flatMap(plan => plan.lineage.flatMap(field => field.evidenceRefs)),
  ])];
  const { artifact } = result;
  return <section className="review-card" aria-label="Preview result">
    <h2>Preview result</h2>
    <p>Parent writes: {result.parentWrites}</p>
    {artifact ? <dl className="review-facts">
      <dt>Artifact SHA-256</dt><dd><code>{artifact.hash}</code></dd>
      <dt>Spec SHA-256</dt><dd><code>{artifact.specHash}</code></dd>
      <dt>Profile hashes</dt><dd>{artifact.requiredProfileHashes.map(hash => <div key={hash}><code>{hash}</code></div>)}</dd>
    </dl> : <p>Compilation blocked. Review the diagnostics below.</p>}
    <Diagnostics items={result.diagnostics} />
    {result.diffs.length === 0 && <p>No balance differences were returned.</p>}
    {result.diffs.map((diff, index) => <section key={index} className="preview-diff" aria-label={`Balance diff for ${diff.scope.accountId}`}>
      <h3>{diff.scope.companyId} / {diff.scope.sellerEntityId} / {diff.scope.accountId}</h3>
      <dl className="review-facts balance-diff">
        <dt>Before · target v{diff.beforeVersion}</dt><dd>{formatUsdCents(diff.beforeBalanceCents)}</dd>
        <dt>After · projected</dt><dd>{formatUsdCents(diff.afterBalanceCents)}</dd>
      </dl>
    </section>)}
    {result.outcome.plans.map(plan => <section key={plan.hash}>
      <h3>Operations for {plan.scope.accountId} ({plan.operations.length})</h3>
      <p>Plan SHA-256 <code>{plan.hash}</code></p>
      <ol className="review-operations">
        {plan.operations.map((operation, index) => <li key={index}>
          <details>
            <summary><code>{operation.op}</code> · {operation.record.id}</summary>
            <pre>{JSON.stringify(operation.record, null, 2)}</pre>
            <h4>Field lineage</h4>
            <ul>{plan.lineage.filter(field => field.operationIndex === index).map((field, fieldIndex) => {
              const value = recordField(operation.record, field.targetField);
              return <li key={fieldIndex}>
                <p><code>{field.sourcePaths.join(', ') || 'Derived input'}</code> →{' '}
                  <code>{field.mapping?.op ?? 'deterministic derivation'}</code> →{' '}
                  <code>{field.targetField}</code>{value !== undefined && <> · <code>{JSON.stringify(value)}</code></>}</p>
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
    <Holds title="Holds" holds={result.outcome.holds} />
    <Holds title="Unsupported rows" holds={result.unsupportedRows} />
    {citations.length > 0 && <label className="review-selection">Preview evidence citation
      <select value={citation} onChange={event => setCitation(event.target.value)}>
        <option value="">Select a citation</option>
        {citations.map(id => <option key={id} value={id}>{id}</option>)}
      </select>
    </label>}
    {citation && <EvidencePanel evidenceId={citation} />}
  </section>;
}
