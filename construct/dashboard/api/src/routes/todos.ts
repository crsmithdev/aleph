import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq, and, or, lte, isNull, sql } from 'drizzle-orm';
import { todos, goals } from '../db/schema.js';
import { createTodoSchema, updateTodoSchema } from '@goal-tracker/shared';

export const todoRoutes: FastifyPluginAsync = async (app) => {
  // GET /day/:date - todos for a specific date
  app.get<{ Params: { date: string } }>(
    '/day/:date',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { date } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return reply.status(400).send({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      // 1. Undone todos with dueDate <= date
      const undoneDue = app.db
        .select()
        .from(todos)
        .where(and(eq(todos.done, false), lte(todos.dueDate, date)))
        .all();

      // 2. Undone todos with null dueDate and createdAt date <= date
      const undoneNoDue = app.db
        .select()
        .from(todos)
        .where(
          and(
            eq(todos.done, false),
            isNull(todos.dueDate),
            lte(sql`substr(${todos.createdAt}, 1, 10)`, date)
          )
        )
        .all();

      // 3. Todos completed on this date (updatedAt starts with date)
      const completedToday = app.db
        .select()
        .from(todos)
        .where(
          and(
            eq(todos.done, true),
            sql`substr(${todos.updatedAt}, 1, 10) = ${date}`
          )
        )
        .all();

      // Merge undone lists (deduplicate by id)
      const undoneMap = new Map<string, typeof todos.$inferSelect>();
      for (const t of [...undoneDue, ...undoneNoDue]) {
        undoneMap.set(t.id, t);
      }

      // Fetch goal titles for linked todos
      const allTodos = [...undoneMap.values(), ...completedToday];
      const goalIds = [...new Set(allTodos.map((t) => t.goalId).filter(Boolean))] as string[];

      const goalTitles = new Map<string, string>();
      if (goalIds.length > 0) {
        for (const goalId of goalIds) {
          const goal = app.db.select({ id: goals.id, title: goals.title }).from(goals).where(eq(goals.id, goalId)).get();
          if (goal) goalTitles.set(goal.id, goal.title);
        }
      }

      const enrichTodo = (t: typeof todos.$inferSelect) => ({
        ...t,
        goalTitle: t.goalId ? (goalTitles.get(t.goalId) ?? null) : null,
      });

      const undoneList = [...undoneMap.values()].map(enrichTodo);
      const overdue = undoneList.filter((t) => t.dueDate && t.dueDate < date);
      const dueTodayOrNoDue = undoneList.filter((t) => !t.dueDate || t.dueDate === date);

      return {
        overdue,
        todos: dueTodayOrNoDue,
        completed: completedToday.map(enrichTodo),
      };
    }
  );

  // GET /:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const todo = app.db.select().from(todos).where(eq(todos.id, req.params.id)).get();
      if (!todo) return reply.status(404).send({ error: 'Todo not found' });
      return todo;
    }
  );

  // POST /
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = createTodoSchema.parse(req.body);
    const id = nanoid();
    const now = new Date().toISOString();

    if (data.goalId) {
      const goal = app.db.select().from(goals).where(eq(goals.id, data.goalId)).get();
      if (!goal) return reply.status(400).send({ error: 'Goal not found' });
    }

    app.db
      .insert(todos)
      .values({
        id,
        title: data.title,
        note: data.note ?? null,
        dueDate: data.dueDate ?? null,
        goalId: data.goalId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    if (data.goalId) {
      app.eventBus.emitMutation({
        type: 'todo_linked',
        goalId: data.goalId,
        details: { todoId: id, todoTitle: data.title },
        timestamp: now,
      });
    }

    const created = app.db.select().from(todos).where(eq(todos.id, id)).get();
    return reply.status(201).send(created);
  });

  // PATCH /:id
  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db.select().from(todos).where(eq(todos.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Todo not found' });

      const data = updateTodoSchema.parse(req.body);
      const now = new Date().toISOString();

      if (data.goalId !== undefined && data.goalId !== existing.goalId) {
        // Unlink from old goal
        if (existing.goalId) {
          app.eventBus.emitMutation({
            type: 'todo_unlinked',
            goalId: existing.goalId,
            details: { todoId: existing.id, todoTitle: existing.title },
            timestamp: now,
          });
        }
        // Link to new goal
        if (data.goalId) {
          const goal = app.db.select().from(goals).where(eq(goals.id, data.goalId)).get();
          if (!goal) return reply.status(400).send({ error: 'Goal not found' });
          app.eventBus.emitMutation({
            type: 'todo_linked',
            goalId: data.goalId,
            details: { todoId: existing.id, todoTitle: data.title ?? existing.title },
            timestamp: now,
          });
        }
      }

      const updateData: Partial<typeof todos.$inferInsert> = { updatedAt: now };
      if (data.title !== undefined) updateData.title = data.title;
      if (data.done !== undefined) updateData.done = data.done;
      if (data.note !== undefined) updateData.note = data.note ?? null;
      if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ?? null;
      if (data.goalId !== undefined) updateData.goalId = data.goalId ?? null;

      app.db.update(todos).set(updateData).where(eq(todos.id, req.params.id)).run();

      return app.db.select().from(todos).where(eq(todos.id, req.params.id)).get();
    }
  );

  // DELETE /:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db.select().from(todos).where(eq(todos.id, req.params.id)).get();
      if (!existing) return reply.status(404).send({ error: 'Todo not found' });

      if (existing.goalId) {
        app.eventBus.emitMutation({
          type: 'todo_unlinked',
          goalId: existing.goalId,
          details: { todoId: existing.id, todoTitle: existing.title },
          timestamp: new Date().toISOString(),
        });
      }

      app.db.delete(todos).where(eq(todos.id, req.params.id)).run();
      return reply.status(204).send();
    }
  );
};
