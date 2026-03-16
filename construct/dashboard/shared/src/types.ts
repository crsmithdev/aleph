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

export interface WebAuthnCredential {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  createdAt: string;
}

export interface ApiToken {
  id: string;
  name: string;
  tokenHash: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
