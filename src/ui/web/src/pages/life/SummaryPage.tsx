import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSummary, useHabits, useGitStats, useTimeseries, useCreateGoal } from '../../api/hooks';
import { MetricCard } from '../../components/data/MetricCard';
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

function TodayActivity({
  dateDisplay,
  data,
  isLoading,
  completedHabits,
  gitStats,
}: {
  dateDisplay: string;
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

  const buildCopyText = () => {
    const lines: string[] = [`Summary — ${dateDisplay}`, ''];
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

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-lg px-4 pt-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">Today — {dateDisplay}</p>
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
        <p className="text-sm text-text-muted mt-3">Nothing logged yet today.</p>
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
    magenta: 'text-[#c879ff] bg-[#c879ff]/15',
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
  const sevenDaysAgoDate = new Date();
  sevenDaysAgoDate.setDate(sevenDaysAgoDate.getDate() - 6);
  const sevenDaysAgo = toDateStr(sevenDaysAgoDate);

  const [openModal, setOpenModal] = useState<null | 'goal' | 'todo' | 'habit'>(null);

  const { data: timeseries, isLoading: tsLoading, isError: tsError } = useTimeseries(sevenDaysAgo, today);
  const { data: summary, isLoading: summaryLoading } = useSummary(today, today);
  const { data: gitStats } = useGitStats(today, today);
  const { data: habits } = useHabits();
  const completedHabits = (habits ?? []).filter((h) => h.completedThisPeriod).map((h) => h.title);
  const createGoal = useCreateGoal();

  const series = timeseries ?? [];
  const todayPoint = series.find((p) => p.date === today);
  const yesterdayPoint = series.find((p) => p.date === yesterday);
  const sumWeek = (key: 'goalsCreated' | 'goalsCompleted' | 'todosCompleted' | 'habitsHit') =>
    series.reduce((acc, p) => acc + p[key], 0);

  const goalsCreatedSpark = series.map((p) => p.goalsCreated);
  const goalsCompletedSpark = series.map((p) => p.goalsCompleted);
  const todosDoneSpark = series.map((p) => p.todosCompleted);
  const habitsHitSpark = series.map((p) => p.habitsHit);

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

      <TodayActivity
        dateDisplay={todayDisplay}
        data={summary as PeriodSummaryData | undefined}
        isLoading={summaryLoading}
        completedHabits={completedHabits}
        gitStats={gitStats}
      />

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
