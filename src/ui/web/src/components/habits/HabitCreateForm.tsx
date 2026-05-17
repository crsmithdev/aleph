import { useState } from 'react';
import { useCreateHabit } from '../../api/hooks';

export function HabitCreateForm({ onCreated }: { onCreated?: () => void }) {
  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const create = useCreateHabit();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), frequency }, {
      onSuccess: () => { setTitle(''); onCreated?.(); },
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center">
      <input
        type="text"
        value={title}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v);
        }}
        placeholder="New habit..."
        autoFocus
        className="flex-1 bg-bg-secondary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
      />
      <select
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
        className="bg-bg-secondary border border-border-primary rounded-lg px-2 py-2 text-sm text-text-secondary focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      <button
        type="submit"
        disabled={!title.trim() || create.isPending}
        className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
      >
        Add
      </button>
    </form>
  );
}
