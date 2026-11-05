import { useMemo, useState, type ReactNode } from 'react';
import { hostOf } from '../agents/policy';
import { agentFiles, defaultSpec, formatMemory, LIMIT_BOUNDS, PLATFORM_NAME, validateSpec } from '../agents/spec';
import { useEngine, useSnapshot } from '../agents/store';
import type { Agent, AgentSpec, McpServer, MessagingPlatform, NetworkMode } from '../agents/types';
import { ConnectDialog } from '../pages/IntegrationsPage';
import { Icon, type IconName } from './Icon';
import { ProviderDialog } from './ProviderPicker';

const STEPS = [
  { id: 'basics', label: 'Purpose', icon: 'agents' },
  { id: 'model', label: 'Model', icon: 'models' },
  { id: 'workspace', label: 'Workspace & tools', icon: 'git' },
  { id: 'messaging', label: 'Messaging', icon: 'chat' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'limits', label: 'Limits', icon: 'cpu' },
  { id: 'tests', label: 'Tests', icon: 'check' },
  { id: 'review', label: 'Review', icon: 'file' },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];
type StepId = (typeof STEPS)[number]['id'];

const STEP_OF_ERROR: [RegExp, StepId][] = [
  [/^(name|instructions|soul)$/, 'basics'],
  [/^model$/, 'model'],
  [/^(tools|git\.|mcp\.|skill\.)/, 'workspace'],
  [/^channel\./, 'messaging'],
  [/^(network|mount\.|secrets)/, 'security'],
  [/^limits\./, 'limits'],
  [/^test\./, 'tests'],
];

export const BUILTIN_TOOLS = [
  { name: 'read_file', hint: 'Read files in the workspace' },
  { name: 'edit_file', hint: 'Create and change workspace files' },
  { name: 'search_code', hint: 'Search across the workspace' },
  { name: 'run_tests', hint: 'Run the project’s test command' },
  { name: 'run_command', hint: 'Run shell commands in the sandbox' },
  { name: 'web_search', hint: 'Search the web (needs network access)' },
];

function stepOf(key: string): StepId {
  return STEP_OF_ERROR.find(([pattern]) => pattern.test(key))?.[1] ?? 'review';
}

