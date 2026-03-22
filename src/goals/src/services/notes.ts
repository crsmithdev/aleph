import { nanoid } from 'nanoid';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '@construct/data';
import { notes, goals } from '../schema.js';
import { createNoteSchema, updateNoteSchema } from '../validators.js';
import type { EventBus } from './event-bus.js';

export function listNotes(db: Db, goalId: string) {
  return db
    .select()
    .from(notes)
    .where(eq(notes.goalId, goalId))
    .orderBy(desc(notes.createdAt))
    .all();
}

export function addNote(db: Db, goalId: string, input: unknown, eventBus?: EventBus) {
  const goal = db.select().from(goals).where(eq(goals.id, goalId)).get();
  if (!goal) return null;

  const data = createNoteSchema.parse(input);
  const id = nanoid();
  const now = new Date().toISOString();

  db.insert(notes)
    .values({ id, goalId, content: data.content, createdAt: now, updatedAt: now })
    .run();

  eventBus?.emitMutation({
    type: 'note_added',
    goalId,
    details: { noteId: id, content: data.content },
    timestamp: now,
  });

  return db.select().from(notes).where(eq(notes.id, id)).get()!;
}

export function updateNote(db: Db, goalId: string, noteId: string, input: unknown, eventBus?: EventBus) {
  const existing = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.goalId, goalId)))
    .get();
  if (!existing) return null;

  const data = updateNoteSchema.parse(input);
  const now = new Date().toISOString();

  db.update(notes)
    .set({ content: data.content, updatedAt: now })
    .where(eq(notes.id, noteId))
    .run();

  eventBus?.emitMutation({
    type: 'note_edited',
    goalId,
    details: { noteId, oldContent: existing.content, newContent: data.content },
    timestamp: now,
  });

  return db.select().from(notes).where(eq(notes.id, noteId)).get()!;
}

export function deleteNote(db: Db, goalId: string, noteId: string, eventBus?: EventBus): boolean {
  const existing = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.goalId, goalId)))
    .get();
  if (!existing) return false;

  db.delete(notes).where(eq(notes.id, noteId)).run();

  eventBus?.emitMutation({
    type: 'note_deleted',
    goalId,
    details: { noteId, content: existing.content },
    timestamp: new Date().toISOString(),
  });

  return true;
}
