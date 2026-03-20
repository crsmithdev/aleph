import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { categories } from '../schema.js';
import { createCategorySchema, updateCategorySchema } from '../validators.js';

export function listCategories(db: Db) {
  return db.select().from(categories).all();
}

export function getCategory(db: Db, id: string) {
  return db.select().from(categories).where(eq(categories.id, id)).get() ?? null;
}

export function createCategory(db: Db, input: unknown) {
  const data = createCategorySchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();
  db.insert(categories).values({ id, ...data, createdAt: now }).run();
  return db.select().from(categories).where(eq(categories.id, id)).get()!;
}

export function updateCategory(db: Db, id: string, input: unknown) {
  const data = updateCategorySchema.parse(input);
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return null;
  db.update(categories).set(data).where(eq(categories.id, id)).run();
  return db.select().from(categories).where(eq(categories.id, id)).get()!;
}

export function deleteCategory(db: Db, id: string): boolean {
  const existing = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!existing) return false;
  db.delete(categories).where(eq(categories.id, id)).run();
  return true;
}
