import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import {
  useResearchQueries,
  useResearchStats,
  type ResearchQuery,
  type QuestionShape,
  type TopicCluster,
} from '../../api/research-hooks';
import { ComposeBox } from '../../components/research/ComposeBox';
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
import { ChartContainer } from '../../components/charts/ChartContainer';
import {
  tooltipStyle, gridProps, axisProps, CHART_PALETTE,
  legendProps, labelFormatter, xAxisDateProps,
} from '../../components/charts/chartTheme';

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
  completed: 'bg-info',
  archived: 'bg-text-muted',
};

// Sessions-table aesthetic — colored dot + colored lowercase text, no chip bg.
const STATUS_TEXT: Record<string, string> = {
  active: 'text-success',
  paused: 'text-warning',
  exhausted: 'text-text-secondary',
  halted: 'text-error',
  completed: 'text-info',
  archived: 'text-text-muted',
};

// Donut color order — stable so colors don't reshuffle as the mix changes.
const STATUS_ORDER: ResearchQuery['status'][] = [
  'completed', 'exhausted', 'active', 'paused', 'halted', 'archived',
];
const STATUS_COLOR: Record<ResearchQuery['status'], string> = {
  completed: 'var(--success)',
  exhausted: 'var(--info)',
  active: 'var(--accent)',
  paused: 'var(--warning)',
  halted: 'var(--error)',
  archived: 'var(--text-disabled)',
};

