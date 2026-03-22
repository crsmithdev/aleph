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

describe('Categories API', () => {
  let categoryId: string;

  it('POST /api/categories - creates a category', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/categories',
      payload: { name: 'Health', color: '#22c55e' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Health');
    expect(body.color).toBe('#22c55e');
    expect(body.id).toBeDefined();
    categoryId = body.id;
  });

  it('GET /api/categories - lists categories', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/categories' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe('Health');
  });

  it('PATCH /api/categories/:id - updates a category', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/categories/${categoryId}`,
      payload: { name: 'Fitness' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Fitness');
  });
});

describe('Goals API', () => {
  let goalId: string;

  it('POST /api/goals - creates a goal', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals',
      payload: { title: 'Run a marathon', priority: 'high' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe('Run a marathon');
    expect(body.priority).toBe('high');
    expect(body.state).toBe('not_started');
    goalId = body.id;
  });

  it('GET /api/goals - lists goals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/goals' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].categories).toBeDefined();
  });

  it('GET /api/goals/:id - gets a single goal', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/goals/${goalId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Run a marathon');
  });

  it('PATCH /api/goals/:id - updates state', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/goals/${goalId}`,
      payload: { state: 'actionable' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('actionable');
  });

  it('GET /api/goals/:id/history - has history entries', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/goals/${goalId}/history` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Notes API', () => {
  let goalId: string;
  let noteId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/goals',
      payload: { title: 'Test notes goal' },
    });
    goalId = res.json().id;
  });

  it('POST /api/goals/:goalId/notes - creates a note', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/goals/${goalId}/notes`,
      payload: { content: 'First note content' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().content).toBe('First note content');
    noteId = res.json().id;
  });

  it('GET /api/goals/:goalId/notes - lists notes', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/goals/${goalId}/notes` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it('PATCH /api/goals/:goalId/notes/:noteId - updates a note', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/goals/${goalId}/notes/${noteId}`,
      payload: { content: 'Updated content' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe('Updated content');
  });

  it('DELETE /api/goals/:goalId/notes/:noteId - deletes a note', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/goals/${goalId}/notes/${noteId}`,
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('Todos API', () => {
  let todoId: string;

  it('POST /api/todos - creates a todo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/todos',
      payload: { title: 'Buy groceries', dueDate: '2026-03-02' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe('Buy groceries');
    todoId = res.json().id;
  });

  it('GET /api/todos/day/:date - gets day view', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/todos/day/2026-03-02' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.todos).toBeDefined();
    expect(body.overdue).toBeDefined();
  });

  it('PATCH /api/todos/:id - marks todo done', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/todos/${todoId}`,
      payload: { done: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().done).toBe(true);
  });
});

describe('Auth API', () => {
  it('GET /api/auth/status - returns auth status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('authenticated');
    expect(body).toHaveProperty('hasCredentials');
  });
});