export default function AgentWizard({ agent, onDone, onCancel }: {
  agent?: Agent; onDone: (id: string) => void; onCancel: () => void;
}) {
  const engine = useEngine();
  const { agents, models, integrations } = useSnapshot();
  const fallbackModel = models.find(model => model.isDefault) ?? models[0];
  const [spec, setSpec] = useState<AgentSpec>(() => agent ? structuredClone(agent.spec)
    : defaultSpec({ configId: fallbackModel?.id ?? '', model: fallbackModel?.models[0] ?? '' }));
  const [step, setStep] = useState<StepId>('basics');
  // Errors appear for a step only after the user has moved past it once.
  const [left, setLeft] = useState<Set<StepId>>(new Set());
  const [task, setTask] = useState('');
  const taken = agents.filter(entry => entry.id !== agent?.id).map(entry => entry.spec.name);
  const connected = integrations.map(integration => integration.platform);
  const errors = useMemo(() => validateSpec(spec, taken, connected), [spec, taken, connected]);
  const index = STEPS.findIndex(entry => entry.id === step);
  const update = (change: (draft: AgentSpec) => void) => setSpec(current => {
    const draft = structuredClone(current);
    change(draft);
    return draft;
  });
  const visibleError = (key: string) => left.has(stepOf(key)) ? errors[key] : undefined;
  const stepHasErrors = (id: StepId) => Object.keys(errors).some(key => stepOf(key) === id);

  function go(next: StepId) {
    setLeft(current => new Set([...current, step]));
    setStep(next);
  }

  function finish(start: boolean) {
    setLeft(new Set(STEPS.map(entry => entry.id)));
    if (Object.keys(errors).length) return;
    if (agent) {
      engine.updateAgent(agent.id, spec);
      if (start) engine.start(agent.id, task);
      onDone(agent.id);
    } else {
      onDone(engine.createAgent(spec, { start, task }).id);
    }
  }

  const sectionProps = { spec, update, error: visibleError };
  return (
    <div className="wizard">
      <header className="page-head">
        <button type="button" className="button ghost" onClick={onCancel}><Icon name="back" /> {agent ? spec.name : 'Agents'}</button>
        <h1>{agent ? `Edit ${agent.spec.name}` : 'Create an agent'}</h1>
      </header>
      <div className="wizard-body">
        <nav className="wizard-steps" aria-label="Steps">
          {STEPS.map((entry, position) => (
            <button key={entry.id} type="button" className="wizard-step"
              aria-current={entry.id === step ? 'step' : undefined} onClick={() => go(entry.id)}>
              <span className="step-number">{position + 1}</span>
              <span>{entry.label}</span>
              {left.has(entry.id) && entry.id !== step && stepHasErrors(entry.id) && <span className="step-alert" aria-label="Needs attention"><Icon name="alert" size={12} /></span>}
            </button>
          ))}
        </nav>
        <section className="wizard-panel card" aria-labelledby="step-title">
          <h2 id="step-title">{STEPS[index].label}</h2>
          {step === 'basics' && <BasicsStep {...sectionProps} />}
          {step === 'model' && <ModelStep {...sectionProps} />}
          {step === 'workspace' && <WorkspaceStep {...sectionProps} />}
          {step === 'messaging' && <MessagingStep {...sectionProps} />}
          {step === 'security' && <SecurityStep {...sectionProps} />}
          {step === 'limits' && <LimitsStep {...sectionProps} />}
          {step === 'tests' && <TestsStep {...sectionProps} />}
          {step === 'review' && <ReviewStep spec={spec} errors={errors} task={task} setTask={setTask} onFix={go} />}
          <footer className="wizard-actions">
            {index > 0 && <button type="button" className="button ghost" onClick={() => go(STEPS[index - 1].id)}>Back</button>}
            <span className="spacer" />
            {step !== 'review'
              ? <button type="button" className="button primary" onClick={() => go(STEPS[index + 1].id)}>Next</button>
              : <>
                <button type="button" className="button" onClick={() => finish(false)}>{agent ? 'Save changes' : 'Create'}</button>
                <button type="button" className="button primary" onClick={() => finish(true)}>
                  <Icon name="play" /> {agent ? 'Save and start' : 'Create and start'}
                </button>
              </>}
          </footer>
        </section>
      </div>
    </div>
  );
}

type SectionProps = {
  spec: AgentSpec;
  update: (change: (draft: AgentSpec) => void) => void;
  error: (key: string) => string | undefined;
};

function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="form-error" role="alert">{error}</small> : hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function Group({ icon, title, hint, children, action }: {
  icon: IconName; title: string; hint: string; children: ReactNode; action?: ReactNode;
}) {
  return (
    <fieldset className="group">
      <legend className="group-head">
        <span className="icon-tile"><Icon name={icon} /></span>
        <span><b>{title}</b><small className="muted">{hint}</small></span>
      </legend>
      {action && <div className="group-action">{action}</div>}
      {children}
    </fieldset>
  );
}

function BasicsStep({ spec, update, error }: SectionProps) {
  return (
    <div className="form">
      <Field label="Name" error={error('name')} hint="Lowercase, used for the agent’s folder and files.">
        <input value={spec.name} placeholder="docs-fixer" autoFocus
          onChange={event => update(draft => { draft.name = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); })} />
      </Field>
      <Field label="Description" hint="One line shown in lists. What is this agent for?">
        <input value={spec.description} placeholder="Finds and fixes broken links in the docs"
          onChange={event => update(draft => { draft.description = event.target.value; })} />
      </Field>
      <Field label="Instructions" error={error('instructions')}
        hint="What should it do, what does done look like, and what must it never do?">
        <textarea rows={7} value={spec.instructions}
          placeholder={'Scan the docs folder for broken links.\nOpen one pull request per fix.\nNever change prose beyond the link.'}
          onChange={event => update(draft => { draft.instructions = event.target.value; })} />
      </Field>
      <Field label="Persona (optional)" error={error('soul')} hint="Tone and working style, for example “Be concise and state uncertainty.”">
        <input value={spec.soul} onChange={event => update(draft => { draft.soul = event.target.value; })} />
      </Field>
    </div>
  );
}

