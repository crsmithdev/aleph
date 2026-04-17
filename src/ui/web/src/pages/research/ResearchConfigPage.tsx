import { useState, useCallback, useRef, useEffect, useId } from 'react';
import { clsx } from 'clsx';
import { PageHeader } from '../../components/layout/PageHeader';
import { Icon } from '../../components/ui/Icon';
import { useProviderConfig, useUpdateProviderConfig } from '../../api/research-hooks';
import { PageLoading } from '../../components/ui/Spinner';
import { ResearchDefaultsPanel } from './ResearchDefaultsPanel';

const inputCls =
  'bg-bg-primary border border-border-primary rounded px-2.5 py-2 text-sm text-text-primary focus:outline-none focus:border-accent w-full';

const labelCls = 'text-sm text-text-muted mb-1.5 block';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm font-medium text-text-secondary mb-3">{children}</p>
  );
}

/** Elide a masked key in the middle so it fits within its panel. */
function elideKey(masked: string, maxLen = 32): string {
  if (masked.length <= maxLen) return masked;
  const keep = Math.floor((maxLen - 3) / 2);
  return masked.slice(0, keep) + '...' + masked.slice(-keep);
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4 space-y-4">
      {children}
    </div>
  );
}

function SaveIndicator({ visible }: { visible: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 text-xs text-green-400 transition-opacity duration-300',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <Icon name="check_circle" size="xs" />
      Saved
    </span>
  );
}

function KeyField({
  label,
  keyInfo,
  configKey,
  onSave,
}: {
  label: string;
  keyInfo: { set: boolean; masked: string };
  configKey: string;
  onSave: (key: string, value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  function handleSave() {
    if (value.trim()) {
      onSave(configKey, value.trim());
    }
    setEditing(false);
    setValue('');
  }

  if (editing) {
    return (
      <div className="space-y-1.5">
        <label className={labelCls}>{label} API Key</label>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setEditing(false); setValue(''); } }}
            placeholder="Paste API key..."
            className={clsx(inputCls, 'flex-1')}
          />
          <button onClick={handleSave} className="text-xs text-accent hover:text-accent/80 font-medium">Save</button>
          <button onClick={() => { setEditing(false); setValue(''); }} className="text-xs text-text-muted hover:text-text-primary">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label} API Key</label>
      {keyInfo.set ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted font-mono flex-1 truncate" title={keyInfo.masked}>{elideKey(keyInfo.masked)}</span>
          <button onClick={() => setEditing(true)} className="text-xs text-text-muted hover:text-text-primary shrink-0">Change</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted italic flex-1">Not configured</span>
          <button onClick={() => setEditing(true)} className="text-xs text-accent hover:text-accent/80 font-medium shrink-0">Change</button>
        </div>
      )}
    </div>
  );
}

// Known good models to show when there's no history yet
const SUGGESTED_MODELS: Record<string, string[]> = {
  openrouter: [
    'deepseek/deepseek-r1-0528:free',
    'deepseek/deepseek-chat',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-001',
  ],
  anthropic: [
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6',
  ],
};

