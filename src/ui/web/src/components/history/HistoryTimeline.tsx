import type { HistoryLog, HistoryEvent } from '../../types';

const eventMeta: Record<HistoryEvent, { label: string; color: string; dot: string }> = {
  goal_created:    { label: 'Created',            color: 'text-accent',         dot: 'bg-blue-500' },
  goal_updated:    { label: '',                    color: 'text-text-muted',     dot: 'bg-gray-500' },
  state_change:    { label: 'State changed',       color: 'text-purple-400',     dot: 'bg-purple-500' },
  priority_change: { label: 'Priority changed',    color: 'text-orange-400',     dot: 'bg-orange-500' },
  category_added:  { label: 'Added category',      color: 'text-success',        dot: 'bg-green-500' },
  category_removed:{ label: 'Removed category',    color: 'text-error',          dot: 'bg-red-500' },
  note_added:      { label: 'Added note',          color: 'text-teal-400',       dot: 'bg-teal-500' },
  note_edited:     { label: 'Edited note',         color: 'text-teal-300',       dot: 'bg-teal-400' },
  note_deleted:    { label: 'Deleted note',        color: 'text-error',          dot: 'bg-red-500' },
  todo_linked:     { label: 'Linked todo',         color: 'text-indigo-400',     dot: 'bg-indigo-500' },
  todo_unlinked:   { label: 'Unlinked todo',       color: 'text-text-muted',     dot: 'bg-gray-500' },
  archived:           { label: 'Archived',            color: 'text-text-muted',     dot: 'bg-gray-600' },
  unarchived:         { label: 'Unarchived',          color: 'text-text-secondary', dot: 'bg-gray-400' },
  promoted_from_todo: { label: 'Promoted from todo',  color: 'text-accent',         dot: 'bg-blue-500' },
};

function titleCase(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDetails(eventType: HistoryEvent, details: Record<string, unknown>): string | null {
  if (eventType === 'state_change' && details.from && details.to) {
    return `${titleCase(String(details.from))} → ${titleCase(String(details.to))}`;
  }
  if (eventType === 'priority_change' && details.from && details.to) {
    return `${titleCase(String(details.from))} → ${titleCase(String(details.to))}`;
  }
  if (eventType === 'category_added' && details.categoryName) {
    return String(details.categoryName);
  }
  if (eventType === 'category_removed' && details.categoryName) {
    return String(details.categoryName);
  }
  if (eventType === 'goal_created' && details.title) {
    return String(details.title);
  }
  if ((eventType === 'todo_linked' || eventType === 'todo_unlinked') && details.todoTitle) {
    return String(details.todoTitle);
  }
  return null;
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffHr < 1) return `${Math.max(1, diffMin)}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: diffDays > 365 ? 'numeric' : undefined,
  });
}

interface HistoryTimelineProps {
  entries: HistoryLog[];
}

export function HistoryTimeline({ entries }: HistoryTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-text-disabled py-4">No history yet.</p>
    );
  }

  const sorted = [...entries]
    .filter((e) => e.eventType !== 'goal_updated')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <ol className="relative border-l border-border-primary ml-2 flex flex-col gap-4">
      {sorted.map((entry) => {
        const meta = eventMeta[entry.eventType] ?? {
          label: entry.eventType.replace(/_/g, ' '),
          color: 'text-text-muted',
          dot: 'bg-gray-500',
        };
        const detail = formatDetails(entry.eventType, entry.details);

        return (
          <li key={entry.id} className="ml-4">
            <span
              className={`absolute -left-1.5 w-3 h-3 rounded-full border-2 border-bg-primary ${meta.dot}`}
            />
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
              {detail && (
                <span className="text-xs text-text-muted">{detail}</span>
              )}
              <span className="text-xs text-text-disabled ml-auto">{formatRelativeTime(entry.createdAt)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
