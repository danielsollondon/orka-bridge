import { networkSummary } from '../agents/policy';
import { formatMemory } from '../agents/spec';
import { useSnapshot } from '../agents/store';
import ActivityList from '../components/ActivityList';
import { AgentActions } from '../components/AgentDetail';
import { Icon } from '../components/Icon';
import { compactNumber, Meter, StatusBadge, timeAgo } from '../components/ui';

export function OverviewPage({ onOpenAgent, onCreate, onOpenActivity }: {
  onOpenAgent: (id: string) => void; onCreate: () => void; onOpenActivity: () => void;
}) {
  const { agents, events } = useSnapshot();
  const day = Date.now() - 24 * 60 * 60 * 1000;
  const recent = events.filter(event => event.at >= day);
  const running = agents.filter(agent => agent.status === 'running' || agent.status === 'starting');
  const attention = agents.filter(agent => agent.status === 'error'
    || recent.some(event => event.agentId === agent.id && event.outcome === 'denied'));
  const cpu = running.reduce((sum, agent) => sum + (agent.usage.samples.at(-1)?.cpu ?? 0), 0);
  const memory = running.reduce((sum, agent) => sum + (agent.usage.samples.at(-1)?.memoryMiB ?? 0), 0);
  const stats = [
    { label: 'Running', value: running.length, detail: `${cpu.toFixed(1)} CPU · ${Math.round(memory)} MiB in use` },
    { label: 'Paused', value: agents.filter(agent => agent.status === 'paused').length, detail: 'Checkpointed, using no CPU' },
    { label: 'Errors (24h)', value: recent.filter(event => event.outcome === 'failed').length, detail: 'Failed tools and runs', tone: 'danger' },
    { label: 'Permission denied (24h)', value: recent.filter(event => event.outcome === 'denied').length, detail: 'Blocked by sandbox policy', tone: 'warn' },
  ];

  if (agents.length === 0) {
    return (
      <section className="card empty-state">
        <span className="icon-tile empty-icon"><Icon name="agents" size={20} /></span>
        <div>
          <h2>Create your first agent</h2>
          <p className="muted">Describe what it should do, pick a model, and choose exactly what it can touch. It runs isolated on this machine.</p>
          <button type="button" className="button primary" onClick={onCreate}><Icon name="plus" /> Create agent</button>
        </div>
      </section>
    );
  }

  return (
    <div className="stack">
      <div className="stats">
        {stats.map(stat => (
          <section key={stat.label} className={`card stat ${stat.tone && stat.value ? stat.tone : ''}`} aria-label={stat.label}>
            <span className="muted">{stat.label}</span>
            <strong>{stat.value}</strong>
            <small className="muted">{stat.detail}</small>
          </section>
        ))}
      </div>
      {attention.length > 0 && (
        <section className="card" aria-labelledby="attention-title">
          <h2 id="attention-title"><Icon name="alert" /> Needs attention</h2>
          <ul className="attention">
            {attention.map(agent => (
              <li key={agent.id}>
                <button type="button" className="link" onClick={() => onOpenAgent(agent.id)}>{agent.spec.name}</button>
                <StatusBadge status={agent.status} />
                <span className="muted">{agent.statusDetail ?? 'Recent permission denials'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card" aria-labelledby="recent-title">
        <div className="section-head">
          <h2 id="recent-title">Recent activity</h2>
          <button type="button" className="button small ghost" onClick={onOpenActivity}>View all</button>
        </div>
        <ActivityList events={events} showAgent limit={8} onOpenAgent={onOpenAgent} />
      </section>
    </div>
  );
}

export function AgentsPage({ onOpenAgent, onCreate }: { onOpenAgent: (id: string) => void; onCreate: () => void }) {
  const { agents } = useSnapshot();
  return (
    <div className="stack">
      <div className="section-head">
        <p className="muted">Every agent runs in its own isolated sandbox with the limits you set.</p>
        <button type="button" className="button primary" onClick={onCreate}><Icon name="plus" /> Create agent</button>
      </div>
      {agents.length === 0 ? <p className="card muted">No agents yet.</p> : (
        <div className="card table-card">
          <table className="agents-table">
            <thead><tr><th>Name</th><th>Status</th><th>Network</th><th>Usage / limit</th><th>Tokens</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {agents.map(agent => {
                const last = agent.usage.samples.at(-1);
                const live = agent.status === 'running' || agent.status === 'starting';
                return (
                  <tr key={agent.id} onClick={() => onOpenAgent(agent.id)}>
                    <td>
                      <button type="button" className="link strong" onClick={event => { event.stopPropagation(); onOpenAgent(agent.id); }}>{agent.spec.name}</button>
                      <div className="muted clamp">{agent.task ?? agent.spec.description}</div>
                    </td>
                    <td><StatusBadge status={agent.status} /></td>
                    <td>{networkSummary(agent.spec)}</td>
                    <td className="mono">{live && last
                      ? `${last.cpu.toFixed(2)}/${agent.spec.limits.cpu} CPU · ${Math.round(last.memoryMiB)} MiB/${formatMemory(agent.spec.limits.memoryMiB)}`
                      : <span className="muted">{agent.spec.limits.cpu} CPU · {formatMemory(agent.spec.limits.memoryMiB)}</span>}</td>
                    <td className="tokens-cell">
                      <span className="mono">{compactNumber(agent.usage.tokens)} <span className="muted">/ {compactNumber(agent.spec.limits.maxTokens)}</span></span>
                      <Meter value={agent.usage.tokens} max={agent.spec.limits.maxTokens} label={`${agent.spec.name} token budget used`} />
                    </td>
                    <td className="muted">{timeAgo(agent.updatedAt)}</td>
                    <td><AgentActions agent={agent} compact /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ActivityPage({ onOpenAgent }: { onOpenAgent: (id: string) => void }) {
  const { events } = useSnapshot();
  return (
    <div className="stack">
      <p className="muted">Audit log of everything your agents did: lifecycle changes, model and tool calls, network connections, file changes, shell commands and secret use. It is kept after an agent is deleted.</p>
      <section className="card"><ActivityList events={events} showAgent onOpenAgent={onOpenAgent} /></section>
    </div>
  );
}
