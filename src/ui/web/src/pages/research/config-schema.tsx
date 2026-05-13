import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Icon } from '../../components/ui/Icon';

export type FieldGroup = 'models';

export interface FieldSchema {
  path: string;
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

/**
 * Slimmed schema after Phase 7 cutover. Only the two SessionConfig fields
 * the loops engine still reads at run time are surfaced. Everything else
 * (budget, depth, perturbation, follow_up, topic_coherence, gap_analysis,
 * generation, …) was pre-loops executor scaffolding — the loop engine
 * ignores those keys, and `mergeWithCodeDefaults` discards them on load.
 *
 * Per-loop tuning rides on the schedule artifact (envelope, models, flags
 * from mode preset) — see `SchedulePayload` in
 * `src/research/src/loop/types.ts`.
 */
export const SCHEMA: FieldSchema[] = [
  { path: 'iteration_check_model', label: 'Iteration-check model', hint: 'Drives the milestone "is the loop on track?" hook (25/50/75 % envelope).', kind: 'text', group: 'models' },
  { path: 'post_mortem_model',     label: 'Post-mortem model',     hint: 'Drives the natural-completion post-mortem hook.', kind: 'text', group: 'models' },
];

export const GROUP_META: Record<FieldGroup, { title: string; sub: string }> = {
  models: { title: 'Models', sub: 'per-hook model selection (iteration check + post-mortem)' },
};

export const CARD_ORDER: FieldGroup[] = ['models'];

export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Build a nested patch { follow_up: { min_count: 3 } } from path 'follow_up.min_count' */
export function patchByPath(path: string, value: unknown): Record<string, unknown> {
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

export interface ConfigFormProps {
  /** Current (effective) config — what the form displays. */
  value: Record<string, unknown>;
  /** Baseline to compare against for override indicators. Null disables overrides. */
  baseline?: Record<string, unknown> | null;
  onSave: (path: string, value: unknown) => void;
  onResetField?: (path: string) => void;
  onResetAll?: () => void;
  /** Label used for the "reset all" button. */
  resetAllLabel?: string;
  title: string;
  subtitle?: string;
}

export function ConfigForm({
  value,
  baseline,
  onSave,
  onResetField,
  onResetAll,
  resetAllLabel = 'Reset to defaults',
  title,
  subtitle,
}: ConfigFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleSave(path: string, next: unknown) {
    onSave(path, next);
    setSavedPath(path);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedPath(null), 1500);
  }

  const overriddenCount = baseline
    ? SCHEMA.filter(f => {
        const v = getByPath(value, f.path);
        const b = getByPath(baseline, f.path);
        return b !== undefined && !deepEqual(v, b);
      }).length
    : 0;

  return (
    <div className="flex flex-col gap-6 max-w-[1800px]">
      <div className="border border-border-primary/40 rounded bg-bg-secondary p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-medium text-text-primary">{title}</h2>
            {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
            {baseline && (
              <p className="text-sm text-text-muted mt-1.5">
                {overriddenCount === 0
                  ? 'No fields differ from the defaults.'
                  : `${overriddenCount} field${overriddenCount === 1 ? '' : 's'} differ from the defaults.`}
              </p>
            )}
          </div>
          {onResetAll && (
            <button
              onClick={() => { if (confirm('Reset all fields?')) onResetAll(); }}
              className="text-sm text-text-muted hover:text-text-primary border border-border-primary/40 rounded px-3 py-1.5 shrink-0"
            >
              {resetAllLabel}
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-x-10">
          {CARD_ORDER.map(group => {
            const fields = SCHEMA.filter(f => f.group === group && !f.advanced);
            if (fields.length === 0) return null;
            return (
              <div key={group} className="break-inside-avoid mb-6">
                <GroupHeading meta={GROUP_META[group]} />
                <div>
                  {fields.map(field => (
                    <Row
                      key={field.path}
                      field={field}
                      value={getByPath(value, field.path)}
                      baseline={baseline ? getByPath(baseline, field.path) : undefined}
                      saved={savedPath === field.path}
                      onSave={handleSave}
                      onResetField={onResetField}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-border-primary/30">
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className="text-sm text-text-muted hover:text-accent select-none"
          >
            {showAdvanced ? '\u25be' : '\u25b8'} {showAdvanced ? 'Hide' : 'Show'} advanced (perturbation, coherence, rate limits)
          </button>

          {showAdvanced && (
            <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-x-10">
              {CARD_ORDER.map(group => {
                const advFields = SCHEMA.filter(f => f.group === group && f.advanced);
                if (advFields.length === 0) return null;
                return (
                  <div key={`adv-${group}`} className="break-inside-avoid mb-4">
                    <GroupHeading meta={{ title: GROUP_META[group].title, sub: 'advanced' }} />
                    <div>
                      {advFields.map(field => (
                        <Row
                          key={field.path}
                          field={field}
                          value={getByPath(value, field.path)}
                          baseline={baseline ? getByPath(baseline, field.path) : undefined}
                          saved={savedPath === field.path}
                          onSave={handleSave}
                          onResetField={onResetField}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {baseline && (
        <p className="text-sm text-text-muted">
          Changing mid-flight values takes effect on the next iteration. In-flight LLM calls complete with current config.
        </p>
      )}
    </div>
  );
}

function GroupHeading({ meta }: { meta: { title: string; sub: string } }) {
  return (
    <div className="flex items-baseline justify-between mb-1 pb-1 border-b border-border-primary/30">
      <h3 className="text-sm font-medium text-text-muted uppercase tracking-[0.08em]">{meta.title}</h3>
      <span className="text-sm text-text-muted">{meta.sub}</span>
    </div>
  );
}

function Row({
  field,
  value,
  baseline,
  saved,
  onSave,
  onResetField,
}: {
  field: FieldSchema;
  value: unknown;
  baseline: unknown;
  saved: boolean;
  onSave: (path: string, value: unknown) => void;
  onResetField?: (path: string) => void;
}) {
  const overridden = baseline !== undefined && !deepEqual(value, baseline);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[260px_minmax(0,1fr)] gap-x-4 gap-y-1 items-center py-3 border-b border-border-primary/30 last:border-b-0">
      <div>
        <div className="text-sm font-medium text-text-primary flex items-center gap-1.5 font-mono">
          {field.path}
          {field.isNew && (
            <span className="text-sm uppercase tracking-[0.06em] bg-success/10 text-success px-1.5 py-[1px] rounded">new</span>
          )}
        </div>
        {field.hint && <div className="text-sm text-text-muted mt-0.5">{field.hint}</div>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={clsx(
            'w-1.5 h-1.5 rounded-full inline-block shrink-0',
            overridden ? 'bg-warning' : 'bg-transparent'
          )}
          title={overridden ? `Overridden - default is ${formatValue(baseline)}` : undefined}
          aria-hidden={!overridden}
        />
        <FieldInput field={field} value={value} onSave={onSave} />
        {baseline !== undefined && (
          <span className="text-sm text-text-muted font-mono">default: {formatValue(baseline)}</span>
        )}
        {overridden && onResetField && (
          <button
            onClick={() => onResetField(field.path)}
            title={`Reset to default (${formatValue(baseline)})`}
            className="text-sm text-text-muted hover:text-text-primary border border-border-primary/40 rounded px-2 py-[2px]"
          >
            reset
          </button>
        )}
        <SavedTick visible={saved} />
      </div>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  return String(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
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

  const isDollar = field.unit === '$';
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        {isDollar && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-text-muted pointer-events-none select-none">
            $
          </span>
        )}
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
          className={clsx(
            inputCls,
            field.kind === 'number' ? 'w-24 text-right' : 'w-56',
            isDollar && 'pl-5'
          )}
        />
      </div>
      {field.unit && !isDollar && <span className="text-sm text-text-muted">{field.unit}</span>}
    </div>
  );
}
