import type { FastifyPluginAsync } from 'fastify';
import {
  listHabits,
  getHabit,
  createHabit,
  updateHabit,
  deleteHabit,
  completeHabit,
  uncompleteHabit,
} from '@aleph/goals';

export const habitRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => listHabits(app.db));

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = getHabit(app.db, req.params.id);
    if (!result) return reply.status(404).send({ error: 'Habit not found' });
    return result;
  });

  app.post('/', async (req, reply) => {
    const result = createHabit(app.db, req.body);
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = updateHabit(app.db, req.params.id, req.body);
    if (!result) return reply.status(404).send({ error: 'Habit not found' });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteHabit(app.db, req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Habit not found' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string }; Body: { periodKey: string } }>(
    '/:id/complete',
    async (req, reply) => {
      const { periodKey } = req.body;
      if (!periodKey) return reply.status(400).send({ error: 'periodKey is required' });
      const result = completeHabit(app.db, req.params.id, periodKey);
      if ('error' in result) {
        if (result.error === 'not_found') return reply.status(404).send({ error: 'Habit not found' });
        if (result.error === 'already_completed') return reply.status(409).send({ error: 'Already completed for this period' });
      }
      return result;
    }
  );

  app.post<{ Params: { id: string }; Body: { periodKey: string } }>(
    '/:id/uncomplete',
    async (req, reply) => {
      const { periodKey } = req.body;
      if (!periodKey) return reply.status(400).send({ error: 'periodKey is required' });
      const result = uncompleteHabit(app.db, req.params.id, periodKey);
      if ('error' in result) {
        if (result.error === 'not_found') return reply.status(404).send({ error: 'Habit not found' });
        if (result.error === 'no_completion') return reply.status(404).send({ error: 'No completion found for this period' });
      }
      return result;
    }
  );
};
