import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useSummary, useHabits, useGitStats, useTimeseries, useCreateGoal } from '../../api/hooks';
import { MetricCard } from '../../components/data/MetricCard';
import { ChartContainer } from '../../components/charts/ChartContainer';
import { tooltipStyle, gridProps, axisProps, xAxisDateProps, legendProps, labelFormatter } from '../../components/charts/chartTheme';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/layout/PageHeader';
import { Modal } from '../../components/ui/Modal';
import { GoalForm } from '../../components/goals/GoalForm';
import { TodoQuickAdd } from '../../components/todos/TodoQuickAdd';
import { HabitCreateForm } from '../../components/habits/HabitCreateForm';
import { Icon } from '../../components/ui/Icon';
import { clsx } from 'clsx';
import { toDateStr, longDate } from '../../utils/format';

type PeriodSummaryData = {
  goalsCreated?: { count: number; items: Array<{ title: string }> };
  goalsCompleted?: { count: number; items: Array<{ goalId: string; details: { title?: string; prevState?: string } }> };
  todosCreated?: { count: number; items: Array<{ title: string }> };
  todosCompleted?: { count: number; items: Array<{ title: string }> };
  habitsCreated?: { count: number; items: Array<{ title: string }> };
};

interface GitStats {
  commits: number;
  added: number;
  deleted: number;
  topCommits?: Array<{ sha: string; subject: string; added: number; deleted: number }>;
}

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <span className="text-sm font-semibold uppercase tracking-wider text-text-muted">{label}</span>
      {count !== undefined && (
        <span className="text-sm text-text-muted">({count})</span>
      )}
    </div>
  );
}

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

type Emphasis = 'hero' | 'normal' | 'muted';

