import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import App from './App';
import { PreviewEngine } from './agents/previewEngine';

afterEach(() => { cleanup(); clearMocks(); vi.unstubAllGlobals(); });

const PAGES = ['Overview', 'Agents', 'Activity', 'Models', 'Environments'];

function setup(seed = true) {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const engine = new PreviewEngine(storage, Date.now, () => 0.99, seed);
  const user = userEvent.setup();
  render(<App engine={engine} />);
  return { engine, user };
}

function nav(name: string) {
  return within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name });
}

test('navigation_order', () => {
  setup();
  const main = screen.getByRole('navigation', { name: 'Main' });
  expect(within(main).getAllByRole('button').map(button => button.textContent)).toEqual(PAGES);
  expect(screen.getByRole('img', { name: 'Orka' })).toBeTruthy();
  expect(screen.getByText('Bridge')).toBeTruthy();
  expect(screen.getByText('Preview data')).toBeTruthy();
});

test('selected_heading', async () => {
  const { user } = setup();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Overview');
  for (const name of [...PAGES.slice(1), 'Overview']) {
    await user.click(nav(name));
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual([name]);
    expect(screen.getByRole('main', { name })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('button')
      .filter(button => button.getAttribute('aria-current') === 'page')).toEqual([nav(name)]);
  }
});

test('keyboard_activation', async () => {
  const { user } = setup();
  await user.tab();
  expect(document.activeElement).toBe(nav('Overview'));
  await user.tab();
  await user.keyboard(' ');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Agents');
  await user.tab();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Activity');
});

test('never shows infrastructure terms like Kubernetes or clusters', async () => {
  const { user } = setup();
  const forbidden = /kubernetes|kubectl|\bk8s\b|cluster|namespace|\bpods?\b|\bcrds?\b|helm/i;
  const check = () => expect(document.body.textContent).not.toMatch(forbidden);
  for (const name of PAGES) {
    await user.click(nav(name));
    check();
  }
  await user.click(nav('Agents'));
  await user.click(screen.getByRole('button', { name: 'docs-fixer' }));
  for (const tab of ['Overview', 'Activity', 'Shell', 'Files']) {
    await user.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
    check();
  }
  await user.click(screen.getByRole('button', { name: /Edit/ }));
  for (const step of within(screen.getByRole('navigation', { name: 'Steps' })).getAllByRole('button')) {
    await user.click(step);
    check();
  }
});

