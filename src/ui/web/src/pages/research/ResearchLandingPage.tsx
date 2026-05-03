import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  useResearchQueries,
  useResearchStats,
  type ResearchQuery,
} from '../../api/research-hooks';
import { ComposeBox } from '../../components/research/ComposeBox';
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

export function ResearchLandingPage() {
  const { data: queries = [] } = useResearchQueries();
  const { data: stats } = useResearchStats('30d', 'day');

  const visible = queries.filter(q => q.status !== 'archived');
  const running = visible.filter(q => q.status === 'active');

  // Just-finished: terminal status in the last 24h, sorted newest-first.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const justFinished = visible
    .filter(q => TERMINAL_STATUSES.has(q.status) && new Date(q.updated_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3);

  // KPI strip values from stats (30d). When stats hasn't loaded yet, render
  // dashes so the page doesn't flash zeros (which would be misleading).
  const kpiRuns = stats ? fmtNumber(stats.totalSessions) : '—';
  const kpiFindings = stats ? fmtNumber(stats.totalFindings) : '—';
  const kpiSpend = stats ? fmtCurrency(stats.totalCost) : '—';
  const kpiActive = String(running.length);

  return (
    <div className="flex flex-col gap-6">
      <ComposeBox />

      {/* KPI strip — system-level, 30 days */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <KpiCard label="Runs · 30 days" value={kpiRuns} accent="accent" />
        <KpiCard
          label="Findings · 30 days"
          value={kpiFindings}
          accent="success"
          sub={
            stats && stats.totalSessions > 0
              ? `avg ${(stats.totalFindings / stats.totalSessions).toFixed(1)} / run`
              : undefined
          }
        />
        <KpiCard
          label="Spend · 30 days"
          value={kpiSpend}
          sub={
            stats && stats.totalSessions > 0
              ? `${fmtCurrency(stats.totalCost / stats.totalSessions)} / run`
              : undefined
          }
        />
        <KpiCard label="Active right now" value={kpiActive} accent="info" />
      </div>

      {/* Two columns: Running now + Just finished */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel
          title="Running now"
          subtitle={running.length === 0 ? 'nothing running' : 'live · auto-refresh'}
          right={
            <Link to="/research/queries" className="text-text-muted hover:text-accent text-sm">
              view all →
            </Link>
          }
        >
          {running.length === 0 ? (
            <EmptyRow>No runs in flight. Submit a prompt above to start one.</EmptyRow>
          ) : (
            running.map(q => <JobRow key={q.id} query={q} pulse />)
          )}
        </Panel>

        <Panel
          title="Just finished"
          subtitle="last 24h"
          right={
            <Link to="/research/queries" className="text-text-muted hover:text-accent text-sm">
              history →
            </Link>
          }
        >
          {justFinished.length === 0 ? (
            <EmptyRow>Nothing finished in the last 24 hours.</EmptyRow>
          ) : (
            justFinished.map(q => <JobRow key={q.id} query={q} />)
          )}
        </Panel>
      </div>

      {/* 30d activity sparkline */}
      <Panel
        title="Activity · last 30 days"
        subtitle="findings (filled) · runs (line)"
      >
        {stats && stats.byDay.length > 0 ? (
          <ActivitySparkline byDay={stats.byDay} />
        ) : (
          <div className="h-20 flex items-center justify-center text-text-muted text-sm">
            No activity in the last 30 days.
          </div>
        )}
      </Panel>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: string;
  accent?: 'accent' | 'success' | 'info' | 'warning' | 'error';
  sub?: string;
}) {
  const valColor =
    accent === 'accent' ? 'text-accent'
    : accent === 'success' ? 'text-success'
    : accent === 'info' ? 'text-info'
    : accent === 'warning' ? 'text-warning'
    : accent === 'error' ? 'text-error'
    : 'text-text-primary';
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className={clsx('font-semibold text-3xl mt-2.5 tabular-nums leading-none', valColor)}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-text-muted mt-1.5 tabular-nums">{sub}</div>
      )}
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
    <div className="bg-bg-secondary border border-border-primary rounded-lg">
      <div className="flex items-baseline gap-2.5 px-4 pt-3.5 pb-3 border-b border-border-primary">
        <h4 className="font-sans font-semibold text-sm text-text-primary">{title}</h4>
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
      style={{ gridTemplateColumns: '4px 1fr auto auto auto' }}
    >
      <span className={clsx('w-1 h-7 rounded-sm shrink-0', stripe)} />
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

interface DayPoint { date: string; sessions: number; findings: number; cost: number }

/** SVG sparkline matching the mockup: filled area for findings, dotted
 *  accent line for runs. Intentionally lightweight — no recharts overhead
 *  for a 30-point series. */
function ActivitySparkline({ byDay }: { byDay: DayPoint[] }) {
  const W = 800;
  const H = 80;
  if (byDay.length < 2) {
    return (
      <div className="px-4 py-4 h-20 flex items-center justify-center text-text-muted text-sm">
        Not enough data yet.
      </div>
    );
  }

  const maxFindings = Math.max(...byDay.map(d => d.findings), 1);
  const maxRuns = Math.max(...byDay.map(d => d.sessions), 1);
  const stepX = W / (byDay.length - 1);

  const findingsPts = byDay.map((d, i) => {
    const x = i * stepX;
    const y = H - 4 - (d.findings / maxFindings) * (H - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const runsPts = byDay.map((d, i) => {
    const x = i * stepX;
    const y = H - 4 - (d.sessions / maxRuns) * (H - 18);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const fillPath = `M ${findingsPts.join(' L ')} L ${W} ${H} L 0 ${H} Z`;

  return (
    <div className="px-4 py-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-20 block"
      >
        <defs>
          <linearGradient id="findings-gradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--success)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--success)" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#findings-gradient)" />
        <polyline
          fill="none"
          stroke="var(--success)"
          strokeWidth="1.4"
          points={findingsPts.join(' ')}
        />
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.2"
          strokeDasharray="2 2"
          points={runsPts.join(' ')}
        />
      </svg>
      <div className="flex justify-between text-xs text-text-muted mt-1.5 tabular-nums">
        <span>{formatShortDate(byDay[0].date)}</span>
        <span>{formatShortDate(byDay[Math.floor(byDay.length / 2)].date)}</span>
        <span>{formatShortDate(byDay[byDay.length - 1].date)} (today)</span>
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
