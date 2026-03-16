import type { FastifyPluginAsync } from 'fastify';
import { nanoid } from 'nanoid';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import { webauthnCredentials } from '../db/schema.js';
import { config } from '../config.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  // GET /status - check auth status and if credentials exist
  app.get('/status', async (req) => {
    const userId = req.session.get('userId');
    const hasCredentials = app.hasCredentials();
    const devBypass = config.nodeEnv !== 'production' && !hasCredentials;
    return { authenticated: !!userId || devBypass, hasCredentials, needsRegistration: !hasCredentials };
  });

  // POST /register/options - generate registration options (only if no credentials exist)
  app.post('/register/options', async (req, reply) => {
    if (app.hasCredentials()) {
      return reply.status(403).send({ error: 'Registration already completed' });
    }
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: 'user',
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    req.session.set('challenge', options.challenge);
    return options;
  });

  // POST /register/verify
  app.post('/register/verify', async (req, reply) => {
    if (app.hasCredentials()) {
      return reply.status(403).send({ error: 'Registration already completed' });
    }
    const challenge = req.session.get('challenge');
    if (!challenge) return reply.status(400).send({ error: 'No challenge found' });

    try {
      const verification = await verifyRegistrationResponse({
        response: req.body as any,
        expectedChallenge: challenge,
        expectedOrigin: config.rpOrigin,
        expectedRPID: config.rpId,
      });

      if (verification.verified && verification.registrationInfo) {
        const { credential } = verification.registrationInfo;
        const id = nanoid();
        app.db.insert(webauthnCredentials).values({
          id,
          credentialId: Buffer.from(credential.id).toString('base64url'),
          publicKey: Buffer.from(credential.publicKey).toString('base64url'),
          counter: credential.counter,
          transports: JSON.stringify((req.body as any).response?.transports || []),
          createdAt: new Date().toISOString(),
        }).run();

        req.session.set('userId', id);
        return { verified: true };
      }
      return reply.status(400).send({ error: 'Verification failed' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /login/options
  app.post('/login/options', async (req, reply) => {
    const creds = app.db.select().from(webauthnCredentials).all();
    if (creds.length === 0) return reply.status(400).send({ error: 'No credentials registered' });

    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      })),
      userVerification: 'preferred',
    });
    req.session.set('challenge', options.challenge);
    return options;
  });

  // POST /login/verify
  app.post('/login/verify', async (req, reply) => {
    const challenge = req.session.get('challenge');
    if (!challenge) return reply.status(400).send({ error: 'No challenge found' });

    const body = req.body as any;
    const credentialId = body.id;
    const cred = app.db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialId))
      .get();
    if (!cred) return reply.status(400).send({ error: 'Credential not found' });

    try {
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: config.rpOrigin,
        expectedRPID: config.rpId,
        credential: {
          id: cred.credentialId,
          publicKey: Buffer.from(cred.publicKey, 'base64url'),
          counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });

      if (verification.verified) {
        app.db
          .update(webauthnCredentials)
          .set({ counter: verification.authenticationInfo.newCounter })
          .where(eq(webauthnCredentials.id, cred.id))
          .run();
        req.session.set('userId', cred.id);
        return { verified: true };
      }
      return reply.status(400).send({ error: 'Verification failed' });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // POST /logout
  app.post('/logout', async (req) => {
    req.session.delete();
    return { ok: true };
  });
};
