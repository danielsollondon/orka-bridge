import type { AgentSpec, ChannelBinding, MessagingPlatform, ModelConfig } from './types';

/**
 * Agents are stored in kmx's single-file format: `NAME.agent.md` (YAML
 * frontmatter + prompt body), `NAME.agent.test.md` and a folder `kmx.yaml`
 * for MCP servers. Sandbox, security and workspace settings that kmx does not
 * model live under the `bridge:` key, which kmx retains as unsupported frontmatter.
 */

export const NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const DOMAIN_PATTERN = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SECRET_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;
const TOOL_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const SLACK_CHANNEL_PATTERN = /^#[a-z0-9][a-z0-9._-]{0,79}$/;
const TEAMS_CHANNEL_PATTERN = /^[^/]{1,128} \/ [^/]{1,128}$/;
const TEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const MAX_SOUL_BYTES = 8192;

export const LIMIT_BOUNDS = {
  cpu: { min: 0.25, max: 8, step: 0.25 },
  memoryMiB: { min: 256, max: 16384, step: 256 },
  diskGiB: { min: 1, max: 100, step: 1 },
  maxRuntimeMin: { min: 5, max: 1440, step: 5 },
  maxTokens: { min: 10_000, max: 10_000_000, step: 10_000 },
} as const;

export function defaultSpec(model: { configId: string; model: string }): AgentSpec {
  return {
    name: '',
    description: '',
    instructions: '',
    soul: '',
    model,
    tools: [],
    workspace: { git: [], mcp: [], skills: [] },
    channels: [],
    security: {
      network: { mode: 'allowlist', allow: [] },
      filesystem: { workspace: 'read-write', hostMounts: [] },
      secrets: [],
      approvals: { gitPush: true, newDomains: true },
    },
    limits: { cpu: 1, memoryMiB: 1024, diskGiB: 5, maxRuntimeMin: 120, maxTokens: 500_000 },
    tests: [],
  };
}

export type SpecErrors = Partial<Record<string, string>>;

export const PLATFORM_NAME: Record<MessagingPlatform, string> = { slack: 'Slack', teams: 'Microsoft Teams' };

export function channelLabel(binding: Pick<ChannelBinding, 'platform' | 'channel'>) {
  return `${binding.channel} in ${PLATFORM_NAME[binding.platform]}`;
}

/**
 * `connected` lists platforms with a connected integration; omit it to skip that check.
 */
