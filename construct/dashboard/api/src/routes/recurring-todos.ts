import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { recurringTodos, recurringTodoCompletions } from '../db/schema.js';
import { createRecurringTodoSchema, updateRecurringTodoSchema } from '@goal-tracker/shared';
import type { Frequency } from '@goal-tracker/shared';
import { getPeriodKey, getPreviousPeriodKey } from '../services/recurring.js';

export const recurringTodoRoutes: FastifyPluginAsync = async (app) => {
  function enrichWithPeriodStatus(rt: typeof recurringTodos.$inferSelect, now: Date) {
    const frequency = rt.frequency as Frequency;
    const currentPeriod = getPeriodKey(now, frequency);
    const prevPeriod = getPreviousPeriodKey(now, frequency);

    const currentCompletion = app.db
      .select()
      .from(recurringTodoCompletions)
      .where(
        and(
          eq(recurringTodoCompletions.recurringTodoId, rt.id),
          eq(recurringTodoCompletions.periodKey, currentPeriod)
        )
      )
      .get();

    const prevCompletion = app.db
      .select()
      .from(recurringTodoCompletions)
      .where(
        and(
          eq(recurringTodoCompletions.recurringTodoId, rt.id),
          eq(recurringTodoCompletions.periodKey, prevPeriod)
        )
      )
      .get();

    return {
      ...rt,
      currentPeriodKey: currentPeriod,
      completedThisPeriod: !!currentCompletion,
      missedLastPeriod: !prevCompletion,
    };
  }

  // GET / - list all recurring todos with period status
  app.get('/', { preHandler: [app.authenticate] }, async () => {
    const now = new Date();
    const all = app.db.select().from(recurringTodos).all();
    return all.map((rt) => enrichWithPeriodStatus(rt, now));
  });

  // GET /:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const rt = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get();
      if (!rt) return reply.status(404).send({ error: 'Recurring todo not found' });
      return enrichWithPeriodStatus(rt, new Date());
    }
  );

  // POST /
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = createRecurringTodoSchema.parse(req.body);
    const id = nanoid();
    const now = new Date().toISOString();

    app.db
      .insert(recurringTodos)
      .values({
        id,
        title: data.title,
        frequency: data.frequency,
        goalId: data.goalId ?? null,
        endDate: data.endDate ?? null,
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = app.db
      .select()
      .from(recurringTodos)
      .where(eq(recurringTodos.id, id))
      .get()!;

    return reply.status(201).send(enrichWithPeriodStatus(created, new Date()));
  });

  // PATCH /:id
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Recurring todo not found' });

      const data = updateRecurringTodoSchema.parse(req.body);
      const now = new Date().toISOString();

      const updateData: Partial<typeof recurringTodos.$inferInsert> = { updatedAt: now };
      if (data.title !== undefined) updateData.title = data.title;
      if (data.frequency !== undefined) updateData.frequency = data.frequency;
      if (data.goalId !== undefined) updateData.goalId = data.goalId ?? null;
      if (data.endDate !== undefined) updateData.endDate = data.endDate ?? null;
      if (data.active !== undefined) updateData.active = data.active;

      app.db.update(recurringTodos).set(updateData).where(eq(recurringTodos.id, req.params.id)).run();

      const updated = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get()!;

      return enrichWithPeriodStatus(updated, new Date());
    }
  );

  // DELETE /:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Recurring todo not found' });

      app.db.delete(recurringTodos).where(eq(recurringTodos.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );

  // POST /:id/complete
  app.post<{ Params: { id: string }; Body: { periodKey: string } }>(
    '/:id/complete',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const rt = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get();
      if (!rt) return reply.status(404).send({ error: 'Recurring todo not found' });

      const { periodKey } = req.body;
      if (!periodKey) return reply.status(400).send({ error: 'periodKey is required' });

      // Check if already completed
      const existing = app.db
        .select()
        .from(recurringTodoCompletions)
        .where(
          and(
            eq(recurringTodoCompletions.recurringTodoId, rt.id),
            eq(recurringTodoCompletions.periodKey, periodKey)
          )
        )
        .get();

      if (existing) {
        return reply.status(409).send({ error: 'Already completed for this period' });
      }

      const id = nanoid();
      const now = new Date().toISOString();

      app.db
        .insert(recurringTodoCompletions)
        .values({
          id,
          recurringTodoId: rt.id,
          periodKey,
          completedAt: now,
        })
        .run();

      return app.db
        .select()
        .from(recurringTodoCompletions)
        .where(eq(recurringTodoCompletions.id, id))
        .get();
    }
  );

  // POST /:id/uncomplete
  app.post<{ Params: { id: string }; Body: { periodKey: string } }>(
    '/:id/uncomplete',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const rt = app.db
        .select()
        .from(recurringTodos)
        .where(eq(recurringTodos.id, req.params.id))
        .get();
      if (!rt) return reply.status(404).send({ error: 'Recurring todo not found' });

      const { periodKey } = req.body;
      if (!periodKey) return reply.status(400).send({ error: 'periodKey is required' });

      const existing = app.db
        .select()
        .from(recurringTodoCompletions)
        .where(
          and(
            eq(recurringTodoCompletions.recurringTodoId, rt.id),
            eq(recurringTodoCompletions.periodKey, periodKey)
          )
        )
        .get();

      if (!existing) {
        return reply.status(404).send({ error: 'No completion found for this period' });
      }

      app.db
        .delete(recurringTodoCompletions)
        .where(eq(recurringTodoCompletions.id, existing.id))
        .run();

      return { ok: true };
    }
  );
};
