import type { ShellResult } from './shell';
import type { Agent, AgentSpec, AuditEvent, ModelConfig } from './types';

/**
 * Features an engine can actually enforce. The UI disables controls an engine
 * does not support instead of pretending they work.
 */
export type EngineCapabilities = {
  pause: boolean;
  shell: boolean;
  limits: boolean;
  networkPolicy: boolean;
  liveUsage: boolean;
};

export type EngineSnapshot = {
  agents: Agent[];
  events: AuditEvent[];
  models: ModelConfig[];
};

export type ModelInput = Omit<ModelConfig, 'id' | 'isDefault' | 'credentialRef'> & { id?: string };

/**
 * The boundary between the UI and whatever runs agents (preview, AX, kmx).
 * Implementations translate the kmx agent spec into their own runtime objects.
 */
export interface AgentEngine {
  readonly id: string;
  readonly label: string;
  readonly preview: boolean;
  readonly capabilities: EngineCapabilities;
  snapshot(): EngineSnapshot;
  subscribe(listener: () => void): () => void;

  createAgent(spec: AgentSpec, options?: { start?: boolean; task?: string }): Agent;
  updateAgent(id: string, spec: AgentSpec): Agent;
  start(id: string, task?: string): void;
  pause(id: string): void;
  resume(id: string): void;
  stop(id: string): void;
  remove(id: string): void;
  copy(id: string): Agent;
  exec(id: string, cwd: string, command: string): ShellResult;

  saveModel(input: ModelInput, secret?: string): ModelConfig;
  removeModel(id: string): void;
  setDefaultModel(id: string): void;
}
