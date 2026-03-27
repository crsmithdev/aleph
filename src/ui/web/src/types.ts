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

export interface Goal {
  id: string;
  title: string;
  priority: string;
  state: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  goalId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: string;
  title: string;
  done: boolean;
  note: string | null;
  dueDate: string | null;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  title: string;
  frequency: string;
  goalId: string | null;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  completedThisPeriod: boolean;
  currentPeriodKey: string;
  missedLastPeriod: boolean;
}

export interface GoalMeta {
  categories?: Category[];
  latestNote?: { content: string } | null;
  todoCount?: number;
  noteCount?: number;
  habitCount?: number;
}

export interface HistoryLog {
  id: string;
  goalId: string;
  eventType: HistoryEvent;
  details: Record<string, unknown>;
  createdAt: string;
}
