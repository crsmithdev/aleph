import { useTodos } from '../../api/hooks';
import { TodoQuickAdd } from '../../components/todos/TodoQuickAdd';
import { TodoItem } from '../../components/todos/TodoItem';
import { HabitsSection } from '../../components/todos/HabitsSection';
import { PageLoading } from '../../components/ui/Spinner';

export function TodosPage() {
  const { data, isLoading } = useTodos();

  const active = data?.active ?? [];
  const completed = data?.completed ?? [];

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6 px-4">
      <h1 className="text-2xl font-bold text-text-primary">TODOs</h1>

      <TodoQuickAdd />

      {isLoading ? (
        <PageLoading />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent inline-block" />
              Active
              {active.length > 0 && (
                <span className="text-text-muted font-normal normal-case tracking-normal">
                  ({active.length})
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {active.length === 0 ? (
                <div className="text-sm text-text-muted italic py-2">No active todos.</div>
              ) : (
                active.map((todo) => (
                  <TodoItem key={todo.id} todo={todo} />
                ))
              )}
            </div>
          </section>

          {completed.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-success inline-block" />
                Completed Today
                <span className="text-text-muted font-normal normal-case tracking-normal">
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
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-accent inline-block" />
              Habits
            </h2>
            <HabitsSection date={new Date().toISOString().slice(0, 10)} />
          </section>
        </div>
      )}
    </div>
  );
}
