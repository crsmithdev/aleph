import { useHabits, useCompleteHabit, useUncompleteHabit } from '../../api/hooks';
import type { Habit } from '../../types';

function frequencyLabel(frequency: Habit['frequency']): string {
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

interface HabitsSectionProps {
  date: string;
}

export function HabitsSection({ date: _date }: HabitsSectionProps) {
  const { data: habits, isLoading } = useHabits();
  const complete = useCompleteHabit();
  const uncomplete = useUncompleteHabit();

  const active = habits?.filter((h) => h.active) ?? [];

  if (isLoading) {
    return <div className="text-sm text-text-muted italic">Loading habits...</div>;
  }

  if (active.length === 0) {
    return <div className="text-sm text-text-muted italic">No habits.</div>;
  }

  return (
    <div className="space-y-2">
      {active.map((habit) => (
        <HabitItem
          key={habit.id}
          habit={habit}
          periodKey={habit.currentPeriodKey}
          onComplete={() => complete.mutate({ id: habit.id, periodKey: habit.currentPeriodKey })}
          onUncomplete={() => uncomplete.mutate({ id: habit.id, periodKey: habit.currentPeriodKey })}
        />
      ))}
    </div>
  );
}

interface HabitItemProps {
  habit: Habit;
  periodKey: string;
  onComplete: () => void;
  onUncomplete: () => void;
}

function HabitItem({ habit, onComplete, onUncomplete }: HabitItemProps) {
  const checked = habit.completedThisPeriod;

  const handleToggle = () => {
    if (checked) {
      onUncomplete();
    } else {
      onComplete();
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary border border-border-primary">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleToggle}
        className="h-4 w-4 rounded border-border-secondary bg-bg-tertiary text-accent focus:ring-accent cursor-pointer"
      />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`text-sm ${checked ? 'line-through text-text-muted' : 'text-text-primary'}`}>
          {habit.title}
        </span>
        <span className="text-sm px-2 py-0.5 rounded bg-bg-tertiary text-text-muted border border-border-secondary">
          {frequencyLabel(habit.frequency)}
        </span>
      </div>
    </div>
  );
}
