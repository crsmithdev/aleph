import { and, gte, lte, sql, eq } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { goals, todos, notes, historyLogs, habits } from '../schema.js';

export function getSummary(db: Db, start: string, end: string, tzOffsetMinutes?: number) {
  // Adjust query boundaries for timezone: timestamps are stored as UTC ISO strings,
  // but start/end dates are in the user's local timezone.
  const offsetMs = (tzOffsetMinutes ?? 0) * 60 * 1000;
  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  startDate.setTime(startDate.getTime() + offsetMs);
  endDate.setTime(endDate.getTime() + offsetMs);
  const startTs = startDate.toISOString();
  const endTs = endDate.toISOString();

  const goalsCreated = db
    .select()
    .from(goals)
    .where(and(gte(goals.createdAt, startTs), lte(goals.createdAt, endTs)))
    .all();

  const goalsCompletedLogs = db
    .select()
    .from(historyLogs)
    .where(
      and(
        eq(historyLogs.eventType, 'state_change'),
        gte(historyLogs.createdAt, startTs),
        lte(historyLogs.createdAt, endTs),
        sql`json_extract(${historyLogs.details}, '$.newState') = 'done'`
      )
    )
    .all();

  const goalsStateChanged = db
    .select()
    .from(historyLogs)
    .where(
      and(
        eq(historyLogs.eventType, 'state_change'),
        gte(historyLogs.createdAt, startTs),
        lte(historyLogs.createdAt, endTs)
      )
    )
    .all();

  const todosCompleted = db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.done, true),
        gte(todos.updatedAt, startTs),
        lte(todos.updatedAt, endTs)
      )
    )
    .all();

  const todosCreated = db
    .select()
    .from(todos)
    .where(and(gte(todos.createdAt, startTs), lte(todos.createdAt, endTs)))
    .all();

  const habitsCreated = db
    .select()
    .from(habits)
    .where(and(gte(habits.createdAt, startTs), lte(habits.createdAt, endTs)))
    .all();

  const notesAdded = db
    .select()
    .from(notes)
    .where(and(gte(notes.createdAt, startTs), lte(notes.createdAt, endTs)))
    .all();

  return {
    range: { start, end },
    goalsCreated: { count: goalsCreated.length, items: goalsCreated },
    goalsCompleted: {
      count: goalsCompletedLogs.length,
      items: goalsCompletedLogs.map((l) => ({
        goalId: l.goalId,
        completedAt: l.createdAt,
        details: JSON.parse(l.details),
      })),
    },
    goalsStateChanged: {
      count: goalsStateChanged.length,
      items: goalsStateChanged.map((l) => ({
        goalId: l.goalId,
        changedAt: l.createdAt,
        details: JSON.parse(l.details),
      })),
    },
    todosCreated: { count: todosCreated.length, items: todosCreated },
    todosCompleted: { count: todosCompleted.length, items: todosCompleted },
    habitsCreated: { count: habitsCreated.length, items: habitsCreated },
    notesAdded: { count: notesAdded.length, items: notesAdded },
  };
}
