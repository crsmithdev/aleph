import type { FastifyPluginAsync } from 'fastify';
import { listCategories, getCategory, createCategory, updateCategory, deleteCategory } from '@aleph/goals';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => listCategories(app.db));

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = getCategory(app.db, req.params.id);
    if (!result) return reply.status(404).send({ error: 'Category not found' });
    return result;
  });

  app.post('/', async (req, reply) => {
    const result = createCategory(app.db, req.body);
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const result = updateCategory(app.db, req.params.id, req.body);
    if (!result) return reply.status(404).send({ error: 'Category not found' });
    return result;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const ok = deleteCategory(app.db, req.params.id);
    if (!ok) return reply.status(404).send({ error: 'Category not found' });
    return reply.status(204).send();
  });
};
