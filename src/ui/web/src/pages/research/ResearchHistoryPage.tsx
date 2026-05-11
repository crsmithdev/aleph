import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  useResearchQueries,
  useResearchStats,
  type ResearchQuery,
  type QuestionShape,
  type TopicCluster,
} from '../../api/research-hooks';
import { PageHeader, PageTitle } from '../../components/layout/PageHeader';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/data/DataTable';
import { fmtCurrency, fmtDuration, shortRelativeTime } from '../../utils/format';
import {
  HistoryFilterRail,
  initialFilters,
  type HistoryFilters,
  type StatusValue,
  type VerdictValue,
  type CostBand,
} from '../../components/research/HistoryFilterRail';
import { HistorySummaryStrip } from '../../components/research/HistorySummaryStrip';

// Segmented-control tokens — match ObsControlBar's SEG_BTN/SEG_ACTIVE so the
// History toolbar reads as the same control family as the observability pages.
const SEG_BTN = 'px-2 py-0.5 text-sm rounded transition-colors whitespace-nowrap';
const SEG_ACTIVE = 'bg-bg-secondary text-text-primary shadow-sm';
const SEG_INACTIVE = 'text-text-muted hover:text-text-primary';

type Range = '24h' | '7d' | '30d' | '90d' | 'all';
const RANGE_OPTIONS: Range[] = ['24h', '7d', '30d', '90d', 'all'];
const RANGE_TO_DAYS: Record<Range, number | null> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};

type SortKey = 'started' | 'cost' | 'findings' | 'duration' | 'verdict';
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'started', label: 'started ↓' },
  { value: 'cost', label: 'cost' },
  { value: 'findings', label: 'findings' },
  { value: 'duration', label: 'duration' },
  { value: 'verdict', label: 'verdict' },
];

const STATUS_DOT: Record<string, string> = {
  active: 'bg-success',
  paused: 'bg-warning',
  exhausted: 'bg-text-muted',
  halted: 'bg-error',
  completed: 'bg-blue-400',
  archived: 'bg-text-muted',
};

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-success/15 text-success',
  paused: 'bg-warning/15 text-warning',
  exhausted: 'bg-bg-tertiary text-text-secondary',
  halted: 'bg-error/15 text-error',
  completed: 'bg-blue-500/15 text-blue-300',
  archived: 'bg-bg-tertiary text-text-muted',
};

