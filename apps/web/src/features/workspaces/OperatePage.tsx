import type { LocalSession } from '../../../../../packages/client/src/session.js';
import { ConnectionOperationsPanel, ConnectionParentPanel } from '../../demo/ConnectionPanels.js';
import './workspace.css';

export function OperatePage({ session }: { session: LocalSession }) {
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Operate</p>
      <h1>Operate in our books</h1>
      <p>
        Read the stored parent view for an authorized customer, then manage sync authority and receipts.
      </p>
    </header>
    <ConnectionParentPanel allowedAccountIds={session.allowedAccountIds} />
    <ConnectionOperationsPanel allowedAccountIds={session.allowedAccountIds} />
  </main>;
}
