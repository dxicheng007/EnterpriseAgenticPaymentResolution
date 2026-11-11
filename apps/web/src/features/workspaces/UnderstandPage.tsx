import type { LocalSession } from '../../../../../packages/client/src/session.js';
import { ConnectionDiscoveryPanel, ConnectionSourcesPanel } from '../../demo/ConnectionPanels.js';
import './workspace.css';

export function UnderstandPage({ session }: { session: LocalSession }) {
  return <main className="review-main">
    <header>
      <p className="review-eyebrow">Understand</p>
      <h1>Understand the acquisition</h1>
      <p>
        Inspect captured evidence and original documents, then review the mappings agents derived from
        each company’s systems. Evidence stays distinct from interpretations and imported books.
      </p>
    </header>
    <ConnectionSourcesPanel allowedSourceRefs={session.allowedSourceRefs} />
    <ConnectionDiscoveryPanel allowedSourceRefs={session.allowedSourceRefs} />
  </main>;
}
