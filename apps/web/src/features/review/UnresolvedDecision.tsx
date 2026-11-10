import type { Diagnostic } from '../../../../../packages/contracts/src/common.js';

/** Shows unresolved blockers without offering an invented money-resolution write. */
export function UnresolvedDecision({ diagnostics }: { diagnostics: readonly Diagnostic[] }) {
  const blockers = diagnostics.filter(item => item.severity === 'blocker');
  return <section className="review-card" aria-label="Unresolved decisions">
    <h2>Unresolved decisions</h2>
    <p>Unsupported or invented amounts stay blocked. There is no resolution control that invents money.</p>
    {blockers.length === 0
      ? <p>No blocker diagnostics are present on this package.</p>
      : <ul>{blockers.map(item =>
        <li key={item.code + item.message}>
          <strong>{item.code}</strong> — {item.message}
        </li>)}</ul>}
  </section>;
}
