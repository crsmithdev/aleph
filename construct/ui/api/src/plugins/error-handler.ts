import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export const errorHandler = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.flatten().fieldErrors,
      });
    }
    const err = error as Error & { statusCode?: number };
    if (err.statusCode) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    app.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  });
});