function PeriodActivity({
  periodLabel,
  dateDisplay,
  emphasis,
  data,
  isLoading,
  completedHabits,
  gitStats,
}: {
  periodLabel: string;
  dateDisplay: string;
  emphasis: Emphasis;
  data: PeriodSummaryData | undefined;
  isLoading: boolean;
  completedHabits: string[];
  gitStats: GitStats | undefined;
}) {
  const [copied, setCopied] = useState(false);

  const createdGoals: ListItem[] = (data?.goalsCreated?.items ?? []).map((g) => ({ text: g.title, kind: 'created' }));
  const completedGoalItems: ListItem[] = (data?.goalsCompleted?.items ?? []).map((g) => ({ text: g.details?.title ?? g.goalId, kind: 'completed' }));
  const goalItems = [...createdGoals, ...completedGoalItems];

  const createdTodos: ListItem[] = (data?.todosCreated?.items ?? []).map((t) => ({ text: t.title, kind: 'created' }));
  const completedTodoItems: ListItem[] = (data?.todosCompleted?.items ?? []).map((t) => ({ text: t.title, kind: 'completed' }));

  const createdHabits: ListItem[] = (data?.habitsCreated?.items ?? []).map((h) => ({ text: h.title, kind: 'created' }));
  const followedHabits: ListItem[] = completedHabits.map((h) => ({ text: h, kind: 'completed' }));
  const habitItems = [...createdHabits, ...followedHabits];

  const topCommits = gitStats?.topCommits ?? [];

  const buildCopyText = () => {
    const lines: string[] = [`${periodLabel} — ${dateDisplay}`, ''];
    if (goalItems.length > 0) {
      lines.push('Goals:', ...goalItems.map((g) => `  ${g.kind === 'created' ? '+' : '✓'} ${g.text}`), '');
    }
    if (createdTodos.length > 0) {
      lines.push('Todos added:', ...createdTodos.map((t) => `  + ${t.text}`), '');
    }
    if (completedTodoItems.length > 0) {
      lines.push('Todos finished:', ...completedTodoItems.map((t) => `  ✓ ${t.text}`), '');
    }
    if (habitItems.length > 0) {
      lines.push('Habits:', ...habitItems.map((h) => `  ${h.kind === 'created' ? '+' : '✓'} ${h.text}`), '');
    }
    if (gitStats && gitStats.commits > 0) {
      lines.push(`Construct: +${gitStats.added} LOC / −${gitStats.deleted} LOC · ${gitStats.commits} commit${gitStats.commits !== 1 ? 's' : ''}`);
      if (topCommits.length > 0) {
        lines.push(...topCommits.map((c) => `  · ${c.sha} ${c.subject} (+${c.added}/−${c.deleted})`));
      }
    }
    return lines.join('\n').trim();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildCopyText()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isEmpty =
    !isLoading &&
    goalItems.length === 0 &&
    createdTodos.length === 0 &&
    completedTodoItems.length === 0 &&
    habitItems.length === 0 &&
    !(gitStats && gitStats.commits > 0);

  const cardClass = clsx(
    'rounded-lg px-4 pt-3 pb-4',
    emphasis === 'hero'   && 'bg-bg-secondary border-2 border-accent/40',
    emphasis === 'normal' && 'bg-bg-secondary border border-border-primary',
    emphasis === 'muted'  && 'bg-bg-secondary/60 border border-border-primary',
  );

  const titleClass = clsx(
    'font-semibold',
    emphasis === 'hero'   && 'text-base text-text-primary',
    emphasis === 'normal' && 'text-sm text-text-primary',
    emphasis === 'muted'  && 'text-sm text-text-secondary',
  );

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
            'flex-shrink-0 px-3 py-1 text-sm rounded-md border transition-colors mt-0.5',
            copied
              ? 'bg-success/10 border-success text-success'
              : 'bg-bg-tertiary border-border-primary text-text-secondary hover:text-text-primary hover:border-border-secondary disabled:opacity-50 disabled:cursor-not-allowed'
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
        <div className="divide-y divide-border-primary/50 mt-1">
          {goalItems.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Goals" count={goalItems.length} />
              <BulletList items={goalItems} />
            </div>
          )}
          {createdTodos.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Todos added" count={createdTodos.length} />
              <BulletList items={createdTodos} />
            </div>
          )}
          {completedTodoItems.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Todos finished" count={completedTodoItems.length} />
              <BulletList items={completedTodoItems} />
            </div>
          )}
          {habitItems.length > 0 && (
            <div className="pb-3">
              <SectionHeader label="Habits" count={habitItems.length} />
              <BulletList items={habitItems} />
            </div>
          )}
          {gitStats && gitStats.commits > 0 && (
            <div className="pt-3">
              <SectionHeader label="Construct" />
              <div className="flex items-baseline gap-3 text-sm pl-1 flex-wrap">
                <span className="whitespace-nowrap"><span className="text-success font-mono">+{gitStats.added}</span><span className="text-text-muted"> LOC</span></span>
                <span className="whitespace-nowrap"><span className="text-error font-mono">−{gitStats.deleted}</span><span className="text-text-muted"> LOC</span></span>
                <span className="whitespace-nowrap"><span className="text-accent font-mono">{gitStats.commits}</span><span className="text-text-secondary"> commit{gitStats.commits !== 1 ? 's' : ''}</span></span>
              </div>
              {topCommits.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {topCommits.map((c) => (
                    <li key={c.sha} className="flex items-baseline gap-2 text-sm">
                      <span className="font-mono text-text-muted shrink-0">{c.sha}</span>
                      <span className="text-text-secondary truncate flex-1 min-w-0">{c.subject}</span>
                      <span className="font-mono text-text-muted shrink-0 whitespace-nowrap">
                        <span className="text-success">+{c.added}</span> / <span className="text-error">−{c.deleted}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreateButton({
  glyph,
  label,
  accent,
  onClick,
}: {
  glyph: string;
  label: string;
  accent: 'accent' | 'success' | 'magenta';
  onClick: () => void;
}) {
  const accentClasses: Record<typeof accent, string> = {
    accent: 'text-accent bg-accent/15',
    success: 'text-success bg-success/15',
    magenta: 'text-magenta bg-magenta/15',
  };
  return (
    <button
      onClick={onClick}
      className="group flex-1 min-w-[180px] flex items-center gap-3 bg-bg-secondary border border-border-primary hover:border-border-secondary hover:bg-bg-tertiary rounded-xl px-4 py-3 transition-colors text-left"
    >
      <span className={clsx('w-9 h-9 rounded-lg flex items-center justify-center', accentClasses[accent])}>
        <Icon name={glyph} size="md" />
      </span>
      <span className="text-base font-semibold text-text-primary">{label}</span>
    </button>
  );
}

export function SummaryPage() {
  const navigate = useNavigate();
  const today = toDateStr(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);
  const thirtyDaysAgoDate = new Date();
  thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 29);
  const thirtyDaysAgo = toDateStr(thirtyDaysAgoDate);

  const [openModal, setOpenModal] = useState<null | 'goal' | 'todo' | 'habit'>(null);

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
  const createGoal = useCreateGoal();

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

  const hasChartData = series.some(
    (p) => p.goalsCompleted + p.todosCompleted + p.habitsHit > 0,
  );

  const todayDisplay = longDate(today);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Summary"
        actions={<span className="text-sm text-text-muted">{todayDisplay}</span>}
      />

      <div className="flex gap-3 flex-wrap">
        <CreateButton glyph="add" label="New goal" accent="accent" onClick={() => setOpenModal('goal')} />
        <CreateButton glyph="check" label="New todo" accent="success" onClick={() => setOpenModal('todo')} />
        <CreateButton glyph="autorenew" label="New habit" accent="magenta" onClick={() => setOpenModal('habit')} />
      </div>

      {tsError && <ErrorState message="Failed to load summary data." />}

      {tsLoading && !timeseries ? (
        <PageLoading />
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="Goals created"
            today={todayPoint?.goalsCreated ?? 0}
            yesterday={yesterdayPoint?.goalsCreated ?? 0}
            week={sumWeek('goalsCreated')}
            spark={goalsCreatedSpark}
            accent="accent"
          />
          <MetricCard
            label="Goals completed"
            today={todayPoint?.goalsCompleted ?? 0}
            yesterday={yesterdayPoint?.goalsCompleted ?? 0}
            week={sumWeek('goalsCompleted')}
            spark={goalsCompletedSpark}
            accent="success"
          />
          <MetricCard
            label="Todos done"
            today={todayPoint?.todosCompleted ?? 0}
            yesterday={yesterdayPoint?.todosCompleted ?? 0}
            week={sumWeek('todosCompleted')}
            spark={todosDoneSpark}
            accent="success"
          />
          <MetricCard
            label="Habits hit"
            today={todayPoint?.habitsHit ?? 0}
            yesterday={yesterdayPoint?.habitsHit ?? 0}
            week={sumWeek('habitsHit')}
            spark={habitsHitSpark}
            accent="magenta"
          />
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

      <div className="space-y-4">
        <PeriodActivity
          periodLabel="Today"
          dateDisplay={todayDisplay}
          emphasis="hero"
          data={todaySummary as PeriodSummaryData | undefined}
          isLoading={todayLoading}
          completedHabits={completedHabits}
          gitStats={todayGit}
        />
        <PeriodActivity
          periodLabel="Yesterday"
          dateDisplay={longDate(yesterday)}
          emphasis="normal"
          data={yesterdaySummary as PeriodSummaryData | undefined}
          isLoading={yesterdayLoading}
          completedHabits={[]}
          gitStats={yesterdayGit}
        />
        <PeriodActivity
          periodLabel="Last 7 days"
          dateDisplay={`${longDate(sevenDaysAgo)} – ${longDate(today)}`}
          emphasis="muted"
          data={weekSummary as PeriodSummaryData | undefined}
          isLoading={weekLoading}
          completedHabits={[]}
          gitStats={weekGit}
        />
      </div>

      <Modal open={openModal === 'goal'} onClose={() => setOpenModal(null)} title="New goal">
        <GoalForm
          onSubmit={(data) =>
            createGoal.mutate(data, {
              onSuccess: (g) => {
                setOpenModal(null);
                navigate(`/goals/${g.id}`);
              },
            })
          }
          onCancel={() => setOpenModal(null)}
          loading={createGoal.isPending}
        />
      </Modal>

      <Modal open={openModal === 'todo'} onClose={() => setOpenModal(null)} title="New todo">
        <TodoQuickAdd />
      </Modal>

      <Modal open={openModal === 'habit'} onClose={() => setOpenModal(null)} title="New habit">
        <HabitCreateForm onCreated={() => setOpenModal(null)} />
      </Modal>
    </div>
  );
}
