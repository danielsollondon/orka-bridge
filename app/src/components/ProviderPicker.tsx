import { useState } from 'react';
import { isOptional, PROVIDERS, provider as providerById, type ProviderField } from '../agents/providers';
import { useEngine } from '../agents/store';
import type { ModelConfig, ProviderId } from '../agents/types';
import { Icon, type IconName } from './Icon';
import { Dialog } from './ui';

const FIELD_LABEL: Record<ProviderField, string> = {
  apiKey: 'API key', endpoint: 'Endpoint URL', deployment: 'Deployment name', apiVersion: 'API version',
};

export function ProviderGrid({ onPick }: { onPick: (id: ProviderId) => void }) {
  return (
    <ul className="provider-grid" aria-label="Providers">
      {PROVIDERS.map(entry => (
        <li key={entry.id}>
          <button type="button" className="provider-card" onClick={() => onPick(entry.id)}>
            <Icon name={entry.glyph as IconName} size={26} />
            <span>{entry.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProviderForm({ providerId, existing, onSaved, onBack }: {
  providerId: ProviderId; existing?: ModelConfig; onSaved: (config: ModelConfig) => void; onBack?: () => void;
}) {
  const engine = useEngine();
  const entry = providerById(providerId);
  const [label, setLabel] = useState(existing?.label ?? entry.name);
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? entry.defaultEndpoint ?? '');
  const [deployment, setDeployment] = useState(existing?.deployment ?? '');
  const [apiVersion, setApiVersion] = useState('2024-10-21');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState((existing?.models ?? entry.suggestedModels).join(', '));
  const [error, setError] = useState('');

  function save() {
    const modelList = (providerId === 'azure-openai' ? [deployment] : models.split(','))
      .map(model => model.trim()).filter(Boolean);
    const missing = entry.fields.find(field => !isOptional(providerId, field) && !(
      field === 'apiKey' ? apiKey || existing?.credentialRef
        : field === 'endpoint' ? endpoint : field === 'deployment' ? deployment : apiVersion));
    if (!label.trim()) return setError('Enter a name for this configuration.');
    if (missing) return setError(`Enter the ${FIELD_LABEL[missing].toLowerCase()}.`);
    if (entry.fields.includes('endpoint') && !/^https?:\/\/\S+$/.test(endpoint)) return setError('Use an http:// or https:// endpoint.');
    if (modelList.length === 0) return setError('List at least one model.');
    const saved = engine.saveModel({
      id: existing?.id, provider: providerId, label: label.trim(), models: modelList,
      ...(entry.fields.includes('endpoint') ? { endpoint } : {}),
      ...(providerId === 'azure-openai' ? { deployment } : {}),
    }, apiKey || undefined);
    setApiKey('');
    onSaved(saved);
  }

  return (
    <form className="form" onSubmit={event => { event.preventDefault(); save(); }}>
      <div className="provider-heading">
        <span className="icon-tile big"><Icon name={entry.glyph as IconName} size={20} /></span>
        <div><h3>{entry.name}</h3><p className="muted">{entry.note}</p></div>
      </div>
      <label className="field">
        <span>Configuration name</span>
        <input value={label} onChange={event => setLabel(event.target.value)} />
      </label>
      {entry.fields.includes('endpoint') && (
        <label className="field"><span>{FIELD_LABEL.endpoint}</span>
          <input value={endpoint} placeholder={entry.defaultEndpoint ?? 'https://my-resource.openai.azure.com'} onChange={event => setEndpoint(event.target.value)} />
        </label>
      )}
      {entry.fields.includes('deployment') && (
        <label className="field"><span>{FIELD_LABEL.deployment}</span>
          <input value={deployment} onChange={event => setDeployment(event.target.value)} />
        </label>
      )}
      {entry.fields.includes('apiVersion') && (
        <label className="field"><span>{FIELD_LABEL.apiVersion}</span>
          <input value={apiVersion} onChange={event => setApiVersion(event.target.value)} />
        </label>
      )}
      {entry.fields.includes('apiKey') && (
        <label className="field">
          <span>{FIELD_LABEL.apiKey}{isOptional(providerId, 'apiKey') ? ' (optional)' : ''}</span>
          <input type="password" autoComplete="off" value={apiKey}
            placeholder={existing?.credentialRef ? 'Saved in keychain. Leave blank to keep.' : ''}
            onChange={event => setApiKey(event.target.value)} />
          <small className="muted"><Icon name="lock" size={11} /> Stored in your system keychain. Agents never see it; the model gateway adds it to requests.</small>
        </label>
      )}
      {providerId !== 'azure-openai' && (
        <label className="field"><span>Models agents can use</span>
          <input value={models} placeholder="model-a, model-b" onChange={event => setModels(event.target.value)} />
          <small className="muted">Comma-separated model IDs.</small>
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        {onBack && <button type="button" className="button ghost" onClick={onBack}>Back</button>}
        <button type="submit" className="button primary">{existing ? 'Save changes' : 'Add provider'}</button>
      </div>
    </form>
  );
}

export function ProviderDialog({ onClose, onSaved, existing }: {
  onClose: () => void; onSaved?: (config: ModelConfig) => void; existing?: ModelConfig;
}) {
  const [picked, setPicked] = useState<ProviderId | undefined>(existing?.provider);
  return (
    <Dialog title={existing ? 'Edit provider' : 'Select provider'} onClose={onClose} wide>
      {picked
        ? <ProviderForm providerId={picked} existing={existing}
          onBack={existing ? undefined : () => setPicked(undefined)}
          onSaved={config => { onSaved?.(config); onClose(); }} />
        : <>
          <p className="muted dialog-lead">Select a provider to add a new configuration.</p>
          <ProviderGrid onPick={setPicked} />
          <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button></div>
        </>}
    </Dialog>
  );
}
