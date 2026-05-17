import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
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

describe('Habits API', () => {
  let habitId: string;

  it('GET /api/habits - lists habits (empty initially)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/habits' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(0);
  });

  it('POST /api/habits - creates a habit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/habits',
      payload: { title: 'Morning run', frequency: 'daily' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Morning run');
    expect(body.frequency).toBe('daily');
    expect(body.id).toBeDefined();
    expect(body.active).toBe(true);
    habitId = body.id;
  });

  it('GET /api/habits - lists habits after creation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/habits' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Morning run');
  });

  it('GET /api/habits/:id - gets a habit by id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/habits/${habitId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Morning run');
    expect(body.id).toBe(habitId);
    expect(body.currentPeriodKey).toBeDefined();
    expect(body.history).toBeDefined();
  });

  it('GET /api/habits/:id - 404 for unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/habits/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /api/habits/:id - updates a habit', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/habits/${habitId}`,
      payload: { title: 'Evening run', frequency: 'weekly' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe('Evening run');
    expect(body.frequency).toBe('weekly');
  });

  it('PATCH /api/habits/:id - 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/habits/nonexistent',
      payload: { title: 'Updated' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/habits/:id/complete - 400 if periodKey missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/complete`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/habits/:id/complete - completes for a period', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/complete`,
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.habitId).toBe(habitId);
    expect(body.periodKey).toBe('2026-05-15');
  });

  it('POST /api/habits/:id/complete - 409 if already completed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/complete`,
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /api/habits/:id/complete - 404 for unknown habit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/habits/nonexistent/complete',
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/habits/:id/uncomplete - 400 if periodKey missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/uncomplete`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/habits/:id/uncomplete - uncompletes a period', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/uncomplete`,
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('POST /api/habits/:id/uncomplete - 404 if no completion exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/habits/${habitId}/uncomplete`,
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/habits/:id/uncomplete - 404 for unknown habit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/habits/nonexistent/uncomplete',
      payload: { periodKey: '2026-05-15' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/habits/:id - 404 for unknown id', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/habits/nonexistent' });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/habits/:id - deletes a habit (204)', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/habits/${habitId}` });
    expect(res.statusCode).toBe(204);
  });

  it('GET /api/habits/:id - 404 after deletion', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/habits/${habitId}` });
    expect(res.statusCode).toBe(404);
  });
});