function ModelStep({ spec, update, error }: SectionProps) {
  const { models } = useSnapshot();
  const [adding, setAdding] = useState(false);
  const selected = models.find(model => model.id === spec.model.configId);
  return (
    <div className="form">
      <p className="muted">Which model should this agent think with? Providers and keys are shared across agents and managed under Models.</p>
      <div className="choice-list" role="radiogroup" aria-label="Provider">
        {models.map(model => (
          <label key={model.id} className={model.id === spec.model.configId ? 'choice selected' : 'choice'}>
            <input type="radio" name="provider" checked={model.id === spec.model.configId}
              onChange={() => update(draft => { draft.model = { configId: model.id, model: model.models[0] ?? '' }; })} />
            <span><b>{model.label}</b><small className="muted">{model.models.join(', ')}</small></span>
            {model.isDefault && <span className="tag">Default</span>}
          </label>
        ))}
        <button type="button" className="choice add" onClick={() => setAdding(true)}><Icon name="plus" /> Add a provider</button>
      </div>
      {selected && (
        <Field label="Model" error={error('model')}>
          <select value={spec.model.model} onChange={event => update(draft => { draft.model.model = event.target.value; })}>
            {selected.models.map(model => <option key={model}>{model}</option>)}
          </select>
        </Field>
      )}
      {!selected && error('model') && <p className="form-error" role="alert">{error('model')}</p>}
      {adding && <ProviderDialog onClose={() => setAdding(false)}
        onSaved={config => update(draft => { draft.model = { configId: config.id, model: config.models[0] ?? '' }; })} />}
    </div>
  );
}

