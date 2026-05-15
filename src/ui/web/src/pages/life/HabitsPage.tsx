import { Icon } from '../../components/ui/Icon';
import { useState } from 'react';
import { useHabits, useCompleteHabit, useUncompleteHabit, useUpdateHabit, useDeleteHabit } from '../../api/hooks';
import { PageLoading } from '../../components/ui/Spinner';
import { PageHeader } from '../../components/layout/PageHeader';
import { HabitCreateForm } from '../../components/habits/HabitCreateForm';
import { EmptyState } from '../../components/ui/EmptyState';
import { clsx } from 'clsx';
import type { Habit, HabitHistoryCell } from '../../types';

function frequencyCadenceLabel(f: string): string {
  if (f === 'daily') return 'daily';
  if (f === 'weekly') return 'weekly';
  if (f === 'monthly') return 'monthly';
  return f;
}

function streakUnit(f: string): string {
  if (f === 'monthly') return 'mo';
  if (f === 'weekly') return 'wk';
  return 'd';
}

/** 28-cell heatmap matching the life kit. Magenta is reserved for habits. */
function HabitHeatmap({ history, currentPeriodKey }: { history: HabitHistoryCell[]; currentPeriodKey: string }) {
  return (
    <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${history.length}, minmax(0, 1fr))` }}>
      {history.map((cell) => (
        <div
          key={cell.periodKey}
          title={`${cell.periodKey} · ${cell.completed ? 'done' : 'missed'}`}
          className={clsx(
            'aspect-square rounded-[2px]',
            cell.completed
              ? cell.periodKey === currentPeriodKey
                ? 'bg-magenta'
                : 'bg-magenta/70'
              : cell.periodKey === currentPeriodKey
                ? 'bg-bg-primary border border-dashed border-border-primary'
                : 'bg-bg-tertiary',
          )}
        />
      ))}
    </div>
  );
}

function HabitRow({ habit }: { habit: Habit }) {
  const complete = useCompleteHabit();
  const uncomplete = useUncompleteHabit();
  const updateHabit = useUpdateHabit();
  const deleteHabit = useDeleteHabit();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(habit.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const checked = habit.completedThisPeriod;
  const streak = habit.streak ?? 0;
  const history = habit.history ?? [];

  const handleToggle = () => {
    if (checked) {
      uncomplete.mutate({ id: habit.id, periodKey: habit.currentPeriodKey });
    } else {
      complete.mutate({ id: habit.id, periodKey: habit.currentPeriodKey });
    }
  };

  const saveTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== habit.title) {
      updateHabit.mutate({ id: habit.id, title: trimmed });
    } else {
      setEditTitle(habit.title);
    }
    setEditing(false);
  };

  return (
    <div className="group bg-bg-secondary border border-border-primary rounded-lg px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-3">
        <button
          onClick={handleToggle}
          className={clsx(
            'flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors',
            checked
              ? 'bg-success border-success text-white'
              : 'border-border-secondary hover:border-accent'
          )}
          title={checked ? 'Mark as not done' : 'Mark as done'}
        >
          {checked && <Icon name="check" size="xs" />}
        </button>

        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          {editing ? (
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') { setEditTitle(habit.title); setEditing(false); }
              }}
              autoFocus
              className="flex-1 bg-bg-tertiary border border-border-secondary rounded px-2 py-0.5 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          ) : (
            <button
              type="button"
              className={clsx('text-sm font-semibold text-left bg-transparent border-none p-0 cursor-pointer', checked ? 'line-through text-text-muted' : 'text-text-primary')}
              onClick={() => setEditing(true)}
            >
              {habit.title}
            </button>
          )}
          <span className="text-xs font-mono uppercase tracking-wider text-text-muted">
            {frequencyCadenceLabel(habit.frequency)}
          </span>
          {habit.missedLastPeriod && !checked && (
            <span className="text-xs font-mono uppercase tracking-wider text-warning">missed</span>
          )}
        </div>

        <span className={clsx('text-xs font-mono whitespace-nowrap', streak > 0 ? 'text-magenta' : 'text-text-muted')}>
          {streak > 0 ? `streak · ${streak} ${streakUnit(habit.frequency)}` : 'no streak'}
        </span>

        {confirmDelete ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => deleteHabit.mutate(habit.id)}
              className="text-sm text-red-400 hover:text-red-300 font-medium"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-sm text-text-muted hover:text-text-secondary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-text-muted hover:text-error text-xl leading-none transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
            title="Delete habit"
            aria-label="Delete habit"
          >
            &times;
          </button>
        )}
      </div>

      {history.length > 0 && (
        <HabitHeatmap history={history} currentPeriodKey={habit.currentPeriodKey} />
      )}
    </div>
  );
}

export function HabitsPage() {
  const { data: habits, isLoading } = useHabits();

  const active = habits?.filter((h) => h.active) ?? [];
  const inactive = habits?.filter((h) => !h.active) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Habits" />

      <HabitCreateForm />

      {isLoading ? (
        <PageLoading />
      ) : (
        <div className="space-y-6">
          {active.length === 0 ? (
            <EmptyState
              icon="autorenew"
              title="No active habits."
              hint="Add a habit above. Magenta is reserved for habits — you'll see streaks light up here as you go."
            />
          ) : (
            <div className="space-y-2">
              {active.map((habit) => (
                <HabitRow key={habit.id} habit={habit} />
              ))}
            </div>
          )}

          {inactive.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2">
                Inactive ({inactive.length})
              </h2>
              <div className="space-y-2">
                {inactive.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
