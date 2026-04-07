import { clsx } from 'clsx';

export const priorityColors: Record<string, string> = {
  low: 'bg-bg-tertiary text-text-muted',
  medium: 'bg-accent/10 text-accent',
  high: 'bg-warning/15 text-warning',
  critical: 'bg-error/15 text-error',
};

export const stateColors: Record<string, string> = {
  not_started: 'bg-bg-tertiary text-text-muted',
  actionable: 'bg-success/15 text-success',
  scheduled: 'bg-accent/10 text-accent',
  waiting: 'bg-warning/15 text-warning',
  done: 'bg-success/15 text-success',
  canceled: 'bg-bg-tertiary text-text-muted line-through',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={clsx(
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
      className={clsx(
        'px-2 py-0.5 rounded text-xs font-medium capitalize',
        stateColors[state] ?? 'bg-bg-tertiary text-text-muted'
      )}
    >
      {label}
    </span>
  );
}
