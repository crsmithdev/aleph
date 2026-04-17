import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../../components/ui/Icon';
import { PageLoading } from '../../components/ui/Spinner';
import {
  useResearchDefaults,
  useUpdateResearchDefaults,
  useResetResearchDefaults,
  type ResearchDefaults,
} from '../../api/research-hooks';

/**
 * Schema drives rendering. Each entry maps one primitive or nested-leaf
 * field of SessionConfig to a form row with enough metadata for the
 * renderer to pick a control and validate.
 */
type FieldGroup = 'budget' | 'depth' | 'quality' | 'generation' | 'extraction' | 'models';

interface FieldSchema {
  path: string; // dotted path into ResearchDefaults (e.g. 'follow_up.min_count')
  label: string;
  hint?: string;
  unit?: string;
  kind: 'number' | 'text' | 'bool';
  min?: number;
  max?: number;
  step?: number;
  group: FieldGroup;
  advanced?: boolean;
  nullable?: boolean;
  /** For fields lifted from hardcode — shows a "new" pill in the UI. */
  isNew?: boolean;
}

const SCHEMA: FieldSchema[] = [
  // Budget
  { path: 'budget_daily_usd',        label: 'Daily budget',     hint: 'Hard cap — dispatcher halts when exceeded', unit: '$', kind: 'number', min: 0,  step: 0.5,  group: 'budget' },
  { path: 'budget_total_usd',        label: 'Total budget',     hint: 'Blank = unlimited',                          unit: '$', kind: 'number', min: 0,  step: 1,    group: 'budget', nullable: true },
  { path: 'budget_alert_threshold',  label: 'Alert threshold',  hint: 'Warn at fraction of budget (0–1)',          kind: 'number', min: 0, max: 1, step: 0.05, group: 'budget' },

  // Depth & Breadth
  { path: 'max_thread_depth',        label: 'Max thread depth',        kind: 'number', min: 1,  step: 1, group: 'depth' },
  { path: 'max_total_threads',       label: 'Max total threads',       kind: 'number', min: 1,  step: 10, group: 'depth' },
  { path: 'min_searches_per_thread', label: 'Min searches per thread', kind: 'number', min: 1,  step: 1, group: 'depth' },
  { path: 'burst_iterations',        label: 'Burst iterations',        hint: 'Iterations per burst run', kind: 'number', min: 1, step: 1, group: 'depth' },
  { path: 'max_concurrent_threads',  label: 'Max concurrent threads',  kind: 'number', min: 1,  step: 1, group: 'depth' },

  // Quality
  { path: 'novelty_threshold',            label: 'Novelty threshold',    hint: 'Discard findings below this',     kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality' },
  { path: 'dedup_similarity_threshold',   label: 'Dedup similarity',                                             kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality' },
  { path: 'diminishing_returns_threshold',label: 'Diminishing returns',  hint: 'Stop when avg novelty drops below',kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality' },
  { path: 'diminishing_returns_window',   label: 'Diminishing window',   hint: 'Findings considered in window',    kind: 'number', min: 1,  step: 5, group: 'quality' },
  { path: 'follow_up.min_count',          label: 'Follow-ups min',                                                  kind: 'number', min: 0, step: 1, group: 'quality' },
  { path: 'follow_up.max_count',          label: 'Follow-ups max',                                                  kind: 'number', min: 1, step: 1, group: 'quality' },
  { path: 'follow_up.similarity_threshold',label:'Follow-up dedup sim',                                             kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality' },

  // Generation (3 new)
  { path: 'llm_max_output_tokens',   label: 'LLM max output tokens', hint: 'Per LLM call ceiling',       kind: 'number', min: 512, step: 512,  group: 'generation', isNew: true },
  { path: 'snippet_synthesis_chars', label: 'Synthesis chars / source', hint: 'Passed to per-thread synthesis', kind: 'number', min: 200, step: 100, group: 'generation', isNew: true },
  { path: 'snippet_display_chars',   label: 'Display snippet chars', hint: 'Stored for citation UI',     kind: 'number', min: 50,  step: 50,   group: 'generation', isNew: true },

  // Extraction
  { path: 'fetch_source_text',           label: 'Fetch source text',     hint: 'Queue extraction for sources', kind: 'bool',   group: 'extraction' },
  { path: 'gap_analysis.enabled',        label: 'Gap analysis',          hint: 'Spawn searches to fill gaps',  kind: 'bool',   group: 'extraction' },
  { path: 'gap_analysis.max_gap_searches', label: 'Max gap searches',    kind: 'number', min: 0, max: 10, step: 1, group: 'extraction' },

  // Models
  { path: 'model', label: 'Primary model', kind: 'text', group: 'models' },

  // Advanced
  { path: 'p_serendipity',              label: 'Serendipity probability', hint: 'Chance a query wanders off-topic', kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality', advanced: true },
  { path: 'max_perturbation_probability', label: 'Max perturbation prob',                                          kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality', advanced: true },
  { path: 'topic_coherence.seed_similarity_min', label: 'Seed similarity min', hint: '0 disables',                 kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality', advanced: true },
  { path: 'topic_coherence.hop_similarity_min',  label: 'Hop similarity min',  hint: '0 disables',                 kind: 'number', min: 0, max: 1, step: 0.05, group: 'quality', advanced: true },
  { path: 'min_delay_between_steps_ms', label: 'Min delay between steps', unit: 'ms',  kind: 'number', min: 0, step: 1000, group: 'depth', advanced: true },
  { path: 'max_steps_per_hour',         label: 'Max steps per hour',                   kind: 'number', min: 1, step: 1,    group: 'depth', advanced: true },
];

const GROUP_META: Record<FieldGroup, { title: string; sub: string }> = {
  budget:     { title: 'Budget',         sub: 'spend ceilings' },
  depth:      { title: 'Depth & Breadth', sub: 'search exploration' },
  quality:    { title: 'Quality',        sub: 'novelty & dedup' },
  generation: { title: 'Generation',     sub: 'LLM output shape' },
  extraction: { title: 'Extraction',     sub: 'full-text fetching' },
  models:     { title: 'Models',         sub: 'primary provider' },
};

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Build a nested patch { follow_up: { min_count: 3 } } from path 'follow_up.min_count' */
function patchByPath(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  const root: Record<string, unknown> = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const next: Record<string, unknown> = {};
    cur[parts[i]] = next;
    cur = next;
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}

const CARD_ORDER: FieldGroup[] = ['budget', 'depth', 'quality', 'generation', 'extraction', 'models'];

export function ResearchDefaultsPanel() {
  const { data, isLoading } = useResearchDefaults();
  const update = useUpdateResearchDefaults();
  const reset = useResetResearchDefaults();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function onSave(path: string, value: unknown) {
    update.mutate(patchByPath(path, value) as Partial<ResearchDefaults>, {
      onSuccess: () => {
        setSavedPath(path);
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSavedPath(null), 1500);
      },
    });
  }

  if (isLoading || !data) return <PageLoading />;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Defaults</h2>
          <p className="text-sm text-text-muted mt-1">
            Shipped defaults for new research queries. In-flight sessions keep their frozen config; changes apply to new queries.
          </p>
        </div>
        <button
          onClick={() => {
            if (confirm('Reset all defaults to built-in values?')) reset.mutate();
          }}
          className="text-sm text-text-muted hover:text-text-primary border border-border-primary rounded px-3 py-1.5"
        >
          Reset to built-in
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CARD_ORDER.map(group => (
          <Card key={group} meta={GROUP_META[group]}>
            {SCHEMA.filter(f => f.group === group && !f.advanced).map(field => (
              <Row
                key={field.path}
                field={field}
                value={getByPath(data, field.path)}
                saved={savedPath === field.path}
                onSave={onSave}
              />
            ))}
          </Card>
        ))}
      </div>

      <div>
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="text-sm text-text-muted hover:text-accent select-none"
        >
          {showAdvanced ? '▾' : '▸'} {showAdvanced ? 'Hide' : 'Show'} advanced (perturbation, coherence, rate limits)
        </button>

        {showAdvanced && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {CARD_ORDER.map(group => {
              const advFields = SCHEMA.filter(f => f.group === group && f.advanced);
              if (advFields.length === 0) return null;
              return (
                <Card key={`adv-${group}`} meta={{ title: GROUP_META[group].title, sub: 'advanced' }}>
                  {advFields.map(field => (
                    <Row
                      key={field.path}
                      field={field}
                      value={getByPath(data, field.path)}
                      saved={savedPath === field.path}
                      onSave={onSave}
                    />
                  ))}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ meta, children }: { meta: { title: string; sub: string }; children: React.ReactNode }) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-text-primary">{meta.title}</h3>
        <span className="text-sm text-text-muted">{meta.sub}</span>
      </div>
      <div className="divide-y divide-border-primary">{children}</div>
    </div>
  );
}

function Row({
  field,
  value,
  saved,
  onSave,
}: {
  field: FieldSchema;
  value: unknown;
  saved: boolean;
  onSave: (path: string, value: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 items-center py-2.5">
      <div className="text-sm">
        <span className="text-text-primary">{field.label}</span>
        {field.isNew && (
          <span className="ml-2 inline-block text-xs uppercase tracking-wider bg-green-500/10 text-green-400 px-2 py-0.5 rounded">new</span>
        )}
        {field.hint && <span className="block text-sm text-text-muted mt-0.5">{field.hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <FieldInput field={field} value={value} onSave={onSave} />
        <SavedTick visible={saved} />
      </div>
    </div>
  );
}

function SavedTick({ visible }: { visible: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center text-green-400 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      aria-hidden={!visible}
    >
      <Icon name="check_circle" size="sm" />
    </span>
  );
}

function FieldInput({
  field,
  value,
  onSave,
}: {
  field: FieldSchema;
  value: unknown;
  onSave: (path: string, value: unknown) => void;
}) {
  const inputCls =
    'bg-bg-primary border border-border-primary rounded px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent';

  // Local draft state: keep input controlled while user types,
  // commit on blur / Enter to avoid spamming PUT /defaults per keystroke.
  const initial = field.kind === 'bool' ? Boolean(value) : value == null ? '' : String(value);
  const [draft, setDraft] = useState<string | boolean>(initial);

  useEffect(() => {
    setDraft(field.kind === 'bool' ? Boolean(value) : value == null ? '' : String(value));
  }, [value, field.kind]);

  if (field.kind === 'bool') {
    return (
      <button
        onClick={() => { const next = !draft; setDraft(next); onSave(field.path, next); }}
        className={clsx(
          'relative inline-block w-9 h-5 rounded-full border transition-colors',
          draft ? 'bg-accent/30 border-accent' : 'bg-bg-tertiary border-border-primary'
        )}
        aria-pressed={!!draft}
        role="switch"
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full transition-transform',
            draft ? 'translate-x-4 bg-accent' : 'translate-x-0 bg-text-muted'
          )}
        />
      </button>
    );
  }

  function commit() {
    const raw = typeof draft === 'string' ? draft.trim() : '';
    if (field.kind === 'number') {
      if (raw === '' && field.nullable) {
        if (value !== null) onSave(field.path, null);
        return;
      }
      const n = Number(raw);
      if (Number.isNaN(n)) { setDraft(value == null ? '' : String(value)); return; }
      if (field.min !== undefined && n < field.min) { setDraft(String(value)); return; }
      if (field.max !== undefined && n > field.max) { setDraft(String(value)); return; }
      if (n !== value) onSave(field.path, n);
      return;
    }
    if (raw !== value) onSave(field.path, raw);
  }

  return (
    <div className="flex items-center gap-1">
      {field.unit === '$' && <span className="text-sm text-text-muted">$</span>}
      <input
        type={field.kind === 'number' ? 'number' : 'text'}
        value={String(draft)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(value == null ? '' : String(value)); (e.target as HTMLInputElement).blur(); }
        }}
        min={field.min}
        max={field.max}
        step={field.step}
        placeholder={field.nullable ? 'null' : undefined}
        className={clsx(inputCls, field.kind === 'number' ? 'w-24 text-right' : 'w-56')}
      />
      {field.unit && field.unit !== '$' && <span className="text-sm text-text-muted">{field.unit}</span>}
    </div>
  );
}
