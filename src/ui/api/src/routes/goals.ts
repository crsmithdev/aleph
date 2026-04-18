import type { FastifyPluginAsync } from 'fastify';
import { listGoals, getGoal, createGoal, updateGoal, deleteGoal, setCategories, linkGoals, unlinkGoals } from '@construct/goals';

export const goalRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { state?: string; priority?: string; category?: string; archived?: string } }>(
    '/',
    async (req) => listGoals(app.db, req.query)
  );

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = getGoal(app.db, req.params.id);
    if (!result) return reply.status(404).send({ error: 'Goal not found' });
    return result;
  });

  app.post('/', async (req, reply) => {
    const result = createGoal(app.db, req.body, app.eventBus);
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = updateGoal(app.db, req.params.id, req.body, app.eventBus);
    if (!result) return reply.status(404).send({ error: 'Goal not found' });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteGoal(app.db, req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Goal not found' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string }; Body: { linkedGoalId: string } }>(
    '/:id/links',
    async (req, reply) => {
      const { linkedGoalId } = req.body;
      if (!linkedGoalId) return reply.status(400).send({ error: 'linkedGoalId is required' });
      const ok = linkGoals(app.db, req.params.id, linkedGoalId);
      if (!ok) return reply.status(404).send({ error: 'Goal not found' });
      return reply.status(204).send();
    }
  );

  app.delete<{ Params: { id: string; otherId: string } }>(
    '/:id/links/:otherId',
    async (req, reply) => {
      unlinkGoals(app.db, req.params.id, req.params.otherId);
      return reply.status(204).send();
    }
  );

  app.put<{ Params: { id: string }; Body: { categoryIds: string[] } }>(
    '/:id/categories',
    async (req, reply) => {
      const { categoryIds } = req.body;
      if (!Array.isArray(categoryIds)) {
        return reply.status(400).send({ error: 'categoryIds must be an array' });
      }
      const result = setCategories(app.db, req.params.id, categoryIds, app.eventBus);
      if (!result) return reply.status(404).send({ error: 'Goal not found' });
      return result;
    }
  );
};
