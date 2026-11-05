import { createContext, useContext, useSyncExternalStore } from 'react';
import type { AgentEngine } from './engine';

export const EngineContext = createContext<AgentEngine | null>(null);

export function useEngine(): AgentEngine {
  const engine = useContext(EngineContext);
  if (!engine) throw new Error('useEngine must be used inside EngineContext');
  return engine;
}

export function useSnapshot() {
  const engine = useEngine();
  return useSyncExternalStore(listener => engine.subscribe(listener), () => engine.snapshot());
}
