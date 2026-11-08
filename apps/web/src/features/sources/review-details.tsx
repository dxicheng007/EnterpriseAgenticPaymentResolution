import { LocalApiError } from '../../../../../packages/client/src/http.js';
import type { Diagnostic } from '../../../../../packages/contracts/src/common.js';

export function Diagnostics({ items }: { items: Diagnostic[] }) {
  if (!items.length) return null;
  return <ul className="review-diagnostics">{items.map((item, index) =>
    <li key={index}>
      <strong>{item.severity === 'blocker' ? 'Blocker' : 'Warning'} · {item.code}</strong>
      <p>{item.message}</p>
      {item.sourceIds.length > 0 && <small>Sources {item.sourceIds.join(', ')}</small>}
      {item.fieldPaths.length > 0 && <small>Fields {item.fieldPaths.join(', ')}</small>}
    </li>)}</ul>;
}

export function RequestFailure({ error, next }: { error: unknown; next: string }) {
  if (!(error instanceof LocalApiError)) return <p role="alert">The request could not be completed. {next}</p>;
  const reason = {
    401: 'Demo reviewer session required.',
    403: 'Access denied for this scope.',
    404: 'The requested record is unavailable.',
    409: 'The requested version conflicts with stored data.',
    413: 'The upload exceeds the size limit.',
    422: 'The source data could not be accepted.',
    503: 'A local dependency is unavailable.',
  }[error.status];
  return <div className="review-error" role="alert">
    {reason && <strong>{reason}</strong>}
    <p>{error.message} {next}</p>
    <Diagnostics items={error.diagnostics} />
    {error.correlationId && <small>Request reference {error.correlationId}</small>}
  </div>;
}
