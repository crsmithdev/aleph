import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';
import { dispatchWebhooks } from '../webhook-dispatch.js';
import { createDb } from '@construct/data';
import { webhooks } from '../db/schema.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createApp({ dbUrl: ':memory:' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('Webhooks API', () => {
  let webhookId: string;

  it('GET /api/webhooks - lists webhooks (empty initially)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  it('POST /api/webhooks - 400 if url missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { events: ['goal.created'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webhooks - 400 if url is not http/https', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'ftp://example.com/hook', events: ['goal.created'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webhooks - 400 if url is not a valid URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'not-a-url', events: ['goal.created'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webhooks - 400 if events is empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://example.com/hook', events: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webhooks - 400 if events is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/webhooks - creates a webhook (201)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://example.com/hook', events: ['goal.created'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.url).toBe('https://example.com/hook');
    expect(body.events).toEqual(['goal.created']);
    expect(body.active).toBe(true);
    expect(body.id).toBeDefined();
    webhookId = body.id;
  });

  it('GET /api/webhooks - lists webhooks after creation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].url).toBe('https://example.com/hook');
    expect(body[0].events).toEqual(['goal.created']);
  });

  it('PATCH /api/webhooks/:id - updates url', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${webhookId}`,
      payload: { url: 'https://example.com/hook-v2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('https://example.com/hook-v2');
  });

  it('PATCH /api/webhooks/:id - updates events', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${webhookId}`,
      payload: { events: ['goal.created', 'goal.completed'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual(['goal.created', 'goal.completed']);
  });

  it('PATCH /api/webhooks/:id - updates active flag', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/webhooks/${webhookId}`,
      payload: { active: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().active).toBe(false);
  });

  it('PATCH /api/webhooks/:id - 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/webhooks/nonexistent',
      payload: { url: 'https://example.com/updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/webhooks/:id - 404 for unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/webhooks/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/webhooks/:id - deletes a webhook (204)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/webhooks/${webhookId}` });
    expect(res.statusCode).toBe(204);
  });

  it('GET /api/webhooks - empty after deletion', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });
});

describe('dispatchWebhooks', () => {
  const WEBHOOK_DDL = `
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
      secret TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;

  it('fires POST to matching active webhook', async () => {
    let received: unknown = null;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        received = await req.json();
        return new Response('ok');
      },
    });
    try {
      const { db, sqlite } = createDb(':memory:');
      sqlite.exec(WEBHOOK_DDL);
      db.insert(webhooks).values({
        id: 'wh-1',
        url: `http://localhost:${server.port}/hook`,
        events: JSON.stringify(['loop.completed']),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();

      const results = await dispatchWebhooks('loop.completed', { id: 'loop-1', status: 'completed' }, db);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('wh-1');
      expect(results[0].status).toBe(200);
      expect((received as any)?.event).toBe('loop.completed');
      expect((received as any)?.payload?.status).toBe('completed');
    } finally {
      server.stop(true);
    }
  });

  it('skips inactive webhooks', async () => {
    const { db, sqlite } = createDb(':memory:');
    sqlite.exec(WEBHOOK_DDL);
    db.insert(webhooks).values({
      id: 'wh-inactive',
      url: 'http://localhost:9999/hook',
      events: JSON.stringify(['loop.completed']),
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    const results = await dispatchWebhooks('loop.completed', {}, db);
    expect(results).toHaveLength(0);
  });

  it('skips webhooks subscribed to different events', async () => {
    const { db, sqlite } = createDb(':memory:');
    sqlite.exec(WEBHOOK_DDL);
    db.insert(webhooks).values({
      id: 'wh-other',
      url: 'http://localhost:9999/hook',
      events: JSON.stringify(['goal.created']),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    const results = await dispatchWebhooks('loop.completed', {}, db);
    expect(results).toHaveLength(0);
  });

  it('returns error status on unreachable URL', async () => {
    const { db, sqlite } = createDb(':memory:');
    sqlite.exec(WEBHOOK_DDL);
    db.insert(webhooks).values({
      id: 'wh-bad',
      url: 'http://localhost:1/hook',
      events: JSON.stringify(['loop.completed']),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    const results = await dispatchWebhooks('loop.completed', {}, db);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('error');
  });
});
