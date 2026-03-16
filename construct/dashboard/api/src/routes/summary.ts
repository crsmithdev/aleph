import type { FastifyPluginAsync } from 'fastify';
import { and, gte, lte, sql, eq } from 'drizzle-orm';
import { goals, todos, notes, historyLogs } from '../db/schema.js';

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  // GET / - summary over a date range
  app.get<{ Querystring: { start?: string; end?: string } }>(
    '/',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { start, end } = req.query;

      if (!start || !end) {
        return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
      }

      // Normalize to full ISO timestamps for range comparison
      const startTs = `${start}T00:00:00.000Z`;
      const endTs = `${end}T23:59:59.999Z`;

      // Goals created in range
      const goalsCreated = app.db
        .select()
        .from(goals)
        .where(and(gte(goals.createdAt, startTs), lte(goals.createdAt, endTs)))
        .all();

      // Goals completed (state changed to 'done') in range - from history logs
      const goalsCompletedLogs = app.db
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

      // Goals state changed in range (any state transition)
      const goalsStateChanged = app.db
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

      // Todos completed in range (done=true and updatedAt in range)
      const todosCompleted = app.db
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

      // Notes added in range
      const notesAdded = app.db
        .select()
        .from(notes)
        .where(and(gte(notes.createdAt, startTs), lte(notes.createdAt, endTs)))
        .all();

      return {
        range: { start, end },
        goalsCreated: {
          count: goalsCreated.length,
          items: goalsCreated,
        },
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
        todosCompleted: {
          count: todosCompleted.length,
          items: todosCompleted,
        },
        notesAdded: {
          count: notesAdded.length,
          items: notesAdded,
        },
      };
    }
  );
};
