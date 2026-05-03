import { clsx } from 'clsx';
import type { QuestionShape, TopicCluster } from '../../api/research-hooks';

export type StatusValue = 'active' | 'paused' | 'exhausted' | 'halted' | 'completed';
export type VerdictValue = 'pass' | 'flag' | 'halt';
export type CostBand = 'lt_25' | '25_to_100' | '100_to_200' | 'gt_200';

const STATUS_OPTIONS: { value: StatusValue; label: string; dot: string }[] = [
  { value: 'active', label: 'Active', dot: 'bg-success' },
  { value: 'completed', label: 'Completed', dot: 'bg-blue-400' },
  { value: 'exhausted', label: 'Exhausted', dot: 'bg-text-muted' },
  { value: 'paused', label: 'Paused', dot: 'bg-warning' },
  { value: 'halted', label: 'Halted', dot: 'bg-error' },
];

const SHAPES: QuestionShape[] = ['survey', 'timeline', 'comparison', 'dynamics', 'list', 'audit', 'lookup'];

const VERDICT_OPTIONS: { value: VerdictValue; label: string; dot: string }[] = [
  { value: 'pass', label: 'Pass', dot: 'bg-success' },
  { value: 'flag', label: 'Flag', dot: 'bg-warning' },
  { value: 'halt', label: 'Halt', dot: 'bg-error' },
];

const COST_BANDS: { value: CostBand; label: string }[] = [
  { value: 'lt_25', label: 'under $0.25' },
  { value: '25_to_100', label: '$0.25 – $1.00' },
  { value: '100_to_200', label: '$1.00 – $2.00' },
  { value: 'gt_200', label: 'over $2.00' },
];

const STARTED_OPTIONS: { value: StartedFilter; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

export type StartedFilter = 'all' | '24h' | '7d' | '30d' | '90d';

const TOPIC_DOTS: Record<TopicCluster, string> = {
  'AI / LLM tooling': 'bg-accent',
  'Music history': 'bg-blue-400',
  'Databases': 'bg-success',
  'Audio & DSP': 'bg-warning',
  'Personal infra': 'bg-orange-400',
  'Misc': 'bg-text-muted',
};

export interface HistoryFilters {
  search: string;
  status: Set<StatusValue>;
  shape: Set<QuestionShape>;
  verdict: Set<VerdictValue>;
  topic: Set<TopicCluster>;
  costBand: Set<CostBand>;
  started: StartedFilter;
}

export const initialFilters: HistoryFilters = {
  search: '',
  status: new Set(),
  shape: new Set(),
  verdict: new Set(),
  topic: new Set(),
  costBand: new Set(),
  started: 'all',
};

interface Props {
  filters: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
  /** Counts per facet — for "Status: Active (12)" badges. */
  counts: {
    status: Record<StatusValue, number>;
    shape: Partial<Record<QuestionShape, number>>;
    verdict: Record<VerdictValue, number>;
    topic: Map<TopicCluster, number>;
    costBand: Record<CostBand, number>;
  };
}

export function HistoryFilterRail({ filters, onChange, counts }: Props) {
  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  return (
    <aside
      className="border-r border-border-primary bg-bg-secondary py-4 shrink-0"
      style={{ width: '240px' }}
    >
      <Group label="Search">
        <input
          type="text"
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
          placeholder="title or prompt…"
          className="w-full bg-bg-tertiary border border-border-primary text-text-secondary text-sm px-2.5 py-1.5 rounded focus:outline-none focus:border-accent"
        />
      </Group>

      <Group label="Started">
        {STARTED_OPTIONS.map(o => (
          <Option
            key={o.value}
            label={o.label}
            count={undefined}
            active={filters.started === o.value}
            onClick={() => onChange({ ...filters, started: o.value })}
          />
        ))}
      </Group>

      <Group label="Status">
        {STATUS_OPTIONS.map(o => (
          <Option
            key={o.value}
            label={o.label}
            dot={o.dot}
            count={counts.status[o.value]}
            active={filters.status.has(o.value)}
            onClick={() => onChange({ ...filters, status: toggle(filters.status, o.value) })}
          />
        ))}
      </Group>

      <Group label="Shape">
        {SHAPES.map(s => (
          <Option
            key={s}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            count={counts.shape[s] ?? 0}
            active={filters.shape.has(s)}
            onClick={() => onChange({ ...filters, shape: toggle(filters.shape, s) })}
          />
        ))}
      </Group>

      <Group label="Verdict">
        {VERDICT_OPTIONS.map(o => (
          <Option
            key={o.value}
            label={o.label}
            dot={o.dot}
            count={counts.verdict[o.value]}
            active={filters.verdict.has(o.value)}
            onClick={() => onChange({ ...filters, verdict: toggle(filters.verdict, o.value) })}
          />
        ))}
      </Group>

      <Group label="Topic cluster">
        {Array.from(counts.topic.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([cluster, count]) => (
            <Option
              key={cluster}
              label={cluster}
              dot={TOPIC_DOTS[cluster]}
              count={count}
              active={filters.topic.has(cluster)}
              onClick={() => onChange({ ...filters, topic: toggle(filters.topic, cluster) })}
            />
          ))}
        {counts.topic.size === 0 && (
          <div className="text-xs text-text-muted italic px-2">No clusters yet</div>
        )}
      </Group>

      <Group label="Cost band" last>
        {COST_BANDS.map(b => (
          <Option
            key={b.value}
            label={b.label}
            count={counts.costBand[b.value]}
            active={filters.costBand.has(b.value)}
            onClick={() => onChange({ ...filters, costBand: toggle(filters.costBand, b.value) })}
          />
        ))}
      </Group>
    </aside>
  );
}

function Group({ label, last, children }: { label: string; last?: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx('px-4 pb-4', !last && 'border-b border-border-primary mb-3')}>
      <div className="text-xs font-mono uppercase tracking-wider text-text-muted mb-2">{label}</div>
      {children}
    </div>
  );
}

function Option({
  label, count, active, onClick, dot,
}: { label: string; count: number | undefined; active: boolean; onClick: () => void; dot?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex w-full items-center justify-between px-2 py-1 rounded text-sm transition-colors',
        active
          ? 'bg-bg-tertiary text-text-primary'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        {dot && <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', dot)} />}
        <span className="truncate">{label}</span>
      </span>
      {count !== undefined && (
        <span className="font-mono text-xs text-text-muted tabular-nums shrink-0">{count}</span>
      )}
    </button>
  );
}