function WorkspaceStep({ spec, update, error }: SectionProps) {
  const [customTool, setCustomTool] = useState('');
  const toggleTool = (name: string) => update(draft => {
    draft.tools = draft.tools.includes(name) ? draft.tools.filter(tool => tool !== name) : [...draft.tools, name];
  });
  const extraTools = spec.tools.filter(tool => !BUILTIN_TOOLS.some(entry => entry.name === tool));
  return (
    <div className="form">
      <Group icon="git" title="Git repositories" hint="Cloned into /workspace before the agent starts."
        action={<button type="button" className="button small" onClick={() => update(draft => {
          draft.workspace.git.push({ url: '', branch: 'main', access: 'read-only' });
        })}><Icon name="plus" /> Add repository</button>}>
        {spec.workspace.git.length === 0 && <p className="muted empty-line">No repositories. The agent starts with an empty workspace.</p>}
        {spec.workspace.git.map((repo, index) => (
          <div className="row" key={index}>
            <input aria-label="Repository URL" placeholder="https://github.com/org/repo.git" value={repo.url}
              onChange={event => update(draft => { draft.workspace.git[index].url = event.target.value.trim(); })} />
            <input aria-label="Branch" className="narrow" value={repo.branch}
              onChange={event => update(draft => { draft.workspace.git[index].branch = event.target.value.trim(); })} />
            <select aria-label="Access" value={repo.access}
              onChange={event => update(draft => { draft.workspace.git[index].access = event.target.value as 'read-only' | 'read-write'; })}>
              <option value="read-only">Read only</option>
              <option value="read-write">Read and push</option>
            </select>
            <RemoveButton label="Remove repository" onClick={() => update(draft => { draft.workspace.git.splice(index, 1); })} />
            {error(`git.${index}`) && <small className="form-error row-error" role="alert">{error(`git.${index}`)}</small>}
          </div>
        ))}
      </Group>

      <Group icon="plug" title="MCP servers" hint="Tool servers the agent can call. Local servers run inside the sandbox."
        action={<button type="button" className="button small" onClick={() => update(draft => {
          draft.workspace.mcp.push({ name: '', transport: 'http', url: '', tools: [] });
        })}><Icon name="plus" /> Add server</button>}>
        {spec.workspace.mcp.length === 0 && <p className="muted empty-line">No MCP servers.</p>}
        {spec.workspace.mcp.map((server, index) => (
          <div className="row" key={index}>
            <input aria-label="Server name" className="narrow" placeholder="github" value={server.name}
              onChange={event => update(draft => { draft.workspace.mcp[index].name = event.target.value.toLowerCase(); })} />
            <select aria-label="Transport" value={server.transport}
              onChange={event => update(draft => {
                const base = { name: server.name, tools: server.tools };
                draft.workspace.mcp[index] = event.target.value === 'stdio'
                  ? { ...base, transport: 'stdio', command: '', args: [] } : { ...base, transport: 'http', url: '' };
              })}>
              <option value="http">Remote (HTTP)</option>
              <option value="stdio">Local command</option>
            </select>
            {server.transport === 'http'
              ? <input aria-label="Server URL" placeholder="https://api.githubcopilot.com/mcp/" value={server.url}
                onChange={event => update(draft => { (draft.workspace.mcp[index] as Extract<McpServer, { transport: 'http' }>).url = event.target.value.trim(); })} />
              : <input aria-label="Server command" placeholder="npx -y @modelcontextprotocol/server-filesystem /workspace"
                value={[server.command, ...server.args].join(' ')}
                onChange={event => update(draft => {
                  const [command = '', ...args] = event.target.value.split(' ');
                  Object.assign(draft.workspace.mcp[index], { command, args });
                })} />}
            <input aria-label="Server tools" placeholder="tools (comma-separated)" value={server.tools.join(', ')}
              onChange={event => update(draft => { draft.workspace.mcp[index].tools = event.target.value.split(',').map(tool => tool.trim()).filter(Boolean); })} />
            <RemoveButton label="Remove server" onClick={() => update(draft => { draft.workspace.mcp.splice(index, 1); })} />
            {error(`mcp.${index}`) && <small className="form-error row-error" role="alert">{error(`mcp.${index}`)}</small>}
          </div>
        ))}
      </Group>

      <Group icon="book" title="Skill packages" hint="Reusable instructions and scripts loaded into /workspace/.skills."
        action={<button type="button" className="button small" onClick={() => update(draft => {
          draft.workspace.skills.push({ name: '', source: '' });
        })}><Icon name="plus" /> Add skill</button>}>
        {spec.workspace.skills.length === 0 && <p className="muted empty-line">No skills.</p>}
        {spec.workspace.skills.map((skill, index) => (
          <div className="row" key={index}>
            <input aria-label="Skill name" className="narrow" placeholder="code-review" value={skill.name}
              onChange={event => update(draft => { draft.workspace.skills[index].name = event.target.value.trim(); })} />
            <input aria-label="Skill source" placeholder="github.com/org/skills/code-review" value={skill.source}
              onChange={event => update(draft => { draft.workspace.skills[index].source = event.target.value.trim(); })} />
            <RemoveButton label="Remove skill" onClick={() => update(draft => { draft.workspace.skills.splice(index, 1); })} />
            {error(`skill.${index}`) && <small className="form-error row-error" role="alert">{error(`skill.${index}`)}</small>}
          </div>
        ))}
      </Group>

      <Group icon="wrench" title="Built-in tools" hint="Only the tools you pick are offered to the model.">
        <div className="checks">
          {BUILTIN_TOOLS.map(tool => (
            <label key={tool.name} className="check">
              <input type="checkbox" checked={spec.tools.includes(tool.name)} onChange={() => toggleTool(tool.name)} />
              <span><code>{tool.name}</code><small className="muted">{tool.hint}</small></span>
            </label>
          ))}
          {extraTools.map(tool => (
            <label key={tool} className="check">
              <input type="checkbox" checked onChange={() => toggleTool(tool)} />
              <span><code>{tool}</code><small className="muted">Custom tool</small></span>
            </label>
          ))}
        </div>
        <div className="row">
          <input aria-label="Custom tool name" placeholder="Add a custom tool name" value={customTool}
            onChange={event => setCustomTool(event.target.value.trim())}
            onKeyDown={event => { if (event.key === 'Enter' && customTool) { event.preventDefault(); toggleTool(customTool); setCustomTool(''); } }} />
          <button type="button" className="button small" disabled={!customTool}
            onClick={() => { toggleTool(customTool); setCustomTool(''); }}>Add tool</button>
        </div>
        {error('tools') && <small className="form-error" role="alert">{error('tools')}</small>}
      </Group>
    </div>
  );
}

