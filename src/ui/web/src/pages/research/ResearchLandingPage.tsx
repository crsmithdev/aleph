import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts';
import {
  useResearchQueries,
  useResearchStats,
  type ResearchQuery,
} from '../../api/research-hooks';
import { ComposeBox } from '../../components/research/ComposeBox';
import { StatCard } from '../../components/data/StatCard';
import { ObsControlBar } from '../../components/data/ObsControlBar';
import { type TimeRange, type Granularity } from '../../components/data/TimeRangeSelector';
import { ChartContainer } from '../../components/charts/ChartContainer';
import {
  tooltipStyle, gridProps, axisProps, CHART_PALETTE,
  legendProps, labelFormatter, xAxisDateProps,
} from '../../components/charts/chartTheme';
import { fmtCurrency, fmtNumber, shortRelativeTime } from '../../utils/format';

const TERMINAL_STATUSES = new Set<ResearchQuery['status']>([
  'completed', 'exhausted', 'halted', 'paused',
]);

const STRIPE_BY_STATUS: Record<ResearchQuery['status'], string> = {
  active: 'bg-success',
  paused: 'bg-warning',
  exhausted: 'bg-text-disabled',
  halted: 'bg-error',
  completed: 'bg-info',
  archived: 'bg-text-disabled',
};

// Visual order for the status donut — keep stable so colors don't reshuffle
// as the underlying mix changes.
const STATUS_ORDER: ResearchQuery['status'][] = [
  'active', 'paused', 'completed', 'exhausted', 'halted', 'archived',
];

