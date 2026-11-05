import { useState } from 'react';
import { provider } from '../agents/providers';
import { useEngine, useSnapshot } from '../agents/store';
import type { ModelConfig } from '../agents/types';
import EngineStatus from '../components/EngineStatus';
import { Icon, type IconName } from '../components/Icon';
import { ProviderDialog } from '../components/ProviderPicker';
import { Dialog } from '../components/ui';

export function ModelsPage() {
  const engine = useEngine();
  const { models, agents } = useSnapshot();
  const [dialog, setDialog] = useState<{ existing?: ModelConfig } | undefined>();
  const [removing, setRemoving] = useState<ModelConfig>();
  return (
    <div className="stack">
      <div className="section-head">
        <p className="muted">Providers agents can use. Keys stay in your system keychain and are added to requests by Bridge’s model gateway; agents never see them.</p>
        <button type="button" className="button primary" onClick={() => setDialog({})}><Icon name="plus" /> Add provider</button>
      </div>
      <div className="model-list">
        {models.map(model => {
          const entry = provider(model.provider);
          const users = agents.filter(agent => agent.spec.model.configId === model.id);
          return (
            <section key={model.id} className="card model-card" aria-label={model.label}>
              <span className="icon-tile big"><Icon name={entry.glyph as IconName} size={20} /></span>
              <div className="grow">
                <h2>{model.label} {model.isDefault && <span className="tag">Default</span>}</h2>
                <p className="muted">{entry.name}{model.endpoint ? ` · ${model.endpoint}` : ''}</p>
                <p>{model.models.map(name => <code key={name} className="tool">{name}</code>)}</p>
                <p className="muted">
                  {entry.fields.includes('apiKey') ? (model.credentialRef ? <><Icon name="lock" size={11} /> Key in keychain · </> : 'No key · ') : ''}
                  Used by {users.length} agent{users.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="actions">
                {!model.isDefault && <button type="button" className="button small" onClick={() => engine.setDefaultModel(model.id)}>Make default</button>}
                <button type="button" className="button small" onClick={() => setDialog({ existing: model })}><Icon name="edit" /> Edit</button>
                <button type="button" className="icon-button danger" aria-label={`Remove ${model.label}`} onClick={() => setRemoving(model)}><Icon name="trash" /></button>
              </div>
            </section>
          );
        })}
        {models.length === 0 && <p className="card muted">No providers yet. Add one so agents have a model to use.</p>}
      </div>
      {dialog && <ProviderDialog existing={dialog.existing} onClose={() => setDialog(undefined)} />}
      {removing && (
        <Dialog title={`Remove ${removing.label}?`} onClose={() => setRemoving(undefined)}>
          {agents.some(agent => agent.spec.model.configId === removing.id)
            ? <p className="dialog-lead">Agents using this provider will not start until you choose another model for them.</p>
            : <p className="dialog-lead">No agents use this provider.</p>}
          <div className="form-actions">
            <button type="button" className="button ghost" onClick={() => setRemoving(undefined)}>Cancel</button>
            <button type="button" className="button danger-solid" onClick={() => { engine.removeModel(removing.id); setRemoving(undefined); }}>Remove</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function EnvironmentsPage() {
  const engine = useEngine();
  const { agents } = useSnapshot();
  return (
    <div className="stack">
      <p className="muted">Where your agents run. Develop on this machine, then send the same agent to a team environment.</p>
      <section className="card env-card" aria-label="This machine">
        <span className="icon-tile big"><Icon name="environments" size={20} /></span>
        <div className="grow">
          <h2>This machine <span className="tag">{engine.preview ? 'Preview' : 'Connected'}</span></h2>
          <p className="muted">A lightweight Linux VM managed by Bridge. Each agent gets its own sandbox inside it, with hard CPU, memory and network limits.</p>
          <dl className="props compact">
            <dt>Agents</dt><dd>{agents.length} total · {agents.filter(agent => agent.status === 'running').length} running</dd>
            <dt>Isolation</dt><dd>Per-agent sandbox (always on)</dd>
            <dt>Engine</dt><dd>{engine.label}</dd>
          </dl>
        </div>
      </section>
      <section className="card env-card muted-card" aria-label="Team environments">
        <span className="icon-tile big"><Icon name="server" size={20} /></span>
        <div className="grow">
          <h2>Team environments</h2>
          <p className="muted">Connect a shared environment to test and deploy agents for your team. Coming later.</p>
        </div>
        <button type="button" className="button" disabled>Connect</button>
      </section>
      <EngineStatus />
    </div>
  );
}
