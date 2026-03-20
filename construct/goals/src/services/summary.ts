import { and, gte, lte, sql, eq } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { goals, todos, notes, historyLogs } from '../schema.js';

export function getSummary(db: Db, start: string, end: string) {
  const startTs = `${start}T00:00:00.000Z`;
  const endTs = `${end}T23:59:59.999Z`;

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
    todosCompleted: { count: todosCompleted.length, items: todosCompleted },
    notesAdded: { count: notesAdded.length, items: notesAdded },
  };
}
