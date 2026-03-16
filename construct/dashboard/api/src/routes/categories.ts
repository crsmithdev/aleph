import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { categories } from '../db/schema.js';
import { createCategorySchema, updateCategorySchema } from '@goal-tracker/shared';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: [app.authenticate] }, async (_req, _reply) => {
    return app.db.select().from(categories).all();
  });

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const cat = app.db
        .select()
        .from(categories)
        .where(eq(categories.id, req.params.id))
        .get();
      if (!cat) return reply.status(404).send({ error: 'Category not found' });
      return cat;
    }
  );

  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = createCategorySchema.parse(req.body);
    const id = nanoid();
    const now = new Date().toISOString();
    app.db.insert(categories).values({ id, ...data, createdAt: now }).run();
    const created = app.db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .get();
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const data = updateCategorySchema.parse(req.body);
      const existing = app.db
        .select()
        .from(categories)
        .where(eq(categories.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Category not found' });
      app.db
        .update(categories)
        .set(data)
        .where(eq(categories.id, req.params.id))
        .run();
      return app.db
        .select()
        .from(categories)
        .where(eq(categories.id, req.params.id))
        .get();
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(categories)
        .where(eq(categories.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Category not found' });
      app.db.delete(categories).where(eq(categories.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );
};
