import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import type { Subprocess } from "bun";

const BASE = "http://localhost:4921";
let proc: Subprocess;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "server.ts"], {
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  await Bun.sleep(800);
});

afterAll(() => {
  proc?.kill();
});

describe("projects", () => {
  test("GET /api/projects returns seeded projects", async () => {
    const res = await fetch(`${BASE}/api/projects`);
    expect(res.status).toBe(200);
    const projects = await res.json() as any[];
    expect(projects.length).toBe(3);
    expect(projects[0].name).toBe("Backend API");
  });

  test("GET /api/projects/:id returns a project", async () => {
    const res = await fetch(`${BASE}/api/projects/1`);
    expect(res.status).toBe(200);
    const project = await res.json() as any;
    expect(project.slug).toBe("backend-api");
  });

  test("GET /api/projects/:id returns 404 for missing project", async () => {
    const res = await fetch(`${BASE}/api/projects/999`);
    expect(res.status).toBe(404);
  });
});

describe("tasks CRUD", () => {
  test("GET /api/tasks returns all seeded tasks", async () => {
    const res = await fetch(`${BASE}/api/tasks`);
    expect(res.status).toBe(200);
    const tasks = await res.json() as any[];
    expect(tasks.length).toBeGreaterThanOrEqual(10);
  });

  test("POST /api/tasks creates a task", async () => {
    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 1,
        title: "New test task",
        priority: "high",
        tags: ["test"],
      }),
    });
    expect(res.status).toBe(201);
    const task = await res.json() as any;
    expect(task.title).toBe("New test task");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("open");
  });

  test("POST /api/tasks rejects empty title", async () => {
    const res = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: 1, title: "" }),
    });
    expect(res.status).toBe(400);
  });

  test("PATCH /api/tasks/:id updates a task", async () => {
    const res = await fetch(`${BASE}/api/tasks/1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "critical", status: "review" }),
    });
    expect(res.status).toBe(200);
    const task = await res.json() as any;
    expect(task.priority).toBe("critical");
    expect(task.status).toBe("review");
  });

  test("DELETE /api/tasks/:id removes a task", async () => {
    // Create then delete
    const createRes = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: 2, title: "Ephemeral task" }),
    });
    const created = await createRes.json() as any;

    const deleteRes = await fetch(`${BASE}/api/tasks/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);

    const getRes = await fetch(`${BASE}/api/tasks/${created.id}`);
    expect(getRes.status).toBe(404);
  });
});

describe("task filtering", () => {
  test("filter by projectId", async () => {
    const res = await fetch(`${BASE}/api/tasks?projectId=1`);
    const tasks = await res.json() as any[];
    expect(tasks.every((t: any) => t.projectId === 1)).toBe(true);
  });

  test("filter by status", async () => {
    const res = await fetch(`${BASE}/api/tasks?status=open`);
    const tasks = await res.json() as any[];
    expect(tasks.every((t: any) => t.status === "open")).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
  });

  test("filter by priority", async () => {
    const res = await fetch(`${BASE}/api/tasks?priority=high`);
    const tasks = await res.json() as any[];
    expect(tasks.every((t: any) => t.priority === "high")).toBe(true);
    expect(tasks.length).toBeGreaterThan(0);
  });

  test("filter by assignee", async () => {
    const res = await fetch(`${BASE}/api/tasks?assignee=alice`);
    const tasks = await res.json() as any[];
    expect(tasks.every((t: any) => t.assignee === "alice")).toBe(true);
  });

  test("filter by tag", async () => {
    const res = await fetch(`${BASE}/api/tasks?tag=security`);
    const tasks = await res.json() as any[];
    expect(tasks.every((t: any) => t.tags.includes("security"))).toBe(true);
  });

  test("filter by dueBefore returns tasks due before cutoff", async () => {
    const res = await fetch(`${BASE}/api/tasks?dueBefore=2026-04-17`);
    const tasks = await res.json() as any[];
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) {
      expect(new Date(t.dueDate).getTime()).toBeLessThan(new Date("2026-04-17").getTime());
    }
  });
});

describe("stats", () => {
  test("GET /api/stats returns aggregate stats", async () => {
    const res = await fetch(`${BASE}/api/stats`);
    expect(res.status).toBe(200);
    const stats = await res.json() as any;
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.byStatus).toBeDefined();
    expect(stats.byPriority).toBeDefined();
    expect(typeof stats.overdue).toBe("number");
    expect(typeof stats.unassigned).toBe("number");
  });

  test("GET /api/stats?projectId=1 returns project-scoped stats", async () => {
    const res = await fetch(`${BASE}/api/stats?projectId=1`);
    const stats = await res.json() as any;
    // Project 1 has 5 seeded tasks (plus any created by earlier tests)
    expect(stats.total).toBeGreaterThanOrEqual(5);
  });

  test("overdue count excludes done and archived tasks", async () => {
    // Snapshot overdue count before adding a past-due done task
    const beforeRes = await fetch(`${BASE}/api/stats`);
    const before = await beforeRes.json() as any;
    const overdueBefore = before.overdue;

    // Create a task with past due date, then mark it done
    const createRes = await fetch(`${BASE}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: 1,
        title: "Past due but done",
        dueDate: "2020-01-01",
      }),
    });
    const task = await createRes.json() as any;
    await fetch(`${BASE}/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });

    // Overdue should NOT increase — done tasks aren't overdue
    const afterRes = await fetch(`${BASE}/api/stats`);
    const after = await afterRes.json() as any;
    expect(after.overdue).toBe(overdueBefore);
  });
});

describe("bulk operations", () => {
  test("POST /api/tasks/bulk/status updates multiple tasks", async () => {
    const listRes = await fetch(`${BASE}/api/tasks?status=open&projectId=1`);
    const openTasks = await listRes.json() as any[];
    const ids = openTasks.slice(0, 2).map((t: any) => t.id);

    const res = await fetch(`${BASE}/api/tasks/bulk/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status: "in_progress" }),
    });
    expect(res.status).toBe(200);
    const result = await res.json() as any;
    expect(result.updated).toBe(ids.length);
  });

  test("POST /api/tasks/reassign moves tasks between assignees", async () => {
    const res = await fetch(`${BASE}/api/tasks/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "bob", to: "alice" }),
    });
    expect(res.status).toBe(200);
    const result = await res.json() as any;
    expect(result.reassigned).toBeGreaterThanOrEqual(0);
  });
});
