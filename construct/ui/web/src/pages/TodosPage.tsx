import { useState } from 'react';
import { useTodos } from '../api/hooks';
import { DayNavigator } from '../components/todos/DayNavigator';
import { TodoQuickAdd } from '../components/todos/TodoQuickAdd';
import { TodoItem } from '../components/todos/TodoItem';
import { RecurringSection } from '../components/todos/RecurringSection';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TodosPage() {
  const [date, setDate] = useState(today);
  const { data, isLoading } = useTodos(date);

  const todayStr = today();
  const overdue = data?.overdue ?? [];
  const forDay = data?.todos ?? [];
  const completed = data?.completed ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">TODOs</h1>
      </div>

      <DayNavigator date={date} onChange={setDate} />

      <TodoQuickAdd date={date} />

      {isLoading ? (
        <div className="text-sm text-gray-500 italic">Loading...</div>
      ) : (
        <div className="space-y-6">
          {overdue.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Overdue
                <span className="text-red-600 font-normal normal-case tracking-normal">
                  ({overdue.length})
                </span>
              </h2>
              <div className="space-y-2">
                {overdue.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} isOverdue />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />
              {date === todayStr ? 'Today' : new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {forDay.length > 0 && (
                <span className="text-gray-600 font-normal normal-case tracking-normal">
                  ({forDay.filter((t) => t.done).length}/{forDay.length} done)
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {forDay.length === 0 ? (
                <div className="text-sm text-gray-600 italic py-2">No todos for this day.</div>
              ) : (
                forDay.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))
              )}
            </div>
          </section>

          {completed.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Completed
                <span className="text-gray-600 font-normal normal-case tracking-normal">
                  ({completed.length})
                </span>
              </h2>
              <div className="space-y-2">
                {completed.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 inline-block" />
              Recurring
            </h2>
            <RecurringSection date={date} />
          </section>
        </div>
      )}
    </div>
  );
}
