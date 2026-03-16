import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { webauthnCredentials, apiTokens } from '../db/schema.js';
import { createHash } from 'crypto';
import { config } from '../config.js';

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    // Dev/test bypass: skip auth when no credentials registered yet
    if (config.nodeEnv !== 'production' && !app.hasCredentials()) return;

    // Check session first
    if (request.session?.get('userId')) return;

    // Check API token
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const hash = createHash('sha256').update(token).digest('hex');
      const found = app.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).get();
      if (found) {
        app.db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, found.id)).run();
        return;
      }
    }

    reply.status(401).send({ error: 'Unauthorized' });
  });

  app.decorate('optionalAuth', async (request: FastifyRequest) => {
    // Just check if authenticated, don't block
  });

  app.decorate('hasCredentials', () => {
    const creds = app.db.select().from(webauthnCredentials).all();
    return creds.length > 0;
  });
});

// Extend types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    optionalAuth: (request: FastifyRequest) => Promise<void>;
    hasCredentials: () => boolean;
  }
}
