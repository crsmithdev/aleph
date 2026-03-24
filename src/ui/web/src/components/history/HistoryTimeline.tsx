import type { HistoryLog, HistoryEvent } from '../../types';

const eventMeta: Record<HistoryEvent, { label: string; color: string; dot: string }> = {
  goal_created:    { label: 'Goal created',      color: 'text-accent',      dot: 'bg-blue-500' },
  goal_updated:    { label: 'Goal updated',       color: 'text-text-muted',  dot: 'bg-gray-500' },
  state_change:    { label: 'State changed',      color: 'text-purple-400',  dot: 'bg-purple-500' },
  priority_change: { label: 'Priority changed',   color: 'text-orange-400',  dot: 'bg-orange-500' },
  category_added:  { label: 'Category added',     color: 'text-success',     dot: 'bg-green-500' },
  category_removed:{ label: 'Category removed',   color: 'text-error',       dot: 'bg-red-500' },
  note_added:      { label: 'Note added',         color: 'text-teal-400',    dot: 'bg-teal-500' },
  note_edited:     { label: 'Note edited',        color: 'text-teal-300',    dot: 'bg-teal-400' },
  note_deleted:    { label: 'Note deleted',       color: 'text-error',       dot: 'bg-red-500' },
  todo_linked:     { label: 'Todo linked',        color: 'text-indigo-400',  dot: 'bg-indigo-500' },
  todo_unlinked:   { label: 'Todo unlinked',      color: 'text-text-muted',  dot: 'bg-gray-500' },
  archived:        { label: 'Archived',           color: 'text-text-muted',  dot: 'bg-gray-600' },
  unarchived:      { label: 'Unarchived',         color: 'text-text-secondary', dot: 'bg-gray-400' },
};

function formatDetails(eventType: HistoryEvent, details: Record<string, unknown>): string | null {
  if (eventType === 'state_change' && details.from && details.to) {
    return `${String(details.from).replace(/_/g, ' ')} → ${String(details.to).replace(/_/g, ' ')}`;
  }
  if (eventType === 'priority_change' && details.from && details.to) {
    return `${details.from} → ${details.to}`;
  }
  if (eventType === 'category_added' && details.categoryName) {
    return String(details.categoryName);
  }
  if (eventType === 'category_removed' && details.categoryName) {
    return String(details.categoryName);
  }
  if ((eventType === 'goal_updated' || eventType === 'goal_created') && details.title) {
    return String(details.title);
  }
  return null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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

  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

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
              <span className="text-xs text-text-disabled ml-auto">{formatTime(entry.createdAt)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
