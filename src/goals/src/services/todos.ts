import { nanoid } from 'nanoid';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { todos, goals, notes } from '../schema.js';
import { createTodoSchema, updateTodoSchema } from '../validators.js';
import type { EventBus } from './event-bus.js';
import { attachMeta } from './goals.js';
import type { GoalWithMeta } from '../types.js';

function enrichTodos(db: Db, todoList: (typeof todos.$inferSelect)[]) {
  const goalIds = [...new Set(todoList.map((t) => t.goalId).filter(Boolean))] as string[];
  const goalTitles = new Map<string, string>();
  for (const goalId of goalIds) {
    const goal = db.select({ id: goals.id, title: goals.title }).from(goals).where(eq(goals.id, goalId)).get();
    if (goal) goalTitles.set(goal.id, goal.title);
  }
  return todoList.map((t) => ({
    ...t,
    dueDate: t.dueDate ?? null,
    goalTitle: t.goalId ? (goalTitles.get(t.goalId) ?? null) : null,
  }));
}

export function getTodosActive(db: Db) {
  const today = new Date().toISOString().slice(0, 10);

  const allUndone = db.select().from(todos).where(eq(todos.done, false)).orderBy(todos.createdAt).all();
  const activeTodos = allUndone.filter((t) => !t.dueDate || t.dueDate <= today);

  const completedToday = db
    .select()
    .from(todos)
    .where(and(eq(todos.done, true), sql`substr(${todos.updatedAt}, 1, 10) = ${today}`))
    .orderBy(desc(todos.updatedAt))
    .all();

  return {
    active: enrichTodos(db, activeTodos),
    completed: enrichTodos(db, completedToday),
  };
}

export function getTodosAll(db: Db) {
  const today = new Date().toISOString().slice(0, 10);

  const activeTodos = db.select().from(todos).where(eq(todos.done, false)).orderBy(todos.createdAt).all();
  const completedToday = db
    .select()
    .from(todos)
    .where(and(eq(todos.done, true), sql`substr(${todos.updatedAt}, 1, 10) = ${today}`))
    .orderBy(desc(todos.updatedAt))
    .all();

  return {
    active: enrichTodos(db, activeTodos),
    completed: enrichTodos(db, completedToday),
  };
}

export function getTodosForDay(db: Db, date: string) {
  const undone = db
    .select()
    .from(todos)
    .where(eq(todos.done, false))
    .all();

  const completedToday = db
    .select()
    .from(todos)
    .where(
      and(
        eq(todos.done, true),
        sql`substr(${todos.updatedAt}, 1, 10) = ${date}`
      )
    )
    .all();

  const allTodos = [...undone, ...completedToday];
  const goalIds = [...new Set(allTodos.map((t) => t.goalId).filter(Boolean))] as string[];

  const goalTitles = new Map<string, string>();
  for (const goalId of goalIds) {
    const goal = db.select({ id: goals.id, title: goals.title }).from(goals).where(eq(goals.id, goalId)).get();
    if (goal) goalTitles.set(goal.id, goal.title);
  }

  const enrichTodo = (t: typeof todos.$inferSelect) => ({
    ...t,
    goalTitle: t.goalId ? (goalTitles.get(t.goalId) ?? null) : null,
  });

  return {
    todos: undone.map(enrichTodo),
    completed: completedToday.map(enrichTodo),
  };
}

export function getTodo(db: Db, id: string) {
  return db.select().from(todos).where(eq(todos.id, id)).get() ?? null;
}

export function createTodo(db: Db, input: unknown, eventBus?: EventBus) {
  const data = createTodoSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  if (data.goalId) {
    const goal = db.select().from(goals).where(eq(goals.id, data.goalId)).get();
    if (!goal) throw new Error('Goal not found');
  }

  db.insert(todos)
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
    eventBus?.emitMutation({
      type: 'todo_linked',
      goalId: data.goalId,
      details: { todoId: id, todoTitle: data.title },
      timestamp: now,
    });
  }

  return db.select().from(todos).where(eq(todos.id, id)).get()!;
}

export function updateTodo(db: Db, id: string, input: unknown, eventBus?: EventBus) {
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) return null;

  const data = updateTodoSchema.parse(input);
  const now = new Date().toISOString();

  if (data.goalId !== undefined && data.goalId !== existing.goalId) {
    if (existing.goalId) {
      eventBus?.emitMutation({
        type: 'todo_unlinked',
        goalId: existing.goalId,
        details: { todoId: existing.id, todoTitle: existing.title },
        timestamp: now,
      });
    }
    if (data.goalId) {
      const goal = db.select().from(goals).where(eq(goals.id, data.goalId)).get();
      if (!goal) throw new Error('Goal not found');
      eventBus?.emitMutation({
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

  db.update(todos).set(updateData).where(eq(todos.id, id)).run();

  return db.select().from(todos).where(eq(todos.id, id)).get()!;
}

export function promoteTodoToGoal(db: Db, id: string, eventBus?: EventBus): GoalWithMeta | null {
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) return null;

  const now = new Date().toISOString();
  const goalId = nanoid();

  if (existing.goalId) {
    eventBus?.emitMutation({
      type: 'todo_unlinked',
      goalId: existing.goalId,
      details: { todoId: existing.id, todoTitle: existing.title },
      timestamp: now,
    });
  }

  db.insert(goals).values({
    id: goalId,
    title: existing.title,
    priority: 'medium',
    state: 'not_started',
    archived: false,
    createdAt: existing.createdAt,
    updatedAt: now,
  }).run();

  if (existing.note) {
    db.insert(notes).values({
      id: nanoid(),
      goalId,
      content: existing.note,
      createdAt: existing.createdAt,
      updatedAt: now,
    }).run();
  }

  eventBus?.emitMutation({
    type: 'promoted_from_todo',
    goalId,
    details: { todoId: existing.id, todoTitle: existing.title, originalCreatedAt: existing.createdAt },
    timestamp: now,
  });

  db.delete(todos).where(eq(todos.id, id)).run();

  const goal = db.select().from(goals).where(eq(goals.id, goalId)).get()!;
  const [withMeta] = attachMeta(db, [goal]);
  return withMeta;
}

export function deleteTodo(db: Db, id: string, eventBus?: EventBus): boolean {
  const existing = db.select().from(todos).where(eq(todos.id, id)).get();
  if (!existing) return false;

  if (existing.goalId) {
    eventBus?.emitMutation({
      type: 'todo_unlinked',
      goalId: existing.goalId,
      details: { todoId: existing.id, todoTitle: existing.title },
      timestamp: new Date().toISOString(),
    });
  }

  db.delete(todos).where(eq(todos.id, id)).run();
  return true;
}
