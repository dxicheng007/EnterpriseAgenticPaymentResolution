import { useCallback, useEffect, useMemo, useState } from 'react';
import { DemoWorking } from './DemoWorking.js';
import {
  demoCompanies,
  exploreSteps,
  formatDemoMoney,
  getDemoCompany,
  parentCompany,
  translateSteps,
  type DemoAct,
  type DemoCompany,
  type DemoCompanyStatus,
  type TranslationChunk,
} from './acquisition-demo-data.js';
import './acquisition-demo.css';

type CompanyState = {
  status: DemoCompanyStatus;
  translations: TranslationChunk[];
};

const initialStates: Record<string, CompanyState> = Object.fromEntries(
  demoCompanies.map(company => [company.id, {
    status: 'unknown' as const,
    translations: company.translations.map(chunk => ({ ...chunk })),
  }]),
);

function statusLabel(status: DemoCompanyStatus): string {
  switch (status) {
    case 'unknown': return 'Unknown';
    case 'exploring': return 'Exploring';
    case 'mapped': return 'Explored';
    case 'translating': return 'Building connector';
    case 'wired': return 'Wired in';
  }
}

function PortfolioStage({
  company,
  status,
  onExplore,
  onOpenDossier,
}: {
  company: DemoCompany;
  status: DemoCompanyStatus;
  onExplore: () => void;
  onOpenDossier: () => void;
}) {
  return <section className="acq-panel" aria-label="Acquisition overview">
    <p className="review-eyebrow">Acquired company</p>
    <h2>{company.name}</h2>
    <p>{company.tagline}. Acquired {company.acquiredOn}.</p>
    <span className="acq-status-pill" data-tone={status}>{statusLabel(status)}</span>
    {status === 'unknown' ? (
      <div className="acq-empty" style={{ marginTop: '1rem' }}>
        <h2>We don’t know this company yet</h2>
        <p>{company.unknownBlurb} Launch agents to inspect systems, documents, and financial records — with full visibility.</p>
        <button type="button" className="secondary" onClick={onExplore}>Explore with agents</button>
      </div>
    ) : (
      <>
        <div className="acq-stat-grid">
          <div className="acq-stat"><span>Finance stack</span><strong>{company.financeStack}</strong></div>
          <div className="acq-stat"><span>Systems seen</span><strong>{company.systems.length}</strong></div>
          <div className="acq-stat"><span>Documents</span><strong>{company.documents.length}</strong></div>
          <div className="acq-stat"><span>Open AR</span><strong>{formatDemoMoney(company.dashboard.openReceivablesCents)}</strong></div>
        </div>
        <div className="acq-actions">
          {status === 'mapped' || status === 'wired' || status === 'translating' ? (
            <button type="button" className="secondary" onClick={onOpenDossier}>Open dossier</button>
          ) : null}
        </div>
      </>
    )}
  </section>;
}