export function ResearchLandingPage() {
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

  const activeNow = useMemo(
    () => visibleQueries.filter(q => q.status === 'active').length,
    [visibleQueries],
  );

  // Range pre-filter — strip, counts, and table all agree.
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

  // Donut data — every visible query (any age); status mix is a now-picture.
  const statusMix = useMemo(() => {
    const c: Partial<Record<ResearchQuery['status'], number>> = {};
    for (const q of visibleQueries) c[q.status] = (c[q.status] ?? 0) + 1;
    return STATUS_ORDER
      .map(s => ({ status: s, count: c[s] ?? 0 }))
      .filter(r => r.count > 0);
  }, [visibleQueries]);
  const statusMixTotal = statusMix.reduce((s, r) => s + r.count, 0);

  return (
    <div className="flex flex-col gap-6 -mx-6 -mt-6">
      <div className="px-6 pt-6">
        <ComposeBox />
      </div>

      <div className="px-6">
        <PageHeader
          title={
            <>
              <PageTitle>Research</PageTitle>
              <span className="text-base font-mono text-text-muted shrink-0 tabular-nums">
                {visibleQueries.length}
              </span>
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
        <>
          {/* Trend triplet — activity area | verdict bar | status mix donut */}
          <div className="px-6 grid gap-4" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
            <ChartContainer title={`Activity · ${range}`} height={140}>
              {stats && stats.byDay.length > 0 ? (
                <AreaChart data={stats.byDay}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Legend {...legendProps} />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="findings"
                    stackId="activity"
                    stroke={CHART_PALETTE[0]}
                    fill={CHART_PALETTE[0]}
                    fillOpacity={0.3}
                    name="Findings"
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="sessions"
                    stackId="activity"
                    stroke={CHART_PALETTE[1]}
                    fill={CHART_PALETTE[1]}
                    fillOpacity={0.3}
                    name="Runs"
                  />
                </AreaChart>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  No activity in the selected range.
                </div>
              )}
            </ChartContainer>

            <ChartContainer title="Verdicts" height={140}>
              {stats && stats.byVerdict.length > 0 ? (
                <BarChart data={stats.byVerdict}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="date" {...xAxisDateProps} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
                  <Bar isAnimationActive={false} dataKey="pass" stackId="v" fill="var(--success)" name="Pass" />
                  <Bar isAnimationActive={false} dataKey="flag" stackId="v" fill="var(--warning)" name="Flag" />
                  <Bar isAnimationActive={false} dataKey="halt" stackId="v" fill="var(--error)" name="Halt" />
                </BarChart>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  No verdicts yet.
                </div>
              )}
            </ChartContainer>

            <ChartContainer title="Status mix" raw>
              {statusMix.length === 0 ? (
                <div className="h-[140px] flex items-center justify-center text-text-muted text-sm">
                  No queries yet.
                </div>
              ) : (
                <div className="flex gap-3 h-[140px]">
                  <div className="flex-1 min-w-0 flex items-center">
                    <ResponsiveContainer width="100%" height={140}>
                      <PieChart>
                        <Pie
                          isAnimationActive={false}
                          data={statusMix}
                          dataKey="count"
                          nameKey="status"
                          cx="50%"
                          cy="50%"
                          innerRadius="42%"
                          outerRadius="90%"
                        >
                          {statusMix.map((entry) => (
                            <Cell key={entry.status} fill={STATUS_COLOR[entry.status]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v, n) => [String(v), String(n)]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-1 justify-center shrink-0 w-28">
                    {statusMix.map((row) => (
                      <div key={row.status} className="flex items-center gap-1.5 text-xs min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: STATUS_COLOR[row.status] }}
                        />
                        <span className="text-text-secondary capitalize truncate flex-1">
                          {row.status}
                        </span>
                        <span className="text-text-muted font-mono shrink-0 w-6 text-right tabular-nums">
                          {row.count}
                        </span>
                      </div>
                    ))}
                    {statusMixTotal > 0 && (
                      <div className="flex items-center gap-1.5 text-xs min-w-0 pt-1 mt-0.5 border-t border-border-primary">
                        <span className="text-text-muted flex-1">total</span>
                        <span className="text-text-secondary font-mono shrink-0 w-6 text-right tabular-nums">
                          {statusMixTotal}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </ChartContainer>
          </div>

          <div className="border border-border-primary rounded-lg overflow-hidden mx-6 mb-6 bg-bg-primary">
            <HistorySummaryStrip
              stats={stats}
              totalRuns={inRangeQueries.length}
              byStatus={summary.byStatus}
              avgDurationMs={summary.avgDurationMs}
              activeNow={activeNow}
              rangeLabel={range}
            />

            <div className="flex">
              <HistoryFilterRail filters={filters} onChange={setFilters} counts={counts} />

              <div className="flex-1 min-w-0">
                <Toolbar
                  resultCount={sorted.length}
                  activeNow={activeNow}
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
        </>
      )}
    </div>
  );
}

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

interface ToolbarProps {
  resultCount: number;
  activeNow: number;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  groupByShape: boolean;
  onGroupByShape: () => void;
  onExportCsv: () => void;
}

function Toolbar({ resultCount, activeNow, sortKey, onSortKey, groupByShape, onGroupByShape, onExportCsv }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-primary bg-bg-secondary">
      <span className="text-xs text-text-muted">{resultCount} result{resultCount === 1 ? '' : 's'}</span>
      {activeNow > 0 && (
        <>
          <span className="text-text-muted">·</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-success font-mono">
            <span
              className="w-1.5 h-1.5 rounded-full bg-success"
              style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
            />
            {activeNow} running · live
          </span>
        </>
      )}
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
        <Button size="sm" variant={groupByShape ? 'primary' : 'secondary'} onClick={onGroupByShape}>
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
      render: (q) => <ShapeTag shapes={q.question_shape?.shapes ?? []} />,
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
        <span className={clsx('inline-flex items-center gap-1.5 text-sm', STATUS_TEXT[q.status] ?? 'text-text-secondary')}>
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
      render: (q) => <VerdictCell verdict={deriveVerdict(q)} status={q.status} />,
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

function ShapeTag({ shapes }: { shapes: QuestionShape[] }) {
  if (shapes.length === 0) return <span className="text-text-muted text-xs">—</span>;
  // First detected shape rendered as a plain-accent column value, not a chip.
  return (
    <span className="inline-block min-w-[72px] text-xs font-mono tracking-wide text-accent lowercase whitespace-nowrap">
      {shapes[0]}
    </span>
  );
}

function VerdictCell({ verdict, status }: { verdict: 'pass' | 'flag' | 'halt' | null; status: ResearchQuery['status'] }) {
  if (status === 'active') {
    return <span className="text-sm text-info">priming</span>;
  }
  if (verdict === 'pass') return <span className="text-sm text-success">pass</span>;
  if (verdict === 'flag') return <span className="text-sm text-warning">flag</span>;
  if (verdict === 'halt') return <span className="text-sm text-error">halt</span>;
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

// Active rows pin above terminal rows; chosen key sorts within each section.
// Matches the mockup's "active runs as a pinned section above historical rows"
// behavior independently of which sort key the user picks.
function sortQueries(rows: ResearchQuery[], key: SortKey): ResearchQuery[] {
  const cmpKey = (a: ResearchQuery, b: ResearchQuery): number => {
    switch (key) {
      case 'started':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'cost':
        return (b.stats?.cost ?? 0) - (a.stats?.cost ?? 0);
      case 'findings':
        return (b.stats?.findings ?? 0) - (a.stats?.findings ?? 0);
      case 'duration':
        return (computeDurationMs(b) ?? 0) - (computeDurationMs(a) ?? 0);
      case 'verdict': {
        const rank = (v: 'pass' | 'flag' | 'halt' | null) =>
          v === 'pass' ? 0 : v === 'flag' ? 1 : v === 'halt' ? 2 : 3;
        return rank(deriveVerdict(a)) - rank(deriveVerdict(b));
      }
    }
  };
  return [...rows].sort((a, b) => {
    const aActive = a.status === 'active' ? 0 : 1;
    const bActive = b.status === 'active' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return cmpKey(a, b);
  });
}

function deriveVerdict(q: ResearchQuery): 'pass' | 'flag' | 'halt' | null {
  if (q.status === 'halted') return 'halt';
  return q.stats?.latest_post_mortem?.verdict ?? null;
}

function computeDurationMs(q: ResearchQuery): number | null {
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