export function ResearchLandingPage() {
  const [range, setRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<Granularity>('day');

  const { data: queries = [] } = useResearchQueries();
  const { data: stats } = useResearchStats(range, granularity);

  const visible = queries.filter(q => q.status !== 'archived');
  const running = visible.filter(q => q.status === 'active');
  // Loops don't have a separate pending-job queue — the engine spawns the
  // child process at /start time. "In flight" is just whatever is running.
  const inFlight = running;

  // Recent: terminal status in the last 24h, sorted newest-first.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recent = visible
    .filter(q => TERMINAL_STATUSES.has(q.status) && new Date(q.updated_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);

  // KPI strip values from stats. When stats hasn't loaded yet, render dashes
  // so the page doesn't flash zeros (which would be misleading).
  const kpiRuns = stats ? fmtNumber(stats.totalSessions) : '—';
  const kpiFindings = stats ? fmtNumber(stats.totalFindings) : '—';
  const kpiSpend = stats ? fmtCurrency(stats.totalCost) : '—';
  const kpiActive = String(running.length);

  // Status mix for the donut — counts every visible query (any age), since the
  // status mix is a *now* picture, not a windowed one.
  const statusMix = useMemo(() => {
    const counts: Partial<Record<ResearchQuery['status'], number>> = {};
    for (const q of visible) counts[q.status] = (counts[q.status] ?? 0) + 1;
    return STATUS_ORDER
      .map(s => ({ status: s, count: counts[s] ?? 0 }))
      .filter(r => r.count > 0);
  }, [visible]);
  const statusMixTotal = statusMix.reduce((s, r) => s + r.count, 0);

  return (
    <div className="flex flex-col gap-6">
      <ComposeBox />

      <ObsControlBar
        title="Research"
        range={range}
        onRangeChange={setRange}
        granularity={granularity}
        onGranularityChange={setGranularity}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 !mt-0">
        <StatCard label={`Runs · ${range}`} value={kpiRuns} accent="default" compact />
        <StatCard
          label={`Findings · ${range}`}
          value={kpiFindings}
          accent="success"
          compact
          detail={
            stats && stats.totalSessions > 0
              ? `avg ${(stats.totalFindings / stats.totalSessions).toFixed(1)} / run`
              : undefined
          }
        />
        <StatCard
          label={`Spend · ${range}`}
          value={kpiSpend}
          accent="neutral"
          compact
          detail={
            stats && stats.totalSessions > 0
              ? `${fmtCurrency(stats.totalCost / stats.totalSessions)} / run`
              : undefined
          }
        />
        <StatCard label="Active right now" value={kpiActive} accent="default" compact />
      </div>

      {/* Two columns: In flight + Recent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel
          title="In flight"
          subtitle={inFlight.length === 0 ? 'nothing running' : `${running.length} running`}
          right={
            <Link to="/research/queries" className="text-text-muted hover:text-accent text-sm">
              view all →
            </Link>
          }
        >
          {inFlight.length === 0 ? (
            <EmptyRow>No runs in flight. Submit a prompt above to start one.</EmptyRow>
          ) : (
            inFlight.map(q => (
              <JobRow key={q.id} query={q} pulse={q.status === 'active'} />
            ))
          )}
        </Panel>

        <Panel
          title="Recent"
          subtitle="last 24h"
          right={
            <Link to="/research/queries" className="text-text-muted hover:text-accent text-sm">
              history →
            </Link>
          }
        >
          {recent.length === 0 ? (
            <EmptyRow>Nothing finished in the last 24 hours.</EmptyRow>
          ) : (
            recent.map(q => <JobRow key={q.id} query={q} />)
          )}
        </Panel>
      </div>

      {/* Activity over selected range — stacked area: findings + runs */}
      <ChartContainer title={`Activity · ${range}`}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Verdict over time — stacked bar */}
        <ChartContainer title={`Verdicts · ${range}`}>
          {stats && stats.byVerdict.length > 0 ? (
            <BarChart data={stats.byVerdict}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} />
              <Legend {...legendProps} />
              <Bar isAnimationActive={false} dataKey="pass" stackId="v" fill="var(--success)" name="Pass" />
              <Bar isAnimationActive={false} dataKey="flag" stackId="v" fill="var(--warning)" name="Flag" />
              <Bar isAnimationActive={false} dataKey="halt" stackId="v" fill="var(--error)" name="Halt" />
            </BarChart>
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              No verdicts in the selected range.
            </div>
          )}
        </ChartContainer>

        {/* Status mix — donut (now-picture, not windowed) */}
        <ChartContainer title="Status mix · all queries" raw>
          {statusMix.length === 0 ? (
            <div className="h-[180px] flex items-center justify-center text-text-muted text-sm">
              No queries yet.
            </div>
          ) : (
            <div className="flex gap-3 h-[180px]">
              <div className="flex-1 min-w-0 flex items-center">
                <ResponsiveContainer width="100%" height={180}>
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
                      {statusMix.map((entry, i) => (
                        <Cell key={entry.status} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v, n) => [String(v), String(n)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-1.5 justify-center shrink-0 w-32">
                {statusMix.map((row, i) => (
                  <div key={row.status} className="flex items-center gap-1.5 text-xs min-w-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }}
                    />
                    <span className="font-mono text-text-secondary capitalize truncate flex-1">
                      {row.status}
                    </span>
                    <span className="text-text-muted font-mono shrink-0 w-6 text-right tabular-nums">
                      {row.count}
                    </span>
                  </div>
                ))}
                {statusMixTotal > 0 && (
                  <div className="flex items-center gap-1.5 text-xs min-w-0 pt-1.5 mt-0.5 border-t border-border-primary">
                    <span className="font-mono text-text-muted flex-1">total</span>
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
    </div>
  );
}

function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary">
      <div className="flex items-baseline gap-3 px-4 pt-3 pb-3 border-b border-border-primary">
        <h3 className="font-heading text-lg font-medium text-text-secondary">{title}</h3>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-sm text-text-muted text-center italic">{children}</div>
  );
}

function JobRow({ query, pulse }: { query: ResearchQuery; pulse?: boolean }) {
  const stripe = STRIPE_BY_STATUS[query.status];
  const shape = query.question_shape?.shapes[0] ?? null;
  const topic = query.topic_cluster?.cluster ?? null;
  const findings = query.stats?.findings ?? 0;
  const cost = query.stats?.cost ?? 0;
  const verdict = query.stats?.latest_post_mortem?.verdict ?? null;
  return (
    <Link
      to={`/research/${query.id}`}
      className="grid items-center gap-2.5 px-3.5 py-2.5 border-b border-border-primary last:border-b-0 text-sm hover:bg-bg-tertiary"
      style={{ gridTemplateColumns: '3px 1fr auto auto auto' }}
    >
      <span className={clsx('w-[3px] h-7 rounded-sm shrink-0', stripe)} />
      <div className="min-w-0">
        <div className="font-medium text-text-primary truncate">
          {query.title || query.prompt_short || query.prompt}
        </div>
        <div className="text-xs text-text-muted mt-0.5 truncate">
          {[
            shape,
            topic,
            query.stats?.last_step_at ? shortRelativeTime(query.stats.last_step_at) : null,
            findings ? `${findings} findings` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      </div>
      <span className="font-mono text-xs text-text-secondary tabular-nums whitespace-nowrap">
        <span className="text-text-primary font-medium">{findings}</span>
        <span className="text-text-muted"> F</span>
      </span>
      <span className="font-mono text-xs text-text-secondary tabular-nums whitespace-nowrap">
        {fmtCurrency(cost)}
      </span>
      {pulse ? (
        <span className="inline-flex items-center gap-1.5 text-success text-[11px] font-mono">
          <span
            className="w-1.5 h-1.5 rounded-full bg-success"
            style={{ animation: 'pulse 1.6s ease-in-out infinite' }}
          />
          {query.status}
        </span>
      ) : verdict ? (
        <span
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
            verdict === 'pass' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning',
          )}
        >
          {verdict}
        </span>
      ) : (
        <span className="text-xs text-text-muted capitalize">{query.status}</span>
      )}
    </Link>
  );
}
