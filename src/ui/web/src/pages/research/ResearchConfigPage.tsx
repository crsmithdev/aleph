import { useState, useCallback, useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import { PageHeader } from '../../components/layout/PageHeader';
import { Icon } from '../../components/ui/Icon';
import { useProviderConfig, useUpdateProviderConfig } from '../../api/research-hooks';
import { PageLoading } from '../../components/ui/Spinner';

const inputCls =
  'bg-bg-primary border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent w-full';

const labelCls = 'text-xs text-text-muted mb-1 block';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-text-muted uppercase tracking-wide mb-3">{children}</p>
  );
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
      <div className="flex items-center gap-2">
        <label className={clsx(labelCls, 'mb-0 shrink-0 w-24')}>{label}</label>
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
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className={clsx(labelCls, 'mb-0 shrink-0 w-24')}>{label}</label>
      {keyInfo.set ? (
        <>
          <span className="text-sm text-text-muted font-mono flex-1">{keyInfo.masked}</span>
          <Icon name="check_circle" size="xs" className="text-green-400 shrink-0" />
          <button onClick={() => setEditing(true)} className="text-xs text-text-muted hover:text-text-primary">Change</button>
        </>
      ) : (
        <>
          <span className="text-xs text-text-muted italic flex-1">Not configured</span>
          <button onClick={() => setEditing(true)} className="text-xs text-accent hover:text-accent/80 font-medium">Set key</button>
        </>
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
          : 'border-border-primary text-text-muted hover:text-text-primary hover:border-border-secondary'
      )}
    >
      {label}
    </button>
  );
}

export function ResearchConfigPage() {
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
      <PageHeader
        title="Providers"
        actions={<SaveIndicator visible={saved} />}
      />

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
            <input
              type="text"
              defaultValue={config.model}
              onBlur={(e) => {
                if (e.target.value !== config.model) autoSave({ model: e.target.value });
              }}
              placeholder={config.llm_provider === 'anthropic' ? 'claude-opus-4-5' : 'deepseek/deepseek-chat'}
              className={inputCls}
            />
          </div>

          <div className="space-y-2 pt-1">
            <KeyField label="Anthropic" keyInfo={config.keys.anthropic} configKey="anthropic_api_key" onSave={handleKeySave} />
            <KeyField label="OpenRouter" keyInfo={config.keys.openrouter} configKey="openrouter_api_key" onSave={handleKeySave} />
          </div>
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

          <div className="space-y-2 pt-1">
            <KeyField label="Tavily" keyInfo={config.keys.tavily} configKey="tavily_api_key" onSave={handleKeySave} />
            <KeyField label="Brave" keyInfo={config.keys.brave} configKey="brave_api_key" onSave={handleKeySave} />
            <div className="flex items-center gap-2">
              <label className={clsx(labelCls, 'mb-0 shrink-0 w-24')}>DuckDuckGo</label>
              <span className="text-xs text-text-muted italic flex-1">No key required</span>
              <Icon name="check_circle" size="xs" className="text-green-400 shrink-0" />
            </div>
          </div>
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

          <div className="space-y-2 pt-1">
            <KeyField label="Jina" keyInfo={config.keys.jina} configKey="jina_api_key" onSave={handleKeySave} />
            <div className="flex items-center gap-2">
              <label className={clsx(labelCls, 'mb-0 shrink-0 w-24')}>Local</label>
              <span className="text-xs text-text-muted italic flex-1">No key required — uses built-in readability parser</span>
              <Icon name="check_circle" size="xs" className="text-green-400 shrink-0" />
            </div>
          </div>
        </Card>
      </div>

      {/* Research Defaults */}
      <div>
        <SectionLabel>Research Defaults</SectionLabel>
        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Max thread depth</label>
              <input
                type="number"
                min={1}
                max={20}
                defaultValue={config.max_thread_depth}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== config.max_thread_depth) autoSave({ max_thread_depth: v });
                }}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Min searches per thread</label>
              <input
                type="number"
                min={1}
                max={10}
                defaultValue={config.min_searches}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== config.min_searches) autoSave({ min_searches: v });
                }}
                className={inputCls}
              />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={config.gap_analysis}
              onChange={(e) => autoSave({ gap_analysis: e.target.checked })}
              className="w-4 h-4 accent-accent"
            />
            <span className="text-sm text-text-primary">Enable gap analysis</span>
          </label>

          <div>
            <label className={labelCls}>Daily spend limit (USD, blank = unlimited)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              defaultValue={config.daily_limit}
              onBlur={(e) => {
                if (e.target.value !== config.daily_limit) autoSave({ daily_limit: e.target.value });
              }}
              placeholder="e.g. 5.00"
              className={clsx(inputCls, 'max-w-40')}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
