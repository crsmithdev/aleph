import { nanoid } from 'nanoid';
import { eq, and, inArray } from 'drizzle-orm';
import type { Db } from '@aleph/data';
import { habits, habitCompletions } from '../schema.js';
import { createHabitSchema, updateHabitSchema } from '../validators.js';
import type { Frequency } from '../constants.js';
import { getPeriodKey, getPreviousPeriodKey, getRecentPeriodKeys } from './recurring.js';

const HISTORY_PERIODS = 28;

function enrichWithPeriodStatus(db: Db, habit: typeof habits.$inferSelect, now: Date) {
  const frequency = habit.frequency as Frequency;
  const currentPeriod = getPeriodKey(now, frequency);
  const prevPeriod = getPreviousPeriodKey(now, frequency);
  const recentKeys = getRecentPeriodKeys(now, frequency, HISTORY_PERIODS);

  const completedKeys = new Set(
    db
      .select({ periodKey: habitCompletions.periodKey })
      .from(habitCompletions)
      .where(
        and(
          eq(habitCompletions.habitId, habit.id),
          inArray(habitCompletions.periodKey, recentKeys),
        ),
      )
      .all()
      .map((r) => r.periodKey),
  );

  const history = recentKeys.map((periodKey) => ({
    periodKey,
    completed: completedKeys.has(periodKey),
  }));

  // Streak = consecutive completed periods ending at the current period
  // (or, if the current isn't done yet, the previous period). Stops at the
  // first miss.
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const cell = history[i];
    if (cell.completed) {
      streak++;
    } else if (cell.periodKey === currentPeriod) {
      // Current period not yet done — don't reset, just keep walking.
      continue;
    } else {
      break;
    }
  }

  return {
    ...habit,
    currentPeriodKey: currentPeriod,
    completedThisPeriod: completedKeys.has(currentPeriod),
    missedLastPeriod: !completedKeys.has(prevPeriod),
    streak,
    history,
  };
}

export function listHabits(db: Db) {
  const now = new Date();
  return db.select().from(habits).all().map((h) => enrichWithPeriodStatus(db, h, now));
}

export function getHabit(db: Db, id: string) {
  const habit = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!habit) return null;
  return enrichWithPeriodStatus(db, habit, new Date());
}

export function createHabit(db: Db, input: unknown) {
  const data = createHabitSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  db.insert(habits)
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

  const created = db.select().from(habits).where(eq(habits.id, id)).get()!;
  return enrichWithPeriodStatus(db, created, new Date());
}

export function updateHabit(db: Db, id: string, input: unknown) {
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!existing) return null;

  const data = updateHabitSchema.parse(input);
  const now = new Date().toISOString();

  const updateData: Partial<typeof habits.$inferInsert> = { updatedAt: now };
  if (data.title !== undefined) updateData.title = data.title;
  if (data.frequency !== undefined) updateData.frequency = data.frequency;
  if (data.goalId !== undefined) updateData.goalId = data.goalId ?? null;
  if (data.endDate !== undefined) updateData.endDate = data.endDate ?? null;
  if (data.active !== undefined) updateData.active = data.active;

  db.update(habits).set(updateData).where(eq(habits.id, id)).run();

  const updated = db.select().from(habits).where(eq(habits.id, id)).get()!;
  return enrichWithPeriodStatus(db, updated, new Date());
}

export function deleteHabit(db: Db, id: string): boolean {
  const existing = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!existing) return false;
  db.delete(habits).where(eq(habits.id, id)).run();
  return true;
}

export function completeHabit(db: Db, id: string, periodKey: string) {
  const habit = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!habit) return { error: 'not_found' as const };

  const existing = db
    .select()
    .from(habitCompletions)
    .where(
      and(
        eq(habitCompletions.habitId, habit.id),
        eq(habitCompletions.periodKey, periodKey)
      )
    )
    .get();

  if (existing) return { error: 'already_completed' as const };

  const completionId = nanoid();
  const now = new Date().toISOString();

  db.insert(habitCompletions)
    .values({ id: completionId, habitId: habit.id, periodKey, completedAt: now })
    .run();

  return db.select().from(habitCompletions).where(eq(habitCompletions.id, completionId)).get()!;
}

export function uncompleteHabit(db: Db, id: string, periodKey: string) {
  const habit = db.select().from(habits).where(eq(habits.id, id)).get();
  if (!habit) return { error: 'not_found' as const };

  const existing = db
    .select()
    .from(habitCompletions)
    .where(
      and(
        eq(habitCompletions.habitId, habit.id),
        eq(habitCompletions.periodKey, periodKey)
      )
    )
    .get();

  if (!existing) return { error: 'no_completion' as const };

  db.delete(habitCompletions).where(eq(habitCompletions.id, existing.id)).run();
  return { ok: true };
}
