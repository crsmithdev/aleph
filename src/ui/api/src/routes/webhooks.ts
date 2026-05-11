import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { webhooks } from '../db/schema.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // GET / - list webhooks
  app.get('/', async () => {
    return app.db
      .select()
      .from(webhooks)
      .all()
      .map((w) => ({ ...w, events: JSON.parse(w.events) }));
  });

  // POST / - create webhook
  app.post<{ Body: { url: string; events: string[]; secret?: string } }>(
    '/',
    async (req, reply) => {
      const { url, events, secret } = req.body;

      if (!url || typeof url !== 'string') {
        return reply.status(400).send({ error: 'url is required' });
      }
      if (!Array.isArray(events) || events.length === 0) {
        return reply.status(400).send({ error: 'events must be a non-empty array' });
      }

      const id = nanoid();
      const now = new Date().toISOString();

      app.db
        .insert(webhooks)
        .values({
          id,
          url,
          events: JSON.stringify(events),
          secret: secret ?? null,
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      return reply.status(201).send({ id, url, events, secret: secret ?? null, active: true, createdAt: now, updatedAt: now });
    }
  );

  // PATCH /:id - update webhook
  app.patch<{
    Params: { id: string };
    Body: { url?: string; events?: string[]; secret?: string | null; active?: boolean };
  }>(
    '/:id',
    async (req, reply) => {
      const existing = app.db.select().from(webhooks).where(eq(webhooks.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Webhook not found' });

      const { url, events, secret, active } = req.body;
      const now = new Date().toISOString();

      const updateData: Partial<typeof webhooks.$inferInsert> = { updatedAt: now };
      if (url !== undefined) updateData.url = url;
      if (events !== undefined) updateData.events = JSON.stringify(events);
      if (secret !== undefined) updateData.secret = secret ?? null;
      if (active !== undefined) updateData.active = active;

      app.db.update(webhooks).set(updateData).where(eq(webhooks.id, req.params.id)).run();

      const merged = { ...existing, ...updateData };
      return { ...merged, events: JSON.parse(String(merged.events)) };
    }
  );

  // DELETE /:id - delete webhook
  app.delete<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const existing = app.db.select().from(webhooks).where(eq(webhooks.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Webhook not found' });

      app.db.delete(webhooks).where(eq(webhooks.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );
};
