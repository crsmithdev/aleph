import { cn } from '../../utils/cn';

const priorityColors: Record<string, string> = {
  low: 'bg-bg-tertiary text-text-muted',
  medium: 'bg-blue-900/50 text-blue-300',
  high: 'bg-orange-900/50 text-orange-300',
  critical: 'bg-red-900/50 text-red-300',
};

const stateColors: Record<string, string> = {
  not_started: 'bg-bg-tertiary text-text-muted',
  actionable: 'bg-green-900/50 text-green-300',
  scheduled: 'bg-purple-900/50 text-purple-300',
  waiting: 'bg-yellow-900/50 text-yellow-300',
  done: 'bg-emerald-900/50 text-emerald-300',
  canceled: 'bg-bg-tertiary text-text-muted line-through',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded text-xs font-medium',
        priorityColors[priority] ?? 'bg-bg-tertiary text-text-muted'
      )}
    >
      {priority}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const label = state.replace(/_/g, ' ');
  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded text-xs font-medium capitalize',
        stateColors[state] ?? 'bg-bg-tertiary text-text-muted'
      )}
    >
      {label}
    </span>
  );
}
