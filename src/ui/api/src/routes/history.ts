import type { FastifyPluginAsync } from 'fastify';
import { getGoal, getHistory, getCategory } from '@construct/goals';

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>('/:goalId/history', async (req, reply) => {
    const goal = getGoal(app.db, req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    const logs = getHistory(app.db, req.params.goalId);
    const catIds = new Set(
      logs.filter(l => l.eventType === 'category_added' || l.eventType === 'category_removed')
        .map(l => String((l.details as Record<string, unknown>).categoryId)).filter(Boolean)
    );
    const cats = new Map([...catIds].map(id => [id, getCategory(app.db, id)]));
    return logs.map((log) => {
      const details = log.details as Record<string, unknown>;
      if ((log.eventType === 'category_added' || log.eventType === 'category_removed') && details.categoryId && !details.categoryName) {
        const cat = cats.get(String(details.categoryId));
        if (cat) details.categoryName = cat.name;
      }
      return { ...log, details };
    });
  });
};
