import { useState } from 'react';
import { useCreateTodo } from '../../api/hooks';

export function TodoQuickAdd() {
  const [title, setTitle] = useState('');
  const createTodo = useCreateTodo();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    createTodo.mutate(
      { title: title.trim() },
      { onSuccess: () => setTitle('') }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        name="todo-title"
        autoComplete="off"
        value={title}
        onChange={(e) => {
          const v = e.target.value;
          setTitle(v.length > 0 ? v.charAt(0).toUpperCase() + v.slice(1) : v);
        }}
        placeholder="Add a Todo..."
        className="flex-1 bg-bg-secondary border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
      />
      <button
        type="submit"
        disabled={!title.trim() || createTodo.isPending}
        className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors"
      >
        Add
      </button>
    </form>
  );
}
