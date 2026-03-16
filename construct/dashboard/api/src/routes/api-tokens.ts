import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { apiTokens } from '../db/schema.js';
import { randomBytes, createHash } from 'crypto';

export const apiTokenRoutes: FastifyPluginAsync = async (app) => {
  // GET / - list tokens (never return the actual token)
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    return app.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .all();
  });

  // POST / - create token; returns raw token ONCE
  app.post<{ Body: { name: string } }>(
    '/',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { name } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.status(400).send({ error: 'name is required' });
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const id = nanoid();
      const now = new Date().toISOString();

      app.db
        .insert(apiTokens)
        .values({
          id,
          name: name.trim(),
          tokenHash,
          lastUsedAt: null,
          createdAt: now,
        })
        .run();

      return reply.status(201).send({
        id,
        name: name.trim(),
        token: rawToken,
        createdAt: now,
      });
    }
  );

  // DELETE /:id - revoke token
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Token not found' });

      app.db.delete(apiTokens).where(eq(apiTokens.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );
};
