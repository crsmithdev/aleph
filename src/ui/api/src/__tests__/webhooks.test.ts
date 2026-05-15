import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';
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
