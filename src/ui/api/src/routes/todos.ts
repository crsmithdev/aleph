import type { FastifyPluginAsync } from 'fastify';
import { getTodosActive, getTodosAll, getTodo, createTodo, updateTodo, deleteTodo, promoteTodoToGoal } from '@construct/goals';

export const todoRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { includeScheduled?: string } }>('/active', async (req) => {
    if (req.query.includeScheduled === 'true') {
      return getTodosAll(app.db);
    }
    return getTodosActive(app.db);
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

  app.post<{ Params: { id: string } }>('/:id/promote', async (req, reply) => {
    const result = promoteTodoToGoal(app.db, req.params.id, app.eventBus);
    if (!result) return reply.status(404).send({ error: 'Todo not found' });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteTodo(app.db, req.params.id, app.eventBus);
    if (!ok) return reply.status(404).send({ error: 'Todo not found' });
    return reply.status(204).send();
  });
};
