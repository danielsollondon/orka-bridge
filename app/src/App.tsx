import { useEffect, useMemo, useState } from 'react';
import type { AgentEngine } from './agents/engine';
import { PreviewEngine } from './agents/previewEngine';
import { EngineContext, useSnapshot } from './agents/store';
import mark from './assets/orka-mark.svg';
import AgentDetail from './components/AgentDetail';
import AgentWizard from './components/AgentWizard';
import { Icon, type IconName } from './components/Icon';
import { ActivityPage, AgentsPage, OverviewPage } from './pages/AgentPages';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { EnvironmentsPage, ModelsPage } from './pages/SettingsPages';

const pages = ['Overview', 'Agents', 'Activity', 'Models', 'Integrations', 'Environments'] as const;
type Page = (typeof pages)[number];
const PAGE_ICON: Record<Page, IconName> = {
  Overview: 'overview', Agents: 'agents', Activity: 'activity', Models: 'models', Integrations: 'integrations', Environments: 'environments',
};

type View = { kind: 'page' } | { kind: 'agent'; id: string } | { kind: 'create' } | { kind: 'edit'; id: string };

export default function App({ engine }: { engine?: AgentEngine }) {
  const active = useMemo(() => engine ?? new PreviewEngine(), [engine]);
  useEffect(() => {
    if (!(active instanceof PreviewEngine) || engine) return;
    active.startSimulation();
    return () => active.stopSimulation();
  }, [active, engine]);
  return (
    <EngineContext.Provider value={active}>
      <Shell preview={active.preview} />
    </EngineContext.Provider>
  );
}

function Shell({ preview }: { preview: boolean }) {
  const [page, setPage] = useState<Page>('Overview');
  const [view, setView] = useState<View>({ kind: 'page' });
  const { agents } = useSnapshot();
  const viewKey = `${page}:${view.kind}:${'id' in view ? view.id : ''}`;
  useEffect(() => { document.documentElement.scrollTop = 0; }, [viewKey]);
  const openAgent = (id: string) => { setPage('Agents'); setView({ kind: 'agent', id }); };
  const create = () => { setPage('Agents'); setView({ kind: 'create' }); };
  const agent = view.kind === 'agent' || view.kind === 'edit' ? agents.find(entry => entry.id === view.id) : undefined;
  const title = view.kind === 'page' || ((view.kind === 'agent' || view.kind === 'edit') && !agent) ? page : undefined;

  return (
    <div className="app-shell">
      <header className="tab-bar">
        <span className="brand"><img src={mark} width="32" height="32" alt="Orka" /><b>Bridge</b></span>
        <nav className="page-nav" aria-label="Main">
          {pages.map(name => (
            <button key={name} className="page-tab" type="button"
              aria-current={page === name ? 'page' : undefined}
              onClick={() => { setPage(name); setView({ kind: 'page' }); }}>
              <span className="icon-tile"><Icon name={PAGE_ICON[name]} /></span>
              <span>{name}</span>
            </button>
          ))}
        </nav>
        {preview && <span className="preview-pill" title="No runtime is connected yet. Agents, usage and activity on these screens are simulated in this window.">Preview data</span>}
      </header>
      <main className="page-content" aria-label={title ?? agent?.spec.name ?? 'Create an agent'}>
        {title && <h1 className="page-title">{title}</h1>}
        {title === 'Overview' && <OverviewPage onOpenAgent={openAgent} onCreate={create} onOpenActivity={() => setPage('Activity')} />}
        {title === 'Agents' && <AgentsPage onOpenAgent={openAgent} onCreate={create} />}
        {title === 'Activity' && <ActivityPage onOpenAgent={openAgent} />}
        {title === 'Models' && <ModelsPage />}
        {title === 'Integrations' && <IntegrationsPage onOpenAgent={openAgent} />}
        {title === 'Environments' && <EnvironmentsPage />}
        {view.kind === 'create' && (
          <AgentWizard onCancel={() => setView({ kind: 'page' })} onDone={id => setView({ kind: 'agent', id })} />
        )}
        {view.kind === 'edit' && agent && (
          <AgentWizard agent={agent} onCancel={() => setView({ kind: 'agent', id: agent.id })} onDone={id => setView({ kind: 'agent', id })} />
        )}
        {view.kind === 'agent' && agent && (
          <AgentDetail key={agent.id} agent={agent} onBack={() => setView({ kind: 'page' })}
            onEdit={() => setView({ kind: 'edit', id: agent.id })}
            onOpenModels={() => { setPage('Models'); setView({ kind: 'page' }); }} />
        )}
      </main>
    </div>
  );
}
