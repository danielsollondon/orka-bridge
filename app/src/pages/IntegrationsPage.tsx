import { useState } from 'react';
import { channelLabel, PLATFORM_NAME } from '../agents/spec';
import { useEngine, useSnapshot } from '../agents/store';
import type { Integration, MessagingPlatform } from '../agents/types';
import { Icon } from '../components/Icon';
import { Dialog, timeAgo } from '../components/ui';

const PLATFORMS: { platform: MessagingPlatform; summary: string; account: string; placeholder: string }[] = [
  {
    platform: 'slack',
    summary: 'Mention an agent in a channel to give it a task. Agents post progress, results and approval requests back to the thread.',
    account: 'Workspace',
    placeholder: 'Contoso',
  },
  {
    platform: 'teams',
    summary: 'Mention an agent in a team channel to give it a task. Agents reply in the conversation and send approval requests as cards.',
    account: 'Organization',
    placeholder: 'Contoso Engineering',
  },
];

export function IntegrationsPage({ onOpenAgent }: { onOpenAgent: (id: string) => void }) {
  const engine = useEngine();
  const { integrations, agents } = useSnapshot();
  const [connecting, setConnecting] = useState<MessagingPlatform>();
  const [disconnecting, setDisconnecting] = useState<Integration>();
  return (
    <div className="stack">
      <p className="muted">Let agents work where your team talks. Bridge relays messages, so agents never see Slack or Teams tokens
        and need no extra network access. Choose each agent’s channels in its Messaging settings.</p>
      {PLATFORMS.map(entry => {
        const integration = integrations.find(item => item.platform === entry.platform);
        const users = agents.filter(agent => agent.spec.channels.some(binding => binding.platform === entry.platform));
        return (
          <section key={entry.platform} className="card env-card" aria-label={PLATFORM_NAME[entry.platform]}>
            <span className="icon-tile big"><Icon name={entry.platform} size={20} /></span>
            <div className="grow">
              <h2>{PLATFORM_NAME[entry.platform]} {integration
                ? <span className="tag connected">Connected</span>
                : <span className="tag">Not connected</span>}</h2>
              <p className="muted">{entry.summary}</p>
              {integration && (
                <dl className="props compact">
                  <dt>{entry.account}</dt><dd>{integration.account}</dd>
                  <dt>Connected</dt><dd>{timeAgo(integration.connectedAt)} <span className="muted">· token in keychain</span></dd>
                </dl>
              )}
              {users.length > 0 && (
                <ul className="channel-users">
                  {users.flatMap(agent => agent.spec.channels
                    .filter(binding => binding.platform === entry.platform)
                    .map(binding => (
                      <li key={`${agent.id}-${binding.channel}`}>
                        <button type="button" className="link" onClick={() => onOpenAgent(agent.id)}>{agent.spec.name}</button>
                        <span className="muted"> in {binding.channel}</span>
                        {!integration && <span className="tag warn">Paused until connected</span>}
                      </li>
                    )))}
                </ul>
              )}
            </div>
            {integration
              ? <button type="button" className="button" onClick={() => setDisconnecting(integration)}>Disconnect</button>
              : <button type="button" className="button primary" onClick={() => setConnecting(entry.platform)}>Connect</button>}
          </section>
        );
      })}
      {connecting && <ConnectDialog platform={connecting} onClose={() => setConnecting(undefined)} />}
      {disconnecting && (
        <Dialog title={`Disconnect ${PLATFORM_NAME[disconnecting.platform]}?`} onClose={() => setDisconnecting(undefined)}>
          <p className="dialog-lead">Agents stop listening and posting in {PLATFORM_NAME[disconnecting.platform]}. Their channel settings are kept
            and work again when you reconnect.</p>
          <div className="form-actions">
            <button type="button" className="button ghost" onClick={() => setDisconnecting(undefined)}>Cancel</button>
            <button type="button" className="button danger-solid" onClick={() => {
              engine.disconnectIntegration(disconnecting.id);
              setDisconnecting(undefined);
            }}>Disconnect</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function ConnectDialog({ platform, onClose, onConnected }: {
  platform: MessagingPlatform; onClose: () => void; onConnected?: () => void;
}) {
  const engine = useEngine();
  const entry = PLATFORMS.find(item => item.platform === platform)!;
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog title={`Connect ${PLATFORM_NAME[platform]}`} onClose={onClose}>
      <form className="form" onSubmit={event => {
        event.preventDefault();
        if (!account.trim()) return setError(`Enter the ${entry.account.toLowerCase()} name.`);
        engine.connectIntegration(platform, account);
        onConnected?.();
        onClose();
      }}>
        <p className="muted">Bridge opens {PLATFORM_NAME[platform]} sign-in so an admin can approve the Bridge app. Its token is stored in
          your system keychain. In this preview, sign-in is simulated.</p>
        <label className="field">
          <span>{entry.account}</span>
          <input value={account} placeholder={entry.placeholder} autoFocus onChange={event => setAccount(event.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary"><Icon name={platform} /> Sign in to {PLATFORM_NAME[platform]}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function channelSummary(channels: { platform: MessagingPlatform; channel: string; listen: boolean; post: boolean; approvals: boolean }[]) {
  return channels.map(binding => {
    const uses = [binding.listen && 'listens', binding.post && 'posts', binding.approvals && 'approvals'].filter(Boolean).join(', ');
    return `${channelLabel(binding)} (${uses})`;
  });
}
