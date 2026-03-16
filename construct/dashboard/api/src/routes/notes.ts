import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import { eq, desc, and } from 'drizzle-orm';
import { notes, goals } from '../db/schema.js';
import { createNoteSchema, updateNoteSchema } from '@goal-tracker/shared';

export const noteRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>(
    '/:goalId/notes',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const goal = app.db
        .select()
        .from(goals)
        .where(eq(goals.id, req.params.goalId))
        .get();
      if (!goal) return reply.status(404).send({ error: 'Goal not found' });

      return app.db
        .select()
        .from(notes)
        .where(eq(notes.goalId, req.params.goalId))
        .orderBy(desc(notes.createdAt))
        .all();
    }
  );

  app.post<{ Params: { goalId: string } }>(
    '/:goalId/notes',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const goal = app.db
        .select()
        .from(goals)
        .where(eq(goals.id, req.params.goalId))
        .get();
      if (!goal) return reply.status(404).send({ error: 'Goal not found' });

      const data = createNoteSchema.parse(req.body);
      const id = nanoid();
      const now = new Date().toISOString();

      app.db
        .insert(notes)
        .values({ id, goalId: req.params.goalId, content: data.content, createdAt: now, updatedAt: now })
        .run();

      const created = app.db.select().from(notes).where(eq(notes.id, id)).get();

      app.eventBus.emitMutation({
        type: 'note_added',
        goalId: req.params.goalId,
        details: { noteId: id, content: data.content },
        timestamp: now,
      });

      return reply.status(201).send(created);
    }
  );

  app.patch<{ Params: { goalId: string; noteId: string } }>(
    '/:goalId/notes/:noteId',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(notes)
        .where(and(eq(notes.id, req.params.noteId), eq(notes.goalId, req.params.goalId)))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Note not found' });

      const data = updateNoteSchema.parse(req.body);
      const now = new Date().toISOString();

      app.db
        .update(notes)
        .set({ content: data.content, updatedAt: now })
        .where(eq(notes.id, req.params.noteId))
        .run();

      const updated = app.db.select().from(notes).where(eq(notes.id, req.params.noteId)).get();

      app.eventBus.emitMutation({
        type: 'note_edited',
        goalId: req.params.goalId,
        details: {
          noteId: req.params.noteId,
          oldContent: existing.content,
          newContent: data.content,
        },
        timestamp: now,
      });

      return updated;
    }
  );

  app.delete<{ Params: { goalId: string; noteId: string } }>(
    '/:goalId/notes/:noteId',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const existing = app.db
        .select()
        .from(notes)
        .where(and(eq(notes.id, req.params.noteId), eq(notes.goalId, req.params.goalId)))
        .get();
      if (!existing) return reply.status(404).send({ error: 'Note not found' });

      app.db.delete(notes).where(eq(notes.id, req.params.noteId)).run();

      app.eventBus.emitMutation({
        type: 'note_deleted',
        goalId: req.params.goalId,
        details: {
          noteId: req.params.noteId,
          content: existing.content,
        },
        timestamp: new Date().toISOString(),
      });

      return reply.status(204).send();
    }
  );
};
