# @construct/goals

Domain logic for goals, todos, categories, notes, recurring todos, and history. Pure service functions with direct SQLite access via `@construct/data`.

**Depends on:** @construct/data

## Usage

```typescript
import { createDb } from '@construct/data';
import { applyDDL, createGoal, listGoals, EventBus, HistoryService } from '@construct/goals';

const { db, sqlite } = createDb();
applyDDL(sqlite);

const eventBus = new EventBus();
new HistoryService(db, eventBus).start();

const goal = createGoal(db, { title: 'Ship v2' }, eventBus);
const goals = listGoals(db);
```

## MCP Server

`mcp/src/index.ts` — direct SQLite access, no HTTP server needed. Configured in `.mcp.json`.

## Services

All functions take `(db, ...)` and return plain objects. No Fastify dependency.

- **goals** — listGoals, getGoal, createGoal, updateGoal, deleteGoal, setCategories
- **todos** — getTodosForDay, getTodo, createTodo, updateTodo, deleteTodo
- **categories** — listCategories, getCategory, createCategory, updateCategory, deleteCategory
- **notes** — listNotes, addNote, updateNote, deleteNote
- **recurring** — listRecurringTodos, createRecurringTodo, completeRecurringTodo, uncompleteRecurringTodo
- **history** — getHistory, HistoryService
- **summary** — getSummary
