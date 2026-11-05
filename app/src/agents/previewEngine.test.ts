import { expect, test } from 'vitest';
import { PreviewEngine } from './previewEngine';
import { runShell } from './shell';
import { defaultSpec } from './spec';
import type { Agent, AgentSpec } from './types';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, data };
}

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return { ...defaultSpec({ configId: 'mdl_copilot', model: 'gpt-5' }), name: 'tester', instructions: 'Do the thing.', ...overrides };
}

function engine(random = () => 0.99) {
  let now = 1_000_000;
  const storage = memoryStorage();
  const instance = new PreviewEngine(storage, () => (now += 1000), random, false);
  return { engine: instance, storage };
}

test('lifecycle: create, start, run, pause, resume, stop', () => {
  const { engine: preview } = engine();
  const agent = preview.createAgent(spec(), { start: true, task: 'First job' });
  expect(agent.status).toBe('starting');
  expect(agent.task).toBe('First job');
  preview.tick();
  expect(preview.snapshot().agents[0].status).toBe('running');
  preview.tick();
  expect(preview.snapshot().agents[0].usage.samples).toHaveLength(1);
  preview.pause(agent.id);
  expect(preview.snapshot().agents[0].status).toBe('paused');
  preview.tick();
  expect(preview.snapshot().agents[0].usage.samples).toHaveLength(1);
  preview.resume(agent.id);
  expect(preview.snapshot().agents[0].status).toBe('running');
  preview.stop(agent.id);
  expect(preview.snapshot().agents[0].status).toBe('stopped');
  expect(preview.snapshot().events.map(event => event.summary)).toEqual([
    'Stopped', 'Resumed from checkpoint', 'Paused', 'Sandbox ready', 'Started: First job', 'Agent created',
  ]);
});

test('usage never exceeds the configured limits', () => {
  let flip = 0;
  const { engine: preview } = engine(() => (flip++ % 2 ? 0.999 : 0.6));
  const agent = preview.createAgent(spec({ limits: { cpu: 0.5, memoryMiB: 512, diskGiB: 1, maxRuntimeMin: 600, maxTokens: 10_000_000 } }), { start: true });
  for (let index = 0; index < 60; index += 1) preview.tick();
  const current = preview.snapshot().agents.find(entry => entry.id === agent.id)!;
  for (const sample of current.usage.samples) {
    expect(sample.cpu).toBeLessThanOrEqual(0.5);
    expect(sample.memoryMiB).toBeLessThanOrEqual(512);
  }
});

test('token budget pauses the agent and is audited', () => {
  const { engine: preview } = engine();
  const agent = preview.createAgent(spec({ limits: { ...spec().limits, maxTokens: 10_000 } }), { start: true });
  for (let index = 0; index < 30; index += 1) preview.tick();
  const current = preview.snapshot().agents.find(entry => entry.id === agent.id)!;
  expect(current.status).toBe('paused');
  expect(current.statusDetail).toBe('Paused: token limit reached.');
  expect(preview.snapshot().events.some(event => event.summary === 'Token limit reached' && event.outcome === 'denied')).toBe(true);
});

test('copy picks a unique name and delete keeps audit history', () => {
  const { engine: preview } = engine();
  const agent = preview.createAgent(spec());
  expect(preview.copy(agent.id).spec.name).toBe('tester-copy');
  expect(preview.copy(agent.id).spec.name).toBe('tester-copy-2');
  preview.remove(agent.id);
  expect(preview.snapshot().agents.map(entry => entry.spec.name)).toEqual(['tester-copy', 'tester-copy-2']);
  expect(preview.snapshot().events.filter(event => event.agentId === agent.id).map(event => event.summary))
    .toEqual(['Agent deleted', 'Agent created']);
});