function MessagingStep({ spec, update, error }: SectionProps) {
  const { integrations } = useSnapshot();
  const [connecting, setConnecting] = useState<MessagingPlatform>();
  const platforms: { platform: MessagingPlatform; placeholder: string }[] = [
    { platform: 'slack', placeholder: '#docs-team' },
    { platform: 'teams', placeholder: 'Engineering / Code review' },
  ];
  const add = (platform: MessagingPlatform) => update(draft => {
    draft.channels.push({ platform, channel: platform === 'slack' ? '#' : '', listen: true, post: true, approvals: false });
  });
  return (
    <div className="form">
      <p className="muted">Let people give this agent tasks from Slack or Microsoft Teams, and choose where it reports back.
        Messages go through Bridge, so the agent never sees a Slack or Teams token.</p>
      <div className="platforms">
        {platforms.map(entry => {
          const integration = integrations.find(item => item.platform === entry.platform);
          return (
            <div key={entry.platform} className="platform-row">
              <span className="icon-tile"><Icon name={entry.platform} /></span>
              <span className="grow"><b>{PLATFORM_NAME[entry.platform]}</b>
                <small className="muted">{integration ? `Connected to ${integration.account}` : 'Not connected'}</small></span>
              {integration
                ? <button type="button" className="button small" onClick={() => add(entry.platform)}><Icon name="plus" /> Add {PLATFORM_NAME[entry.platform]} channel</button>
                : <button type="button" className="button small" onClick={() => setConnecting(entry.platform)}>Connect {PLATFORM_NAME[entry.platform]}</button>}
            </div>
          );
        })}
      </div>
      {spec.channels.length === 0 && <p className="muted empty-line">No channels. The agent only takes tasks from Bridge.</p>}
      {spec.channels.map((binding, index) => (
        <fieldset className="group channel" key={index}>
          <legend className="sr-only">{PLATFORM_NAME[binding.platform]} channel {index + 1}</legend>
          <div className="row">
            <span className="icon-tile" title={PLATFORM_NAME[binding.platform]}><Icon name={binding.platform} /></span>
            <input aria-label={`${PLATFORM_NAME[binding.platform]} channel`}
              placeholder={platforms.find(entry => entry.platform === binding.platform)?.placeholder}
              value={binding.channel}
              onChange={event => update(draft => {
                draft.channels[index].channel = binding.platform === 'slack' ? event.target.value.toLowerCase().replace(/\s+/g, '-') : event.target.value;
              })} />
            <RemoveButton label="Remove channel" onClick={() => update(draft => { draft.channels.splice(index, 1); })} />
          </div>
          <div className="checks">
            <label className="check">
              <input type="checkbox" checked={binding.listen} onChange={event => update(draft => { draft.channels[index].listen = event.target.checked; })} />
              <span>Take tasks here<small className="muted">When someone mentions @{spec.name || 'agent'}</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={binding.post} onChange={event => update(draft => { draft.channels[index].post = event.target.checked; })} />
              <span>Post progress and results<small className="muted">Replies in the thread that started the task</small></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={binding.approvals} onChange={event => update(draft => { draft.channels[index].approvals = event.target.checked; })} />
              <span>Ask for approvals here<small className="muted">For actions under Security → Ask me first</small></span>
            </label>
          </div>
          {error(`channel.${index}`) && <small className="form-error" role="alert">{error(`channel.${index}`)}</small>}
        </fieldset>
      ))}
      {connecting && <ConnectDialog platform={connecting} onClose={() => setConnecting(undefined)} onConnected={() => add(connecting)} />}
    </div>
  );
}

