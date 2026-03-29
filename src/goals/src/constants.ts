export const PRIORITY = ['low', 'medium', 'high', 'critical'] as const;
export type Priority = typeof PRIORITY[number];

export const GOAL_STATE = ['not_started', 'actionable', 'scheduled', 'waiting', 'done', 'canceled'] as const;
export type GoalState = typeof GOAL_STATE[number];

export const FREQUENCY = ['daily', 'weekly', 'monthly'] as const;
export type Frequency = typeof FREQUENCY[number];

export const HISTORY_EVENT = [
  'state_change', 'priority_change', 'category_added', 'category_removed',
  'note_added', 'note_edited', 'note_deleted', 'todo_linked', 'todo_unlinked',
  'archived', 'unarchived', 'goal_created', 'goal_updated', 'promoted_from_todo'
] as const;
export type HistoryEvent = typeof HISTORY_EVENT[number];
