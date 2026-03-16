import { useState } from 'react';
import { useCreateTodo } from '../../api/hooks';
import { useGoals } from '../../api/hooks';

interface TodoQuickAddProps {
  date: string;
}

export function TodoQuickAdd({ date }: TodoQuickAddProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [goalId, setGoalId] = useState('');
  const [showExtras, setShowExtras] = useState(false);

  const createTodo = useCreateTodo();
  const { data: goals } = useGoals({ archived: false });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createTodo.mutate(
      {
        title: title.trim(),
        date,
        goalId: goalId || undefined,
      },
      {
        onSuccess: () => {
          setTitle('');
          setDueDate('');
          setGoalId('');
          setShowExtras(false);
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setShowExtras(true)}
          placeholder="Add a todo..."
          className="flex-1 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-600"
        />
        <button
          type="submit"
          disabled={!title.trim() || createTodo.isPending}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
        >
          Add
        </button>
      </div>

      {showExtras && (
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Due:</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="flex items-center gap-1">
            <label className="text-xs text-gray-500">Goal:</label>
            <select
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-600 max-w-40"
            >
              <option value="">None</option>
              {goals?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowExtras(false);
              setDueDate('');
              setGoalId('');
            }}
            className="text-xs text-gray-500 hover:text-gray-400 ml-auto"
          >
            Collapse
          </button>
        </div>
      )}
    </form>
  );
}
