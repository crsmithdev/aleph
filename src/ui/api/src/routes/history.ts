import type { FastifyPluginAsync } from 'fastify';
import { getGoal, getHistory, getCategory } from '@construct/goals';

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>('/:goalId/history', async (req, reply) => {
    const goal = getGoal(app.db, req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const logs = getHistory(app.db, req.params.goalId);
    return logs.map((log) => {
      const details = log.details as Record<string, unknown>;
      if ((log.eventType === 'category_added' || log.eventType === 'category_removed') && details.categoryId && !details.categoryName) {
        const cat = getCategory(app.db, String(details.categoryId));
        if (cat) details.categoryName = cat.name;
      }
      return { ...log, details };
    });
  });
};
