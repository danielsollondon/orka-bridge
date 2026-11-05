import { useMemo, useState } from 'react';
import type { AuditEvent, AuditKind } from '../agents/types';
import { Icon, type IconName } from './Icon';
import { OutcomeBadge, timeAgo } from './ui';

const KIND_ICON: Record<AuditKind, IconName> = {
  lifecycle: 'agents', model: 'models', tool: 'wrench', network: 'globe', file: 'file', shell: 'terminal', secret: 'key', message: 'chat',
};
const KIND_LABEL: Record<AuditKind, string> = {
  lifecycle: 'Lifecycle', model: 'Model', tool: 'Tool', network: 'Network', file: 'File', shell: 'Shell', secret: 'Secret', message: 'Message',
};

export type ActivityFilter = 'all' | 'problems' | 'denied' | 'failed';

export default function ActivityList({ events, showAgent, initialFilter = 'all', onOpenAgent, limit }: {
  events: AuditEvent[];
  showAgent?: boolean;
  initialFilter?: ActivityFilter;
  onOpenAgent?: (id: string) => void;
  limit?: number;
}) {
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const [kind, setKind] = useState<AuditKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string>();
  const counts = useMemo(() => ({
    all: events.length,
    problems: events.filter(event => event.outcome !== 'ok').length,
    denied: events.filter(event => event.outcome === 'denied').length,
    failed: events.filter(event => event.outcome === 'failed').length,
  }), [events]);
  const visible = events.filter(event =>
    (filter === 'all' || (filter === 'problems' ? event.outcome !== 'ok' : event.outcome === filter))
    && (kind === 'all' || event.kind === kind)
    && (!query || `${event.agentName} ${event.summary} ${event.detail ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  const shown = limit ? visible.slice(0, limit) : visible;
  const filters: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'problems', label: 'Problems' },
    { id: 'denied', label: 'Permission denied' }, { id: 'failed', label: 'Errors' },
  ];

  return (
    <div className="activity">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter activity">
          {filters.map(entry => (
            <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
              {entry.label} <span className="count">{counts[entry.id]}</span>
            </button>
          ))}
        </div>
        <select aria-label="Event type" value={kind} onChange={event => setKind(event.target.value as AuditKind | 'all')}>
          <option value="all">All types</option>
          {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input type="search" aria-label="Search activity" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {shown.length === 0 ? <p className="muted empty-line">No matching activity.</p> : (
        <ol className="events">
          {shown.map(event => (
            <li key={event.id} className={`event event-${event.outcome}`}>
              <button type="button" className="event-row" aria-expanded={expanded === event.id}
                onClick={() => setExpanded(expanded === event.id ? undefined : event.id)}>
                <span className="icon-tile" title={KIND_LABEL[event.kind]}><Icon name={KIND_ICON[event.kind]} /></span>
                <span className="event-main">
                  <span className="event-summary">{event.summary}</span>
                  {showAgent && <span className="muted event-agent">{event.agentName}</span>}
                </span>
                <OutcomeBadge outcome={event.outcome} kind={event.kind} />
                <time className="muted" dateTime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}>{timeAgo(event.at)}</time>
              </button>
              {expanded === event.id && (
                <div className="event-detail">
                  <dl>
                    <dt>Agent</dt><dd>{onOpenAgent
                      ? <button type="button" className="link" onClick={() => onOpenAgent(event.agentId)}>{event.agentName}</button>
                      : event.agentName}</dd>
                    <dt>Type</dt><dd>{KIND_LABEL[event.kind]}</dd>
                    <dt>Time</dt><dd>{new Date(event.at).toLocaleString()}</dd>
                    {event.detail && <><dt>Detail</dt><dd>{event.detail}</dd></>}
                    <dt>Event ID</dt><dd><code>{event.id}</code></dd>
                  </dl>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
