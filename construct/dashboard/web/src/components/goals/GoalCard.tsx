import { useNavigate } from 'react-router-dom';
import type { Goal, Category } from '@goal-tracker/shared';
import { PriorityBadge, StateBadge } from '../ui/Badge';
import { CategoryChip } from '../categories/CategoryChip';
import { useUpdateGoal } from '../../api/hooks';

interface GoalCardProps {
  goal: Goal & { categories?: Category[]; latestNote?: { content: string } };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function GoalCard({ goal }: GoalCardProps) {
  const navigate = useNavigate();
  const updateGoal = useUpdateGoal();

  const isDone = goal.state === 'done';

  function handleToggleDone(e: React.MouseEvent) {
    e.stopPropagation();
    updateGoal.mutate({
      id: goal.id,
      state: isDone ? 'actionable' : 'done',
    });
  }

  return (
    <div
      onClick={() => navigate(`/goals/${goal.id}`)}
      className="group flex items-start gap-3 bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 cursor-pointer hover:border-gray-700 hover:bg-gray-900/80 transition-colors"
    >
      {/* Done toggle */}
      <button
        onClick={handleToggleDone}
        title={isDone ? 'Mark not done' : 'Mark done'}
        className={`mt-0.5 flex-shrink-0 w-4.5 h-4.5 rounded-full border-2 flex items-center justify-center transition-colors ${
          isDone
            ? 'border-emerald-500 bg-emerald-500'
            : 'border-gray-600 hover:border-emerald-500'
        }`}
        style={{ width: '1.125rem', height: '1.125rem' }}
      >
        {isDone && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10">
            <path d="M1.5 5l2.5 2.5 4.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <span
            className={`text-sm font-medium leading-snug ${
              isDone ? 'text-gray-500 line-through' : 'text-gray-100 group-hover:text-white'
            }`}
          >
            {goal.title}
          </span>
          <span className="text-xs text-gray-600 flex-shrink-0">
            {formatDate(goal.updatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <PriorityBadge priority={goal.priority} />
          <StateBadge state={goal.state} />
          {goal.categories?.map((cat) => (
            <CategoryChip key={cat.id} name={cat.name} color={cat.color} />
          ))}
          {goal.archived && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-500">
              archived
            </span>
          )}
        </div>

        {goal.latestNote && (
          <p className="mt-1.5 text-xs text-gray-500 line-clamp-1">
            {goal.latestNote.content}
          </p>
        )}
      </div>
    </div>
  );
}
