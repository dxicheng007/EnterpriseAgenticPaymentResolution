import type { LocalSession } from '../../../../../packages/client/src/session.js';
import { ConnectionAuthorizePanel } from '../../demo/ConnectionPanels.js';
import './workspace.css';

export function AuthorizePage({ session }: { session: LocalSession }) {
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Authorize</p>
      <h1>Authorize this customer</h1>
      <p>
        Approve one customer only. That grants bounded standing authority for automatic sync under the
        reviewed rules — no one else.
      </p>
    </header>
    <ConnectionAuthorizePanel allowedAccountIds={session.allowedAccountIds} />
  </main>;
}
