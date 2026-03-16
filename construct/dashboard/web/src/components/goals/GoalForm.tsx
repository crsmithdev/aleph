import { useState } from 'react';
import type { Goal } from '@goal-tracker/shared';
import { PRIORITY, GOAL_STATE } from '@goal-tracker/shared';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';

interface GoalFormProps {
  initial?: Partial<Goal>;
  onSubmit: (data: { title: string; priority: string; state: string }) => void;
  onCancel: () => void;
  loading?: boolean;
}

const priorityOptions = PRIORITY.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
const stateOptions = GOAL_STATE.map((s) => ({
  value: s,
  label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
}));

export function GoalForm({ initial, onSubmit, onCancel, loading }: GoalFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [priority, setPriority] = useState<string>(initial?.priority ?? 'medium');
  const [state, setState] = useState<string>(initial?.state ?? 'not_started');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({ title: title.trim(), priority, state });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter goal title…"
          autoFocus
          className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={priorityOptions}
        />
        <Select
          label="State"
          value={state}
          onChange={setState}
          options={stateOptions}
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" loading={loading} disabled={!title.trim()}>
          {initial ? 'Save changes' : 'Create goal'}
        </Button>
      </div>
    </form>
  );
}