function suggestedDomains(spec: AgentSpec) {
  const hosts = new Set<string>();
  for (const repo of spec.workspace.git) {
    const host = repo.url.startsWith('git@') ? repo.url.slice(4).split(':')[0] : hostOf(repo.url);
    if (host) hosts.add(host);
  }
  for (const server of spec.workspace.mcp) {
    const host = server.transport === 'http' ? hostOf(server.url) : undefined;
    if (host) hosts.add(host);
  }
  return [...hosts].filter(host => !spec.security.network.allow.includes(host));
}

function SecurityStep({ spec, update, error }: SectionProps) {
  const [domain, setDomain] = useState('');
  const [secret, setSecret] = useState('');
  const [mount, setMount] = useState('');
  const suggestions = suggestedDomains(spec);
  const addDomain = (value: string) => {
    const clean = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (clean) update(draft => { if (!draft.security.network.allow.includes(clean)) draft.security.network.allow.push(clean); });
  };
  const networkModes: { mode: NetworkMode; title: string; hint: string }[] = [
    { mode: 'none', title: 'No network', hint: 'Only the model is reachable.' },
    { mode: 'allowlist', title: 'Allowed domains only', hint: 'Recommended. Everything else is blocked and logged.' },
    { mode: 'open', title: 'Open internet', hint: 'Any domain. Connections are still logged.' },
  ];
  return (
    <div className="form">
      <div className="callout">
        <Icon name="shield" size={18} />
        <div>
          <b>Always isolated</b>
          <p className="muted">Every agent runs in its own lightweight sandbox inside Bridge’s Linux VM, separate from your computer
            and from other agents. It sees only its workspace, the network you allow, and the secrets you grant.</p>
        </div>
      </div>

      <Group icon="globe" title="Network" hint="What can the agent connect to?">
        <div className="choice-list" role="radiogroup" aria-label="Network access">
          {networkModes.map(option => (
            <label key={option.mode} className={spec.security.network.mode === option.mode ? 'choice selected' : 'choice'}>
              <input type="radio" name="network" checked={spec.security.network.mode === option.mode}
                onChange={() => update(draft => { draft.security.network.mode = option.mode; })} />
              <span><b>{option.title}</b><small className="muted">{option.hint}</small></span>
            </label>
          ))}
        </div>
        {spec.security.network.mode === 'allowlist' && <>
          <div className="chips">
            {spec.security.network.allow.map(host => (
              <span className="chip" key={host}>{host}
                <button type="button" aria-label={`Remove ${host}`} onClick={() => update(draft => {
                  draft.security.network.allow = draft.security.network.allow.filter(entry => entry !== host);
                })}><Icon name="x" size={10} /></button>
              </span>
            ))}
            {spec.security.network.allow.length === 0 && <span className="muted">No domains yet.</span>}
          </div>
          <div className="row">
            <input aria-label="Allowed domain" placeholder="github.com or *.example.com" value={domain}
              onChange={event => setDomain(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addDomain(domain); setDomain(''); } }} />
            <button type="button" className="button small" disabled={!domain.trim()} onClick={() => { addDomain(domain); setDomain(''); }}>Allow</button>
          </div>
          {suggestions.length > 0 && (
            <div className="suggestions"><span className="muted">Suggested from your workspace:</span>
              {suggestions.map(host => <button key={host} type="button" className="chip add" onClick={() => addDomain(host)}><Icon name="plus" size={10} /> {host}</button>)}
            </div>
          )}
          {error('network') && <small className="form-error" role="alert">{error('network')}</small>}
        </>}
      </Group>

      <Group icon="file" title="Files" hint="What can the agent read and write?">
        <div className="choice-list horizontal" role="radiogroup" aria-label="Workspace access">
          {(['read-write', 'read-only'] as const).map(access => (
            <label key={access} className={spec.security.filesystem.workspace === access ? 'choice selected' : 'choice'}>
              <input type="radio" name="workspace-access" checked={spec.security.filesystem.workspace === access}
                onChange={() => update(draft => { draft.security.filesystem.workspace = access; })} />
              <span><b>{access === 'read-write' ? 'Workspace: read and write' : 'Workspace: read only'}</b></span>
            </label>
          ))}
        </div>
        <p className="muted">Host folders are not visible unless you share them here.</p>
        {spec.security.filesystem.hostMounts.map((entry, index) => (
          <div className="row" key={index}>
            <code className="grow">{entry.path}</code>
            <select aria-label="Host folder access" value={entry.access}
              onChange={event => update(draft => { draft.security.filesystem.hostMounts[index].access = event.target.value as 'read-only' | 'read-write'; })}>
              <option value="read-only">Read only</option>
              <option value="read-write">Read and write</option>
            </select>
            <RemoveButton label="Remove host folder" onClick={() => update(draft => { draft.security.filesystem.hostMounts.splice(index, 1); })} />
            {error(`mount.${index}`) && <small className="form-error row-error" role="alert">{error(`mount.${index}`)}</small>}
          </div>
        ))}
        <div className="row">
          <input aria-label="Host folder path" placeholder="/Users/me/datasets" value={mount} onChange={event => setMount(event.target.value)} />
          <button type="button" className="button small" disabled={!mount.trim()} onClick={() => {
            update(draft => { draft.security.filesystem.hostMounts.push({ path: mount.trim(), access: 'read-only' }); });
            setMount('');
          }}>Share folder</button>
        </div>
      </Group>

      <Group icon="key" title="Credentials" hint="Secrets injected as environment variables. Values stay in your keychain.">
        <div className="chips">
          {spec.security.secrets.map(name => (
            <span className="chip" key={name}><Icon name="lock" size={10} /> {name}
              <button type="button" aria-label={`Remove ${name}`} onClick={() => update(draft => {
                draft.security.secrets = draft.security.secrets.filter(entry => entry !== name);
              })}><Icon name="x" size={10} /></button>
            </span>
          ))}
          {spec.security.secrets.length === 0 && <span className="muted">No credentials. Model access never needs one; the gateway handles it.</span>}
        </div>
        <div className="row">
          <input aria-label="Secret name" placeholder="GITHUB_TOKEN" value={secret} onChange={event => setSecret(event.target.value.toUpperCase())} />
          <button type="button" className="button small" disabled={!secret.trim()} onClick={() => {
            update(draft => { if (!draft.security.secrets.includes(secret.trim())) draft.security.secrets.push(secret.trim()); });
            setSecret('');
          }}>Grant</button>
        </div>
        {error('secrets') && <small className="form-error" role="alert">{error('secrets')}</small>}
      </Group>

      <Group icon="check" title="Ask me first" hint="Pause and wait for your approval before these actions.">
        <div className="checks">
          <label className="check">
            <input type="checkbox" checked={spec.security.approvals.gitPush}
              onChange={event => update(draft => { draft.security.approvals.gitPush = event.target.checked; })} />
            <span>Pushing to a Git repository</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={spec.security.approvals.newDomains}
              onChange={event => update(draft => { draft.security.approvals.newDomains = event.target.checked; })} />
            <span>Requesting a domain that is not allowed</span>
          </label>
        </div>
      </Group>
    </div>
  );
}

