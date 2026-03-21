import type { FastifyPluginAsync } from 'fastify';
import { getTodosActive, getTodosForDay, getTodo, createTodo, updateTodo, deleteTodo } from '@construct/goals';

export const todoRoutes: FastifyPluginAsync = async (app) => {
  app.get('/active', async () => {
    return getTodosActive(app.db);
  });

  app.get<{ Params: { date: string } }>('/day/:date', async (req, reply) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return reply.status(400).send({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    return getTodosForDay(app.db, req.params.date);
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = getTodo(app.db, req.params.id);
    if (!result) return reply.status(404).send({ error: 'Todo not found' });
    return result;
  });

  app.post('/', async (req, reply) => {
    try {
      const result = createTodo(app.db, req.body, app.eventBus);
      return reply.status(201).send(result);
    } catch (err: any) {
      if (err.message === 'Goal not found') return reply.status(400).send({ error: err.message });
      throw err;
    }
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    try {
      const result = updateTodo(app.db, req.params.id, req.body, app.eventBus);
      if (!result) return reply.status(404).send({ error: 'Todo not found' });
      return result;
    } catch (err: any) {
      if (err.message === 'Goal not found') return reply.status(400).send({ error: err.message });
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteTodo(app.db, req.params.id, app.eventBus);
    if (!ok) return reply.status(404).send({ error: 'Todo not found' });
    return reply.status(204).send();
  });
};
