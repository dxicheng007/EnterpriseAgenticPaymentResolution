import { useEffect, useState } from 'react';
import { onSessionExpiration } from '../../../packages/client/src/http.js';
import { getLocalSession, type LocalSession } from '../../../packages/client/src/session.js';
import { OperationsPage } from './features/connections/OperationsPage.js';
import { ParentView } from './features/connections/ParentView.js';
import { ReviewPage } from './features/connections/ReviewPage.js';
import { DiscoveryPage } from './features/discovery/DiscoveryPage.js';
import { HealthPage } from './features/health/HealthPage.js';
import { PreviewPage } from './features/preview/PreviewPage.js';
import { SourcesPage } from './features/sources/SourcesPage.js';
import './features/sources/review.css';
import { AcquisitionDemo } from './demo/AcquisitionDemo.js';
import { DemoStubBanner, DemoWorking } from './demo/DemoWorking.js';
import {
  StagedDiscoveryPanel, StagedHealthPanel, StagedOperationsPanel, StagedParentPanel, StagedPreviewPanel,
  StagedReviewPanel, StagedSourcesPanel,
} from './demo/StagedSurfaces.js';
import { stagedCompanyA } from './demo/staged-company-a.js';
import { isDemoStubEnabled, onDemoStubChange, setDemoStubEnabled } from './demo/stub-mode.js';

const pages = [
  { id: 'theater', label: 'Theater' },
  { id: 'health', label: 'Health' }, { id: 'sources', label: 'Sources' }, { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'Review' }, { id: 'parent', label: 'Parent' }, { id: 'operations', label: 'Operations' }, { id: 'discovery', label: 'Discovery' },
] as const;

type PageId = typeof pages[number]['id'];

const titles = {
  sources: 'Sources and evidence', review: 'Customer review', preview: 'Connector preview', parent: 'Parent records', operations: 'Operations', discovery: 'Discovery',
} as const;

const stagedSession: LocalSession = {
  demoOnly: true,
  reviewer: { reviewerId: 'demo-reviewer', sessionId: 'staged-session-company-a' },
  allowedSourceRefs: ['legacy-a', 'legacy-b'],
  allowedAccountIds: [stagedCompanyA.accountId, 'company-b.seller-b.cust-b-d22feb38e846-1'],
};

function currentPage(): PageId {
  return pages.find(page => '#' + page.id === window.location.hash.split('?', 1)[0])?.id ?? 'health';
}

export function App() {
  const [page, setPage] = useState<PageId>(currentPage);
  const [session, setSession] = useState<LocalSession>();
  const [sessionFailed, setSessionFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stub, setStub] = useState(isDemoStubEnabled);

  useEffect(() => {
    function navigate() { setPage(currentPage()); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => onDemoStubChange(() => setStub(isDemoStubEnabled())), []);

  useEffect(() => {
    if (stub) {
      setSession(stagedSession);
      setSessionFailed(false);
      return;
    }
    let active = true;
    function connect() {
      setSessionFailed(false);
      void getLocalSession().then(
        connected => { if (active) setSession(connected); },
        () => { if (active) { setSession(undefined); setSessionFailed(true); } },
      );
    }
    const unsubscribe = onSessionExpiration(connect);
    connect();
    return () => { active = false; unsubscribe(); };
  }, [attempt, stub]);

  return <>
    <header className="app-header">
      <div>
        <strong>Acquisition connectors</strong>
        <p>{sessionFailed && !stub ? 'Demo reviewer session unavailable' : session
            ? 'Demo reviewer · ' + session.reviewer.reviewerId
            : 'Opening local demo session…'}</p>
        {sessionFailed && !stub &&
          <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>Retry demo session</button>}
      </div>
      <nav aria-label="Workspace">{pages.map(item => <a key={item.id} href={'#' + item.id}
        aria-current={page === item.id ? 'page' : undefined}>{item.label}</a>)}</nav>
    </header>
    {!stub && sessionFailed
      ? <DemoStubBanner enabled={false} onEnable={() => setDemoStubEnabled(true)} />
      : stub
        ? <DemoStubBanner enabled onEnable={() => setDemoStubEnabled(true)}
          onDisable={() => { setDemoStubEnabled(false); setAttempt(value => value + 1); }} />
        : null}
    {page === 'theater' ? <AcquisitionDemo />
      : stub ? <main className="review-main">
        <h1>{page === 'health' ? 'Acquisition connector health' : titles[page]}</h1>
        {page === 'health' ? <StagedHealthPanel />
          : page === 'sources' ? <StagedSourcesPanel />
            : page === 'preview' ? <StagedPreviewPanel />
              : page === 'review' ? <StagedReviewPanel />
                : page === 'parent' ? <StagedParentPanel />
                  : page === 'operations' ? <StagedOperationsPanel />
                    : <StagedDiscoveryPanel />}
      </main>
        : page === 'health' ? <HealthPage />
          : !session ? <main className="review-main">
            <h1>{titles[page]}</h1>
            {sessionFailed
              ? <section className="review-card">
                <p className="review-eyebrow">Session</p>
                <h2>Demo reviewer required</h2>
                <p>The demo reviewer session is required to open this workspace.</p>
              </section>
              : <DemoWorking title="Opening local demo session…" variant="shimmer" mode="wait" />}
          </main>
            : page === 'sources' ? <SourcesPage allowedSourceRefs={session.allowedSourceRefs} />
              : page === 'discovery' ? <DiscoveryPage /> : page === 'parent' ? <ParentView session={session} />
                : page === 'operations' ? <OperationsPage session={session} />
                  : page === 'review' ? <ReviewPage session={session} /> : <PreviewPage />}
  </>;
}
