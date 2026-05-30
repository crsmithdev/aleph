import { nanoid } from 'nanoid';
import { eq, inArray, desc, and } from 'drizzle-orm';
import type { Db } from '@aleph/data';
import { goals, goalCategories, goalLinks, categories, notes, todos, habits } from '../schema.js';
import { createGoalSchema, updateGoalSchema } from '../validators.js';
import type { EventBus } from './event-bus.js';
import type { GoalWithMeta } from '../types.js';

type GoalRow = typeof goals.$inferSelect;
type CategoryRow = typeof categories.$inferSelect;

export function attachMeta(db: Db, goalRows: GoalRow[]): GoalWithMeta[] {
  if (goalRows.length === 0) return [];

  const ids = goalRows.map((g) => g.id);

  const gcRows = db
    .select({ goalId: goalCategories.goalId, categoryId: goalCategories.categoryId })
    .from(goalCategories)
    .where(inArray(goalCategories.goalId, ids))
    .all();

  const categoryIds = [...new Set(gcRows.map((r) => r.categoryId))];
  const catRows: CategoryRow[] =
    categoryIds.length > 0
      ? db.select().from(categories).where(inArray(categories.id, categoryIds)).all()
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

  const noteRows = db
    .select()
    .from(notes)
    .where(inArray(notes.goalId, ids))
    .orderBy(desc(notes.createdAt))
    .all();

  const latestNoteByGoal = new Map<string, typeof notes.$inferSelect>();
  const noteCountByGoal = new Map<string, number>();
  for (const note of noteRows) {
    if (!latestNoteByGoal.has(note.goalId)) {
      latestNoteByGoal.set(note.goalId, note);
    }
    noteCountByGoal.set(note.goalId, (noteCountByGoal.get(note.goalId) ?? 0) + 1);
  }

  const todoRows = db
    .select({ goalId: todos.goalId })
    .from(todos)
    .where(inArray(todos.goalId, ids))
    .all();

  const todoCountByGoal = new Map<string, number>();
  for (const todo of todoRows) {
    if (todo.goalId) {
      todoCountByGoal.set(todo.goalId, (todoCountByGoal.get(todo.goalId) ?? 0) + 1);
    }
  }

  const habitRows = db
    .select({ goalId: habits.goalId })
    .from(habits)
    .where(inArray(habits.goalId, ids))
    .all();

  const habitCountByGoal = new Map<string, number>();
  for (const habit of habitRows) {
    if (habit.goalId) {
      habitCountByGoal.set(habit.goalId, (habitCountByGoal.get(habit.goalId) ?? 0) + 1);
    }
  }

  const linkRows = db
    .select({ goalId: goalLinks.goalId, linkedGoalId: goalLinks.linkedGoalId })
    .from(goalLinks)
    .where(inArray(goalLinks.goalId, ids))
    .all();

  const linkedGoalIds = [...new Set(linkRows.map((r) => r.linkedGoalId))];
  const linkedGoalRows: GoalRow[] =
    linkedGoalIds.length > 0
      ? db.select().from(goals).where(inArray(goals.id, linkedGoalIds)).all()
      : [];
  const linkedGoalById = new Map(linkedGoalRows.map((g) => [g.id, g]));

  const linkedGoalsByGoal = new Map<string, GoalRow[]>();
  for (const link of linkRows) {
    const linked = linkedGoalById.get(link.linkedGoalId);
    if (linked) {
      const list = linkedGoalsByGoal.get(link.goalId) ?? [];
      list.push(linked);
      linkedGoalsByGoal.set(link.goalId, list);
    }
  }

  return goalRows.map((g) => ({
    ...g,
    categories: catsByGoal.get(g.id) ?? [],
    latestNote: latestNoteByGoal.get(g.id) ?? null,
    todoCount: todoCountByGoal.get(g.id) ?? 0,
    noteCount: noteCountByGoal.get(g.id) ?? 0,
    habitCount: habitCountByGoal.get(g.id) ?? 0,
    linkedGoals: linkedGoalsByGoal.get(g.id) ?? [],
  }));
}

export function listGoals(
  db: Db,
  filters?: { state?: string; priority?: string; category?: string; archived?: string }
): GoalWithMeta[] {
  let rows = db.select().from(goals).all();

  const showArchived = filters?.archived === 'true';
  rows = rows.filter((g) => g.archived === showArchived);

  if (filters?.state) rows = rows.filter((g) => g.state === filters.state);
  if (filters?.priority) rows = rows.filter((g) => g.priority === filters.priority);

  if (filters?.category) {
    const gcRows = db
      .select({ goalId: goalCategories.goalId })
      .from(goalCategories)
      .where(eq(goalCategories.categoryId, filters.category))
      .all();
    const goalIdSet = new Set(gcRows.map((r) => r.goalId));
    rows = rows.filter((g) => goalIdSet.has(g.id));
  }

  return attachMeta(db, rows);
}

export function getGoal(db: Db, id: string): GoalWithMeta | null {
  const goal = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!goal) return null;
  const [withMeta] = attachMeta(db, [goal]);
  return withMeta;
}

