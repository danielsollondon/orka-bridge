import { useEffect, useRef, useState } from 'react';
import { useEngine } from '../agents/store';
import type { Agent } from '../agents/types';

type Line = { kind: 'input' | 'output' | 'error' | 'system'; text: string };

export default function Terminal({ agent, onExit }: { agent: Agent; onExit?: () => void }) {
  const engine = useEngine();
  const [cwd, setCwd] = useState('/workspace');
  const [lines, setLines] = useState<Line[]>(() => [
    { kind: 'system', text: `Connected to ${agent.spec.name}'s sandbox as agent. Commands are recorded in the audit log.` },
    { kind: 'system', text: 'Type help to list commands.' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const available = agent.status === 'running';

  useEffect(() => {
    const element = scroller.current;
    if (element && typeof element.scrollTo === 'function') element.scrollTo({ top: element.scrollHeight });
  }, [lines]);

  function submit() {
    const command = input;
    setInput('');
    setCursor(-1);
    if (command.trim()) setHistory(current => [command, ...current].slice(0, 100));
    const prompt: Line = { kind: 'input', text: `${cwd}$ ${command}` };
    if (command.trim() === 'clear') return setLines([]);
    if (command.trim() === 'exit') {
      setLines(current => [...current, prompt, { kind: 'system', text: 'Session closed.' }]);
      return onExit?.();
    }
    const result = engine.exec(agent.id, cwd, command);
    setCwd(result.cwd);
    setLines(current => [...current, prompt,
      ...(result.output ? [{ kind: result.exitCode === 0 ? 'output' : 'error', text: result.output } as Line] : [])]);
  }

  function recall(direction: 1 | -1) {
    const next = Math.min(Math.max(cursor + direction, -1), history.length - 1);
    setCursor(next);
    setInput(next === -1 ? '' : history[next]);
  }

  return (
    <div className="terminal" onClick={() => field.current?.focus()}>
      <div className="terminal-bar">
        <span className="terminal-dots" aria-hidden="true"><i /><i /><i /></span>
        <span>agent@{agent.spec.name}: {cwd}</span>
        <span className="terminal-tag">Isolated sandbox</span>
      </div>
      <div className="terminal-screen" ref={scroller} role="log" aria-label="Shell output" aria-live="polite">
        {lines.map((line, index) => <pre key={index} className={`term-${line.kind}`}>{line.text}</pre>)}
        {available ? (
          <form className="terminal-input" onSubmit={event => { event.preventDefault(); submit(); }}>
            <label htmlFor="shell-input" className="term-prompt">{cwd}$</label>
            <input id="shell-input" ref={field} value={input} autoComplete="off" spellCheck={false} autoFocus
              aria-label="Shell command" onChange={event => setInput(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'ArrowUp') { event.preventDefault(); recall(1); }
                if (event.key === 'ArrowDown') { event.preventDefault(); recall(-1); }
              }} />
          </form>
        ) : <pre className="term-system">The shell is available while the agent is running. It is {agent.status} now.</pre>}
      </div>
    </div>
  );
}