function DossierStage({ company }: { company: DemoCompany }) {
  return <>
    <section className="acq-panel" aria-label="Company dossier">
      <p className="review-eyebrow">Dossier</p>
      <h2>What agents found in {company.name}</h2>
      <p>Systems, documents, and receivables — reconstructed with evidence still kept distinct from imported books.</p>
      <div className="acq-stat-grid">
        <div className="acq-stat"><span>Open receivables</span><strong>{formatDemoMoney(company.dashboard.openReceivablesCents)}</strong></div>
        <div className="acq-stat"><span>Customers</span><strong>{company.dashboard.customers}</strong></div>
        <div className="acq-stat"><span>Contracts</span><strong>{company.dashboard.contracts}</strong></div>
        <div className="acq-stat"><span>Monthly revenue</span><strong>{formatDemoMoney(company.dashboard.monthlyRevenueCents)}</strong></div>
      </div>
    </section>

    <section className="acq-panel" aria-label="Systems map">
      <h2>Systems map</h2>
      <p>How activity still originates in the acquired company before the connector carries it into {parentCompany.name}.</p>
      <div className="acq-diagram">
        <div className="acq-diagram-col">
          <h3>{company.name}</h3>
          {company.systems.map(system =>
            <div key={system.id} className="acq-diagram-node" data-active="true">
              <strong>{system.name}</strong>
              <div>{system.vendor} · {system.records.toLocaleString()} records · {system.freshness}</div>
            </div>)}
        </div>
        <div className="acq-diagram-bridge" aria-hidden="true"><span>⟳</span></div>
        <div className="acq-diagram-col">
          <h3>{parentCompany.name}</h3>
          <div className="acq-diagram-node">{parentCompany.viewer}</div>
          <div className="acq-diagram-node">{parentCompany.schema}</div>
          <div className="acq-diagram-node">Awaiting hard-coded connector</div>
        </div>
      </div>
    </section>

    <section className="acq-panel" aria-label="Source systems">
      <h2>Connected systems</h2>
      <div className="acq-system-grid">
        {company.systems.map(system =>
          <article key={system.id} className="acq-system">
            <h3>{system.name}</h3>
            <p>{system.kind} · {system.vendor}</p>
            <p>{system.records.toLocaleString()} records · {system.freshness}</p>
          </article>)}
      </div>
    </section>

    <section className="acq-panel" aria-label="Documents">
      <h2>Documents & evidence</h2>
      <div className="acq-table-wrap">
        <table className="acq-table">
          <thead>
            <tr><th>Document</th><th>Kind</th><th>As of</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {company.documents.map(doc =>
              <tr key={doc.id}>
                <td>{doc.title}</td>
                <td>{doc.kind}</td>
                <td>{doc.asOf}</td>
                <td>{doc.amountLabel ?? '—'}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="acq-panel" aria-label="Invoices">
      <h2>Invoice ledger (source)</h2>
      <div className="acq-table-wrap">
        <table className="acq-table">
          <thead>
            <tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Status</th><th>Amount</th></tr>
          </thead>
          <tbody>
            {company.invoices.map(invoice =>
              <tr key={invoice.id}>
                <td>{invoice.id}</td>
                <td>{invoice.customer}</td>
                <td>{invoice.issued}</td>
                <td>{invoice.status}</td>
                <td>{formatDemoMoney(invoice.amountCents)}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </>;
}

function TranslateStage({
  company,
  translations,
  busy,
  onBuild,
}: {
  company: DemoCompany;
  translations: TranslationChunk[];
  busy: boolean;
  onBuild: () => void;
}) {
  const locked = translations.filter(chunk => chunk.status === 'locked').length;
  return <section className="acq-panel" aria-label="Connector translation">
    <p className="review-eyebrow">Hard-coded translations</p>
    <h2>Build the connector in visible chunks</h2>
    <p>
      Agents propose inspectable rules from {company.name} into {parentCompany.schema}.
      Each chunk is evidence-backed — not a silent model improvisation at sync time.
    </p>
    <div className="acq-stat-grid">
      <div className="acq-stat"><span>Chunks</span><strong>{translations.length}</strong></div>
      <div className="acq-stat"><span>Locked</span><strong>{locked}</strong></div>
      <div className="acq-stat"><span>Source stack</span><strong>{company.financeStack}</strong></div>
    </div>
    {busy ? <DemoWorking title="Building connector translations…" variant="checklist" steps={translateSteps} mode="wait" /> : null}
    <div className="acq-map-list">
      {translations.map(chunk =>
        <article key={chunk.id} className="acq-map-chunk" data-state={chunk.status}>
          <div className="acq-map-side">
            <h4>{chunk.sourceLabel}</h4>
            <p>{chunk.sourceSystem}</p>
          </div>
          <div className="acq-map-arrow" aria-hidden="true">→</div>
          <div className="acq-map-side">
            <h4>{chunk.targetLabel}</h4>
            <p>{chunk.targetSystem}</p>
          </div>
          <div className="acq-map-meta">
            <span>Rule: {chunk.rule}</span>
            <span>Evidence: {chunk.evidence}</span>
            <span>Status: {chunk.status}</span>
          </div>
        </article>)}
    </div>
    {!busy && locked < translations.length ? (
      <div className="acq-actions">
        <button type="button" className="secondary" onClick={onBuild}>
          Run connector build
        </button>
      </div>
    ) : null}
    {!busy && locked === translations.length ? (
      <p role="status">Connector chunks locked. Source activity can now flow through the connector into {parentCompany.name}.</p>
    ) : null}
  </section>;
}

function ParentStage({ company, wired }: { company: DemoCompany; wired: boolean }) {
  const view = company.parentView;
  return <section className="acq-panel" aria-label="Parent company view">
    <div className="acq-parent-banner">
      <div>
        <strong>{parentCompany.name} · {parentCompany.viewer}</strong>
        <div><span>Seeing {company.name} through the approved connector</span></div>
      </div>
      <span className="acq-status-pill" data-tone={wired ? 'wired' : 'unknown'}>
        {wired ? 'Live via connector' : 'Not wired yet'}
      </span>
    </div>
    <h2>{view.customer}</h2>
    <p>
      Contracts and invoices still belong to {company.name} / {view.seller}.
      After the connector is wired, they arrive in {parentCompany.name} as a natural parent view — same economics, translated.
    </p>
    <div className="acq-flow">
      <div className="acq-flow-step" data-glow="true">
        <strong>1 · Acquired source</strong>
        <p>{company.financeStack} remains authoritative for issued records.</p>
      </div>
      <div className="acq-flow-step" data-glow={wired}>
        <strong>2 · Connector</strong>
        <p>Hard-coded translations apply deterministically — no model calls at runtime.</p>
      </div>
      <div className="acq-flow-step" data-glow={wired}>
        <strong>3 · {parentCompany.name}</strong>
        <p>Parent books show the translated customer, balances, and allocations.</p>
      </div>
    </div>
    {!wired ? (
      <div className="acq-empty">
        <h2>Parent view is empty for this acquisition</h2>
        <p>Explore the company, then lock connector translations before Northstar can show Company work in parent books.</p>
      </div>
    ) : (
      <>
        <div className="acq-stat-grid">
          <div className="acq-stat"><span>Starting balance</span><strong>{formatDemoMoney(view.startingBalanceCents)}</strong></div>
          <div className="acq-stat"><span>Current balance</span><strong>{formatDemoMoney(view.currentBalanceCents)}</strong></div>
          <div className="acq-stat"><span>Last sync</span><strong>{view.lastSyncLabel}</strong></div>
        </div>
        <div className="acq-table-wrap">
          <table className="acq-table">
            <thead>
              <tr><th>Parent line</th><th>From source</th><th>Maps to</th><th>Amount</th></tr>
            </thead>
            <tbody>
              {view.lines.map(line =>
                <tr key={line.label}>
                  <td>{line.label}</td>
                  <td>{line.source}</td>
                  <td>{line.parent}</td>
                  <td>{formatDemoMoney(line.amountCents)}</td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </>
    )}
  </section>;
}

export function AcquisitionDemo() {
  const [companyId, setCompanyId] = useState<string>(demoCompanies[0]!.id);
  const [act, setAct] = useState<DemoAct>('portfolio');
  const [states, setStates] = useState(initialStates);
  const [exploreBusy, setExploreBusy] = useState(false);
  const [translateBusy, setTranslateBusy] = useState(false);

  const company = useMemo(() => getDemoCompany(companyId), [companyId]);
  const state = states[companyId] ?? initialStates[companyId]!;

  const setStatus = useCallback((id: string, status: DemoCompanyStatus) => {
    setStates(current => ({
      ...current,
      [id]: { ...current[id]!, status },
    }));
  }, []);

  function selectCompany(id: string) {
    setCompanyId(id);
    setExploreBusy(false);
    setTranslateBusy(false);
    const next = states[id]?.status ?? 'unknown';
    setAct(next === 'unknown' ? 'portfolio' : next === 'wired' ? 'parent' : 'dossier');
  }

  function startExplore() {
    setAct('explore');
    setExploreBusy(true);
    setStatus(companyId, 'exploring');
  }

  const finishExplore = useCallback(() => {
    setExploreBusy(false);
    setStatus(companyId, 'mapped');
    setAct('dossier');
  }, [companyId, setStatus]);

  function startTranslate() {
    const base = getDemoCompany(companyId).translations.map((chunk, index) => ({
      ...chunk,
      status: (index === 0 ? 'building' : 'pending') as TranslationChunk['status'],
    }));
    setAct('translate');
    setTranslateBusy(true);
    setStates(current => ({
      ...current,
      [companyId]: {
        status: 'translating',
        translations: base,
      },
    }));
  }

  useEffect(() => {
    if (!translateBusy) return;
    const chunks = state.translations;
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setStates(current => {
        const existing = current[companyId]!;
        const translations = existing.translations.map((chunk, chunkIndex) => {
          if (chunkIndex < index) return { ...chunk, status: 'locked' as const };
          if (chunkIndex === index) return { ...chunk, status: 'building' as const };
          return { ...chunk, status: 'pending' as const };
        });
        const done = index >= chunks.length;
        return {
          ...current,
          [companyId]: {
            status: done ? 'wired' : 'translating',
            translations,
          },
        };
      });
      if (index >= chunks.length) {
        window.clearInterval(timer);
        setTranslateBusy(false);
        setAct('parent');
      }
    }, 1100);
    return () => window.clearInterval(timer);
  }, [companyId, state.translations.length, translateBusy]);

  const acts: { id: DemoAct; label: string; enabled: boolean }[] = [
    { id: 'portfolio', label: '1 · Acquire', enabled: true },
    { id: 'dossier', label: '2 · Dossier', enabled: state.status !== 'unknown' && state.status !== 'exploring' },
    { id: 'translate', label: '3 · Translate', enabled: state.status === 'mapped' || state.status === 'translating' || state.status === 'wired' },
    { id: 'parent', label: '4 · Parent view', enabled: state.status === 'wired' || state.status === 'mapped' || state.status === 'translating' },
  ];

  return <div className="acq-shell">
    <header className="acq-hero">
      <p className="review-eyebrow">Acquisition theater</p>
      <h1>See the company. Build the wire. Read it in parent books.</h1>
      <p>
        Explore unknown acquisitions with visible agents, lock hard-coded translations chunk by chunk,
        then watch source invoices keep living in the acquired company while appearing naturally in {parentCompany.name}.
      </p>
      <nav className="acq-acts" aria-label="Demo acts">
        {acts.map(item =>
          <button key={item.id} type="button" className={act === item.id ? undefined : 'ghost'}
            aria-current={act === item.id ? 'true' : undefined}
            disabled={!item.enabled || exploreBusy || translateBusy}
            onClick={() => setAct(item.id)}>
            {item.label}
          </button>)}
      </nav>
    </header>

    <div className="acq-layout">
      <aside className="acq-rail" aria-label="Acquired companies">
        <h2>Acquisitions</h2>
        <div className="acq-company-list">
          {demoCompanies.map(item => {
            const itemStatus = states[item.id]?.status ?? 'unknown';
            return <button key={item.id} type="button" className="acq-company-card"
              aria-current={item.id === companyId ? 'true' : undefined}
              disabled={exploreBusy || translateBusy}
              onClick={() => selectCompany(item.id)}>
              <strong>{item.name}</strong>
              <span>{item.tagline}</span>
              <span className="acq-status-pill" data-tone={itemStatus}>{statusLabel(itemStatus)}</span>
            </button>;
          })}
        </div>
      </aside>

      <div className="acq-stage">
        {act === 'portfolio' ? (
          <PortfolioStage company={company} status={state.status}
            onExplore={startExplore} onOpenDossier={() => setAct('dossier')} />
        ) : null}

        {act === 'explore' ? (
          <section className="acq-panel">
            <p className="review-eyebrow">Agent exploration</p>
            <h2>Agents are opening {company.name}</h2>
            <p>Full visibility while systems, documents, and financial meaning are reconstructed.</p>
            <DemoWorking
              title={`Exploring ${company.name}…`}
              variant="checklist"
              steps={exploreSteps}
              totalMs={6400}
              onDone={finishExplore} />
          </section>
        ) : null}

        {act === 'dossier' && state.status !== 'unknown' && state.status !== 'exploring' ? (
          <>
            <DossierStage company={company} />
            <div className="acq-actions">
              <button type="button" className="secondary"
                disabled={state.status === 'translating'}
                onClick={startTranslate}>
                {state.status === 'wired' ? 'Rebuild translations' : 'Build connector translations'}
              </button>
              <button type="button" className="ghost" onClick={() => setAct('parent')}>
                Peek at parent view
              </button>
            </div>
          </>
        ) : null}

        {act === 'translate' ? (
          <TranslateStage
            company={company}
            translations={state.translations}
            busy={translateBusy}
            onBuild={startTranslate} />
        ) : null}

        {act === 'parent' ? (
          <ParentStage company={company} wired={state.status === 'wired'} />
        ) : null}
      </div>
    </div>
  </div>;
}
