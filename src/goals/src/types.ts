import type { Priority, GoalState, Frequency, HistoryEvent } from './constants.js';

export interface Goal {
  id: string;
  title: string;
  priority: Priority;
  state: GoalState;
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

export interface RecurringTodo {
  id: string;
  title: string;
  frequency: Frequency;
  goalId: string | null;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringTodoCompletion {
  id: string;
  recurringTodoId: string;
  periodKey: string;
  completedAt: string;
}

export interface HistoryLog {
  id: string;
  goalId: string;
  eventType: HistoryEvent;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface GoalWithMeta extends Goal {
  categories: Category[];
  latestNote: Note | null;
}
