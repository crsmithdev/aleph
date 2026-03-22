import type { FastifyPluginAsync } from 'fastify';
import { getSummary } from '@construct/goals';

export const summaryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { start?: string; end?: string; tz?: string } }>('/', async (req, reply) => {
    const { start, end, tz } = req.query;
    if (!start || !end) {
      return reply.status(400).send({ error: 'start and end query params are required (ISO date YYYY-MM-DD)' });
    }
    const tzOffset = tz ? parseInt(tz, 10) : undefined;
    return getSummary(app.db, start, end, tzOffset);
  });
};