export function validateSpec(spec: AgentSpec, takenNames: string[] = [], connected?: MessagingPlatform[]): SpecErrors {
  const errors: SpecErrors = {};
  if (!NAME_PATTERN.test(spec.name)) {
    errors.name = 'Use 1–63 lowercase letters, digits or hyphens, starting with a letter.';
  } else if (takenNames.includes(spec.name)) {
    errors.name = 'Another agent already uses this name.';
  }
  if (!spec.instructions.trim()) errors.instructions = 'Tell the agent what it should do.';
  if (new TextEncoder().encode(spec.soul).length > MAX_SOUL_BYTES) errors.soul = 'Keep the persona under 8 KB.';
  if (!spec.model.configId || !spec.model.model) errors.model = 'Choose a model.';
  if (spec.tools.some(tool => !TOOL_PATTERN.test(tool))) errors.tools = 'Tool names use letters, digits, _ or -.';
  spec.workspace.git.forEach((repo, index) => {
    if (!/^https:\/\/[^\s]+$/.test(repo.url) && !/^git@[^\s]+:[^\s]+$/.test(repo.url)) {
      errors[`git.${index}`] = 'Use an https:// or git@ repository URL.';
    }
  });
  const mcpNames = new Set<string>();
  spec.workspace.mcp.forEach((server, index) => {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(server.name) || mcpNames.has(server.name)) {
      errors[`mcp.${index}`] = 'Give each server a unique lowercase name.';
    } else if (server.transport === 'stdio' ? !server.command.trim() : !/^https:\/\//.test(server.url)) {
      errors[`mcp.${index}`] = server.transport === 'stdio' ? 'Enter the server command.' : 'Use an https:// URL.';
    }
    mcpNames.add(server.name);
  });
  spec.workspace.skills.forEach((skill, index) => {
    if (!skill.name.trim() || !skill.source.trim()) errors[`skill.${index}`] = 'Enter a name and source.';
  });
  const channels = new Set<string>();
  spec.channels.forEach((binding, index) => {
    const key = `${binding.platform}:${binding.channel.toLowerCase()}`;
    if (binding.platform === 'slack' && !SLACK_CHANNEL_PATTERN.test(binding.channel)) {
      errors[`channel.${index}`] = 'Use a Slack channel like #team-docs (lowercase, no spaces).';
    } else if (binding.platform === 'teams' && !TEAMS_CHANNEL_PATTERN.test(binding.channel)) {
      errors[`channel.${index}`] = 'Use “Team / Channel”, for example Engineering / Code review.';
    } else if (channels.has(key)) {
      errors[`channel.${index}`] = 'This channel is already added.';
    } else if (!binding.listen && !binding.post && !binding.approvals) {
      errors[`channel.${index}`] = 'Choose at least one way to use this channel.';
    } else if (connected && !connected.includes(binding.platform)) {
      errors[`channel.${index}`] = `Connect ${PLATFORM_NAME[binding.platform]} under Integrations first.`;
    }
    channels.add(key);
  });
  const badDomain = spec.security.network.allow.find(domain => !DOMAIN_PATTERN.test(domain));
  if (badDomain) errors.network = `“${badDomain}” is not a domain. Use forms like github.com or *.example.com.`;
  spec.security.filesystem.hostMounts.forEach((mount, index) => {
    if (!mount.path.startsWith('/') && !/^~\//.test(mount.path)) errors[`mount.${index}`] = 'Use an absolute path.';
  });
  const badSecret = spec.security.secrets.find(secret => !SECRET_PATTERN.test(secret));
  if (badSecret) errors.secrets = `“${badSecret}” must be UPPER_SNAKE_CASE.`;
  for (const [key, bound] of Object.entries(LIMIT_BOUNDS)) {
    const value = spec.limits[key as keyof typeof LIMIT_BOUNDS];
    if (!Number.isFinite(value) || value < bound.min || value > bound.max) {
      errors[`limits.${key}`] = `Between ${bound.min} and ${bound.max}.`;
    }
  }
  const testIds = new Set<string>();
  spec.tests.forEach((test, index) => {
    if (!TEST_ID_PATTERN.test(test.id) || testIds.has(test.id.toLowerCase())) {
      errors[`test.${index}`] = 'Give each test a unique ID.';
    } else if (!test.input.trim() || !test.value.trim()) {
      errors[`test.${index}`] = 'Enter an input and expected value.';
    } else if (test.check === 'toolCalled' && !spec.tools.includes(test.value)) {
      errors[`test.${index}`] = 'Tool checks must name a selected tool.';
    }
    testIds.add(test.id.toLowerCase());
  });
  return errors;
}

