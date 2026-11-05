import { expect, test } from 'vitest';
import { agentFile, agentFiles, defaultSpec, kmxConfig, testFile, toYaml, validateSpec } from './spec';
import type { AgentSpec } from './types';

function sample(): AgentSpec {
  const spec = defaultSpec({ configId: 'mdl_copilot', model: 'gpt-5' });
  return {
    ...spec,
    name: 'docs-fixer',
    description: 'Fixes broken links',
    instructions: 'Find broken links.\nOpen a pull request per fix.',
    soul: 'Be concise.',
    tools: ['read_file', 'web_search'],
    workspace: {
      git: [{ url: 'https://github.com/contoso/docs.git', branch: 'main', access: 'read-write' }],
      mcp: [
        { name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/', tools: ['create_pull_request'] },
        { name: 'notes', transport: 'stdio', command: '/usr/local/bin/notes-mcp', args: ['--stdio'], tools: ['search_notes'] },
      ],
      skills: [{ name: 'link-checker', source: 'github.com/contoso/skills/link-checker' }],
    },
    security: {
      ...spec.security,
      network: { mode: 'allowlist', allow: ['github.com', '*.githubusercontent.com'] },
      secrets: ['GITHUB_TOKEN'],
    },
    tests: [{ id: 'finds-link', input: 'Check docs/setup.md', check: 'toolCalled', value: 'read_file' }],
  };
}

test('agent file uses kmx native frontmatter with bridge extensions and the prompt as body', () => {
  expect(agentFile(sample(), { id: 'mdl_copilot', provider: 'github-copilot', label: 'Copilot', models: ['gpt-5'], isDefault: true })).toBe(`---
name: docs-fixer
description: Fixes broken links
model: gpt-5
kmx:
  schemaVersion: 1
  runtime: orka
  soul:
    inline: Be concise.
  skills:
    - name: link-checker
  tools:
    - name: read_file
    - name: web_search
bridge:
  schemaVersion: 1
  modelProvider: github-copilot
  workspace:
    git:
      - repo: https://github.com/contoso/docs.git
        branch: main
        access: read-write
    mcp:
      - name: github
        url: https://api.githubcopilot.com/mcp/
        tools: [create_pull_request]
    skills:
      - name: link-checker
        source: github.com/contoso/skills/link-checker
  security:
    isolation: sandbox
    network:
      default: deny
      allow: [github.com, "*.githubusercontent.com"]
    filesystem:
      workspace: read-write
      host: []
    secrets: [GITHUB_TOKEN]
    approvals:
      gitPush: true
      newDomains: true
  limits:
    cpu: 1
    memory: 1Gi
    disk: 5Gi
    maxRuntime: 2h
    maxTokens: 500000
---
Find broken links.
Open a pull request per fix.
`);
});

test('ambiguous YAML scalars are quoted', () => {
  expect(toYaml({ a: 'yes', b: '1.5', c: 'key: value', d: 'plain text', e: '', f: 'trailing #x' }))
    .toBe('a: "yes"\nb: "1.5"\nc: "key: value"\nd: plain text\ne: ""\nf: "trailing #x"\n');
  expect(toYaml({ multi: 'line one\nline two' })).toBe('multi: "line one\\nline two"\n');
});

test('tests file uses kmx agent-test fences', () => {
  expect(testFile(sample())).toBe(`---
schemaVersion: 1
---

# docs-fixer tests

\`\`\`yaml agent-test
id: finds-link
input: Check docs/setup.md
assertions:
  - id: finds-link-check
    type: toolCalled
    tool: read_file
\`\`\`
`);
});

test('kmx.yaml lists only local MCP servers', () => {
  expect(kmxConfig(sample())).toBe(`version: 1
mcpServers:
  notes:
    command: /usr/local/bin/notes-mcp
    args: ["--stdio"]
    tools:
      search_notes: search_notes
liveToolServers: [notes]
`);
  expect(kmxConfig({ ...sample(), workspace: { ...sample().workspace, mcp: [] } })).toBeUndefined();
  expect(agentFiles(sample()).map(file => file.path))
    .toEqual(['docs-fixer/docs-fixer.agent.md', 'docs-fixer/docs-fixer.agent.test.md', 'docs-fixer/kmx.yaml']);
});

test('network modes map to deny-by-default policy', () => {
  const none = { ...sample(), security: { ...sample().security, network: { mode: 'none' as const, allow: [] } } };
  expect(agentFile(none)).toContain('    network:\n      default: deny\n    filesystem:');
  const open = { ...sample(), security: { ...sample().security, network: { mode: 'open' as const, allow: [] } } };
  expect(agentFile(open)).toContain('    network:\n      default: allow\n');
});

test('messaging channels are saved under bridge.channels', () => {
  const spec = { ...sample(), channels: [
    { platform: 'slack' as const, channel: '#docs-team', listen: true, post: true, approvals: false },
    { platform: 'teams' as const, channel: 'Engineering / Code review', listen: false, post: true, approvals: true },
  ] };
  expect(agentFile(spec)).toContain(`  channels:
    - platform: slack
      channel: "#docs-team"
      listen: true
      post: true
      approvals: false
    - platform: teams
      channel: Engineering / Code review
      listen: false
      post: true
      approvals: true
  security:`);
  expect(agentFile(sample())).not.toContain('channels:');
});

test('channel validation', () => {
  const withChannels = (channels: AgentSpec['channels']) => validateSpec({ ...sample(), channels }, [], ['slack', 'teams']);
  const slack = { platform: 'slack' as const, channel: '#docs', listen: true, post: false, approvals: false };
  expect(withChannels([slack])).toEqual({});
  expect(withChannels([{ ...slack, channel: 'docs' }])['channel.0']).toMatch(/Slack channel like #team-docs/);
  expect(withChannels([{ ...slack, platform: 'teams', channel: 'General' }])['channel.0']).toMatch(/Team \/ Channel/);
  expect(withChannels([slack, { ...slack, channel: '#DOCS' }])['channel.1']).toBeDefined();
  expect(withChannels([{ ...slack, listen: false }])['channel.0']).toBe('Choose at least one way to use this channel.');
  expect(validateSpec({ ...sample(), channels: [slack] }, [], ['teams'])['channel.0']).toBe('Connect Slack under Integrations first.');
});

test('validation explains each problem', () => {
  expect(validateSpec(sample())).toEqual({});
  const bad = sample();
  bad.name = 'Docs Fixer';
  bad.instructions = ' ';
  bad.workspace.git[0].url = 'ftp://example.com/repo';
  bad.security.network.allow.push('not a domain');
  bad.security.secrets.push('lower');
  bad.limits.cpu = 64;
  bad.tests[0].value = 'missing_tool';
  expect(Object.keys(validateSpec(bad)).sort()).toEqual(
    ['git.0', 'instructions', 'limits.cpu', 'name', 'network', 'secrets', 'test.0']);
  expect(validateSpec(sample(), ['docs-fixer']).name).toBe('Another agent already uses this name.');
});
