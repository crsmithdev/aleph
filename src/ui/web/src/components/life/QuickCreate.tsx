import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useCreateGoal, useCreateTodo, useCreateHabit } from '../../api/hooks';
import { Icon } from '../ui/Icon';

type Kind = 'goal' | 'todo' | 'habit';

const ACTIONS: { kind: Kind; label: string; glyph: string; classes: string }[] = [
  { kind: 'goal', label: 'Goal', glyph: 'add', classes: 'text-accent bg-accent/15 hover:bg-accent/25' },
  { kind: 'todo', label: 'Todo', glyph: 'check', classes: 'text-success bg-success/15 hover:bg-success/25' },
  { kind: 'habit', label: 'Habit', glyph: 'autorenew', classes: 'text-magenta bg-magenta/15 hover:bg-magenta/25' },
];

/**
 * One shared text box that creates a goal, todo, or habit from the same title —
 * the button you press picks the type. Goals open their detail page (where the
 * rest of the fields live); todos and habits create in place and clear the box.
 */
export function QuickCreate() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const createGoal = useCreateGoal();
  const createTodo = useCreateTodo();
  const createHabit = useCreateHabit();

  const trimmed = title.trim();
  const pending = createGoal.isPending || createTodo.isPending || createHabit.isPending;

  const create = (kind: Kind) => {
    if (!trimmed || pending) return;
    if (kind === 'goal') {
      createGoal.mutate({ title: trimmed }, { onSuccess: (g) => navigate(`/goals/${g.id}`) });
    } else if (kind === 'todo') {
      createTodo.mutate({ title: trimmed }, { onSuccess: () => setTitle('') });
    } else {
      createHabit.mutate({ title: trimmed, frequency: 'daily' }, { onSuccess: () => setTitle('') });
    }
  };

  return (
    <div className="bg-bg-secondary border border-border-primary rounded-xl p-4 flex flex-col gap-3">
      <input
        type="text"
        value={title}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v);
        }}
        placeholder="What do you want to accomplish?"
        autoComplete="off"
        className="w-full bg-bg-primary border border-border-primary rounded-lg px-3.5 py-2.5 text-base text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
      />
      <div className="flex gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            onClick={() => create(a.kind)}
            disabled={!trimmed || pending}
            className={clsx(
              'flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              a.classes,
            )}
          >
            <Icon name={a.glyph} size="sm" />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
