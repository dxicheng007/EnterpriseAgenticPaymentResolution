import { ConnectionPreviewPanel } from '../../demo/ConnectionPanels.js';
import './workspace.css';

export function ConnectPage() {
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Connect</p>
      <h1>Connect into our books</h1>
      <p>
        Dry-run the connector against parent records. Confirm balances, coverage, and proposed operations
        before any customer is authorized.
      </p>
    </header>
    <ConnectionPreviewPanel />
  </main>;
}
