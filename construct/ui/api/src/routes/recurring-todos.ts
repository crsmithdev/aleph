import type { FastifyPluginAsync } from 'fastify';
import {
  listRecurringTodos,
  getRecurringTodo,
  createRecurringTodo,
  updateRecurringTodo,
  deleteRecurringTodo,
  completeRecurringTodo,
  uncompleteRecurringTodo,
} from '@construct/goals';

export const recurringTodoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => listRecurringTodos(app.db));

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = getRecurringTodo(app.db, req.params.id);
    if (!result) return reply.status(404).send({ error: 'Recurring todo not found' });
    return result;
  });

  app.post('/', async (req, reply) => {
    const result = createRecurringTodo(app.db, req.body);
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = updateRecurringTodo(app.db, req.params.id, req.body);
    if (!result) return reply.status(404).send({ error: 'Recurring todo not found' });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteRecurringTodo(app.db, req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Recurring todo not found' });
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string }; Body: { periodKey: string } }>(
    '/:id/complete',
    async (req, reply) => {
      const { periodKey } = req.body;
      if (!periodKey) return reply.status(400).send({ error: 'periodKey is required' });
      const result = completeRecurringTodo(app.db, req.params.id, periodKey);
      if ('error' in result) {
        if (result.error === 'not_found') return reply.status(404).send({ error: 'Recurring todo not found' });
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
      const result = uncompleteRecurringTodo(app.db, req.params.id, periodKey);
      if ('error' in result) {
        if (result.error === 'not_found') return reply.status(404).send({ error: 'Recurring todo not found' });
        if (result.error === 'no_completion') return reply.status(404).send({ error: 'No completion found for this period' });
      }
      return result;
    }
  );
};
