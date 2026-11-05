import { agentFile } from './spec';
import { domainAllowed, hostOf } from './policy';
import type { Agent, AuditOutcome } from './types';

export type ShellAudit = { outcome: AuditOutcome; summary: string; kind: 'shell' | 'network' };
export type ShellResult = { output: string; cwd: string; exitCode: number; audits: ShellAudit[] };

type Node = { kind: 'dir'; children: Record<string, Node> } | { kind: 'file'; content: string };

function dir(children: Record<string, Node> = {}): Extract<Node, { kind: 'dir' }> {
  return { kind: 'dir', children };
}
function file(content: string): Node {
  return { kind: 'file', content };
}

function repoName(url: string) {
  return url.replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() ?? 'repo';
}

/** Builds the sandbox's visible filesystem: only the workspace and explicit mounts exist. */
export function sandboxTree(agent: Agent): Node {
  const { spec } = agent;
  const workspace: Record<string, Node> = {
    'AGENTS.md': file(`${spec.instructions.trim()}\n`),
    '.bridge': dir({ [`${spec.name}.agent.md`]: file(agentFile(spec)) }),
  };
  for (const repo of spec.workspace.git) {
    workspace[repoName(repo.url)] = dir({
      'README.md': file(`# ${repoName(repo.url)}\n\nCloned from ${repo.url} (${repo.branch}).\n`),
      '.git': dir(),
    });
  }
  if (spec.workspace.skills.length) {
    workspace['.skills'] = dir(Object.fromEntries(spec.workspace.skills.map(skill =>
      [skill.name, dir({ 'SKILL.md': file(`# ${skill.name}\n\nSource: ${skill.source}\n`) })])));
  }
  const root: Record<string, Node> = {
    workspace: dir(workspace),
    home: dir({ agent: dir() }),
    tmp: dir(),
    etc: dir({ hostname: file(`${spec.name}\n`) }),
  };
  for (const mount of spec.security.filesystem.hostMounts) {
    const parts = mount.path.replace(/^~\//, '/home/agent/').split('/').filter(Boolean);
    let cursor = root;
    parts.forEach((part, index) => {
      const existing = cursor[part];
      const next = existing?.kind === 'dir' ? existing : dir();
      if (index === parts.length - 1) {
        next.children['.mounted'] = file(`Mounted ${mount.access} from the host.\n`);
      }
      cursor[part] = next;
      cursor = next.children;
    });
  }
  return dir(root);
}

export function resolvePath(cwd: string, target: string) {
  const parts = (target.startsWith('/') ? target : `${cwd}/${target}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part);
  }
  return `/${out.join('/')}`;
}

function lookup(tree: Node, path: string): Node | undefined {
  let node: Node | undefined = tree;
  for (const part of path.split('/').filter(Boolean)) {
    node = node?.kind === 'dir' ? node.children[part] : undefined;
  }
  return node;
}

function tokenize(command: string) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map(token => token.replace(/^["']|["']$/g, '')) ?? [];
}

const HELP = `Commands in this sandbox preview:
  ls [path]   cd <path>   pwd   cat <file>   whoami   hostname
  env         ps          top   df           curl <url>
  git status  git log     git push         echo <text>
  clear       exit`;

export function runShell(agent: Agent, cwd: string, command: string): ShellResult {
  const [cmd, ...args] = tokenize(command.trim());
  const tree = sandboxTree(agent);
  const ok = (output: string, nextCwd = cwd): ShellResult =>
    ({ output, cwd: nextCwd, exitCode: 0, audits: [{ kind: 'shell', outcome: 'ok', summary: `$ ${command.trim()}` }] });
  const fail = (output: string, exitCode = 1, audits?: ShellAudit[]): ShellResult =>
    ({ output, cwd, exitCode, audits: audits ?? [{ kind: 'shell', outcome: 'failed', summary: `$ ${command.trim()}` }] });
  const { spec } = agent;
  const last = agent.usage.samples.at(-1);

  switch (cmd) {
    case undefined: return { output: '', cwd, exitCode: 0, audits: [] };
    case 'help': return ok(HELP);
    case 'pwd': return ok(cwd);
    case 'whoami': return ok('agent');
    case 'hostname': return ok(spec.name);
    case 'echo': return ok(args.join(' '));
    case 'cd': {
      const target = resolvePath(cwd, args[0] ?? '/workspace');
      const node = lookup(tree, target);
      if (node?.kind !== 'dir') return fail(`cd: ${args[0]}: No such directory`);
      return ok('', target);
    }
    case 'ls': {
      const target = resolvePath(cwd, args.find(arg => !arg.startsWith('-')) ?? '.');
      const node = lookup(tree, target);
      if (!node) {
        const hint = target.startsWith('/Users') || target.startsWith('/home/') && !target.startsWith('/home/agent')
          ? ' (host files are not mounted in this sandbox)' : '';
        return fail(`ls: ${target}: No such file or directory${hint}`);
      }
      if (node.kind === 'file') return ok(target.split('/').pop() ?? '');
      const showHidden = args.some(arg => arg.startsWith('-') && arg.includes('a'));
      const names = Object.entries(node.children)
        .filter(([name]) => showHidden || !name.startsWith('.'))
        .map(([name, child]) => child.kind === 'dir' ? `${name}/` : name)
        .sort();
      return ok(names.join('  '));
    }
    case 'cat': {
      if (!args[0]) return fail('cat: missing file operand');
      const target = resolvePath(cwd, args[0]);
      const node = lookup(tree, target);
      if (!node) return fail(`cat: ${args[0]}: No such file or directory`);
      if (node.kind === 'dir') return fail(`cat: ${args[0]}: Is a directory`);
      return ok(node.content.replace(/\n$/, ''));
    }
    case 'env': {
      const secrets = spec.security.secrets.map(name => `${name}=•••••••• (injected from keychain)`);
      return ok(['HOME=/home/agent', 'PWD=' + cwd, `AGENT_NAME=${spec.name}`, `AGENT_MODEL=${spec.model.model}`,
        'OPENAI_BASE_URL=http://model-gateway.local/v1', ...secrets].join('\n'));
    }
    case 'ps': {
      return ok([
        '  PID  %CPU  RSS(MiB)  COMMAND',
        '    1   0.0       12  /sbin/bridge-init',
        `   14  ${((last?.cpu ?? 0) * 100 / Math.max(spec.limits.cpu, 0.01)).toFixed(1).padStart(4)}  ${String(Math.round((last?.memoryMiB ?? 0) * 0.8)).padStart(7)}  agent-runtime --model ${spec.model.model}`,
        ...spec.workspace.mcp.map((server, index) =>
          `   ${21 + index}   0.3       38  mcp-server ${server.name}`),
        `   ${40 + spec.workspace.mcp.length}   0.0        4  sh`,
      ].join('\n'));
    }
    case 'top': {
      const cpu = last?.cpu ?? 0;
      const mem = last?.memoryMiB ?? 0;
      return ok(`Sandbox ${spec.name}: ${agent.status}
CPU     ${cpu.toFixed(2)} / ${spec.limits.cpu} cores (${Math.round((cpu / spec.limits.cpu) * 100)}%)
Memory  ${Math.round(mem)} / ${spec.limits.memoryMiB} MiB (${Math.round((mem / spec.limits.memoryMiB) * 100)}%)
Tokens  ${agent.usage.tokens.toLocaleString('en-US')} / ${spec.limits.maxTokens.toLocaleString('en-US')}`);
    }
    case 'df': {
      return ok(`Filesystem   Size   Used   Mounted on
workspace    ${spec.limits.diskGiB}G   ${(agent.usage.diskMiB / 1024).toFixed(1)}G   /workspace (${spec.security.filesystem.workspace})
tmpfs        64M    0M     /tmp`);
    }
    case 'curl':
    case 'wget': {
      const url = args.find(arg => !arg.startsWith('-'));
      const host = url && hostOf(url);
      if (!host) return fail(`${cmd}: no URL specified`, 2);
      if (!domainAllowed(spec, host)) {
        const reason = spec.security.network.mode === 'none' ? 'network access is off' : `${host} is not in the network allowlist`;
        return fail(`${cmd}: (7) Failed to connect to ${host}: blocked by sandbox policy (${reason})`, 7, [
          { kind: 'shell', outcome: 'failed', summary: `$ ${command.trim()}` },
          { kind: 'network', outcome: 'denied', summary: `Blocked connection to ${host}`, },
        ]);
      }
      return { output: `HTTP/2 200\n(${host} responded; body hidden in preview)`, cwd, exitCode: 0, audits: [
        { kind: 'shell', outcome: 'ok', summary: `$ ${command.trim()}` },
        { kind: 'network', outcome: 'ok', summary: `Connected to ${host}` },
      ] };
    }
    case 'git': {
      const repo = spec.workspace.git.find(entry => cwd.startsWith(`/workspace/${repoName(entry.url)}`));
      if (!repo) return fail('fatal: not a git repository (or any of the parent directories): .git', 128);
      if (args[0] === 'status') return ok(`On branch ${repo.branch}\nnothing to commit, working tree clean`);
      if (args[0] === 'log') return ok(`commit 3f2c1ab (HEAD -> ${repo.branch}, origin/${repo.branch})\n    Latest upstream commit`);
      if (args[0] === 'push') {
        if (repo.access === 'read-only') {
          return fail('remote: Permission denied: this repository is mounted read-only for the agent.', 1, [
            { kind: 'shell', outcome: 'denied', summary: `$ ${command.trim()} (repository is read-only)` },
          ]);
        }
        if (spec.security.approvals.gitPush) {
          return fail('Push held for approval. Approve it from the agent’s Activity tab.', 1, [
            { kind: 'shell', outcome: 'denied', summary: `$ ${command.trim()} (waiting for approval)` },
          ]);
        }
        return ok('Everything up-to-date');
      }
      return fail(`git: '${args[0] ?? ''}' is not available in this preview`);
    }
    case 'rm':
    case 'touch':
    case 'mkdir': {
      if (spec.security.filesystem.workspace === 'read-only' && resolvePath(cwd, args.at(-1) ?? '.').startsWith('/workspace')) {
        return fail(`${cmd}: Read-only file system`, 1, [
          { kind: 'shell', outcome: 'denied', summary: `$ ${command.trim()} (workspace is read-only)` },
        ]);
      }
      return ok('');
    }
    default:
      return fail(`${cmd}: command not found. Type help for available commands.`, 127);
  }
}
