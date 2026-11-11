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
import { AuthorizePage } from './features/workspaces/AuthorizePage.js';
import { ConnectPage } from './features/workspaces/ConnectPage.js';
import { HealthChip } from './features/workspaces/HealthChip.js';
import { OperatePage } from './features/workspaces/OperatePage.js';
import { UnderstandPage } from './features/workspaces/UnderstandPage.js';
import './features/sources/review.css';
import './features/workspaces/workspace.css';
import { AcquisitionDemo } from './demo/AcquisitionDemo.js';
import { demoWorkspaceSession } from './demo/connection-catalog.js';
import { DemoWorking } from './demo/DemoWorking.js';

const pages = [
  { id: 'theater', label: 'Theater' },
  { id: 'understand', label: 'Understand' },
  { id: 'connect', label: 'Connect' },
  { id: 'authorize', label: 'Authorize' },
  { id: 'operate', label: 'Operate' },
] as const;

type WorkspaceId = typeof pages[number]['id'];
type LiveId = 'sources' | 'discovery' | 'preview' | 'review' | 'parent' | 'operations';
type PageId = WorkspaceId | LiveId | 'health';

const titles = {
  understand: 'Understand the acquisition',
  connect: 'Connect into our books',
  authorize: 'Authorize this customer',
  operate: 'Operate in our books',
} as const;

const fallbackSession: LocalSession = {
  demoOnly: true,
  reviewer: demoWorkspaceSession.reviewer,
  allowedSourceRefs: [...demoWorkspaceSession.allowedSourceRefs],
  allowedAccountIds: [...demoWorkspaceSession.allowedAccountIds],
};

function currentPage(): PageId {
  const raw = window.location.hash.split('?', 1)[0]?.slice(1) ?? '';
  if (raw === 'health') return 'health';
  if (pages.some(page => page.id === raw)) return raw as WorkspaceId;
  if (raw === 'sources' || raw === 'discovery' || raw === 'preview' || raw === 'review' ||
    raw === 'parent' || raw === 'operations') return raw;
  return 'health';
}

function navPage(page: PageId): WorkspaceId | 'health' {
  if (page === 'sources' || page === 'discovery') return 'understand';
  if (page === 'preview') return 'connect';
  if (page === 'review') return 'authorize';
  if (page === 'parent' || page === 'operations') return 'operate';
  return page;
}

export function App() {
  const [page, setPage] = useState<PageId>(currentPage);
  const [session, setSession] = useState<LocalSession>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    function navigate() { setPage(currentPage()); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    let active = true;
    function connect() {
      void getLocalSession().then(
        connected => {
          if (!active) return;
          setSession({
            ...connected,
            allowedSourceRefs: [...new Set([
              ...connected.allowedSourceRefs,
              ...fallbackSession.allowedSourceRefs,
            ])],
            allowedAccountIds: [...new Set([
              ...connected.allowedAccountIds,
              ...fallbackSession.allowedAccountIds,
            ])],
          });
        },
        () => { if (active) setSession(fallbackSession); },
      );
    }
    const unsubscribe = onSessionExpiration(connect);
    connect();
    return () => { active = false; unsubscribe(); };
  }, [attempt]);

  const activeNav = navPage(page);

  return <>
    <header className="app-header">
      <div>
        <strong>Acquisition connectors</strong>
        <p>{session
          ? 'Demo reviewer · ' + session.reviewer.reviewerId
          : 'Opening local demo session…'}</p>
        <HealthChip />
        {!session &&
          <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>
            Retry demo session
          </button>}
      </div>
      <nav aria-label="Workspace">{pages.map(item => <a key={item.id} href={'#' + item.id}
        aria-current={activeNav === item.id ? 'page' : undefined}>{item.label}</a>)}</nav>
    </header>
    {page === 'theater' ? <AcquisitionDemo />
      : page === 'health' ? <HealthPage />
        : !session ? <main className="review-main">
          <h1>{activeNav === 'health' || activeNav === 'theater'
            ? titles.understand
            : titles[activeNav]}</h1>
          <DemoWorking title="Opening local demo session…" variant="shimmer" mode="wait" />
        </main>
          : page === 'understand' ? <UnderstandPage session={session} />
            : page === 'connect' ? <ConnectPage />
              : page === 'authorize' ? <AuthorizePage session={session} />
                : page === 'operate' ? <OperatePage session={session} />
                  : page === 'sources' ? <SourcesPage allowedSourceRefs={session.allowedSourceRefs} />
                    : page === 'discovery' ? <DiscoveryPage />
                      : page === 'preview' ? <PreviewPage />
                        : page === 'review' ? <ReviewPage session={session} />
                          : page === 'parent' ? <ParentView session={session} />
                            : <OperationsPage session={session} />}
  </>;
}
