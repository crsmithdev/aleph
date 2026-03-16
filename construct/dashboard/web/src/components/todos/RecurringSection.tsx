import { useState } from 'react';
import { useRecurringTodos, useCompleteRecurringTodo, useUncompleteRecurringTodo } from '../../api/hooks';
import type { RecurringTodo } from '@goal-tracker/shared';

function getPeriodKey(frequency: RecurringTodo['frequency'], date: string): string {
  const d = new Date(date + 'T00:00:00');
  if (frequency === 'daily') {
    return date;
  }
  if (frequency === 'weekly') {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  if (frequency === 'monthly') {
    return date.slice(0, 7);
  }
  return date;
}

function frequencyLabel(frequency: RecurringTodo['frequency']): string {
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

interface RecurringSectionProps {
  date: string;
}

export function RecurringSection({ date }: RecurringSectionProps) {
  const { data: todos, isLoading } = useRecurringTodos();
  const complete = useCompleteRecurringTodo();
  const uncomplete = useUncompleteRecurringTodo();

  const active = todos?.filter((t) => t.active) ?? [];

  if (isLoading) {
    return <div className="text-sm text-gray-500 italic">Loading recurring todos...</div>;
  }

  if (active.length === 0) {
    return <div className="text-sm text-gray-500 italic">No recurring todos.</div>;
  }

  return (
    <div className="space-y-2">
      {active.map((todo) => {
        const periodKey = getPeriodKey(todo.frequency, date);
        return (
          <RecurringTodoItem
            key={todo.id}
            todo={todo}
            periodKey={periodKey}
            onComplete={() => complete.mutate({ id: todo.id, periodKey })}
            onUncomplete={() => uncomplete.mutate({ id: todo.id, periodKey })}
          />
        );
      })}
    </div>
  );
}

interface RecurringTodoItemProps {
  todo: RecurringTodo;
  periodKey: string;
  onComplete: () => void;
  onUncomplete: () => void;
}

function RecurringTodoItem({ todo, onComplete, onUncomplete }: RecurringTodoItemProps) {
  const [checked, setChecked] = useState(false);

  const handleToggle = () => {
    if (checked) {
      onUncomplete();
    } else {
      onComplete();
    }
    setChecked(!checked);
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
          {todo.title}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
          {frequencyLabel(todo.frequency)}
        </span>
      </div>
    </div>
  );
}
