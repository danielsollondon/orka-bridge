import type { AgentSpec } from './types';

export function hostOf(target: string): string | undefined {
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(target) ? target : `https://${target}`);
    return url.hostname.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export function domainAllowed(spec: AgentSpec, host: string): boolean {
  const { mode, allow } = spec.security.network;
  if (mode === 'open') return true;
  if (mode === 'none') return false;
  return allow.some(rule => rule.startsWith('*.')
    ? host.endsWith(rule.slice(1)) && host.length > rule.length - 1
    : host === rule);
}

export function networkSummary(spec: AgentSpec): string {
  const { mode, allow } = spec.security.network;
  if (mode === 'none') return 'No network';
  if (mode === 'open') return 'Open internet';
  return allow.length === 0 ? 'Model only' : `${allow.length} allowed domain${allow.length === 1 ? '' : 's'}`;
}