function ModelCombobox({
  value,
  provider,
  recentModels,
  onChange,
}: {
  value: string;
  provider: string;
  recentModels: string[];
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep draft in sync when external value changes (e.g. provider switch reset)
  useEffect(() => { setDraft(value); }, [value]);

  // Build option list: recent first, then suggestions not already in recent
  const suggestions = SUGGESTED_MODELS[provider] ?? [];
  const options = [
    ...recentModels,
    ...suggestions.filter(s => !recentModels.includes(s)),
  ].filter(m => m.toLowerCase().includes(draft.toLowerCase()) || draft === value);

  function commit(model: string) {
    setDraft(model);
    setOpen(false);
    if (model !== value) onChange(model);
    inputRef.current?.blur();
  }

  function handleBlur(e: React.FocusEvent) {
    // Close only if focus leaves the whole container
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
      const trimmed = draft.trim();
      if (trimmed !== value) onChange(trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); setDraft(value); }
    if (e.key === 'Enter') { commit(draft.trim()); }
    if (e.key === 'ArrowDown') { setOpen(true); }
  }

  const visibleOptions = draft
    ? options.filter(m => m !== draft)
    : options;

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : 'deepseek/deepseek-chat'}
          className={clsx(inputCls, 'pr-8')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
        />
        <button
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          aria-label="Show model options"
        >
          <Icon name={open ? 'expand_less' : 'expand_more'} size="sm" />
        </button>
      </div>

      {open && visibleOptions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-bg-secondary border border-border-primary rounded-md shadow-lg overflow-hidden"
        >
          {visibleOptions.map((model) => (
            <li
              key={model}
              role="option"
              aria-selected={model === value}
              onMouseDown={(e) => { e.preventDefault(); commit(model); }}
              className={clsx(
                'flex items-center justify-between px-2.5 py-2 text-sm cursor-pointer select-none',
                model === value
                  ? 'text-accent bg-accent/10'
                  : 'text-text-primary hover:bg-bg-primary'
              )}
            >
              <span className="font-mono truncate">{model}</span>
              {recentModels.includes(model) && (
                <span className="text-xs text-text-muted ml-2 shrink-0">used</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProviderButton({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-3 py-1.5 text-sm rounded border transition-colors',
        selected
          ? 'border-accent bg-accent/10 text-accent font-medium'
          : 'border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary'
      )}
    >
      {label}
    </button>
  );
}

type ConfigTab = 'providers' | 'defaults';

export function ResearchConfigPage() {
  const [tab, setTab] = useState<ConfigTab>('providers');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Research Config" />

      <div className="flex gap-1 border-b border-border-primary">
        <TabButton active={tab === 'providers'} onClick={() => setTab('providers')}>Providers</TabButton>
        <TabButton active={tab === 'defaults'} onClick={() => setTab('defaults')}>Defaults</TabButton>
      </div>

      {tab === 'providers' ? <ProvidersPanel /> : <ResearchDefaultsPanel />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-sm border-b-2 -mb-px transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary'
      )}
    >
      {children}
    </button>
  );
}

function ProvidersPanel() {
  const { data: config, isLoading } = useProviderConfig();
  const update = useUpdateProviderConfig();
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const autoSave = useCallback((patch: Record<string, unknown>) => {
    update.mutate(patch, {
      onSuccess: () => {
        setSaved(true);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setSaved(false), 2000);
      },
    });
  }, [update]);

  const handleKeySave = useCallback((configKey: string, value: string) => {
    autoSave({ [configKey]: value });
  }, [autoSave]);

  if (isLoading || !config) return <PageLoading />;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">

      {/* LLM Provider */}
      <div>
        <SectionLabel>LLM Provider</SectionLabel>
        <Card>
          <div className="flex gap-2">
            <ProviderButton
              label="Anthropic"
              selected={config.llm_provider === 'anthropic'}
              onClick={() => autoSave({ llm_provider: 'anthropic' })}
            />
            <ProviderButton
              label="OpenRouter"
              selected={config.llm_provider === 'openrouter'}
              onClick={() => autoSave({ llm_provider: 'openrouter' })}
            />
          </div>

          <div>
            <label className={labelCls}>Model <span className="text-text-muted/60">(blank = default)</span></label>
            <ModelCombobox
              key={`model-${config.llm_provider}`}
              value={config.model}
              provider={config.llm_provider}
              recentModels={config.recent_models ?? []}
              onChange={(model) => autoSave({ model })}
            />
          </div>

          {/* Only show key for selected provider */}
          {config.llm_provider === 'anthropic' && (
            <KeyField label="Anthropic" keyInfo={config.keys.anthropic} configKey="anthropic_api_key" onSave={handleKeySave} />
          )}
          {config.llm_provider === 'openrouter' && (
            <KeyField label="OpenRouter" keyInfo={config.keys.openrouter} configKey="openrouter_api_key" onSave={handleKeySave} />
          )}
        </Card>
      </div>

      {/* Search Provider */}
      <div>
        <SectionLabel>Search Provider</SectionLabel>
        <Card>
          <div className="flex gap-2">
            <ProviderButton
              label="Tavily"
              selected={config.search_provider === 'tavily'}
              onClick={() => autoSave({ search_provider: 'tavily' })}
            />
            <ProviderButton
              label="Brave"
              selected={config.search_provider === 'brave'}
              onClick={() => autoSave({ search_provider: 'brave' })}
            />
            <ProviderButton
              label="DuckDuckGo"
              selected={config.search_provider === 'duckduckgo'}
              onClick={() => autoSave({ search_provider: 'duckduckgo' })}
            />
          </div>

          {/* Only show key for selected provider */}
          {config.search_provider === 'tavily' && (
            <KeyField label="Tavily" keyInfo={config.keys.tavily} configKey="tavily_api_key" onSave={handleKeySave} />
          )}
          {config.search_provider === 'brave' && (
            <KeyField label="Brave" keyInfo={config.keys.brave} configKey="brave_api_key" onSave={handleKeySave} />
          )}
          {config.search_provider === 'duckduckgo' && (
            <p className="text-sm text-text-muted">No API key required.</p>
          )}
        </Card>
      </div>

      {/* Full Text */}
      <div>
        <SectionLabel>Full Text</SectionLabel>
        <Card>
          <div className="flex gap-2">
            <ProviderButton
              label="Jina"
              selected={config.fulltext_provider === 'jina'}
              onClick={() => autoSave({ fulltext_provider: 'jina' })}
            />
            <ProviderButton
              label="Local (Readability)"
              selected={config.fulltext_provider === 'local'}
              onClick={() => autoSave({ fulltext_provider: 'local' })}
            />
          </div>

          {config.fulltext_provider === 'jina' && (
            <KeyField label="Jina" keyInfo={config.keys.jina} configKey="jina_api_key" onSave={handleKeySave} />
          )}
          {config.fulltext_provider === 'local' && (
            <p className="text-sm text-text-muted">Uses built-in readability parser. No API key required.</p>
          )}
        </Card>
      </div>

      {/* Gap Analysis */}
      <div>
        <SectionLabel>Gap Analysis</SectionLabel>
        <Card>
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.gap_analysis}
              onChange={(e) => autoSave({ gap_analysis: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm text-text-primary">Enable gap analysis</span>
          </label>

          {config.gap_analysis && (
            <div>
              <label className={labelCls}>Max gap searches per thread</label>
              <input
                key={`gap-${config.max_gap_searches}`}
                type="number"
                min={1}
                max={10}
                defaultValue={config.max_gap_searches}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== config.max_gap_searches) autoSave({ max_gap_searches: v });
                }}
                className={clsx(inputCls, 'max-w-32')}
              />
            </div>
          )}
        </Card>
      </div>

      <div className="flex justify-end">
        <SaveIndicator visible={saved} />
      </div>
    </div>
  );
}
