export type AgentStatus = 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export type GitRepo = { url: string; branch: string; access: 'read-only' | 'read-write' };
export type McpServer =
  | { name: string; transport: 'stdio'; command: string; args: string[]; tools: string[] }
  | { name: string; transport: 'http'; url: string; tools: string[] };
export type SkillPackage = { name: string; source: string };
export type HostMount = { path: string; access: 'read-only' | 'read-write' };
export type NetworkMode = 'none' | 'allowlist' | 'open';
export type AgentTest = { id: string; input: string; check: 'contains' | 'toolCalled'; value: string };

export type AgentSpec = {
  name: string;
  description: string;
  instructions: string;
  soul: string;
  model: { configId: string; model: string };
  tools: string[];
  workspace: { git: GitRepo[]; mcp: McpServer[]; skills: SkillPackage[] };
  security: {
    network: { mode: NetworkMode; allow: string[] };
    filesystem: { workspace: 'read-only' | 'read-write'; hostMounts: HostMount[] };
    secrets: string[];
    approvals: { gitPush: boolean; newDomains: boolean };
  };
  limits: { cpu: number; memoryMiB: number; diskGiB: number; maxRuntimeMin: number; maxTokens: number };
  tests: AgentTest[];
};

export type UsageSample = { at: number; cpu: number; memoryMiB: number };

export type Agent = {
  id: string;
  spec: AgentSpec;
  status: AgentStatus;
  statusDetail?: string;
  task?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  usage: { samples: UsageSample[]; tokens: number; netBytes: number; diskMiB: number };
};

export type AuditKind = 'lifecycle' | 'model' | 'tool' | 'network' | 'file' | 'shell' | 'secret';
export type AuditOutcome = 'ok' | 'denied' | 'failed';

export type AuditEvent = {
  id: string;
  agentId: string;
  agentName: string;
  at: number;
  kind: AuditKind;
  outcome: AuditOutcome;
  summary: string;
  detail?: string;
};

export type ProviderId =
  | 'github-copilot' | 'openai' | 'azure-openai' | 'anthropic' | 'mistral'
  | 'gemini' | 'deepseek' | 'vllm' | 'local' | 'mock';

export type ModelConfig = {
  id: string;
  provider: ProviderId;
  label: string;
  models: string[];
  endpoint?: string;
  deployment?: string;
  /** Reference to a credential in the OS keychain, never the secret itself. */
  credentialRef?: string;
  isDefault: boolean;
};
