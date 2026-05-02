---
title: Event-log completeness across mutations
dimension: Behavioral
---

# Event-log completeness — every state change emits a fully-populated event

The lesson: when a system relies on side effects (audit log, history, telemetry) being emitted from every mutation site, conformance is *behavioral* — not structural. Each peer mutation function must call the emission API with all required fields. Drift takes the form of *missing emissions* and *thin payloads*, not visible code differences.

## The reference

`src/goals/src/services/history.ts` listens on the event bus and writes one row to `history_logs` per mutation:

```ts
export class HistoryService {
  constructor(private db: Db, private eventBus: EventBus) {}
  start() {
    this.eventBus.onMutation((event: AppEvent) => {
      this.db.insert(historyLogs).values({
        id: nanoid(),
        goalId: event.goalId,
        eventType: event.type,
        details: JSON.stringify(event.details),
        createdAt: event.timestamp,
      }).run();
    });
  }
}
```

The contract on the *emission side* (`src/goals/src/services/event-bus.ts`):

```ts
export interface AppEvent {
  type: HistoryEvent;
  goalId: string;
  details: Record<string, unknown>;
  timestamp: string;
}
```

`createTodo` (`src/goals/src/services/todos.ts:102-134`) is a clean exemplar: every linked-todo creation emits a fully-populated event:

```ts
eventBus?.emitMutation({
  type: 'todo_linked',
  goalId: data.goalId,
  details: { todoId: id, todoTitle: data.title },
  timestamp: now,
});
```

All four required fields present, `details` carries the actual payload (not `{}`), `goalId` is real, `timestamp` is the real `now`.

## The peers (before)

`updateTodo` in the same file (`src/goals/src/services/todos.ts:136-174`) is incomplete drift. It emits when `goalId` changes:

```ts
if (data.goalId !== undefined && data.goalId !== existing.goalId) {
  if (existing.goalId) {
    eventBus?.emitMutation({ type: 'todo_unlinked', goalId: existing.goalId, ... });
  }
  if (data.goalId) {
    eventBus?.emitMutation({ type: 'todo_linked', goalId: data.goalId, ... });
  }
}
```

…but emits nothing when `data.title`, `data.done`, `data.note`, or `data.dueDate` change:

```ts
const updateData: Partial<typeof todos.$inferInsert> = { updatedAt: now };
if (data.title !== undefined) updateData.title = data.title;
if (data.done !== undefined) updateData.done = data.done;
if (data.note !== undefined) updateData.note = data.note ?? null;
if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ?? null;
if (data.goalId !== undefined) updateData.goalId = data.goalId ?? null;

db.update(todos).set(updateData).where(eq(todos.id, id)).run();
// ⚠ no eventBus.emitMutation — title / done / note / dueDate changes are invisible to the history log
```

This is the exact failure mode the user observes: "actions are added in the pipeline but never make it into the event log unless I specifically ask for an audit of what might be missing."

## The diff (proposal)

Add the missing emissions for the field-level updates. The `details` payload names every field that actually changed, not just the type:

```diff
   db.update(todos).set(updateData).where(eq(todos.id, id)).run();

+  const changed: Record<string, unknown> = {};
+  if (data.title !== undefined && data.title !== existing.title) changed.title = data.title;
+  if (data.done !== undefined && data.done !== existing.done) changed.done = data.done;
+  if (data.note !== undefined && data.note !== existing.note) changed.note = data.note;
+  if (data.dueDate !== undefined && data.dueDate !== existing.dueDate) changed.dueDate = data.dueDate;
+  if (Object.keys(changed).length > 0) {
+    eventBus?.emitMutation({
+      type: 'todo_updated',
+      goalId: existing.goalId ?? '',
+      details: { todoId: id, ...changed },
+      timestamp: now,
+    });
+  }
+
   return db.select().from(todos).where(eq(todos.id, id)).get()!;
```

(`'todo_updated'` must be added to `HistoryEvent` in `src/goals/src/constants.ts` if it isn't already; that's a one-line peer fix to keep consolidation honest.)

Apply the same shape across other peer mutation functions: `updateGoal`, `updateNote`, `deleteHabit`, etc. Anywhere a row is written that *changes user-visible state*, an `emitMutation` with non-empty `details` must follow.

## After + verification

`bun test.ts` — confirms existing tests still pass and (if the project has a history-log integration test) confirms `todo_updated` events now appear after `updateTodo` calls. If no test exists for this assertion, that's worth flagging in the summary as "behavior aligned, no test backing it yet."

Optional ast-grep audit to find remaining offenders:

```bash
# Find mutation functions that take eventBus but never call emitMutation
ast-grep --pattern 'function $_($_, $_: EventBus) { $$$ }' src/goals/src/services/
# Cross-check each match against the body — flag any that don't contain emitMutation.
```

## Why this is instructive

The drift here is invisible until you look at the audit log and notice gaps. That's precisely why conformance is the right framing: pick the well-shaped emission site (`createTodo`'s `todo_linked` block) as the reference, treat every other mutation function as a peer, and require every state-mutating branch to fire one fully-populated event. The fix isn't "make the code look the same" — it's "make the *behavior* the same: every mutation produces an audit row with full details."