function LimitsStep({ spec, update, error }: SectionProps) {
  const rows: { key: keyof typeof LIMIT_BOUNDS; label: string; format: (value: number) => string; hint: string }[] = [
    { key: 'cpu', label: 'CPU', format: value => `${value} core${value === 1 ? '' : 's'}`, hint: 'Hard cap. The agent is throttled above this.' },
    { key: 'memoryMiB', label: 'Memory', format: formatMemory, hint: 'Hard cap. Exceeding it restarts the sandbox.' },
    { key: 'diskGiB', label: 'Workspace disk', format: value => `${value} GiB`, hint: 'Space for cloned repos and files.' },
    { key: 'maxRuntimeMin', label: 'Maximum run time', format: value => value >= 60 ? `${(value / 60).toFixed(value % 60 ? 1 : 0)} h` : `${value} min`, hint: 'Stops the agent after this long.' },
    { key: 'maxTokens', label: 'Token budget', format: value => value.toLocaleString('en-US'), hint: 'Pauses the agent when used up.' },
  ];
  return (
    <div className="form">
      <p className="muted">Limits are enforced by the sandbox, not requested. Defaults suit most coding agents on a laptop.</p>
      {rows.map(row => {
        const bound = LIMIT_BOUNDS[row.key];
        const value = spec.limits[row.key];
        return (
          <div className="limit" key={row.key}>
            <div className="limit-head"><b>{row.label}</b><span className="limit-value">{row.format(value)}</span></div>
            <input type="range" aria-label={row.label} min={bound.min} max={bound.max} step={bound.step} value={value}
              onChange={event => update(draft => { draft.limits[row.key] = Number(event.target.value); })} />
            <small className={error(`limits.${row.key}`) ? 'form-error' : 'muted'}>{error(`limits.${row.key}`) ?? row.hint}</small>
          </div>
        );
      })}
    </div>
  );
}

