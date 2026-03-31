import { useState } from 'react';
import { useGoals, useCategories, useCreateGoal } from '../../api/hooks';
import { GoalList } from '../../components/goals/GoalList';
import { GoalFilters, type GoalFilterState } from '../../components/goals/GoalFilters';
import { GoalForm } from '../../components/goals/GoalForm';
import { Button } from '../../components/ui/Button';
import { PageLoading } from '../../components/ui/Spinner';
import { ErrorState } from '../../components/ui/ErrorState';
import { clsx } from 'clsx';

const defaultFilters: GoalFilterState = {
  state: '',
  priority: '',
  category: '',
  showArchived: false,
  showCompleted: false,
};

export function GoalsPage() {
  const [filters, setFilters] = useState<GoalFilterState>(defaultFilters);
  const [newGoalOpen, setNewGoalOpen] = useState(false);
  const [groupBy, setGroupBy] = useState<'none' | 'category'>('none');

  const queryFilters = {
    state: filters.state || undefined,
    priority: filters.priority || undefined,
    category: filters.category || undefined,
    archived: filters.showArchived ? true : undefined,
  };

  const { data: goals = [], isLoading, isError } = useGoals(queryFilters);
  const { data: categories = [] } = useCategories();
  const createGoal = useCreateGoal();

  const visibleGoals = filters.showCompleted
    ? goals
    : goals.filter((g) => g.state !== 'done' && g.state !== 'canceled');

  function handleCreate(data: { title: string; priority: string; state: string }) {
    createGoal.mutate(data, {
      onSuccess: () => setNewGoalOpen(false),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Goals</h1>
          <p className="text-sm text-text-muted mt-0.5">
            {visibleGoals.length} goal{visibleGoals.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGroupBy(groupBy === 'none' ? 'category' : 'none')}
            className={clsx(
              'px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
              groupBy === 'category'
                ? 'bg-accent-subtle text-accent border border-accent/40'
                : 'text-text-muted hover:text-text-secondary border border-border-primary hover:border-border-secondary'
            )}
          >
            Group by category
          </button>
          <Button onClick={() => setNewGoalOpen(!newGoalOpen)}>+ New goal</Button>
        </div>
      </div>

      {newGoalOpen && (
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <GoalForm onSubmit={handleCreate} onCancel={() => setNewGoalOpen(false)} loading={createGoal.isPending} />
        </div>
      )}

      <div className="bg-bg-secondary border border-border-primary rounded-lg px-4 py-3">
        <GoalFilters filters={filters} onChange={setFilters} categories={categories} />
      </div>

      {isLoading ? (
        <PageLoading />
      ) : isError ? (
        <ErrorState message="Failed to load goals." />
      ) : (
        <GoalList goals={visibleGoals} groupBy={groupBy} categories={categories} />
      )}

    </div>
  );
}
