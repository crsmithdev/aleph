import { Icon } from '../../components/ui/Icon';
import { useState } from 'react';
import { useHabits, useCreateHabit, useCompleteHabit, useUncompleteHabit, useUpdateHabit, useDeleteHabit } from '../../api/hooks';
import { PageLoading } from '../../components/ui/Spinner';
import { PageHeader } from '../../components/layout/PageHeader';
import { clsx } from 'clsx';
import type { Habit } from '../../types';

function frequencyLabel(f: string) {
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function HabitCreateForm({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const create = useCreateHabit();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), frequency }, {
      onSuccess: () => { setTitle(''); onCreated?.(); },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center">
      <input
        type="text"
        value={title}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v);
        }}
        placeholder="New habit..."
        className="flex-1 bg-bg-secondary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent"
      />
      <select
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
        className="bg-bg-secondary border border-border-primary rounded-lg px-2 py-2 text-sm text-text-secondary focus:outline-none focus:border-accent"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      <button
        type="submit"
        disabled={!title.trim() || create.isPending}
        className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
      >
        Add
      </button>
    </form>
  );
}

function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return null;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
      streak >= 7 ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
    )}>
      {streak}d streak
    </span>
  );
}

function HabitRow({ habit }: { habit: Habit }) {
  const complete = useCompleteHabit();
  const uncomplete = useUncompleteHabit();
  const updateHabit = useUpdateHabit();
  const deleteHabit = useDeleteHabit();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(habit.title);

  const checked = habit.completedThisPeriod;
  const streak = habit.streak ?? 0;

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
    <div className="group flex items-center gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
      <button
        onClick={handleToggle}
        className={clsx(
          'flex-shrink-0 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors',
          checked
            ? 'bg-success border-success text-white'
            : 'border-border-secondary hover:border-accent'
        )}
      >
        {checked && (
          <Icon name="check" size="xs" />
        )}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
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
          <span
            className={clsx('text-sm cursor-pointer', checked ? 'line-through text-text-muted' : 'text-text-primary')}
            onClick={() => setEditing(true)}
          >
            {habit.title}
          </span>
        )}
        <span className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border-primary">
          {frequencyLabel(habit.frequency)}
        </span>
        <StreakBadge streak={streak} />
      </div>

      {habit.missedLastPeriod && !checked && (
        <span className="text-xs text-warning">missed</span>
      )}

      <button
        onClick={() => deleteHabit.mutate(habit.id)}
        className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-error text-lg leading-none transition-opacity flex-shrink-0"
        title="Delete"
      >
        &times;
      </button>
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
            <p className="text-sm text-text-muted italic py-4">No active habits. Create one above.</p>
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
              <div className="space-y-2 opacity-60">
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
