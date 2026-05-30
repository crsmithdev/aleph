import type { FastifyPluginAsync } from 'fastify';
import { getGoal, getHistory } from '@aleph/goals';

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>('/:goalId/history', async (req, reply) => {
    const goal = getGoal(app.db, req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    return getHistory(app.db, req.params.goalId);
  });
};