test('creates an agent through the guided steps and saves kmx files', async () => {
  const { user, engine } = setup();
  await user.click(nav('Agents'));
  await user.click(screen.getByRole('button', { name: 'Create agent' }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create an agent');
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'Issue Triage');
  expect((screen.getByRole('textbox', { name: /^Name/ }) as HTMLInputElement).value).toBe('issue-triage');
  await user.type(screen.getByRole('textbox', { name: /^Instructions/ }), 'Label new issues.');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('radio', { name: /GitHub Copilot/ })).toHaveProperty('checked', true);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: /Add repository/ }));
  await user.type(screen.getByRole('textbox', { name: 'Repository URL' }), 'https://github.com/contoso/api.git');
  await user.click(screen.getByRole('checkbox', { name: /read_file/ }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Always isolated')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /github\.com/ }));
  await user.type(screen.getByRole('textbox', { name: 'Secret name' }), 'gh_token');
  await user.click(screen.getByRole('button', { name: 'Grant' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const file = screen.getByLabelText('issue-triage/issue-triage.agent.md').textContent ?? '';
  expect(file).toContain('name: issue-triage\nmodel: gpt-5\nkmx:\n  schemaVersion: 1\n  runtime: orka');
  expect(file).toContain('      allow: [github.com]');
  expect(file).toContain('    secrets: [GH_TOKEN]');
  await user.type(screen.getByRole('textbox', { name: /^First task/ }), 'Triage today');
  await user.click(screen.getByRole('button', { name: /Create and start/ }));
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('issue-triage');
  expect(screen.getByText('Starting')).toBeTruthy();
  expect(screen.getByText('Triage today')).toBeTruthy();
  const created = engine.snapshot().agents.find(agent => agent.spec.name === 'issue-triage');
  expect(created?.spec.workspace.git).toEqual([{ url: 'https://github.com/contoso/api.git', branch: 'main', access: 'read-only' }]);
});

test('blocks saving until problems are fixed', async () => {
  const { user, engine } = setup();
  await user.click(nav('Agents'));
  await user.click(screen.getByRole('button', { name: 'Create agent' }));
  await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByRole('button', { name: /Review/ }));
  await user.click(screen.getByRole('button', { name: 'Create' }));
  const alert = screen.getAllByRole('alert')[0];
  expect(within(alert).getByText(/Fix these 2 before saving/)).toBeTruthy();
  expect(engine.snapshot().agents).toHaveLength(4);
  await user.click(within(alert).getAllByRole('button', { name: 'Purpose' })[0]);
  expect(screen.getByText('Use 1–63 lowercase letters, digits or hyphens, starting with a letter.')).toBeTruthy();
});

test('agent table shows token use against each budget', async () => {
  const { user } = setup();
  await user.click(nav('Agents'));
  expect(screen.getAllByRole('columnheader').map(header => header.textContent))
    .toEqual(['Name', 'Status', 'Network', 'Usage / limit', 'Tokens', 'Updated', 'Actions']);
  const row = screen.getByRole('row', { name: /^docs-fixer/ });
  expect(within(row).getByText('84k')).toBeTruthy();
  expect(within(row).getByText('/ 500k')).toBeTruthy();
  expect(within(row).getByRole('meter', { name: 'docs-fixer token budget used' }).getAttribute('aria-valuenow')).toBe('84200');
  expect(within(screen.getByRole('row', { name: /^release-notes/ })).getByText('9.8k')).toBeTruthy();
});

test('pause, resume and delete with confirmation', async () => {
  const { user, engine } = setup();
  await user.click(nav('Agents'));
  await user.click(screen.getByRole('button', { name: 'Pause docs-fixer' }));
  expect(engine.snapshot().agents[0].status).toBe('paused');
  await user.click(screen.getByRole('button', { name: 'Resume docs-fixer' }));
  expect(engine.snapshot().agents[0].status).toBe('running');
  await user.click(screen.getByRole('button', { name: 'Copy docs-fixer' }));
  expect(screen.getByRole('button', { name: 'docs-fixer-copy' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Delete docs-fixer-copy' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete docs-fixer-copy?' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'docs-fixer-copy' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Delete docs-fixer-copy' }));
  await user.click(screen.getByRole('button', { name: 'Delete agent' }));
  expect(screen.queryByRole('button', { name: 'docs-fixer-copy' })).toBeNull();
  await user.click(nav('Activity'));
  expect(screen.getAllByText('Agent deleted')).toHaveLength(1);
});

test('shell runs inside the sandbox and blocked requests reach the audit log', async () => {
  const { user } = setup();
  await user.click(nav('Agents'));
  await user.click(screen.getByRole('button', { name: 'docs-fixer' }));
  await user.click(screen.getByRole('tab', { name: 'Shell' }));
  const input = screen.getByRole('textbox', { name: 'Shell command' });
  await user.type(input, 'ls{Enter}');
  const log = screen.getByRole('log', { name: 'Shell output' });
  expect(log.textContent).toContain('/workspace$ lsAGENTS.md  docs/');
  await user.type(input, 'curl https://pypi.org{Enter}');
  expect(log.textContent).toContain('blocked by sandbox policy (pypi.org is not in the network allowlist)');
  await user.type(input, '{ArrowUp}');
  expect((input as HTMLInputElement).value).toBe('curl https://pypi.org');
  await user.click(screen.getByRole('tab', { name: /Activity/ }));
  expect(screen.getByText('Blocked connection to pypi.org')).toBeTruthy();
  expect(screen.getByText('$ ls')).toBeTruthy();
});

test('one click allows a domain the agent was blocked from', async () => {
  const { user, engine } = setup();
  await user.click(screen.getByRole('button', { name: 'dep-updater' }));
  expect(screen.getByText('Blocked: registry.npmjs.org is not in the network allowlist.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Allow registry.npmjs.org' }));
  expect(engine.snapshot().agents.find(agent => agent.spec.name === 'dep-updater')?.spec.security.network.allow)
    .toEqual(['github.com', 'registry.npmjs.org']);
  expect(screen.queryByRole('button', { name: 'Allow registry.npmjs.org' })).toBeNull();
});

test('adds a model provider from the provider picker', async () => {
  const { user, engine } = setup();
  await user.click(nav('Models'));
  await user.click(screen.getByRole('button', { name: 'Add provider' }));
  const dialog = screen.getByRole('dialog', { name: 'Select provider' });
  expect(within(dialog).getAllByRole('button').map(button => button.textContent).slice(1, -1)).toEqual([
    'GitHub Copilot', 'OpenAI', 'Azure OpenAI', 'Anthropic', 'Mistral AI', 'Google Gemini',
    'DeepSeek', 'vLLM (OpenAI-compatible)', 'Local Models', 'Mock Testing Model',
  ]);
  await user.click(within(dialog).getByRole('button', { name: 'Anthropic' }));
  await user.click(within(dialog).getByRole('button', { name: 'Add provider' }));
  expect(within(dialog).getByRole('alert').textContent).toBe('Enter the api key.');
  await user.type(within(dialog).getByLabelText(/^API key/), 'sk-ant-secret');
  await user.click(within(dialog).getByRole('button', { name: 'Add provider' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const region = screen.getByRole('region', { name: 'Anthropic' });
  expect(within(region).getByText(/Key in keychain/)).toBeTruthy();
  expect(JSON.stringify(engine.snapshot())).not.toContain('sk-ant-secret');
});

test('only_requests_engine_version_on_Environments_without_fetch', async () => {
  const ipc = vi.fn(() => ({ kind: 'version', version: 'v0.4.2', hasDiagnostics: false }));
  mockIPC(ipc);
  vi.stubGlobal('isTauri', true);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const { user } = setup();
  expect(ipc).not.toHaveBeenCalled();
  await user.click(nav('Agents'));
  expect(ipc).not.toHaveBeenCalled();
  await user.click(nav('Environments'));
  expect(await screen.findByRole('heading', { name: 'Engine available' })).toBeTruthy();
  expect(screen.getByText('Version v0.4.2. Environment readiness has not been checked.')).toBeTruthy();
  expect(ipc).toHaveBeenCalledExactlyOnceWith('engine_call', { request: { action: { type: 'version' } } });
  await user.click(nav('Overview'));
  expect(screen.queryByRole('heading', { name: 'Engine available' })).toBeNull();
  expect(ipc).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
