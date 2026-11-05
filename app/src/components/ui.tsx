import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import type { AgentStatus, AuditKind, AuditOutcome, UsageSample } from '../agents/types';

const STATUS_LABEL: Record<AgentStatus, string> = {
  starting: 'Starting', running: 'Running', paused: 'Paused', stopped: 'Stopped', error: 'Error',
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  return <span className={`status status-${status}`}><span className="dot" aria-hidden="true" />{STATUS_LABEL[status]}</span>;
}

export function OutcomeBadge({ outcome, kind }: { outcome: AuditOutcome; kind?: AuditKind }) {
  const permission = kind === 'network' || kind === 'secret' || kind === 'file' || kind === 'shell';
  const label = outcome === 'ok' ? (permission ? 'Allowed' : 'OK') : outcome === 'denied' ? 'Denied' : 'Failed';
  return <span className={`outcome outcome-${outcome}`}>{label}</span>;
}

export function Sparkline({ samples, pick, max, label }: {
  samples: UsageSample[]; pick: (sample: UsageSample) => number; max: number; label: string;
}) {
  if (samples.length < 2) return <div className="sparkline empty" role="img" aria-label={`${label}: no data`} />;
  const width = 160;
  const height = 36;
  const points = samples.map((sample, index) =>
    `${(index / (samples.length - 1)) * width},${height - Math.min(pick(sample) / max, 1) * (height - 2) - 1}`).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={`0,${height} ${points} ${width},${height}`} className="spark-fill" />
      <polyline points={points} className="spark-line" />
    </svg>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = Math.min(value / max, 1);
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100}>
      <span className={ratio > 0.85 ? 'meter-fill hot' : 'meter-fill'} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    }
  }, []);
  return (
    <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} aria-label={title}
      // Dialogs can render inside clickable rows; keep their clicks from reaching the row.
      onClick={event => event.stopPropagation()}
      onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className="dialog-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
      </header>
      {children}
    </dialog>
  );
}

export function timeAgo(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
