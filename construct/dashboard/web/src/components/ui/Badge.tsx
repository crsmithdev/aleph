const priorityColors: Record<string, string> = {
  low: 'bg-gray-700 text-gray-300',
  medium: 'bg-blue-900/50 text-blue-300',
  high: 'bg-orange-900/50 text-orange-300',
  critical: 'bg-red-900/50 text-red-300',
};

const stateColors: Record<string, string> = {
  not_started: 'bg-gray-700 text-gray-300',
  actionable: 'bg-green-900/50 text-green-300',
  scheduled: 'bg-purple-900/50 text-purple-300',
  waiting: 'bg-yellow-900/50 text-yellow-300',
  done: 'bg-emerald-900/50 text-emerald-300',
  canceled: 'bg-gray-800 text-gray-500 line-through',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColors[priority] ?? 'bg-gray-700 text-gray-300'}`}
    >
      {priority}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const label = state.replace(/_/g, ' ');
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${stateColors[state] ?? 'bg-gray-700 text-gray-300'}`}
    >
      {label}
    </span>
  );
}

export function CategoryBadge({
  name,
  color,
}: {
  name: string;
  color?: string | null;
}) {
  return (
    <span
      className="px-2 py-0.5 rounded text-xs font-medium"
      style={
        color
          ? { backgroundColor: `${color}20`, color }
          : { backgroundColor: 'rgb(55 65 81)', color: 'rgb(209 213 219)' }
      }
    >
      {name}
    </span>
  );
}
