#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createDb } from '@construct/data';
import {
  applyDDL,
  EventBus,
  HistoryService,
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  listCategories,
  createCategory,
  deleteCategory,
  listNotes,
  addNote,
  updateNote,
  deleteNote,
  getTodosForDay,
  createTodo,
  updateTodo,
  deleteTodo,
  promoteTodoToGoal,
  listHabits,
  createHabit,
  completeHabit,
  getHistory,
  getSummary,
} from '@construct/goals';

const { db, sqlite } = createDb();
applyDDL(sqlite);

const eventBus = new EventBus();
new HistoryService(db, eventBus).start();

const server = new McpServer({
  name: 'goal-tracker',
  version: '0.2.0',
});

// ── Goals ────────────────────────────────────────────────────────────────────

server.tool(
  'list_goals',
  'List all goals with optional filters',
  {
    state: z.string().optional().describe('Filter by state (e.g. actionable, done, waiting)'),
    priority: z.string().optional().describe('Filter by priority (e.g. high, medium, low)'),
    category: z.string().optional().describe('Filter by category ID'),
    archived: z.boolean().optional().describe('Include archived goals (default false)'),
  },
  async (params) => {
    const result = listGoals(db, {
      state: params.state,
      priority: params.priority,
      category: params.category,
      archived: params.archived !== undefined ? String(params.archived) : undefined,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_goal',
  'Get a single goal by ID including categories, notes, and history',
  { id: z.string().describe('Goal ID') },
  async (params) => {
    const result = getGoal(db, params.id);
    if (!result) return { content: [{ type: 'text', text: 'Goal not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_goal',
  'Create a new goal',
  {
    title: z.string().describe('Goal title'),
    priority: z.string().optional().describe('Priority: low, medium, high, critical'),
    state: z.string().optional().describe('Initial state: not_started, actionable, scheduled, waiting, done, canceled'),
  },
  async (params) => {
    const result = createGoal(db, params, eventBus);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'update_goal',
  'Update an existing goal',
  {
    id: z.string().describe('Goal ID'),
    title: z.string().optional().describe('New title'),
    priority: z.string().optional().describe('New priority'),
    state: z.string().optional().describe('New state'),
    archived: z.boolean().optional().describe('Archive or unarchive'),
  },
  async (params) => {
    const { id, ...fields } = params;
    const result = updateGoal(db, id, fields, eventBus);
    if (!result) return { content: [{ type: 'text', text: 'Goal not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_goal',
  'Delete a goal by ID',
  { id: z.string().describe('Goal ID') },
  async (params) => {
    const ok = deleteGoal(db, params.id);
    if (!ok) return { content: [{ type: 'text', text: 'Goal not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Goal deleted successfully' }] };
  }
);

// ── Categories ───────────────────────────────────────────────────────────────

server.tool('list_categories', 'List all categories', {}, async () => {
  const result = listCategories(db);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.tool(
  'create_category',
  'Create a new category',
  {
    name: z.string().describe('Category name'),
    color: z.string().optional().describe('Color hex code (e.g. #ff0000)'),
  },
  async (params) => {
    const result = createCategory(db, params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_category',
  'Delete a category by ID',
  { id: z.string().describe('Category ID') },
  async (params) => {
    const ok = deleteCategory(db, params.id);
    if (!ok) return { content: [{ type: 'text', text: 'Category not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Category deleted successfully' }] };
  }
);

// ── Notes ────────────────────────────────────────────────────────────────────

server.tool(
  'list_notes',
  'List all notes for a goal',
  { goalId: z.string().describe('Goal ID') },
  async (params) => {
    const result = listNotes(db, params.goalId);
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
    const result = addNote(db, params.goalId, { content: params.content }, eventBus);
    if (!result) return { content: [{ type: 'text', text: 'Goal not found' }], isError: true };
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
    const result = updateNote(db, params.goalId, params.noteId, { content: params.content }, eventBus);
    if (!result) return { content: [{ type: 'text', text: 'Note not found' }], isError: true };
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
    const ok = deleteNote(db, params.goalId, params.noteId, eventBus);
    if (!ok) return { content: [{ type: 'text', text: 'Note not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Note deleted successfully' }] };
  }
);

// ── Todos ────────────────────────────────────────────────────────────────────

server.tool(
  'list_todos',
  'List todos for a specific date, including overdue and completed items',
  { date: z.string().describe('Date in YYYY-MM-DD format') },
  async (params) => {
    const result = getTodosForDay(db, params.date);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'create_todo',
  'Create a new todo item',
  {
    title: z.string().describe('Todo title'),
    goalId: z.string().optional().describe('Goal ID to link this todo to'),
    note: z.string().optional().describe('Optional note'),
  },
  async (params) => {
    const result = createTodo(db, params, eventBus);
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
    goalId: z.string().nullable().optional().describe('New linked goal ID (null to unlink)'),
  },
  async (params) => {
    const { id, ...fields } = params;
    const result = updateTodo(db, id, fields, eventBus);
    if (!result) return { content: [{ type: 'text', text: 'Todo not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'delete_todo',
  'Delete a todo item',
  { id: z.string().describe('Todo ID') },
  async (params) => {
    const ok = deleteTodo(db, params.id, eventBus);
    if (!ok) return { content: [{ type: 'text', text: 'Todo not found' }], isError: true };
    return { content: [{ type: 'text', text: 'Todo deleted successfully' }] };
  }
);

server.tool(
  'promote_todo',
  'Promote a todo to a goal. The todo is deleted and a new goal is created with the same title, note, and creation date. Any existing goal association is removed.',
  { id: z.string().describe('Todo ID to promote') },
  async (params) => {
    const result = promoteTodoToGoal(db, params.id, eventBus);
    if (!result) return { content: [{ type: 'text', text: 'Todo not found' }], isError: true };
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Habits ───────────────────────────────────────────────────────────────────

server.tool('list_habits', 'List all habits with period status', {}, async () => {
  const result = listHabits(db);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
});

server.tool(
  'create_habit',
  'Create a new habit',
  {
    title: z.string().describe('Habit title'),
    frequency: z.string().describe('Recurrence: daily, weekly, or monthly'),
    goalId: z.string().optional().describe('Goal ID to link to'),
    endDate: z.string().optional().describe('Optional end date YYYY-MM-DD'),
  },
  async (params) => {
    const result = createHabit(db, params);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'complete_habit',
  'Mark a habit as complete for a period',
  {
    id: z.string().describe('Habit ID'),
    periodKey: z.string().describe('Period key (e.g. 2024-W01, 2024-01, 2024-01-15)'),
  },
  async (params) => {
    const result = completeHabit(db, params.id, params.periodKey);
    if ('error' in result) {
      const msg = result.error === 'not_found' ? 'Habit not found' : 'Already completed for this period';
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Summary & History ────────────────────────────────────────────────────────

server.tool(
  'get_summary',
  'Get an activity summary for a date range',
  {
    start: z.string().describe('Start date YYYY-MM-DD'),
    end: z.string().describe('End date YYYY-MM-DD'),
  },
  async (params) => {
    const result = getSummary(db, params.start, params.end);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  'get_history',
  'Get the event history log for a goal',
  { goalId: z.string().describe('Goal ID') },
  async (params) => {
    const result = getHistory(db, params.goalId);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