export function createGoal(
  db: Db,
  input: unknown,
  eventBus?: EventBus
): GoalWithMeta {
  const data = createGoalSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  db.insert(goals).values({ id, ...data, createdAt: now, updatedAt: now }).run();

  eventBus?.emitMutation({
    type: 'goal_created',
    goalId: id,
    details: { title: data.title, priority: data.priority, state: data.state },
    timestamp: now,
  });

  const goal = db.select().from(goals).where(eq(goals.id, id)).get()!;
  const [withMeta] = attachMeta(db, [goal]);
  return withMeta;
}

export function updateGoal(
  db: Db,
  id: string,
  input: unknown,
  eventBus?: EventBus
): GoalWithMeta | null {
  const existing = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!existing) return null;

  const data = updateGoalSchema.parse(input);
  const now = new Date().toISOString();

  db.update(goals).set({ ...data, updatedAt: now }).where(eq(goals.id, id)).run();

  if (data.state !== undefined && data.state !== existing.state) {
    eventBus?.emitMutation({
      type: 'state_change',
      goalId: id,
      details: { from: existing.state, to: data.state },
      timestamp: now,
    });
  }

  if (data.priority !== undefined && data.priority !== existing.priority) {
    eventBus?.emitMutation({
      type: 'priority_change',
      goalId: id,
      details: { from: existing.priority, to: data.priority },
      timestamp: now,
    });
  }

  if (data.archived !== undefined && data.archived !== existing.archived) {
    eventBus?.emitMutation({
      type: data.archived ? 'archived' : 'unarchived',
      goalId: id,
      details: {},
      timestamp: now,
    });
  }

  eventBus?.emitMutation({
    type: 'goal_updated',
    goalId: id,
    details: data,
    timestamp: now,
  });

  const updated = db.select().from(goals).where(eq(goals.id, id)).get()!;
  const [withMeta] = attachMeta(db, [updated]);
  return withMeta;
}

export function deleteGoal(db: Db, id: string): boolean {
  const existing = db.select().from(goals).where(eq(goals.id, id)).get();
  if (!existing) return false;
  db.delete(goals).where(eq(goals.id, id)).run();
  return true;
}

export function linkGoals(db: Db, goalId: string, otherId: string): boolean {
  if (goalId === otherId) return false;
  const a = db.select().from(goals).where(eq(goals.id, goalId)).get();
  const b = db.select().from(goals).where(eq(goals.id, otherId)).get();
  if (!a || !b) return false;
  // Store both directions so queries are simple
  db.insert(goalLinks).values({ goalId, linkedGoalId: otherId }).onConflictDoNothing().run();
  db.insert(goalLinks).values({ goalId: otherId, linkedGoalId: goalId }).onConflictDoNothing().run();
  return true;
}

export function unlinkGoals(db: Db, goalId: string, otherId: string): boolean {
  db.delete(goalLinks)
    .where(and(eq(goalLinks.goalId, goalId), eq(goalLinks.linkedGoalId, otherId)))
    .run();
  db.delete(goalLinks)
    .where(and(eq(goalLinks.goalId, otherId), eq(goalLinks.linkedGoalId, goalId)))
    .run();
  return true;
}

export function setCategories(
  db: Db,
  goalId: string,
  categoryIds: string[],
  eventBus?: EventBus
): GoalWithMeta | null {
  const goal = db.select().from(goals).where(eq(goals.id, goalId)).get();
  if (!goal) return null;

  const now = new Date().toISOString();

  const existingGc = db
    .select()
    .from(goalCategories)
    .where(eq(goalCategories.goalId, goalId))
    .all();
  const existingIds = new Set(existingGc.map((r) => r.categoryId));
  const newIds = new Set(categoryIds);

  const added = categoryIds.filter((id) => !existingIds.has(id));
  const removed = [...existingIds].filter((id) => !newIds.has(id));

  const affectedIds = [...new Set([...added, ...removed])];
  const categoryNameMap = new Map(
    affectedIds.length > 0
      ? db.select().from(categories).where(inArray(categories.id, affectedIds)).all()
          .map((c) => [c.id, c.name])
      : []
  );

  db.delete(goalCategories).where(eq(goalCategories.goalId, goalId)).run();

  if (categoryIds.length > 0) {
    db.insert(goalCategories)
      .values(categoryIds.map((categoryId) => ({ goalId, categoryId })))
      .run();
  }

  for (const categoryId of added) {
    eventBus?.emitMutation({
      type: 'category_added',
      goalId,
      details: { categoryId, categoryName: categoryNameMap.get(categoryId) },
      timestamp: now,
    });
  }

  for (const categoryId of removed) {
    eventBus?.emitMutation({
      type: 'category_removed',
      goalId,
      details: { categoryId, categoryName: categoryNameMap.get(categoryId) },
      timestamp: now,
    });
  }

  const updated = db.select().from(goals).where(eq(goals.id, goalId)).get()!;
  const [withMeta] = attachMeta(db, [updated]);
  return withMeta;
}
