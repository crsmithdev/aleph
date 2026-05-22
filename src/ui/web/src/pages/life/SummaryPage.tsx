import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useSummary, useHabits, useGitStats, useTimeseries } from '../../api/hooks';
import { MetricCard } from '../../components/data/MetricCard';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, xAxisDateProps, legendProps, labelFormatter } from '../../components/charts/chartTheme';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/layout/PageHeader';
import { QuickCreate } from '../../components/life/QuickCreate';
import { useState } from 'react';
import { clsx } from 'clsx';
import { toDateStr, longDate } from '../../utils/format';

type PeriodSummaryData = {
  goalsCreated?: { count: number; items: Array<{ title: string }> };
  goalsCompleted?: { count: number; items: Array<{ goalId: string; details: { title?: string; prevState?: string } }> };
  todosCreated?: { count: number; items: Array<{ title: string }> };
  todosCompleted?: { count: number; items: Array<{ title: string }> };
  habitsCreated?: { count: number; items: Array<{ title: string }> };
};

type ListItem = { text: string; kind: 'created' | 'completed' };

function BulletList({ items }: { items: ListItem[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-sm text-text-secondary">
          <span className={clsx('mt-0.5 text-sm font-bold leading-none', item.kind === 'created' ? 'text-accent' : 'text-success')}>
            {item.kind === 'created' ? '+' : '✓'}
          </span>
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One of the three per-day columns. Always renders so the columns stay aligned. */
function Column({ label, items }: { label: string; items: ListItem[] }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">{label}</span>
        {items.length > 0 && <span className="text-xs text-text-muted">{items.length}</span>}
      </div>
      {items.length > 0 ? <BulletList items={items} /> : <p className="text-sm text-text-disabled">—</p>}
    </div>
  );
}

type Emphasis = 'hero' | 'normal' | 'muted';

/** A single day on the timeline: header + Goals / Todos / Habits in three columns. */
function PeriodNode({
  periodLabel,
  dateDisplay,
  emphasis,
  data,
  isLoading,
  completedHabits,
}: {
  periodLabel: string;
  dateDisplay: string;
  emphasis: Emphasis;
  data: PeriodSummaryData | undefined;
  isLoading: boolean;
  completedHabits: string[];
}) {
  const [copied, setCopied] = useState(false);

  const goalItems: ListItem[] = [
    ...(data?.goalsCreated?.items ?? []).map((g): ListItem => ({ text: g.title, kind: 'created' })),
    ...(data?.goalsCompleted?.items ?? []).map((g): ListItem => ({ text: g.details?.title ?? g.goalId, kind: 'completed' })),
  ];
  const todoItems: ListItem[] = [
    ...(data?.todosCreated?.items ?? []).map((t): ListItem => ({ text: t.title, kind: 'created' })),
    ...(data?.todosCompleted?.items ?? []).map((t): ListItem => ({ text: t.title, kind: 'completed' })),
  ];
  const habitItems: ListItem[] = [
    ...(data?.habitsCreated?.items ?? []).map((h): ListItem => ({ text: h.title, kind: 'created' })),
    ...completedHabits.map((h): ListItem => ({ text: h, kind: 'completed' })),
  ];

  const isEmpty = !isLoading && goalItems.length === 0 && todoItems.length === 0 && habitItems.length === 0;

  const buildCopyText = () => {
    const lines: string[] = [`${periodLabel} — ${dateDisplay}`, ''];
    const section = (label: string, items: ListItem[]) => {
      if (items.length === 0) return;
      lines.push(`${label}:`, ...items.map((i) => `  ${i.kind === 'created' ? '+' : '✓'} ${i.text}`), '');
    };
    section('Goals', goalItems);
    section('Todos', todoItems);
    section('Habits', habitItems);
    return lines.join('\n').trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildCopyText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const cardClass = clsx(
    'rounded-lg px-4 pt-3 pb-4',
    emphasis === 'hero' && 'bg-bg-secondary border-2 border-accent/40',
    emphasis === 'normal' && 'bg-bg-secondary border border-border-primary',
    emphasis === 'muted' && 'bg-bg-secondary/60 border border-border-primary',
  );

  const titleClass = clsx('font-semibold', emphasis === 'muted' ? 'text-sm text-text-secondary' : emphasis === 'hero' ? 'text-base text-text-primary' : 'text-sm text-text-primary');

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-2">
        <p className={titleClass}>
          <span>{periodLabel}</span>
          <span className="text-text-muted font-normal"> — {dateDisplay}</span>
        </p>
        <button
          onClick={handleCopy}
          disabled={isLoading || isEmpty}
          className={clsx(
            'flex-shrink-0 px-3 py-1 text-sm rounded-md border transition-colors',
            copied
              ? 'bg-success/10 border-success text-success'
              : 'bg-bg-tertiary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-text-muted mt-4">Loading...</div>
      ) : isEmpty ? (
        <p className="text-sm text-text-muted mt-3">Nothing logged.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4 mt-3">
          <Column label="Goals" items={goalItems} />
          <Column label="Todos" items={todoItems} />
          <Column label="Habits" items={habitItems} />
        </div>
      )}
    </div>
  );
}

const NODE_DOT = clsx('absolute left-0 top-1.5 w-3.5 h-3.5 rounded-full bg-bg-primary');

export function SummaryPage() {
  const today = toDateStr(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);
  const thirtyDaysAgoDate = new Date();
  thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 29);
  const thirtyDaysAgo = toDateStr(thirtyDaysAgoDate);

  const sevenDaysAgoDate = new Date();
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
  const sevenDaysAgo = toDateStr(sevenDaysAgoDate);

  const { data: timeseries, isLoading: tsLoading, isError: tsError } = useTimeseries(thirtyDaysAgo, today);
  const { data: todaySummary, isLoading: todayLoading } = useSummary(today, today);
  const { data: yesterdaySummary, isLoading: yesterdayLoading } = useSummary(yesterday, yesterday);
  const { data: weekSummary, isLoading: weekLoading } = useSummary(sevenDaysAgo, today);
  const { data: todayGit } = useGitStats(today, today);
  const { data: yesterdayGit } = useGitStats(yesterday, yesterday);
  const { data: weekGit } = useGitStats(sevenDaysAgo, today);
  const { data: habits } = useHabits();
  const completedHabits = (habits ?? []).filter((h) => h.completedThisPeriod).map((h) => h.title);

  const series = timeseries ?? [];
  const last7 = series.slice(-7);
  const todayPoint = series.find((p) => p.date === today);
  const yesterdayPoint = series.find((p) => p.date === yesterday);
  const sumWeek = (key: 'goalsCreated' | 'goalsCompleted' | 'todosCompleted' | 'habitsHit') =>
    last7.reduce((acc, p) => acc + p[key], 0);

  const goalsCreatedSpark = last7.map((p) => p.goalsCreated);
  const goalsCompletedSpark = last7.map((p) => p.goalsCompleted);
  const todosDoneSpark = last7.map((p) => p.todosCompleted);
  const habitsHitSpark = last7.map((p) => p.habitsHit);

  const hasChartData = series.some((p) => p.goalsCompleted + p.todosCompleted + p.habitsHit > 0);

  const todayDisplay = longDate(today);

  const periods = [
    { label: 'Today', date: todayDisplay, emphasis: 'hero' as Emphasis, data: todaySummary, loading: todayLoading, habits: completedHabits, dot: 'border-2 border-accent' },
    { label: 'Yesterday', date: longDate(yesterday), emphasis: 'normal' as Emphasis, data: yesterdaySummary, loading: yesterdayLoading, habits: [] as string[], dot: 'border-2 border-border-secondary' },
    { label: 'Last 7 days', date: `${longDate(sevenDaysAgo)} – ${longDate(today)}`, emphasis: 'muted' as Emphasis, data: weekSummary, loading: weekLoading, habits: [] as string[], dot: 'border border-border-primary' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Summary" actions={<span className="text-sm text-text-muted">{todayDisplay}</span>} />

      <QuickCreate />

      {tsError && <ErrorState message="Failed to load summary data." />}

      {tsLoading && !timeseries ? (
        <PageLoading />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MetricCard label="Goals created" today={todayPoint?.goalsCreated ?? 0} yesterday={yesterdayPoint?.goalsCreated ?? 0} week={sumWeek('goalsCreated')} spark={goalsCreatedSpark} accent="accent" />
          <MetricCard label="Goals completed" today={todayPoint?.goalsCompleted ?? 0} yesterday={yesterdayPoint?.goalsCompleted ?? 0} week={sumWeek('goalsCompleted')} spark={goalsCompletedSpark} accent="success" />
          <MetricCard label="Todos done" today={todayPoint?.todosCompleted ?? 0} yesterday={yesterdayPoint?.todosCompleted ?? 0} week={sumWeek('todosCompleted')} spark={todosDoneSpark} accent="success" />
          <MetricCard label="Habits hit" today={todayPoint?.habitsHit ?? 0} yesterday={yesterdayPoint?.habitsHit ?? 0} week={sumWeek('habitsHit')} spark={habitsHitSpark} accent="magenta" />
          <MetricCard label="Commits" today={todayGit?.commits ?? 0} yesterday={yesterdayGit?.commits ?? 0} week={weekGit?.commits ?? 0} accent="warning" />
        </div>
      )}

      {!tsLoading && series.length > 0 && (
        hasChartData ? (
          <ChartContainer title="Last 30 days" height={220}>
            <BarChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="date" {...xAxisDateProps} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFormatter} cursor={{ fill: 'var(--bg-tertiary)' }} />
              <Legend {...legendProps} />
              <Bar isAnimationActive={false} stackId="work" dataKey="goalsCompleted" fill="var(--success)" name="Goals" radius={[0, 0, 0, 0]} />
              <Bar isAnimationActive={false} stackId="work" dataKey="todosCompleted" fill="var(--accent)" name="Todos" />
              <Bar isAnimationActive={false} stackId="work" dataKey="habitsHit" fill="var(--magenta)" name="Habits" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        ) : (
          <ChartContainer title="Last 30 days" raw>
            <div className="h-[220px] flex items-center justify-center text-sm text-text-muted">
              No completed work in the last 30 days yet.
            </div>
          </ChartContainer>
        )
      )}

      {/* Vertical timeline: one spine, a node per period, Goals/Todos/Habits in 3 columns each. */}
      <div className="relative space-y-4">
        <span aria-hidden className="absolute left-[6px] top-3 bottom-3 w-px bg-border-primary" />
        {periods.map((p) => (
          <div key={p.label} className="relative pl-7">
            <span aria-hidden className={clsx(NODE_DOT, p.dot)} />
            <PeriodNode
              periodLabel={p.label}
              dateDisplay={p.date}
              emphasis={p.emphasis}
              data={p.data as PeriodSummaryData | undefined}
              isLoading={p.loading}
              completedHabits={p.habits}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
