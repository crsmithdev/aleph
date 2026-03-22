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
    return <div className="text-sm text-gray-500 italic">Loading habits...</div>;
  }

  if (active.length === 0) {
    return <div className="text-sm text-gray-500 italic">No habits.</div>;
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
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-900 border border-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleToggle}
        className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-blue-500 cursor-pointer"
      />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`text-sm ${checked ? 'line-through text-gray-500' : 'text-gray-200'}`}>
          {habit.title}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
          {frequencyLabel(habit.frequency)}
        </span>
      </div>
    </div>
  );
}
