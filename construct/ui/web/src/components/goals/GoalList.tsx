import type { Goal, Category } from '../../types';
import { GoalCard } from './GoalCard';

type GoalWithMeta = Goal & { categories?: Category[]; latestNote?: { content: string } };

interface GoalListProps {
  goals: GoalWithMeta[];
  groupBy?: 'category' | 'none';
  categories?: Category[];
}

export function GoalList({ goals, groupBy = 'none', categories = [] }: GoalListProps) {
  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-600">
        <svg className="w-10 h-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm">No goals match the current filters.</p>
      </div>
    );
  }

  if (groupBy === 'none') {
    return (
      <div className="flex flex-col gap-2">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} />
        ))}
      </div>
    );
  }

  // Group by category
  const categoryMap = new Map<string, { cat: Category | null; goals: GoalWithMeta[] }>();
  categoryMap.set('__none__', { cat: null, goals: [] });

  for (const cat of categories) {
    categoryMap.set(cat.id, { cat, goals: [] });
  }

  for (const goal of goals) {
    if (!goal.categories || goal.categories.length === 0) {
      categoryMap.get('__none__')!.goals.push(goal);
    } else {
      for (const cat of goal.categories) {
        const entry = categoryMap.get(cat.id);
        if (entry) entry.goals.push(goal);
      }
    }
  }

  const groups = [...categoryMap.values()].filter((g) => g.goals.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.cat?.id ?? '__none__'}>
          <div className="flex items-center gap-2 mb-2">
            {group.cat ? (
              <span
                className="text-xs font-semibold uppercase tracking-wider px-2 py-0.5 rounded"
                style={
                  group.cat.color
                    ? { backgroundColor: `${group.cat.color}20`, color: group.cat.color }
                    : { backgroundColor: 'rgb(55 65 81)', color: 'rgb(156 163 175)' }
                }
              >
                {group.cat.name}
              </span>
            ) : (
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                Uncategorized
              </span>
            )}
            <span className="text-xs text-gray-600">({group.goals.length})</span>
          </div>
          <div className="flex flex-col gap-2">
            {group.goals.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