function TestsStep({ spec, update, error }: SectionProps) {
  return (
    <div className="form">
      <p className="muted">Tests are real tasks with a pass condition. They are saved in kmx’s test file and run before the agent ships to a team environment.</p>
      {spec.tests.map((test, index) => (
        <div className="test-row" key={index}>
          <input aria-label="Test ID" className="narrow" placeholder="finds-link" value={test.id}
            onChange={event => update(draft => { draft.tests[index].id = event.target.value.trim(); })} />
          <input aria-label="Test input" placeholder="Check docs/setup.md" value={test.input}
            onChange={event => update(draft => { draft.tests[index].input = event.target.value; })} />
          <select aria-label="Check" value={test.check}
            onChange={event => update(draft => { draft.tests[index].check = event.target.value as 'contains' | 'toolCalled'; })}>
            <option value="contains">Answer contains</option>
            <option value="toolCalled">Calls tool</option>
          </select>
          <input aria-label="Expected" className="narrow" value={test.value}
            onChange={event => update(draft => { draft.tests[index].value = event.target.value; })} />
          <RemoveButton label="Remove test" onClick={() => update(draft => { draft.tests.splice(index, 1); })} />
          {error(`test.${index}`) && <small className="form-error row-error" role="alert">{error(`test.${index}`)}</small>}
        </div>
      ))}
      {spec.tests.length === 0 && <p className="muted empty-line">No tests yet. You can add them later.</p>}
      <div><button type="button" className="button small" onClick={() => update(draft => {
        draft.tests.push({ id: `test-${draft.tests.length + 1}`, input: '', check: 'contains', value: '' });
      })}><Icon name="plus" /> Add test</button></div>
    </div>
  );
}

function ReviewStep({ spec, errors, task, setTask, onFix }: {
  spec: AgentSpec; errors: Record<string, string | undefined>; task: string; setTask: (task: string) => void; onFix: (step: StepId) => void;
}) {
  const { models } = useSnapshot();
  const files = agentFiles(spec, models.find(model => model.id === spec.model.configId));
  const [open, setOpen] = useState(0);
  const problems = Object.entries(errors).filter(([, message]) => message);
  return (
    <div className="form">
      {problems.length > 0 && (
        <div className="callout danger" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <b>Fix {problems.length === 1 ? 'this' : `these ${problems.length}`} before saving</b>
            <ul>{problems.map(([key, message]) => (
              <li key={key}><button type="button" className="link" onClick={() => onFix(stepOf(key))}>{STEPS.find(entry => entry.id === stepOf(key))?.label}</button>: {message}</li>
            ))}</ul>
          </div>
        </div>
      )}
      <Field label="First task (optional)" hint="What should it work on when it starts? You can change this later.">
        <input value={task} placeholder="Fix broken links in docs/getting-started" onChange={event => setTask(event.target.value)} />
      </Field>
      <div className="file-tabs" role="tablist" aria-label="Agent files">
        {files.map((entry, index) => (
          <button key={entry.path} type="button" role="tab" aria-selected={open === index} onClick={() => setOpen(index)}>{entry.path.split('/').pop()}</button>
        ))}
      </div>
      <pre className="code" aria-label={files[open]?.path}>{files[Math.min(open, files.length - 1)]?.content}</pre>
      <small className="muted">Saved in kmx’s agent file format, so kmx can read the same files.</small>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="icon-button" aria-label={label} onClick={onClick}><Icon name="trash" /></button>;
}