export function formatMemory(mib: number) {
  return mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`;
}

export function formatDuration(minutes: number) {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
}

type Yaml = string | number | boolean | Yaml[] | { [key: string]: Yaml };

const RESERVED = /^(true|false|yes|no|on|off|null|~|y|n)$/i;
function scalar(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  const plain = (/^[A-Za-z_./@][A-Za-z0-9 _./:@*+-]*$/.test(value)
    && !RESERVED.test(value) && !/:\s|\s$|\s#/.test(value) && !value.endsWith(':'))
    || /^\d+(Ki|Mi|Gi|Ti|h|m|s)$/.test(value);
  return plain ? value : JSON.stringify(value);
}

function emit(value: Yaml, indent: number): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return ' []';
    if (value.every(item => typeof item !== 'object')) {
      return ` [${value.map(item => scalar(item as string)).join(', ')}]`;
    }
    return value.map(item => {
      if (typeof item === 'object' && !Array.isArray(item)) {
        const body = emit(item, indent + 2).replace(/^\n/, '');
        return `\n${pad}- ${body.slice(indent + 2)}`;
      }
      return `\n${pad}-${emit(item, indent + 2)}`;
    }).join('');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return ' {}';
    return entries.map(([key, item]) => `\n${pad}${scalar(key)}:${emit(item, indent + 2)}`).join('');
  }
  return ` ${scalar(value)}`;
}

export function toYaml(value: { [key: string]: Yaml }) {
  return emit(value, 0).replace(/^\n/, '') + '\n';
}

export function agentFile(spec: AgentSpec, config?: ModelConfig): string {
  const { security, limits, workspace } = spec;
  const remoteMcp = workspace.mcp.filter(server => server.transport === 'http');
  const frontmatter: { [key: string]: Yaml } = {
    name: spec.name,
    ...(spec.description.trim() ? { description: spec.description.trim() } : {}),
    model: spec.model.model,
    kmx: {
      schemaVersion: 1,
      runtime: 'orka',
      ...(spec.soul.trim() ? { soul: { inline: spec.soul.trim() } } : {}),
      skills: workspace.skills.map(skill => ({ name: skill.name })),
      // Orka ToolReference shape; a top-level `tools` key would make kmx treat the file as a preview agent.
      tools: spec.tools.map(name => ({ name })),
    },
    bridge: {
      schemaVersion: 1,
      ...(config ? { modelProvider: config.provider } : {}),
      workspace: {
        git: workspace.git.map(repo => ({ repo: repo.url, branch: repo.branch || 'main', access: repo.access })),
        ...(remoteMcp.length ? { mcp: remoteMcp.map(server => ({ name: server.name, url: server.url, tools: server.tools })) } : {}),
        skills: workspace.skills.map(skill => ({ name: skill.name, source: skill.source })),
      },
      ...(spec.channels.length ? {
        channels: spec.channels.map(binding => ({
          platform: binding.platform, channel: binding.channel,
          listen: binding.listen, post: binding.post, approvals: binding.approvals,
        })),
      } : {}),
      security: {
        isolation: 'sandbox',
        network: security.network.mode === 'allowlist'
          ? { default: 'deny', allow: security.network.allow }
          : { default: security.network.mode === 'open' ? 'allow' : 'deny' },
        filesystem: {
          workspace: security.filesystem.workspace,
          host: security.filesystem.hostMounts.map(mount => ({ path: mount.path, access: mount.access })),
        },
        secrets: security.secrets,
        approvals: { gitPush: security.approvals.gitPush, newDomains: security.approvals.newDomains },
      },
      limits: {
        cpu: limits.cpu,
        memory: formatMemory(limits.memoryMiB),
        disk: `${limits.diskGiB}Gi`,
        maxRuntime: formatDuration(limits.maxRuntimeMin),
        maxTokens: limits.maxTokens,
      },
    },
  };
  return `---\n${toYaml(frontmatter)}---\n${spec.instructions.trim()}\n`;
}

export function testFile(spec: AgentSpec): string {
  const fences = spec.tests.map(test => {
    const assertion: { [key: string]: Yaml } = test.check === 'contains'
      ? { id: `${test.id}-check`, type: 'contains', value: test.value }
      : { id: `${test.id}-check`, type: 'toolCalled', tool: test.value };
    return '```yaml agent-test\n' + toYaml({ id: test.id, input: test.input, assertions: [assertion] }) + '```\n';
  });
  return `---\nschemaVersion: 1\n---\n\n# ${spec.name} tests\n${fences.map(fence => `\n${fence}`).join('')}`;
}

export function kmxConfig(spec: AgentSpec): string | undefined {
  const stdio = spec.workspace.mcp.filter(server => server.transport === 'stdio');
  if (stdio.length === 0) return undefined;
  const servers: { [key: string]: Yaml } = {};
  for (const server of stdio) {
    servers[server.name] = {
      command: server.command,
      args: server.args,
      tools: Object.fromEntries(server.tools.map(tool => [tool, tool])),
    };
  }
  return toYaml({ version: 1, mcpServers: servers, liveToolServers: stdio.map(server => server.name) });
}

export type AgentSourceFile = { path: string; content: string };

export function agentFiles(spec: AgentSpec, config?: ModelConfig): AgentSourceFile[] {
  const name = spec.name || 'untitled';
  const files = [
    { path: `${name}/${name}.agent.md`, content: agentFile(spec, config) },
    { path: `${name}/${name}.agent.test.md`, content: testFile(spec) },
  ];
  const kmx = kmxConfig(spec);
  if (kmx) files.push({ path: `${name}/kmx.yaml`, content: kmx });
  return files;
}
