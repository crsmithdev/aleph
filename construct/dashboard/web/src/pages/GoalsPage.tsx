import { useState } from 'react';
import { useGoals, useCategories, useCreateGoal } from '../api/hooks';
import { GoalList } from '../components/goals/GoalList';
import { GoalFilters, type GoalFilterState } from '../components/goals/GoalFilters';
import { GoalForm } from '../components/goals/GoalForm';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Goals</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {visibleGoals.length} goal{visibleGoals.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setGroupBy(groupBy === 'none' ? 'category' : 'none')}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              groupBy === 'category'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-600/40'
                : 'text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-700'
            }`}
          >
            Group by category
          </button>
          <Button onClick={() => setNewGoalOpen(true)}>+ New goal</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
        <GoalFilters
          filters={filters}
          onChange={setFilters}
          categories={categories}
        />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <span className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 text-red-400 text-sm">
          Failed to load goals.
        </div>
      ) : (
        <GoalList
          goals={visibleGoals}
          groupBy={groupBy}
          categories={categories}
        />
      )}

      {/* New goal modal */}
      <Modal
        open={newGoalOpen}
        onClose={() => setNewGoalOpen(false)}
        title="New goal"
      >
        <GoalForm
          onSubmit={handleCreate}
          onCancel={() => setNewGoalOpen(false)}
          loading={createGoal.isPending}
        />
      </Modal>
    </div>
  );
}
