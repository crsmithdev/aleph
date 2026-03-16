import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq, inArray, desc } from 'drizzle-orm';
import { goals, goalCategories, categories, notes } from '../db/schema.js';
import { createGoalSchema, updateGoalSchema } from '@goal-tracker/shared';

type GoalRow = typeof goals.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

interface GoalWithMeta extends GoalRow {
  categories: CategoryRow[];
  latestNote: (typeof notes.$inferSelect) | null;
}

async function attachMeta(
  app: Parameters<FastifyPluginAsync>[0],
  goalRows: GoalRow[]
): Promise<GoalWithMeta[]> {
  if (goalRows.length === 0) return [];

  const ids = goalRows.map((g) => g.id);

  const gcRows = app.db
    .select({ goalId: goalCategories.goalId, categoryId: goalCategories.categoryId })
    .from(goalCategories)
    .where(inArray(goalCategories.goalId, ids))
    .all();

  const categoryIds = [...new Set(gcRows.map((r) => r.categoryId))];
  const catRows: CategoryRow[] =
    categoryIds.length > 0
      ? app.db.select().from(categories).where(inArray(categories.id, categoryIds)).all()
      : [];

  const catById = new Map(catRows.map((c) => [c.id, c]));
  const catsByGoal = new Map<string, CategoryRow[]>();
  for (const gc of gcRows) {
    const cat = catById.get(gc.categoryId);
    if (cat) {
      const list = catsByGoal.get(gc.goalId) ?? [];
      list.push(cat);
      catsByGoal.set(gc.goalId, list);
    }
  }

  const noteRows = app.db
    .select()
    .from(notes)
    .where(inArray(notes.goalId, ids))
    .orderBy(desc(notes.createdAt))
    .all();

  const latestNoteByGoal = new Map<string, typeof notes.$inferSelect>();
  for (const note of noteRows) {
    if (!latestNoteByGoal.has(note.goalId)) {
      latestNoteByGoal.set(note.goalId, note);
    }
  }

  return goalRows.map((g) => ({
    ...g,
    categories: catsByGoal.get(g.id) ?? [],
    latestNote: latestNoteByGoal.get(g.id) ?? null,
  }));
}

export const goalRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      state?: string;
      priority?: string;
      category?: string;
      archived?: string;
    };
  }>('/', { preHandler: [app.authenticate] }, async (req, _reply) => {
    const { state, priority, category, archived } = req.query;

    let rows = app.db.select().from(goals).all();

    // Filter archived; default false
    const showArchived = archived === 'true' ? true : archived === 'false' ? false : false;
    rows = rows.filter((g) => g.archived === showArchived);

    if (state) rows = rows.filter((g) => g.state === state);
    if (priority) rows = rows.filter((g) => g.priority === priority);

    if (category) {
      const gcRows = app.db
        .select({ goalId: goalCategories.goalId })
        .from(goalCategories)
        .where(eq(goalCategories.categoryId, category))
        .all();
      const goalIdSet = new Set(gcRows.map((r) => r.goalId));
      rows = rows.filter((g) => goalIdSet.has(g.id));
    }

    return attachMeta(app, rows);
  });

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const goal = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get();
      if (!goal) return reply.status(404).send({ error: 'Goal not found' });
      const [withMeta] = await attachMeta(app, [goal]);
      return withMeta;
    }
  );

  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = createGoalSchema.parse(req.body);
    const id = nanoid();
    const now = new Date().toISOString();

    app.db
      .insert(goals)
      .values({ id, ...data, createdAt: now, updatedAt: now })
      .run();

    app.eventBus.emitMutation({
      type: 'goal_created',
      goalId: id,
      details: { title: data.title, priority: data.priority, state: data.state },
      timestamp: now,
    });

    const goal = app.db.select().from(goals).where(eq(goals.id, id)).get()!;
    const [withMeta] = await attachMeta(app, [goal]);
    return reply.status(201).send(withMeta);
  });

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Goal not found' });

      const data = updateGoalSchema.parse(req.body);
      const now = new Date().toISOString();

      app.db
        .update(goals)
        .set({ ...data, updatedAt: now })
        .where(eq(goals.id, req.params.id))
        .run();

      // Emit specific events for notable changes
      if (data.state !== undefined && data.state !== existing.state) {
        app.eventBus.emitMutation({
          type: 'state_change',
          goalId: req.params.id,
          details: { from: existing.state, to: data.state },
          timestamp: now,
        });
      }

      if (data.priority !== undefined && data.priority !== existing.priority) {
        app.eventBus.emitMutation({
          type: 'priority_change',
          goalId: req.params.id,
          details: { from: existing.priority, to: data.priority },
          timestamp: now,
        });
      }

      if (data.archived !== undefined && data.archived !== existing.archived) {
        app.eventBus.emitMutation({
          type: data.archived ? 'archived' : 'unarchived',
          goalId: req.params.id,
          details: {},
          timestamp: now,
        });
      }

      // Always emit a generic update event
      app.eventBus.emitMutation({
        type: 'goal_updated',
        goalId: req.params.id,
        details: data,
        timestamp: now,
      });

      const updated = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get()!;
      const [withMeta] = await attachMeta(app, [updated]);
      return withMeta;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Goal not found' });
      app.db.delete(goals).where(eq(goals.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );

  app.put<{ Params: { id: string }; Body: { categoryIds: string[] } }>(
    '/:id/categories',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const goal = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get();
      if (!goal) return reply.status(404).send({ error: 'Goal not found' });

      const { categoryIds } = req.body;
      if (!Array.isArray(categoryIds)) {
        return reply.status(400).send({ error: 'categoryIds must be an array' });
      }

      const now = new Date().toISOString();

      // Fetch existing associations to diff
      const existingGc = app.db
        .select()
        .from(goalCategories)
        .where(eq(goalCategories.goalId, req.params.id))
        .all();
      const existingIds = new Set(existingGc.map((r) => r.categoryId));
      const newIds = new Set(categoryIds);

      const added = categoryIds.filter((id) => !existingIds.has(id));
      const removed = [...existingIds].filter((id) => !newIds.has(id));

      // Replace all associations
      app.db.delete(goalCategories).where(eq(goalCategories.goalId, req.params.id)).run();

      if (categoryIds.length > 0) {
        app.db
          .insert(goalCategories)
          .values(categoryIds.map((categoryId) => ({ goalId: req.params.id, categoryId })))
          .run();
      }

      for (const categoryId of added) {
        app.eventBus.emitMutation({
          type: 'category_added',
          goalId: req.params.id,
          details: { categoryId },
          timestamp: now,
        });
      }

      for (const categoryId of removed) {
        app.eventBus.emitMutation({
          type: 'category_removed',
          goalId: req.params.id,
          details: { categoryId },
          timestamp: now,
        });
      }

      const updated = app.db.select().from(goals).where(eq(goals.id, req.params.id)).get()!;
      const [withMeta] = await attachMeta(app, [updated]);
      return withMeta;
    }
  );
};
