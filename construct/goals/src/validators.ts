import { z } from 'zod';
import { PRIORITY, GOAL_STATE, FREQUENCY } from './constants.js';

export const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  priority: z.enum(PRIORITY).default('medium'),
  state: z.enum(GOAL_STATE).default('not_started'),
});

export const updateGoalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  priority: z.enum(PRIORITY).optional(),
  state: z.enum(GOAL_STATE).optional(),
  archived: z.boolean().optional(),
});

export const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

export const createNoteSchema = z.object({
  content: z.string().min(1),
});

export const updateNoteSchema = z.object({
  content: z.string().min(1),
});

export const createTodoSchema = z.object({
  title: z.string().min(1).max(200),
  note: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  goalId: z.string().nullable().optional(),
});

export const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  note: z.string().nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  goalId: z.string().nullable().optional(),
  done: z.boolean().optional(),
});

export const createRecurringTodoSchema = z.object({
  title: z.string().min(1).max(200),
  frequency: z.enum(FREQUENCY),
  goalId: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const updateRecurringTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  frequency: z.enum(FREQUENCY).optional(),
  goalId: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type CreateRecurringTodoInput = z.infer<typeof createRecurringTodoSchema>;
export type UpdateRecurringTodoInput = z.infer<typeof updateRecurringTodoSchema>;
