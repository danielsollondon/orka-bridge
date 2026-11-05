import type { AgentEngine, EngineCapabilities, EngineSnapshot, ModelInput } from './engine';
import { domainAllowed } from './policy';
import { runShell } from './shell';
import { defaultSpec } from './spec';
import type { Agent, AgentSpec, AuditEvent, AuditKind, AuditOutcome, ModelConfig } from './types';

const STORAGE_KEY = 'bridge.preview.v1';
const MAX_EVENTS = 500;
const MAX_SAMPLES = 40;

type Clock = () => number;
type Random = () => number;

function makeId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}_${random.replace(/-/g, '').slice(0, 12)}`;
}

const SIMULATED_TOOLS = ['read_file', 'search_code', 'run_tests', 'edit_file', 'web_search'];
const SIMULATED_HOSTS = ['api.github.com', 'github.com', 'registry.npmjs.org', 'pypi.org', 'telemetry.example.net'];

/**
 * In-browser engine used until a real runtime is connected. Everything it
 * reports is simulated, and the UI labels it as preview data.
 */
export class PreviewEngine implements AgentEngine {
  readonly id = 'preview';
  readonly label = 'Preview (simulated)';
  readonly preview = true;
  readonly capabilities: EngineCapabilities = { pause: true, shell: true, limits: true, networkPolicy: true, liveUsage: true };

  private state: EngineSnapshot;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage,
    private now: Clock = Date.now,
    private random: Random = Math.random,
    seed = true,
  ) {
    this.state = this.load() ?? (seed ? seedState(now()) : { agents: [], events: [], models: [] });
  }

  snapshot() { return this.state; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  startSimulation(intervalMs = 2000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stopSimulation() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  createAgent(spec: AgentSpec, options: { start?: boolean; task?: string } = {}) {
    const at = this.now();
    const agent: Agent = {
      id: makeId('agt'), spec, status: 'stopped', createdAt: at, updatedAt: at,
      usage: { samples: [], tokens: 0, netBytes: 0, diskMiB: 0 },
    };
    this.commit({ agents: [...this.state.agents, agent] }, [
      this.event(agent, 'lifecycle', 'ok', 'Agent created', `Saved ${spec.name}/${spec.name}.agent.md`),
    ]);
    if (options.start) this.start(agent.id, options.task);
    return this.agent(agent.id);
  }

  updateAgent(id: string, spec: AgentSpec) {
    const current = this.agent(id);
    const restartNeeded = current.status === 'running' && JSON.stringify(current.spec.limits) !== JSON.stringify(spec.limits);
    this.patch(id, { spec }, [this.event({ ...current, spec }, 'lifecycle', 'ok', 'Configuration updated',
      restartNeeded ? 'New limits apply the next time the agent starts.' : undefined)]);
    return this.agent(id);
  }

  start(id: string, task?: string) {
    const agent = this.agent(id);
    const nextTask = task?.trim() || agent.task;
    this.patch(id, {
      status: 'starting', statusDetail: undefined, task: nextTask, startedAt: this.now(),
      usage: { ...agent.usage, samples: [] },
    }, [this.event(agent, 'lifecycle', 'ok', nextTask ? `Started: ${nextTask}` : 'Started',
      `Sandbox limited to ${agent.spec.limits.cpu} CPU and ${agent.spec.limits.memoryMiB} MiB memory.`)]);
  }

  pause(id: string) {
    const agent = this.agent(id);
    if (agent.status !== 'running' && agent.status !== 'starting') return;
    this.patch(id, { status: 'paused', statusDetail: 'Checkpointed. Resume to continue where it left off.' },
      [this.event(agent, 'lifecycle', 'ok', 'Paused', 'Sandbox state was checkpointed to disk.')]);
  }

  resume(id: string) {
    const agent = this.agent(id);
    if (agent.status !== 'paused') return;
    this.patch(id, { status: 'running', statusDetail: undefined },
      [this.event(agent, 'lifecycle', 'ok', 'Resumed from checkpoint')]);
  }

  stop(id: string) {
    const agent = this.agent(id);
    if (agent.status === 'stopped') return;
    this.patch(id, { status: 'stopped', statusDetail: undefined, startedAt: undefined },
      [this.event(agent, 'lifecycle', 'ok', 'Stopped', 'Sandbox removed. The workspace is kept.')]);
  }

  remove(id: string) {
    const agent = this.agent(id);
    // Audit history is kept after deletion.
    this.commit({ agents: this.state.agents.filter(entry => entry.id !== id) },
      [this.event(agent, 'lifecycle', 'ok', 'Agent deleted', 'Sandbox and workspace removed. Audit history is kept.')]);
  }

  copy(id: string) {
    const source = this.agent(id);
    const names = new Set(this.state.agents.map(agent => agent.spec.name));
    let name = `${source.spec.name}-copy`.slice(0, 63);
    for (let index = 2; names.has(name); index += 1) name = `${source.spec.name}-copy-${index}`.slice(0, 63);
    return this.createAgent(structuredClone({ ...source.spec, name }));
  }

  exec(id: string, cwd: string, command: string) {
    const agent = this.agent(id);
    if (agent.status !== 'running') {
      return { output: `Shell is unavailable while the agent is ${agent.status}.`, cwd, exitCode: 1, audits: [] };
    }
    const result = runShell(agent, cwd, command);
    if (result.audits.length) {
      this.commit({}, result.audits.map(audit => this.event(agent, audit.kind, audit.outcome, audit.summary, 'From your interactive shell')));
    }
    return result;
  }

  saveModel(input: ModelInput, secret?: string) {
    const id = input.id ?? makeId('mdl');
    const existing = this.state.models.find(model => model.id === id);
    // Secrets would be written to the OS keychain by the native app; the preview never stores them.
    const credentialRef = secret ? `keychain:bridge/${id}` : existing?.credentialRef;
    const config: ModelConfig = {
      ...input, id, credentialRef,
      isDefault: existing?.isDefault ?? this.state.models.length === 0,
    };
    const models = existing
      ? this.state.models.map(model => model.id === id ? config : model)
      : [...this.state.models, config];
    this.commit({ models });
    return config;
  }

  removeModel(id: string) {
    const models = this.state.models.filter(model => model.id !== id);
    if (models.length && !models.some(model => model.isDefault)) models[0] = { ...models[0], isDefault: true };
    this.commit({ models });
  }

  setDefaultModel(id: string) {
    this.commit({ models: this.state.models.map(model => ({ ...model, isDefault: model.id === id })) });
  }

  /** Advances the simulation by one step. */
  tick() {
    const at = this.now();
    const events: AuditEvent[] = [];
    const agents = this.state.agents.map(agent => {
      if (agent.status === 'starting') {
        events.push(this.event(agent, 'lifecycle', 'ok', 'Sandbox ready',
          `${agent.spec.workspace.git.length} repo(s) cloned, ${agent.spec.workspace.mcp.length} MCP server(s) connected.`));
        return { ...agent, status: 'running' as const, updatedAt: at };
      }
      if (agent.status !== 'running') return agent;
      return this.simulate(agent, at, events);
    });
    this.commit({ agents }, events);
  }

  private simulate(agent: Agent, at: number, events: AuditEvent[]): Agent {
    const { limits } = agent.spec;
    const previous = agent.usage.samples.at(-1);
    const cpu = clamp((previous?.cpu ?? limits.cpu * 0.2) + (this.random() - 0.5) * limits.cpu * 0.3, 0.02, limits.cpu * 0.95);
    const memoryMiB = clamp((previous?.memoryMiB ?? limits.memoryMiB * 0.3) + (this.random() - 0.45) * limits.memoryMiB * 0.08,
      120, limits.memoryMiB * 0.92);
    const tokens = agent.usage.tokens + Math.round(80 + this.random() * 600);
    const usage = {
      samples: [...agent.usage.samples, { at, cpu, memoryMiB }].slice(-MAX_SAMPLES),
      tokens,
      netBytes: agent.usage.netBytes + Math.round(this.random() * 40_000),
      diskMiB: Math.min(agent.usage.diskMiB + this.random() * 4, limits.diskGiB * 1024),
    };
    if (tokens >= limits.maxTokens) {
      events.push(this.event(agent, 'model', 'denied', 'Token limit reached',
        `Used ${tokens.toLocaleString('en-US')} of ${limits.maxTokens.toLocaleString('en-US')} tokens. Paused the agent.`));
      return { ...agent, usage, status: 'paused', statusDetail: 'Paused: token limit reached.', updatedAt: at };
    }
    if (agent.startedAt && at - agent.startedAt > limits.maxRuntimeMin * 60_000) {
      events.push(this.event(agent, 'lifecycle', 'denied', 'Maximum runtime reached', 'Stopped the agent.'));
      return { ...agent, usage, status: 'stopped', statusDetail: 'Stopped: maximum runtime reached.', updatedAt: at };
    }
    const roll = this.random();
    if (roll < 0.3) {
      const tools = agent.spec.tools.length ? agent.spec.tools : SIMULATED_TOOLS;
      const tool = tools[Math.floor(this.random() * tools.length)];
      events.push(this.event(agent, 'tool', 'ok', `Called ${tool}`));
    } else if (roll < 0.45) {
      events.push(this.event(agent, 'model', 'ok', `Model call to ${agent.spec.model.model}`,
        `${Math.round(500 + this.random() * 3000)} tokens`));
    } else if (roll < 0.55) {
      // Mostly reach allowed hosts; occasionally probe others so denials stay realistic but rare.
      const allowed = agent.spec.security.network.allow.filter(host => !host.startsWith('*.'));
      const host = allowed.length && this.random() < 0.85
        ? allowed[Math.floor(this.random() * allowed.length)]
        : SIMULATED_HOSTS[Math.floor(this.random() * SIMULATED_HOSTS.length)];
      const permitted = domainAllowed(agent.spec, host);
      events.push(this.event(agent, 'network', permitted ? 'ok' : 'denied',
        permitted ? `Connected to ${host}` : `Blocked connection to ${host}`,
        permitted ? undefined : 'Not in the network allowlist. Add it under Security if the agent needs it.'));
    } else if (roll < 0.57) {
      events.push(this.event(agent, 'tool', 'failed', 'Tool call failed: run_tests', 'Exit code 1. The agent will retry.'));
    }
    return { ...agent, usage, updatedAt: at };
  }

  private agent(id: string) {
    const agent = this.state.agents.find(entry => entry.id === id);
    if (!agent) throw new Error(`Unknown agent ${id}`);
    return agent;
  }

  private patch(id: string, changes: Partial<Agent>, events: AuditEvent[]) {
    const at = this.now();
    this.commit({
      agents: this.state.agents.map(agent => agent.id === id ? { ...agent, ...changes, updatedAt: at } : agent),
    }, events);
  }

  private event(agent: Agent, kind: AuditKind, outcome: AuditOutcome, summary: string, detail?: string): AuditEvent {
    return { id: makeId('evt'), agentId: agent.id, agentName: agent.spec.name, at: this.now(), kind, outcome, summary, detail };
  }

  private commit(changes: Partial<EngineSnapshot>, events: AuditEvent[] = []) {
    this.state = {
      ...this.state,
      ...changes,
      events: events.length ? [...events.reverse(), ...this.state.events].slice(0, MAX_EVENTS) : this.state.events,
    };
    this.save();
    for (const listener of this.listeners) listener();
  }

  private load(): EngineSnapshot | undefined {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as EngineSnapshot;
      return Array.isArray(parsed.agents) && Array.isArray(parsed.events) && Array.isArray(parsed.models) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  private save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Preview persistence is best-effort.
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function seedState(now: number): EngineSnapshot {
  const models: ModelConfig[] = [
    { id: 'mdl_copilot', provider: 'github-copilot', label: 'GitHub Copilot', models: ['gpt-5', 'claude-sonnet-4.5', 'gpt-4.1'], isDefault: true },
    { id: 'mdl_mock', provider: 'mock', label: 'Mock Testing Model', models: ['fake'], isDefault: false },
  ];
  const base = defaultSpec({ configId: 'mdl_copilot', model: 'gpt-5' });
  const minute = 60_000;
  const docs: AgentSpec = {
    ...base,
    name: 'docs-fixer',
    description: 'Finds and fixes broken links in the product docs',
    instructions: 'Scan the docs folder for broken links. For each one, find the correct target and open a pull request with the fix. Never change prose beyond the link.',
    tools: ['read_file', 'edit_file', 'web_search'],
    workspace: {
      git: [{ url: 'https://github.com/contoso/docs.git', branch: 'main', access: 'read-write' }],
      mcp: [{ name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', tools: ['create_pull_request'] }],
      skills: [{ name: 'link-checker', source: 'github.com/contoso/skills/link-checker' }],
    },
    security: { ...base.security, network: { mode: 'allowlist', allow: ['github.com', 'api.github.com', '*.githubusercontent.com'] }, secrets: ['GITHUB_TOKEN'] },
    tests: [{ id: 'finds-broken-link', input: 'Check docs/setup.md', check: 'contains', value: 'broken' }],
  };
  const reviewer: AgentSpec = {
    ...base,
    name: 'pr-reviewer',
    description: 'Reviews pull requests labeled needs-review',
    instructions: 'Review open pull requests labeled needs-review. Comment on correctness and missing tests. Never approve or merge.',
    model: { configId: 'mdl_copilot', model: 'claude-sonnet-4.5' },
    tools: ['read_file', 'search_code'],
    workspace: { ...base.workspace, git: [{ url: 'https://github.com/contoso/api.git', branch: 'main', access: 'read-only' }] },
    security: { ...base.security, filesystem: { workspace: 'read-only', hostMounts: [] }, network: { mode: 'allowlist', allow: ['github.com', 'api.github.com'] }, secrets: ['GITHUB_TOKEN'] },
    limits: { ...base.limits, cpu: 0.5, memoryMiB: 512 },
  };
  const deps: AgentSpec = {
    ...base,
    name: 'dep-updater',
    description: 'Keeps npm dependencies current',
    instructions: 'Update outdated npm dependencies one at a time, run the tests, and open a pull request for each passing update.',
    tools: ['read_file', 'edit_file', 'run_tests'],
    workspace: { ...base.workspace, git: [{ url: 'https://github.com/contoso/web.git', branch: 'main', access: 'read-write' }] },
    security: { ...base.security, network: { mode: 'allowlist', allow: ['github.com'] } },
    limits: { ...base.limits, cpu: 2, memoryMiB: 2048 },
  };
  const notes: AgentSpec = {
    ...base,
    name: 'release-notes',
    description: 'Drafts release notes from merged pull requests',
    instructions: 'Summarize pull requests merged since the last release into user-facing release notes.',
    model: { configId: 'mdl_mock', model: 'fake' },
    security: { ...base.security, network: { mode: 'none', allow: [] } },
  };
  const samples = (cpu: number, memoryMiB: number) => Array.from({ length: 24 }, (_, index) => ({
    at: now - (24 - index) * 2000,
    cpu: Math.max(0.02, cpu + Math.sin(index / 2) * cpu * 0.4),
    memoryMiB: memoryMiB + Math.cos(index / 3) * memoryMiB * 0.1,
  }));
  const agents: Agent[] = [
    {
      id: 'agt_docs', spec: docs, status: 'running', task: 'Fix broken links in docs/getting-started',
      createdAt: now - 3 * 24 * 60 * minute, updatedAt: now, startedAt: now - 18 * minute,
      usage: { samples: samples(0.35, 420), tokens: 84_200, netBytes: 3_400_000, diskMiB: 210 },
    },
    {
      id: 'agt_review', spec: reviewer, status: 'paused', task: 'Review PRs labeled needs-review',
      statusDetail: 'Checkpointed. Resume to continue where it left off.',
      createdAt: now - 6 * 24 * 60 * minute, updatedAt: now - 40 * minute,
      usage: { samples: samples(0.1, 260), tokens: 152_000, netBytes: 1_200_000, diskMiB: 95 },
    },
    {
      id: 'agt_deps', spec: deps, status: 'error', task: 'Update outdated dependencies in contoso/web',
      statusDetail: 'Blocked: registry.npmjs.org is not in the network allowlist.',
      createdAt: now - 24 * 60 * minute, updatedAt: now - 4 * minute, startedAt: now - 9 * minute,
      usage: { samples: samples(0.8, 900), tokens: 23_500, netBytes: 600_000, diskMiB: 480 },
    },
    {
      id: 'agt_notes', spec: notes, status: 'stopped',
      createdAt: now - 10 * 24 * 60 * minute, updatedAt: now - 2 * 24 * 60 * minute,
      usage: { samples: [], tokens: 9_800, netBytes: 0, diskMiB: 12 },
    },
  ];
  const event = (agent: Agent, minutesAgo: number, kind: AuditKind, outcome: AuditOutcome, summary: string, detail?: string): AuditEvent =>
    ({ id: makeId('evt'), agentId: agent.id, agentName: agent.spec.name, at: now - minutesAgo * minute, kind, outcome, summary, detail });
  const [a, r, d, n] = agents;
  const events: AuditEvent[] = [
    event(d, 4, 'lifecycle', 'failed', 'Agent stopped after repeated errors', 'npm install failed 3 times because the registry was blocked.'),
    event(d, 5, 'network', 'denied', 'Blocked connection to registry.npmjs.org', 'Not in the network allowlist. Add it under Security if the agent needs it.'),
    event(a, 5, 'tool', 'ok', 'Called edit_file', 'docs/getting-started/install.md'),
    event(d, 6, 'tool', 'failed', 'Tool call failed: run_tests', 'npm ERR! network request to https://registry.npmjs.org failed'),
    event(d, 6, 'network', 'denied', 'Blocked connection to registry.npmjs.org', 'Not in the network allowlist. Add it under Security if the agent needs it.'),
    event(a, 7, 'network', 'ok', 'Connected to api.github.com'),
    event(a, 8, 'secret', 'ok', 'Read secret GITHUB_TOKEN', 'Injected into the sandbox environment.'),
    event(d, 8, 'file', 'ok', 'Edited package.json'),
    event(a, 9, 'network', 'denied', 'Blocked connection to telemetry.example.net', 'Not in the network allowlist. Add it under Security if the agent needs it.'),
    event(d, 9, 'lifecycle', 'ok', 'Started: Update outdated dependencies in contoso/web'),
    event(a, 12, 'model', 'ok', 'Model call to gpt-5', '2,140 tokens'),
    event(a, 18, 'lifecycle', 'ok', 'Started: Fix broken links in docs/getting-started', 'Sandbox limited to 1 CPU and 1024 MiB memory.'),
    event(r, 40, 'lifecycle', 'ok', 'Paused', 'Sandbox state was checkpointed to disk.'),
    event(r, 55, 'tool', 'ok', 'Called search_code'),
    event(n, 2 * 24 * 60, 'lifecycle', 'ok', 'Stopped', 'Sandbox removed. The workspace is kept.'),
  ];
  return { agents, events, models };
}
