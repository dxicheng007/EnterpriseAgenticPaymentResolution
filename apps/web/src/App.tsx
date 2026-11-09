import { useEffect, useState } from 'react';
import { onSessionExpiration } from '../../../packages/client/src/http.js';
import { getLocalSession, type LocalSession } from '../../../packages/client/src/session.js';
import { ParentView } from './features/connections/ParentView.js';
import { ReviewPage } from './features/connections/ReviewPage.js';
import { DiscoveryPage } from './features/discovery/DiscoveryPage.js';
import { HealthPage } from './features/health/HealthPage.js';
import { PreviewPage } from './features/preview/PreviewPage.js';
import { SourcesPage } from './features/sources/SourcesPage.js';
import './features/sources/review.css';

const pages = [
  { id: 'health', label: 'Health' }, { id: 'sources', label: 'Sources' }, { id: 'preview', label: 'Preview' },
  { id: 'review', label: 'Review' }, { id: 'parent', label: 'Parent' }, { id: 'discovery', label: 'Discovery' },
] as const;

const titles = {
  sources: 'Sources and evidence', review: 'Customer review', preview: 'Connector preview', parent: 'Parent records', discovery: 'Discovery',
} as const;

function currentPage() {
  return pages.find(page => '#' + page.id === window.location.hash.split('?', 1)[0])?.id ?? 'health';
}

export function App() {
  const [page, setPage] = useState(currentPage);
  const [session, setSession] = useState<LocalSession>();
  const [sessionFailed, setSessionFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    function navigate() { setPage(currentPage()); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  useEffect(() => {
    let active = true;
    function connect() {
      setSessionFailed(false);
      void getLocalSession().then(
        connected => { if (active) setSession(connected); },
        () => { if (active) setSessionFailed(true); },
      );
    }
    const unsubscribe = onSessionExpiration(connect);
    connect();
    return () => { active = false; unsubscribe(); };
  }, [attempt]);

  return <>
    <header className="app-header">
      <div>
        <strong>Acquisition connectors</strong>
        <p>{sessionFailed ? 'Demo reviewer session unavailable' : session
          ? 'Demo reviewer · ' + session.reviewer.reviewerId : 'Opening local demo session…'}</p>
        {sessionFailed && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry demo session</button>}
      </div>
      <nav aria-label="Workspace">{pages.map(item => <a key={item.id} href={'#' + item.id}
        aria-current={page === item.id ? 'page' : undefined}>{item.label}</a>)}</nav>
    </header>
    {page === 'health' ? <HealthPage /> : !session
      ? <main className="review-main"><h1>{titles[page]}</h1>
        <p>{sessionFailed ? 'The demo reviewer session is required to open this workspace.' : 'Opening local demo session…'}</p>
      </main>
      : page === 'sources' ? <SourcesPage allowedSourceRefs={session.allowedSourceRefs} />
        : page === 'discovery' ? <DiscoveryPage /> : page === 'parent' ? <ParentView />
          : page === 'review' ? <ReviewPage /> : <PreviewPage />}
  </>;
}
