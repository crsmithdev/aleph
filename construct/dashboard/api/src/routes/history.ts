import type { FastifyPluginAsync } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { historyLogs, goals } from '../db/schema.js';

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>(
    '/:goalId/history',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const goal = app.db
        .select()
        .from(goals)
        .where(eq(goals.id, req.params.goalId))
        .get();
      if (!goal) return reply.status(404).send({ error: 'Goal not found' });

      const logs = app.db
        .select()
        .from(historyLogs)
        .where(eq(historyLogs.goalId, req.params.goalId))
        .orderBy(desc(historyLogs.createdAt))
        .all();

      return logs.map((log) => ({
        ...log,
        details: JSON.parse(log.details),
      }));
    }
  );
};
