import { useNavigate } from 'react-router-dom';
import type { Goal, Category } from '../../types';
import { PriorityBadge, StateBadge } from '../ui/Badge';
import { CategoryChip } from '../categories/CategoryChip';
import { useUpdateGoal } from '../../api/hooks';
import { Icon } from '../ui/Icon';

interface GoalCardProps {
  goal: Goal & { categories?: Category[]; latestNote?: { content: string } | null; todoCount?: number; noteCount?: number; habitCount?: number };
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
      className="group flex items-start gap-3 bg-bg-secondary border border-border-primary rounded-lg px-4 py-3 cursor-pointer hover:border-border-secondary hover:bg-bg-secondary/80 transition-colors"
    >
      {/* Done toggle */}
      <button
        onClick={handleToggleDone}
        title={isDone ? 'Mark not done' : 'Mark done'}
        className={`mt-0.5 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          isDone
            ? 'border-emerald-500 bg-emerald-500'
            : 'border-border-primary hover:border-emerald-500'
        }`}
        style={{ width: '1.125rem', height: '1.125rem' }}
      >
        {isDone && <Icon name="check" size="xs" className="text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <span
            className={`text-sm font-medium leading-snug ${
              isDone ? 'text-text-muted line-through' : 'text-text-primary'
            }`}
          >
            {goal.title}
          </span>
          <span className="text-sm text-text-muted flex-shrink-0">
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
            <span className="px-2 py-0.5 rounded text-sm font-medium bg-bg-tertiary text-text-muted">
              archived
            </span>
          )}
        </div>

        {(() => {
          const parts: string[] = [];
          if (goal.todoCount) parts.push(`${goal.todoCount} ${goal.todoCount === 1 ? 'todo' : 'todos'}`);
          if (goal.noteCount) parts.push(`${goal.noteCount} ${goal.noteCount === 1 ? 'note' : 'notes'}`);
          if (goal.habitCount) parts.push(`${goal.habitCount} ${goal.habitCount === 1 ? 'habit' : 'habits'}`);
          return parts.length > 0 ? (
            <p className="mt-1.5 text-sm text-text-muted">
              {parts.join(' · ')}
            </p>
          ) : null;
        })()}
      </div>
    </div>
  );
}
