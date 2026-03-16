import type { Category } from '@goal-tracker/shared';
import { PRIORITY, GOAL_STATE } from '@goal-tracker/shared';
import { Select } from '../ui/Select';

export interface GoalFilterState {
  state: string;
  priority: string;
  category: string;
  showArchived: boolean;
  showCompleted: boolean;
}

interface GoalFiltersProps {
  filters: GoalFilterState;
  onChange: (f: GoalFilterState) => void;
  categories: Category[];
}

const stateOptions = [
  { value: '', label: 'All states' },
  ...GOAL_STATE.map((s) => ({
    value: s,
    label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  })),
];

const priorityOptions = [
  { value: '', label: 'All priorities' },
  ...PRIORITY.map((p) => ({
    value: p,
    label: p.charAt(0).toUpperCase() + p.slice(1),
  })),
];

export function GoalFilters({ filters, onChange, categories }: GoalFiltersProps) {
  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  function set<K extends keyof GoalFilterState>(key: K, value: GoalFilterState[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        label="State"
        value={filters.state}
        onChange={(v) => set('state', v)}
        options={stateOptions}
        className="min-w-36"
      />
      <Select
        label="Priority"
        value={filters.priority}
        onChange={(v) => set('priority', v)}
        options={priorityOptions}
        className="min-w-36"
      />
      <Select
        label="Category"
        value={filters.category}
        onChange={(v) => set('category', v)}
        options={categoryOptions}
        className="min-w-36"
      />
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer pb-0.5">
        <input
          type="checkbox"
          checked={filters.showArchived}
          onChange={(e) => set('showArchived', e.target.checked)}
          className="accent-blue-500"
        />
        Archived
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer pb-0.5">
        <input
          type="checkbox"
          checked={filters.showCompleted}
          onChange={(e) => set('showCompleted', e.target.checked)}
          className="accent-blue-500"
        />
        Completed
      </label>
    </div>
  );
}
