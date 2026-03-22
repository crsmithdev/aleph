import type { FastifyPluginAsync } from 'fastify';
import { listNotes, addNote, updateNote, deleteNote } from '@construct/goals';
import { getGoal } from '@construct/goals';

export const noteRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { goalId: string } }>('/:goalId/notes', async (req, reply) => {
    const goal = getGoal(app.db, req.params.goalId);
    if (!goal) return reply.status(404).send({ error: 'Goal not found' });
    return listNotes(app.db, req.params.goalId);
  });

  app.post<{ Params: { goalId: string } }>('/:goalId/notes', async (req, reply) => {
    const result = addNote(app.db, req.params.goalId, req.body, app.eventBus);
    if (!result) return reply.status(404).send({ error: 'Goal not found' });
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { goalId: string; noteId: string } }>(
    '/:goalId/notes/:noteId',
    async (req, reply) => {
      const result = updateNote(app.db, req.params.goalId, req.params.noteId, req.body, app.eventBus);
      if (!result) return reply.status(404).send({ error: 'Note not found' });
      return result;
    }
  );

  app.delete<{ Params: { goalId: string; noteId: string } }>(
    '/:goalId/notes/:noteId',
    async (req, reply) => {
      const ok = deleteNote(app.db, req.params.goalId, req.params.noteId, app.eventBus);
      if (!ok) return reply.status(404).send({ error: 'Note not found' });
      return reply.status(204).send();
    }
  );
};