export function ResearchHistoryPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>('30d');
  const [filters, setFilters] = useState<HistoryFilters>(initialFilters);
  const [sortKey, setSortKey] = useState<SortKey>('started');
  const [groupByShape, setGroupByShape] = useState(false);

  const { data: queries = [], isLoading, isError } = useResearchQueries();
  const { data: stats } = useResearchStats(range, 'day');

  const handleRowClick = (q: ResearchQuery) => navigate(`/research/${q.id}`);

  const visibleQueries = useMemo(
    () => queries.filter(q => q.status !== 'archived'),
    [queries],
  );

  // Apply range as a hard pre-filter (matches the page-level range selector
  // in the header). Everything downstream — counts, sort, group — works on
  // the range-scoped subset so the summary strip and counts agree.
  const inRangeQueries = useMemo(
    () => filterByRange(visibleQueries, range),
    [visibleQueries, range],
  );

  const filtered = useMemo(
    () => applyFilters(inRangeQueries, filters),
    [inRangeQueries, filters],
  );

  const sorted = useMemo(() => sortQueries(filtered, sortKey), [filtered, sortKey]);

  const counts = useMemo(() => computeCounts(inRangeQueries), [inRangeQueries]);

  const summary = useMemo(() => {
    const byStatus: Record<string, number> = {};
    let durationTotalMs = 0;
    let durationCount = 0;
    for (const q of inRangeQueries) {
      byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
      const ms = computeDurationMs(q);
      if (ms != null) {
        durationTotalMs += ms;
        durationCount += 1;
      }
    }
    const avgDurationMs = durationCount > 0 ? durationTotalMs / durationCount : 0;
    return { byStatus, avgDurationMs };
  }, [inRangeQueries]);

  return (
    <div className="flex flex-col gap-0 -mx-6 -mt-6">
      {/* Page header bar with title + range selector */}
      <div className="px-6 pt-6">
        <PageHeader
          title={
            <>
              <PageTitle>History</PageTitle>
              <span className="text-base font-mono text-text-muted shrink-0 tabular-nums">{visibleQueries.length}</span>
            </>
          }
          actions={<RangeSelector value={range} onChange={setRange} />}
        />
      </div>

      {isLoading ? (
        <div className="px-6"><PageLoading /></div>
      ) : isError ? (
        <div className="px-6"><ErrorState message="Failed to load research queries." /></div>
      ) : (
        <div className="border border-border-primary rounded-lg overflow-hidden mx-6 mb-6 bg-bg-primary">
          <HistorySummaryStrip
            stats={stats}
            totalRuns={inRangeQueries.length}
            byStatus={summary.byStatus}
            avgDurationMs={summary.avgDurationMs}
            avgConfidence={stats?.avgConfidence ?? 0}
          />

          <div className="flex">
            <HistoryFilterRail filters={filters} onChange={setFilters} counts={counts} />

            <div className="flex-1 min-w-0">
              <Toolbar
                resultCount={sorted.length}
                sortKey={sortKey}
                onSortKey={setSortKey}
                groupByShape={groupByShape}
                onGroupByShape={() => setGroupByShape(g => !g)}
                onExportCsv={() => exportCsv(sorted)}
              />

              {sorted.length === 0 ? (
                <div className="text-center py-16 text-text-muted">
                  {inRangeQueries.length === 0
                    ? 'No queries in this range yet.'
                    : 'No queries match the current filters.'}
                </div>
              ) : groupByShape ? (
                <GroupedTable rows={sorted} onRowClick={handleRowClick} />
              ) : (
                <HistoryTable rows={sorted} onRowClick={handleRowClick} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header range selector — mirrors the seg-control in the mockup
// ---------------------------------------------------------------------------

function RangeSelector({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-muted">range</span>
      <div className="inline-flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
        {RANGE_OPTIONS.map(r => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={clsx(SEG_BTN, value === r ? SEG_ACTIVE : SEG_INACTIVE)}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar (sort selector, group-by, compare, export)
// ---------------------------------------------------------------------------

interface ToolbarProps {
  resultCount: number;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  groupByShape: boolean;
  onGroupByShape: () => void;
  onExportCsv: () => void;
}

function Toolbar({ resultCount, sortKey, onSortKey, groupByShape, onGroupByShape, onExportCsv }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-primary bg-bg-secondary">
      <span className="text-xs text-text-muted">{resultCount} result{resultCount === 1 ? '' : 's'}</span>
      <span className="text-text-muted">·</span>
      <span className="text-xs text-text-muted">sorted by</span>
      <div className="inline-flex items-center gap-0.5 rounded border border-border-primary bg-bg-tertiary p-0.5">
        {SORT_OPTIONS.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => onSortKey(o.value)}
            className={clsx(SEG_BTN, sortKey === o.value ? SEG_ACTIVE : SEG_INACTIVE)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Button
          size="sm"
          variant={groupByShape ? 'primary' : 'secondary'}
          onClick={onGroupByShape}
        >
          Group by shape
        </Button>
        <Button size="sm" variant="secondary" disabled title="Coming soon">
          Compare 2 →
        </Button>
        <Button size="sm" variant="secondary" onClick={onExportCsv}>
          Export CSV
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function buildHistoryColumns(): Column<ResearchQuery>[] {
  return [
    {
      key: 'title',
      label: 'Query',
      width: '34%',
      render: (q) => (
        <div className="min-w-0">
          <div className="text-text-primary font-medium truncate">{q.title || q.prompt_short || q.prompt}</div>
          <div className="text-text-muted text-xs truncate">{q.prompt_short || q.prompt}</div>
        </div>
      ),
    },
    {
      key: 'shape',
      label: 'Shape',
      shrink: true,
      render: (q) => <ShapeChips shapes={q.question_shape?.shapes ?? []} />,
    },
    {
      key: 'started',
      label: 'Started',
      shrink: true,
      render: (q) => <span className="text-text-muted text-xs font-mono whitespace-nowrap">{shortRelativeTime(q.created_at)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      shrink: true,
      render: (q) => (
        <span className={clsx(
          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide',
          STATUS_BADGE[q.status] ?? 'bg-bg-tertiary text-text-secondary',
        )}>
          <span className={clsx('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[q.status] ?? 'bg-text-muted')} />
          {q.status}
        </span>
      ),
    },
    {
      key: 'findings',
      label: 'Findings',
      align: 'right',
      shrink: true,
      render: (q) => {
        const findings = q.stats?.findings ?? 0;
        return <span className={clsx('font-mono tabular-nums', findings > 0 ? 'text-success' : 'text-text-muted')}>{findings}</span>;
      },
    },
    {
      key: 'cost',
      label: 'Cost',
      align: 'right',
      shrink: true,
      render: (q) => <span className="font-mono tabular-nums text-text-secondary">{fmtCurrency(q.stats?.cost ?? 0)}</span>,
    },
    {
      key: 'duration',
      label: 'Duration',
      align: 'right',
      shrink: true,
      render: (q) => {
        const ms = computeDurationMs(q);
        return ms != null
          ? <span className="font-mono tabular-nums text-text-secondary">{fmtDuration(ms)}</span>
          : <span className="text-text-muted">—</span>;
      },
    },
    {
      key: 'verdict',
      label: 'Verdict',
      shrink: true,
      render: (q) => <VerdictChip verdict={deriveVerdict(q)} />,
    },
    {
      key: 'activity',
      label: 'Activity',
      shrink: true,
      render: (q) => {
        const sparkValues = q.stats?.findings_by_day ?? [];
        return sparkValues.some(v => v > 0)
          ? <Sparkline values={sparkValues} active={q.status === 'active'} />
          : <span className="text-text-muted text-xs">—</span>;
      },
    },
  ];
}

function HistoryTable({ rows, onRowClick }: { rows: ResearchQuery[]; onRowClick: (q: ResearchQuery) => void }) {
  return (
    <DataTable<ResearchQuery>
      data={rows}
      columns={buildHistoryColumns()}
      keyField="id"
      onRowClick={onRowClick}
      emptyMessage="No queries match the current filters."
    />
  );
}

function GroupedTable({ rows, onRowClick }: { rows: ResearchQuery[]; onRowClick: (q: ResearchQuery) => void }) {
  // A query can match multiple shapes; render under each. Queries with no
  // detected shapes go under a synthetic "Unclassified" group so they stay
  // visible.
  const groups = new Map<string, ResearchQuery[]>();
  for (const q of rows) {
    const shapes = q.question_shape?.shapes ?? [];
    if (shapes.length === 0) {
      const arr = groups.get('Unclassified') ?? [];
      arr.push(q);
      groups.set('Unclassified', arr);
      continue;
    }
    for (const s of shapes) {
      const key = s.charAt(0).toUpperCase() + s.slice(1);
      const arr = groups.get(key) ?? [];
      arr.push(q);
      groups.set(key, arr);
    }
  }

  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  const columns = buildHistoryColumns();

  return (
    <div>
      {ordered.map(([shape, items]) => (
        <div key={shape}>
          <div className="px-4 py-2 bg-bg-tertiary border-y border-border-primary text-xs font-sans uppercase tracking-widest text-text-secondary flex items-center gap-2">
            {shape}
            <span className="text-text-muted">({items.length})</span>
          </div>
          <DataTable<ResearchQuery>
            data={items}
            columns={columns}
            keyField="id"
            onRowClick={onRowClick}
            rowKeyFn={(q) => `${shape}-${q.id}`}
          />
        </div>
      ))}
    </div>
  );
}

function ShapeChips({ shapes }: { shapes: QuestionShape[] }) {
  if (shapes.length === 0) return <span className="text-text-muted text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shapes.map(s => (
        <span
          key={s}
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-accent/10 text-accent border border-accent/30 capitalize whitespace-nowrap"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function VerdictChip({ verdict }: { verdict: 'pass' | 'flag' | 'halt' | null }) {
  const base = 'inline-flex items-center px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wide';
  if (verdict === 'pass') {
    return <span className={clsx(base, 'bg-success/15 text-success')}>pass</span>;
  }
  if (verdict === 'flag') {
    return <span className={clsx(base, 'bg-warning/15 text-warning')}>flag</span>;
  }
  if (verdict === 'halt') {
    return <span className={clsx(base, 'bg-error/15 text-error')}>halt</span>;
  }
  return <span className="text-text-muted text-xs">—</span>;
}

function Sparkline({ values, active }: { values: number[]; active: boolean }) {
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 24;
  const stepX = values.length > 1 ? w / (values.length - 1) : w;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`)
    .join(' ');
  const stroke = active ? 'var(--success)' : 'var(--accent)';
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden preserveAspectRatio="none">
      <polyline fill="none" stroke={stroke} strokeWidth={1.4} points={points} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Filter / sort helpers — pure functions for testability
// ---------------------------------------------------------------------------

function filterByRange(rows: ResearchQuery[], range: Range): ResearchQuery[] {
  const days = RANGE_TO_DAYS[range];
  if (days == null) return rows;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter(q => new Date(q.created_at).getTime() >= cutoff);
}

function applyFilters(rows: ResearchQuery[], f: HistoryFilters): ResearchQuery[] {
  const term = f.search.trim().toLowerCase();
  return rows.filter(q => {
    if (term) {
      const haystack = `${q.title} ${q.prompt}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (f.status.size > 0 && !f.status.has(q.status as StatusValue)) return false;
    if (f.shape.size > 0) {
      const detected = q.question_shape?.shapes ?? [];
      if (!detected.some(s => f.shape.has(s))) return false;
    }
    if (f.verdict.size > 0) {
      const v = deriveVerdict(q);
      if (!v || !f.verdict.has(v)) return false;
    }
    if (f.topic.size > 0) {
      const c = q.topic_cluster?.cluster ?? null;
      if (!c || !f.topic.has(c)) return false;
    }
    if (f.costBand.size > 0) {
      if (!f.costBand.has(costBandFor(q.stats?.cost ?? 0))) return false;
    }
    if (f.started !== 'all') {
      const days = RANGE_TO_DAYS[f.started];
      if (days != null && new Date(q.created_at).getTime() < Date.now() - days * 24 * 60 * 60 * 1000) {
        return false;
      }
    }
    return true;
  });
}

function sortQueries(rows: ResearchQuery[], key: SortKey): ResearchQuery[] {
  const copy = [...rows];
  switch (key) {
    case 'started':
      copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      break;
    case 'cost':
      copy.sort((a, b) => (b.stats?.cost ?? 0) - (a.stats?.cost ?? 0));
      break;
    case 'findings':
      copy.sort((a, b) => (b.stats?.findings ?? 0) - (a.stats?.findings ?? 0));
      break;
    case 'duration':
      copy.sort((a, b) => (computeDurationMs(b) ?? 0) - (computeDurationMs(a) ?? 0));
      break;
    case 'verdict': {
      const rank = (v: 'pass' | 'flag' | 'halt' | null) =>
        v === 'pass' ? 0 : v === 'flag' ? 1 : v === 'halt' ? 2 : 3;
      copy.sort((a, b) => rank(deriveVerdict(a)) - rank(deriveVerdict(b)));
      break;
    }
  }
  return copy;
}

function deriveVerdict(q: ResearchQuery): 'pass' | 'flag' | 'halt' | null {
  if (q.status === 'halted') return 'halt';
  return q.stats?.latest_post_mortem?.verdict ?? null;
}

function computeDurationMs(q: ResearchQuery): number | null {
  // Duration = time from creation to last step (or now, if active). Returns
  // null when there are no steps yet so the table renders an em-dash.
  const last = q.stats?.last_step_at;
  if (!last) return null;
  const start = new Date(q.created_at).getTime();
  const end = new Date(last).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function costBandFor(cost: number): CostBand {
  if (cost < 0.25) return 'lt_25';
  if (cost < 1.0) return '25_to_100';
  if (cost < 2.0) return '100_to_200';
  return 'gt_200';
}

function computeCounts(rows: ResearchQuery[]) {
  const status: Record<StatusValue, number> = {
    active: 0, paused: 0, exhausted: 0, halted: 0, completed: 0,
  };
  const shape: Partial<Record<QuestionShape, number>> = {};
  const verdict: Record<VerdictValue, number> = { pass: 0, flag: 0, halt: 0 };
  const topic = new Map<TopicCluster, number>();
  const costBand: Record<CostBand, number> = { lt_25: 0, '25_to_100': 0, '100_to_200': 0, gt_200: 0 };

  for (const q of rows) {
    if (q.status in status) status[q.status as StatusValue]++;
    for (const s of q.question_shape?.shapes ?? []) {
      shape[s] = (shape[s] ?? 0) + 1;
    }
    const v = deriveVerdict(q);
    if (v) verdict[v]++;
    const c = q.topic_cluster?.cluster;
    if (c) topic.set(c, (topic.get(c) ?? 0) + 1);
    costBand[costBandFor(q.stats?.cost ?? 0)]++;
  }
  return { status, shape, verdict, topic, costBand };
}

function exportCsv(rows: ResearchQuery[]): void {
  const header = ['id', 'title', 'prompt', 'shape', 'topic', 'status', 'started', 'findings', 'cost_usd', 'duration_ms', 'verdict'];
  const lines: string[] = [header.join(',')];
  for (const q of rows) {
    const shapes = (q.question_shape?.shapes ?? []).join('|');
    const topic = q.topic_cluster?.cluster ?? '';
    const verdict = deriveVerdict(q) ?? '';
    const dur = computeDurationMs(q) ?? '';
    const fields = [
      q.id,
      csvEscape(q.title),
      csvEscape(q.prompt),
      shapes,
      csvEscape(topic),
      q.status,
      q.created_at,
      String(q.stats?.findings ?? 0),
      String(q.stats?.cost ?? 0),
      String(dur),
      verdict,
    ];
    lines.push(fields.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `research-history-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