test('provider secrets are never persisted', () => {
  const { engine: preview, storage } = engine();
  const config = preview.saveModel({ provider: 'openai', label: 'OpenAI', models: ['gpt-5'] }, 'sk-test-secret-value');
  expect(config.credentialRef).toBe(`keychain:bridge/${config.id}`);
  expect(config.isDefault).toBe(true);
  expect([...storage.data.values()].join('')).not.toContain('sk-test-secret-value');
  const second = preview.saveModel({ provider: 'mock', label: 'Mock', models: ['fake'] });
  preview.setDefaultModel(second.id);
  preview.removeModel(second.id);
  expect(preview.snapshot().models.map(model => [model.id, model.isDefault])).toEqual([[config.id, true]]);
});

test('state persists across engine instances', () => {
  const storage = memoryStorage();
  const first = new PreviewEngine(storage, Date.now, Math.random, false);
  first.createAgent(spec());
  const second = new PreviewEngine(storage, Date.now, Math.random, false);
  expect(second.snapshot().agents.map(agent => agent.spec.name)).toEqual(['tester']);
});

test('shell is only available while running and commands are audited', () => {
  const { engine: preview } = engine();
  const agent = preview.createAgent(spec());
  expect(preview.exec(agent.id, '/workspace', 'ls').output).toBe('Shell is unavailable while the agent is stopped.');
  preview.start(agent.id);
  preview.tick();
  expect(preview.exec(agent.id, '/workspace', 'ls').output).toBe('AGENTS.md');
  expect(preview.snapshot().events[0]).toMatchObject({ kind: 'shell', outcome: 'ok', summary: '$ ls' });
});

function running(overrides: Partial<AgentSpec>): Agent {
  return {
    id: 'agt', spec: spec(overrides), status: 'running', createdAt: 0, updatedAt: 0,
    usage: { samples: [{ at: 0, cpu: 0.4, memoryMiB: 300 }], tokens: 10, netBytes: 0, diskMiB: 5 },
  };
}

test('shell enforces the network policy', () => {
  const allow = running({ security: { ...spec().security, network: { mode: 'allowlist', allow: ['github.com', '*.example.com'] } } });
  expect(runShell(allow, '/workspace', 'curl https://github.com').exitCode).toBe(0);
  expect(runShell(allow, '/workspace', 'curl api.example.com/x').exitCode).toBe(0);
  expect(runShell(allow, '/workspace', 'curl https://example.com').exitCode).toBe(7);
  const blocked = runShell(allow, '/workspace', 'curl https://pypi.org/simple');
  expect(blocked.output).toContain('pypi.org is not in the network allowlist');
  expect(blocked.audits).toContainEqual({ kind: 'network', outcome: 'denied', summary: 'Blocked connection to pypi.org' });
  const none = running({ security: { ...spec().security, network: { mode: 'none', allow: [] } } });
  expect(runShell(none, '/workspace', 'wget github.com').output).toContain('network access is off');
});

test('shell enforces file and git permissions', () => {
  const readOnly = running({
    workspace: { git: [{ url: 'https://github.com/o/r.git', branch: 'main', access: 'read-only' }], mcp: [], skills: [] },
    security: { ...spec().security, filesystem: { workspace: 'read-only', hostMounts: [{ path: '/Users/me/data', access: 'read-only' }] } },
  });
  expect(runShell(readOnly, '/workspace', 'touch x').output).toBe('touch: Read-only file system');
  expect(runShell(readOnly, '/workspace/r', 'git push').output).toContain('mounted read-only');
  expect(runShell(readOnly, '/workspace', 'ls /Users/me').output).toBe('data/');
  expect(runShell(readOnly, '/workspace', 'ls /Users/other').output).toContain('host files are not mounted');
  const approval = running({ workspace: { git: [{ url: 'https://github.com/o/r.git', branch: 'main', access: 'read-write' }], mcp: [], skills: [] } });
  expect(runShell(approval, '/workspace/r', 'git push').output).toContain('held for approval');
  const env = runShell(running({ security: { ...spec().security, secrets: ['GITHUB_TOKEN'] } }), '/workspace', 'env').output;
  expect(env).toContain('GITHUB_TOKEN=••••••••');
  expect(runShell(approval, '/workspace', 'cd ../etc').cwd).toBe('/etc');
});
