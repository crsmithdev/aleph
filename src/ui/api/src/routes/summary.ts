import type { FastifyPluginAsync } from 'fastify';
import { getSummary } from '@construct/goals';

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { start?: string; end?: string } }>('/', async (req, reply) => {
    const { start, end } = req.query;
    if (!start || !end) {
      return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
    }
    return getSummary(app.db, start, end);
  });
};
