import { useTodos } from '../../api/hooks';
import { TodoQuickAdd } from '../../components/todos/TodoQuickAdd';
import { TodoItem } from '../../components/todos/TodoItem';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { PageHeader } from '../../components/layout/PageHeader';

export function TodosPage() {
  const { data, isLoading, isError } = useTodos();

  const active = data?.active ?? [];
  const completed = data?.completed ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Todos" />

      <TodoQuickAdd />

      {isLoading ? (
        <PageLoading />
      ) : isError ? (
        <ErrorState message="Failed to load todos." />
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
                <div className="text-sm text-text-muted italic py-2">No active Todos.</div>
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

        </div>
      )}
    </div>
  );
}
