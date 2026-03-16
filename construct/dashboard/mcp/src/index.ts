#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.GOAL_TRACKER_URL || 'http://localhost:3001';
const TOKEN = process.env.GOAL_TRACKER_TOKEN || '';

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

const server = new McpServer({
  name: 'goal-tracker',
  version: '0.1.0',
});

// ── Goals ────────────────────────────────────────────────────────────────────

server.tool(
  'list_goals',
  'List all goals with optional filters',
  {
    state: z.string().optional().describe('Filter by state (e.g. active, done, paused)'),
    priority: z.string().optional().describe('Filter by priority (e.g. high, medium, low)'),
    category: z.string().optional().describe('Filter by category ID'),
    archived: z.boolean().optional().describe('Include archived goals (default false)'),
  },
  async (params) => {
    const qs = new URLSearchParams();
    if (params.state) qs.set('state', params.state);
    if (params.priority) qs.set('priority', params.priority);
    if (params.category) qs.set('category', params.category);
    if (params.archived !== undefined) qs.set('archived', String(params.archived));
    const result = await api(`/goals?${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_goal',
  'Get a single goal by ID including categories, notes, and history',
  {
    id: z.string().describe('Goal ID'),
  },
  async (params) => {
    const result = await api(`/goals/${params.id}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_goal',
  'Create a new goal',
  {
    title: z.string().describe('Goal title'),
    priority: z.string().optional().describe('Priority level: high, medium, or low'),
    state: z.string().optional().describe('Initial state: active, paused, or done'),
  },
  async (params) => {
    const body: Record<string, unknown> = { title: params.title };
    if (params.priority !== undefined) body.priority = params.priority;
    if (params.state !== undefined) body.state = params.state;
    const result = await api('/goals', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'update_goal',
  'Update an existing goal',
  {
    id: z.string().describe('Goal ID'),
    title: z.string().optional().describe('New title'),
    priority: z.string().optional().describe('New priority: high, medium, or low'),
    state: z.string().optional().describe('New state: active, paused, or done'),
    archived: z.boolean().optional().describe('Archive or unarchive the goal'),
  },
  async (params) => {
    const { id, ...fields } = params;
    const body: Record<string, unknown> = {};
    if (fields.title !== undefined) body.title = fields.title;
    if (fields.priority !== undefined) body.priority = fields.priority;
    if (fields.state !== undefined) body.state = fields.state;
    if (fields.archived !== undefined) body.archived = fields.archived;
    const result = await api(`/goals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_goal',
  'Delete a goal by ID',
  {
    id: z.string().describe('Goal ID'),
  },
  async (params) => {
    await api(`/goals/${params.id}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: 'Goal deleted successfully' }] };
  }
);

// ── Categories ───────────────────────────────────────────────────────────────

server.tool(
  'list_categories',
  'List all categories',
  {},
  async () => {
    const result = await api('/categories');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_category',
  'Create a new category',
  {
    name: z.string().describe('Category name'),
    color: z.string().optional().describe('Color hex code (e.g. #ff0000)'),
  },
  async (params) => {
    const body: Record<string, unknown> = { name: params.name };
    if (params.color !== undefined) body.color = params.color;
    const result = await api('/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_category',
  'Delete a category by ID',
  {
    id: z.string().describe('Category ID'),
  },
  async (params) => {
    await api(`/categories/${params.id}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: 'Category deleted successfully' }] };
  }
);

// ── Notes ────────────────────────────────────────────────────────────────────

server.tool(
  'list_notes',
  'List all notes for a goal',
  {
    goalId: z.string().describe('Goal ID'),
  },
  async (params) => {
    const result = await api(`/goals/${params.goalId}/notes`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'add_note',
  'Add a note to a goal',
  {
    goalId: z.string().describe('Goal ID'),
    content: z.string().describe('Note content'),
  },
  async (params) => {
    const result = await api(`/goals/${params.goalId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content: params.content }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'update_note',
  'Update a note on a goal',
  {
    goalId: z.string().describe('Goal ID'),
    noteId: z.string().describe('Note ID'),
    content: z.string().describe('New note content'),
  },
  async (params) => {
    const result = await api(`/goals/${params.goalId}/notes/${params.noteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content: params.content }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_note',
  'Delete a note from a goal',
  {
    goalId: z.string().describe('Goal ID'),
    noteId: z.string().describe('Note ID'),
  },
  async (params) => {
    await api(`/goals/${params.goalId}/notes/${params.noteId}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: 'Note deleted successfully' }] };
  }
);

// ── Todos ────────────────────────────────────────────────────────────────────

server.tool(
  'list_todos',
  'List todos for a specific date, including overdue and completed items',
  {
    date: z.string().describe('Date in YYYY-MM-DD format'),
  },
  async (params) => {
    const result = await api(`/todos/day/${params.date}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_todo',
  'Create a new todo item',
  {
    title: z.string().describe('Todo title'),
    dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
    goalId: z.string().optional().describe('Goal ID to link this todo to'),
    note: z.string().optional().describe('Optional note for this todo'),
  },
  async (params) => {
    const body: Record<string, unknown> = { title: params.title };
    if (params.dueDate !== undefined) body.dueDate = params.dueDate;
    if (params.goalId !== undefined) body.goalId = params.goalId;
    if (params.note !== undefined) body.note = params.note;
    const result = await api('/todos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'update_todo',
  'Update an existing todo item',
  {
    id: z.string().describe('Todo ID'),
    done: z.boolean().optional().describe('Mark as done or undone'),
    title: z.string().optional().describe('New title'),
    note: z.string().nullable().optional().describe('New note (null to clear)'),
    dueDate: z.string().nullable().optional().describe('New due date YYYY-MM-DD (null to clear)'),
    goalId: z.string().nullable().optional().describe('New linked goal ID (null to unlink)'),
  },
  async (params) => {
    const { id, ...fields } = params;
    const body: Record<string, unknown> = {};
    if (fields.done !== undefined) body.done = fields.done;
    if (fields.title !== undefined) body.title = fields.title;
    if (fields.note !== undefined) body.note = fields.note;
    if (fields.dueDate !== undefined) body.dueDate = fields.dueDate;
    if (fields.goalId !== undefined) body.goalId = fields.goalId;
    const result = await api(`/todos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_todo',
  'Delete a todo item',
  {
    id: z.string().describe('Todo ID'),
  },
  async (params) => {
    await api(`/todos/${params.id}`, { method: 'DELETE' });
    return { content: [{ type: 'text', text: 'Todo deleted successfully' }] };
  }
);

// ── Recurring Todos ──────────────────────────────────────────────────────────

server.tool(
  'list_recurring_todos',
  'List all recurring todos with their current period completion status',
  {},
  async () => {
    const result = await api('/recurring-todos');
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_recurring_todo',
  'Create a new recurring todo',
  {
    title: z.string().describe('Recurring todo title'),
    frequency: z.string().describe('Recurrence frequency: daily, weekly, or monthly'),
    goalId: z.string().optional().describe('Goal ID to link this recurring todo to'),
    endDate: z.string().optional().describe('Optional end date in YYYY-MM-DD format'),
  },
  async (params) => {
    const body: Record<string, unknown> = {
      title: params.title,
      frequency: params.frequency,
    };
    if (params.goalId !== undefined) body.goalId = params.goalId;
    if (params.endDate !== undefined) body.endDate = params.endDate;
    const result = await api('/recurring-todos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'complete_recurring_todo',
  'Mark a recurring todo as complete for a specific period',
  {
    id: z.string().describe('Recurring todo ID'),
    periodKey: z.string().describe('Period key string (e.g. 2024-W01 for weekly, 2024-01 for monthly, 2024-01-15 for daily)'),
  },
  async (params) => {
    const result = await api(`/recurring-todos/${params.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ periodKey: params.periodKey }),
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Summary & History ────────────────────────────────────────────────────────

server.tool(
  'get_summary',
  'Get an activity summary for a date range',
  {
    start: z.string().describe('Start date in YYYY-MM-DD format'),
    end: z.string().describe('End date in YYYY-MM-DD format'),
  },
  async (params) => {
    const qs = new URLSearchParams({ start: params.start, end: params.end });
    const result = await api(`/summary?${qs}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_history',
  'Get the event history log for a goal',
  {
    goalId: z.string().describe('Goal ID'),
  },
  async (params) => {
    const result = await api(`/goals/${params.goalId}/history`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
