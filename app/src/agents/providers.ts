import type { ProviderId } from './types';

export type ProviderField = 'apiKey' | 'endpoint' | 'deployment' | 'apiVersion';

export type Provider = {
  id: ProviderId;
  name: string;
  glyph: string;
  /** Fields the user must supply; credentials go to the OS keychain. */
  fields: ProviderField[];
  defaultEndpoint?: string;
  suggestedModels: string[];
  note: string;
};

export const PROVIDERS: Provider[] = [
  {
    id: 'github-copilot', name: 'GitHub Copilot', glyph: 'copilot', fields: [],
    suggestedModels: ['gpt-5', 'claude-sonnet-4.5', 'gpt-4.1'],
    note: 'Uses your existing GitHub Copilot sign-in through Bridge’s local model gateway. No API key needed.',
  },
  {
    id: 'openai', name: 'OpenAI', glyph: 'openai', fields: ['apiKey'],
    suggestedModels: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'],
    note: 'Calls api.openai.com with your API key.',
  },
  {
    id: 'azure-openai', name: 'Azure OpenAI', glyph: 'azure', fields: ['endpoint', 'deployment', 'apiVersion', 'apiKey'],
    suggestedModels: [],
    note: 'Calls your Azure OpenAI resource. The deployment name is used as the model.',
  },
  {
    id: 'anthropic', name: 'Anthropic', glyph: 'anthropic', fields: ['apiKey'],
    suggestedModels: ['claude-sonnet-4.5', 'claude-opus-4.1', 'claude-haiku-4.5'],
    note: 'Calls api.anthropic.com with your API key.',
  },
  {
    id: 'mistral', name: 'Mistral AI', glyph: 'mistral', fields: ['apiKey'],
    suggestedModels: ['mistral-large-latest', 'codestral-latest'],
    note: 'Calls api.mistral.ai with your API key.',
  },
  {
    id: 'gemini', name: 'Google Gemini', glyph: 'gemini', fields: ['apiKey'],
    suggestedModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    note: 'Calls the Gemini API with your API key.',
  },
  {
    id: 'deepseek', name: 'DeepSeek', glyph: 'deepseek', fields: ['apiKey'],
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner'],
    note: 'Calls api.deepseek.com with your API key.',
  },
  {
    id: 'vllm', name: 'vLLM (OpenAI-compatible)', glyph: 'server', fields: ['endpoint', 'apiKey'],
    defaultEndpoint: 'http://localhost:8000/v1', suggestedModels: [],
    note: 'Any OpenAI-compatible endpoint. The API key is optional.',
  },
  {
    id: 'local', name: 'Local Models', glyph: 'server', fields: ['endpoint'],
    defaultEndpoint: 'http://localhost:11434/v1', suggestedModels: ['llama3.2', 'qwen2.5-coder'],
    note: 'Models running on this machine, for example Ollama or LM Studio.',
  },
  {
    id: 'mock', name: 'Mock Testing Model', glyph: 'mock', fields: [],
    suggestedModels: ['fake'],
    note: 'Deterministic answers for trying the app and writing tests. Makes no network calls.',
  },
];

export function provider(id: ProviderId): Provider {
  return PROVIDERS.find(entry => entry.id === id) ?? PROVIDERS[0];
}

/** Optional fields the form shows but does not require. */
export function isOptional(providerId: ProviderId, field: ProviderField) {
  return (providerId === 'vllm' && field === 'apiKey') || field === 'apiVersion';
}
