import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { recurringTodos, recurringTodoCompletions } from '../schema.js';
import { createRecurringTodoSchema, updateRecurringTodoSchema } from '../validators.js';
import type { Frequency } from '../constants.js';
import { getPeriodKey, getPreviousPeriodKey } from './recurring.js';

function enrichWithPeriodStatus(db: Db, rt: typeof recurringTodos.$inferSelect, now: Date) {
  const frequency = rt.frequency as Frequency;
  const currentPeriod = getPeriodKey(now, frequency);
  const prevPeriod = getPreviousPeriodKey(now, frequency);

  const currentCompletion = db
    .select()
    .from(recurringTodoCompletions)
    .where(
      and(
        eq(recurringTodoCompletions.recurringTodoId, rt.id),
        eq(recurringTodoCompletions.periodKey, currentPeriod)
      )
    )
    .get();

  const prevCompletion = db
    .select()
    .from(recurringTodoCompletions)
    .where(
      and(
        eq(recurringTodoCompletions.recurringTodoId, rt.id),
        eq(recurringTodoCompletions.periodKey, prevPeriod)
      )
    )
    .get();

  return {
    ...rt,
    currentPeriodKey: currentPeriod,
    completedThisPeriod: !!currentCompletion,
    missedLastPeriod: !prevCompletion,
  };
}

export function listRecurringTodos(db: Db) {
  const now = new Date();
  return db.select().from(recurringTodos).all().map((rt) => enrichWithPeriodStatus(db, rt, now));
}

export function getRecurringTodo(db: Db, id: string) {
  const rt = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get();
  if (!rt) return null;
  return enrichWithPeriodStatus(db, rt, new Date());
}

export function createRecurringTodo(db: Db, input: unknown) {
  const data = createRecurringTodoSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  db.insert(recurringTodos)
    .values({
      id,
      title: data.title,
      frequency: data.frequency,
      goalId: data.goalId ?? null,
      endDate: data.endDate ?? null,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const created = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get()!;
  return enrichWithPeriodStatus(db, created, new Date());
}

export function updateRecurringTodo(db: Db, id: string, input: unknown) {
  const existing = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get();
  if (!existing) return null;

  const data = updateRecurringTodoSchema.parse(input);
  const now = new Date().toISOString();

  const updateData: Partial<typeof recurringTodos.$inferInsert> = { updatedAt: now };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.goalId !== undefined) updateData.goalId = data.goalId ?? null;
  if (data.endDate !== undefined) updateData.endDate = data.endDate ?? null;
  if (data.active !== undefined) updateData.active = data.active;

  db.update(recurringTodos).set(updateData).where(eq(recurringTodos.id, id)).run();

  const updated = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get()!;
  return enrichWithPeriodStatus(db, updated, new Date());
}

export function deleteRecurringTodo(db: Db, id: string): boolean {
  const existing = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get();
  if (!existing) return false;
  db.delete(recurringTodos).where(eq(recurringTodos.id, id)).run();
  return true;
}

export function completeRecurringTodo(db: Db, id: string, periodKey: string) {
  const rt = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get();
  if (!rt) return { error: 'not_found' as const };

  const existing = db
    .select()
    .from(recurringTodoCompletions)
    .where(
      and(
        eq(recurringTodoCompletions.recurringTodoId, rt.id),
        eq(recurringTodoCompletions.periodKey, periodKey)
      )
    )
    .get();

  if (existing) return { error: 'already_completed' as const };

  const completionId = nanoid();
  const now = new Date().toISOString();

  db.insert(recurringTodoCompletions)
    .values({ id: completionId, recurringTodoId: rt.id, periodKey, completedAt: now })
    .run();

  return db.select().from(recurringTodoCompletions).where(eq(recurringTodoCompletions.id, completionId)).get()!;
}

export function uncompleteRecurringTodo(db: Db, id: string, periodKey: string) {
  const rt = db.select().from(recurringTodos).where(eq(recurringTodos.id, id)).get();
  if (!rt) return { error: 'not_found' as const };

  const existing = db
    .select()
    .from(recurringTodoCompletions)
    .where(
      and(
        eq(recurringTodoCompletions.recurringTodoId, rt.id),
        eq(recurringTodoCompletions.periodKey, periodKey)
      )
    )
    .get();

  if (!existing) return { error: 'no_completion' as const };

  db.delete(recurringTodoCompletions).where(eq(recurringTodoCompletions.id, existing.id)).run();
  return { ok: true };
}
