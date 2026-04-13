/**
 * Project tracker API server.
 * Run: bun server.ts
 */
import * as db from "./db.ts";
import type { TaskFilter, CreateTaskInput, UpdateTaskInput, Priority, Status } from "./types.ts";

db.seed();

function json(data: any, status = 200) {
  return Response.json(data, { status });
}

function err(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function parseQuery(url: URL): TaskFilter {
  const filter: TaskFilter = {};
  const pid = url.searchParams.get("projectId");
  if (pid) filter.projectId = parseInt(pid);
  const status = url.searchParams.get("status");
  if (status) filter.status = status as Status;
  const priority = url.searchParams.get("priority");
  if (priority) filter.priority = priority as Priority;
  const assignee = url.searchParams.get("assignee");
  if (assignee) filter.assignee = assignee;
  const tag = url.searchParams.get("tag");
  if (tag) filter.tag = tag;
  const dueBefore = url.searchParams.get("dueBefore");
  if (dueBefore) filter.dueBefore = dueBefore;
  return filter;
}

const VALID_PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
const VALID_STATUSES: Status[] = ["open", "in_progress", "review", "done", "archived"];

const server = Bun.serve({
  port: 4921,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // ── Projects ──────────────────────────────────────────

    if (url.pathname === "/api/projects" && method === "GET") {
      return json(db.listProjects());
    }

    if (url.pathname.match(/^\/api\/projects\/\d+$/) && method === "GET") {
      const id = parseInt(url.pathname.split("/")[3]);
      const project = db.getProject(id);
      if (!project) return err("Project not found", 404);
      return json(project);
    }

    // ── Tasks ─────────────────────────────────────────────

    if (url.pathname === "/api/tasks" && method === "GET") {
      const filter = parseQuery(url);
      const tasks = db.listTasks(filter);
      return json(tasks);
    }

    if (url.pathname === "/api/tasks" && method === "POST") {
      const body = await req.json() as CreateTaskInput;
      if (!body.title?.trim()) return err("title is required");
      if (!body.projectId) return err("projectId is required");
      if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
        return err(`invalid priority: ${body.priority}`);
      }
      try {
        const task = db.createTask(body);
        return json(task, 201);
      } catch (e: any) {
        return err(e.message, 400);
      }
    }

    if (url.pathname.match(/^\/api\/tasks\/\d+$/) && method === "GET") {
      const id = parseInt(url.pathname.split("/")[3]);
      const task = db.getTask(id);
      if (!task) return err("Task not found", 404);
      return json(task);
    }

    if (url.pathname.match(/^\/api\/tasks\/\d+$/) && method === "PATCH") {
      const id = parseInt(url.pathname.split("/")[3]);
      const body = await req.json() as UpdateTaskInput;
      if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
        return err(`invalid priority: ${body.priority}`);
      }
      if (body.status && !VALID_STATUSES.includes(body.status)) {
        return err(`invalid status: ${body.status}`);
      }
      const task = db.updateTask(id, body);
      if (!task) return err("Task not found", 404);
      return json(task);
    }

    if (url.pathname.match(/^\/api\/tasks\/\d+$/) && method === "DELETE") {
      const id = parseInt(url.pathname.split("/")[3]);
      const ok = db.deleteTask(id);
      if (!ok) return err("Task not found", 404);
      return json({ ok: true });
    }

    // ── Stats ─────────────────────────────────────────────

    if (url.pathname === "/api/stats" && method === "GET") {
      const pid = url.searchParams.get("projectId");
      const stats = db.getTaskStats(pid ? parseInt(pid) : undefined);
      return json(stats);
    }

    // ── Bulk ──────────────────────────────────────────────

    if (url.pathname === "/api/tasks/bulk/status" && method === "POST") {
      const body = await req.json() as { ids: number[]; status: Status };
      if (!Array.isArray(body.ids) || !body.status) {
        return err("ids (array) and status required");
      }
      if (!VALID_STATUSES.includes(body.status)) {
        return err(`invalid status: ${body.status}`);
      }
      const count = db.bulkUpdateStatus(body.ids, body.status);
      return json({ updated: count });
    }

    if (url.pathname === "/api/tasks/reassign" && method === "POST") {
      const body = await req.json() as { from: string; to: string };
      if (!body.from || !body.to) return err("from and to required");
      const count = db.reassignTasks(body.from, body.to);
      return json({ reassigned: count });
    }

    return err("Not found", 404);
  },
});

console.log(`Project tracker running on http://localhost:${server.port}`);
