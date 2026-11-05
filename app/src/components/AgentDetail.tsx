import { useState } from 'react';
import { networkSummary } from '../agents/policy';
import { agentFiles, formatMemory } from '../agents/spec';
import { useEngine, useSnapshot } from '../agents/store';
import type { Agent } from '../agents/types';
import { channelSummary } from '../pages/IntegrationsPage';
import ActivityList from './ActivityList';
import { Icon } from './Icon';
import Terminal from './Terminal';
import { Dialog, formatBytes, Meter, Sparkline, StatusBadge, timeAgo } from './ui';

export function AgentActions({ agent, compact, onDeleted }: { agent: Agent; compact?: boolean; onDeleted?: () => void }) {
  const engine = useEngine();
  const [confirming, setConfirming] = useState(false);
  const button = (label: string, icon: Parameters<typeof Icon>[0]['name'], onClick: () => void, extra = '') => (
    <button type="button" className={compact ? `icon-button ${extra}` : `button ${extra}`} aria-label={compact ? `${label} ${agent.spec.name}` : undefined}
      title={label} onClick={event => { event.stopPropagation(); onClick(); }}>
      <Icon name={icon} />{!compact && ` ${label}`}
    </button>
  );
  const { status } = agent;
  return (
    <div className="actions">
      {(status === 'stopped' || status === 'error') && button('Start', 'play', () => engine.start(agent.id))}
      {(status === 'running' || status === 'starting') && engine.capabilities.pause && button('Pause', 'pause', () => engine.pause(agent.id))}
      {status === 'paused' && button('Resume', 'play', () => engine.resume(agent.id))}
      {status !== 'stopped' && button('Stop', 'stop', () => engine.stop(agent.id))}
      {button('Copy', 'copy', () => engine.copy(agent.id))}
      {button('Delete', 'trash', () => setConfirming(true), 'danger')}
      {confirming && (
        <Dialog title={`Delete ${agent.spec.name}?`} onClose={() => setConfirming(false)}>
          <p className="dialog-lead">This stops the agent and removes its sandbox and workspace. Its definition files and audit history are kept.</p>
          <div className="form-actions">
            <button type="button" className="button ghost" onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className="button danger-solid" onClick={() => { engine.remove(agent.id); setConfirming(false); onDeleted?.(); }}>Delete agent</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const TABS = ['Overview', 'Activity', 'Shell', 'Files'] as const;
type Tab = (typeof TABS)[number];

export default function AgentDetail({ agent, onBack, onEdit, onOpenModels }: {
  agent: Agent; onBack: () => void; onEdit: () => void; onOpenModels: () => void;
}) {
  const [tab, setTab] = useState<Tab>('Overview');
  const { events } = useSnapshot();
  const agentEvents = events.filter(event => event.agentId === agent.id);
  const problems = agentEvents.filter(event => event.outcome !== 'ok').length;
  return (
    <div className="detail">
      <header className="page-head">
        <button type="button" className="button ghost" onClick={onBack}><Icon name="back" /> Agents</button>
        <div className="detail-title">
          <h1>{agent.spec.name}</h1>
          <StatusBadge status={agent.status} />
          <span className="tag isolated"><Icon name="shield" size={11} /> Isolated</span>
        </div>
        {agent.spec.description && <p className="muted">{agent.spec.description}</p>}
        <div className="detail-actions">
          <AgentActions agent={agent} onDeleted={onBack} />
          <button type="button" className="button" onClick={onEdit}><Icon name="edit" /> Edit</button>
        </div>
      </header>
      <div className="tabs" role="tablist" aria-label="Agent sections">
        {TABS.map(name => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
            {name}{name === 'Activity' && problems > 0 && <span className="count danger">{problems}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={tab}>
        {tab === 'Overview' && <OverviewTab agent={agent} onOpenModels={onOpenModels} onOpenShell={() => setTab('Shell')} />}
        {tab === 'Activity' && <ActivityList events={agentEvents} />}
        {tab === 'Shell' && <Terminal agent={agent} onExit={() => setTab('Overview')} />}
        {tab === 'Files' && <FilesTab agent={agent} />}
      </div>
    </div>
  );
}

function blockedHosts(agent: Agent, events: ReturnType<typeof useSnapshot>['events']) {
  const hosts = new Set<string>();
  for (const event of events) {
    const match = event.agentId === agent.id && event.kind === 'network' && event.outcome === 'denied'
      && /^Blocked connection to (\S+)$/.exec(event.summary);
    if (match && !agent.spec.security.network.allow.includes(match[1])) hosts.add(match[1]);
  }
  return [...hosts];
}

function OverviewTab({ agent, onOpenModels, onOpenShell }: { agent: Agent; onOpenModels: () => void; onOpenShell: () => void }) {
  const engine = useEngine();
  const { events, models } = useSnapshot();
  const [task, setTask] = useState('');
  const { spec, usage } = agent;
  const last = usage.samples.at(-1);
  const model = models.find(entry => entry.id === spec.model.configId);
  const blocked = spec.security.network.mode === 'allowlist' ? blockedHosts(agent, events) : [];
  const allow = (host: string) => engine.updateAgent(agent.id, {
    ...spec, security: { ...spec.security, network: { ...spec.security.network, allow: [...spec.security.network.allow, host] } },
  });
  const live = agent.status === 'running' || agent.status === 'starting';

  return (
    <div className="overview-grid">
      {(agent.status === 'error' || agent.statusDetail || blocked.length > 0) && (
        <section className={agent.status === 'error' ? 'callout danger span-2' : 'callout span-2'} aria-label="Attention">
          <Icon name={agent.status === 'error' ? 'alert' : 'ban'} size={18} />
          <div>
            {agent.statusDetail && <b>{agent.statusDetail}</b>}
            {blocked.length > 0 && <>
              <p className="muted">The agent tried to reach domains outside its allowlist. Allow them only if the task needs them.</p>
              <div className="chips">{blocked.map(host => (
                <button key={host} type="button" className="chip add" onClick={() => allow(host)}><Icon name="plus" size={10} /> Allow {host}</button>
              ))}</div>
            </>}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="task-title">
        <h2 id="task-title">Current task</h2>
        <p className={agent.task ? 'task-text' : 'muted'}>{agent.task ?? 'No task yet.'}</p>
        {agent.startedAt && live && <p className="muted">Running for {timeAgo(agent.startedAt).replace(' ago', '')}</p>}
        <form className="row" onSubmit={event => { event.preventDefault(); if (task.trim()) { engine.start(agent.id, task); setTask(''); } }}>
          <input aria-label="New task" placeholder="Give it a new task" value={task} onChange={event => setTask(event.target.value)} />
          <button type="submit" className="button primary small" disabled={!task.trim()}><Icon name="play" /> {live ? 'Restart with task' : 'Start'}</button>
        </form>
        {live && <button type="button" className="button small" onClick={onOpenShell}><Icon name="terminal" /> Open shell</button>}
      </section>

      <section className="card" aria-labelledby="resources-title">
        <h2 id="resources-title">Resources</h2>
        <div className="resource">
          <div className="resource-head"><span>CPU</span><span>{live && last ? `${last.cpu.toFixed(2)} of ${spec.limits.cpu} cores` : `limit ${spec.limits.cpu} cores`}</span></div>
          <Sparkline samples={live ? usage.samples : []} pick={sample => sample.cpu} max={spec.limits.cpu} label="CPU usage" />
        </div>
        <div className="resource">
          <div className="resource-head"><span>Memory</span><span>{live && last ? `${Math.round(last.memoryMiB)} MiB of ${formatMemory(spec.limits.memoryMiB)}` : `limit ${formatMemory(spec.limits.memoryMiB)}`}</span></div>
          <Sparkline samples={live ? usage.samples : []} pick={sample => sample.memoryMiB} max={spec.limits.memoryMiB} label="Memory usage" />
        </div>
        <div className="resource">
          <div className="resource-head"><span>Tokens</span><span>{usage.tokens.toLocaleString('en-US')} of {spec.limits.maxTokens.toLocaleString('en-US')}</span></div>
          <Meter value={usage.tokens} max={spec.limits.maxTokens} label="Token budget used" />
        </div>
        <div className="resource">
          <div className="resource-head"><span>Disk</span><span>{Math.round(usage.diskMiB)} MiB of {spec.limits.diskGiB} GiB</span></div>
          <Meter value={usage.diskMiB} max={spec.limits.diskGiB * 1024} label="Disk used" />
        </div>
        <p className="muted">Network transferred: {formatBytes(usage.netBytes)}</p>
      </section>

      <section className="card span-2" aria-labelledby="props-title">
        <h2 id="props-title">Properties</h2>
        <dl className="props">
          <dt>Model</dt><dd>{spec.model.model} <span className="muted">via</span> <button type="button" className="link" onClick={onOpenModels}>{model?.label ?? 'missing provider'}</button></dd>
          <dt>Isolation</dt><dd>Own sandbox in Bridge’s VM · {spec.limits.cpu} CPU · {formatMemory(spec.limits.memoryMiB)} memory · {spec.limits.diskGiB} GiB disk</dd>
          <dt>Network</dt><dd>{networkSummary(spec)}{spec.security.network.mode === 'allowlist' && spec.security.network.allow.length > 0 && <span className="muted">: {spec.security.network.allow.join(', ')}</span>}</dd>
          <dt>Files</dt><dd>Workspace {spec.security.filesystem.workspace}{spec.security.filesystem.hostMounts.length
            ? <span className="muted"> · host: {spec.security.filesystem.hostMounts.map(mount => `${mount.path} (${mount.access})`).join(', ')}</span>
            : <span className="muted"> · no host folders</span>}</dd>
          <dt>Credentials</dt><dd>{spec.security.secrets.length ? spec.security.secrets.join(', ') : <span className="muted">None</span>}</dd>
          <dt>Messaging</dt><dd>{spec.channels.length ? channelSummary(spec.channels).map(line => <div key={line}>{line}</div>) : <span className="muted">Only from Bridge</span>}</dd>
          <dt>Ask first</dt><dd>{[spec.security.approvals.gitPush && 'Git push', spec.security.approvals.newDomains && 'New domains'].filter(Boolean).join(', ') || <span className="muted">Nothing</span>}</dd>
          <dt>Repositories</dt><dd>{spec.workspace.git.length ? spec.workspace.git.map(repo => <div key={repo.url}><code>{repo.url}</code> <span className="muted">{repo.branch} · {repo.access}</span></div>) : <span className="muted">None</span>}</dd>
          <dt>MCP servers</dt><dd>{spec.workspace.mcp.length ? spec.workspace.mcp.map(server => <div key={server.name}>{server.name} <span className="muted">{server.transport === 'http' ? server.url : 'local command'}</span></div>) : <span className="muted">None</span>}</dd>
          <dt>Skills</dt><dd>{spec.workspace.skills.length ? spec.workspace.skills.map(skill => skill.name).join(', ') : <span className="muted">None</span>}</dd>
          <dt>Tools</dt><dd>{spec.tools.length ? spec.tools.map(tool => <code key={tool} className="tool">{tool}</code>) : <span className="muted">None</span>}</dd>
          <dt>Tests</dt><dd>{spec.tests.length ? `${spec.tests.length} defined` : <span className="muted">None</span>}</dd>
          <dt>Created</dt><dd>{new Date(agent.createdAt).toLocaleString()}</dd>
        </dl>
      </section>
    </div>
  );
}

function FilesTab({ agent }: { agent: Agent }) {
  const { models } = useSnapshot();
  const files = agentFiles(agent.spec, models.find(model => model.id === agent.spec.model.configId));
  const [open, setOpen] = useState(0);
  const current = files[Math.min(open, files.length - 1)];
  return (
    <section className="card">
      <p className="muted">The agent is defined by these kmx files. Change them with Edit.</p>
      <div className="file-tabs" role="tablist" aria-label="Agent files">
        {files.map((entry, index) => (
          <button key={entry.path} type="button" role="tab" aria-selected={open === index} onClick={() => setOpen(index)}>{entry.path.split('/').pop()}</button>
        ))}
      </div>
      <pre className="code" aria-label={current.path}>{current.content}</pre>
    </section>
  );
}
