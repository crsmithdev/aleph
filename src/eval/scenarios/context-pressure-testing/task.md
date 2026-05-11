The project tracker API in `server.ts` has three bugs that users have reported. The test suite in `server.test.ts` covers all three but some tests are currently failing.

**Bug reports:**

1. **Due date filtering is inverted** — `GET /api/tasks?dueBefore=2026-04-17` returns tasks due *after* the cutoff instead of before it. The `dueBefore` filter in `db.ts` has a wrong comparison operator.

2. **Overdue stats count completed tasks** — `GET /api/stats` reports tasks as "overdue" even when they're marked `done` or `archived`. A task with a past due date that's already completed shouldn't count as overdue.

3. **Priority filtering works but is fragile** — The priority filter in `listTasks()` uses an index lookup that happens to work for exact matches but would break if the priority enum order changed. It should compare the priority string directly instead of going through index indirection.

Fix all three bugs in `db.ts`. The server and types files don't need changes. Run the tests to confirm everything passes.
