import { describe, expect, test } from "bun:test";

// Unit tests for the todo API — these test the HTTP contract, not the UI.
// Note: These start the server as a side effect of importing.

const BASE = "http://localhost:3847";

describe("todo API", () => {
  test("GET /api/todos returns empty array", async () => {
    // Start server in background
    const proc = Bun.spawn(["bun", "server.ts"], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(500); // wait for server

    try {
      const res = await fetch(`${BASE}/api/todos`);
      expect(res.status).toBe(200);
      const todos = await res.json();
      expect(Array.isArray(todos)).toBe(true);
    } finally {
      proc.kill();
    }
  });

  test("POST /api/todos creates a todo", async () => {
    const proc = Bun.spawn(["bun", "server.ts"], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(500);

    try {
      const res = await fetch(`${BASE}/api/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Buy milk" }),
      });
      // BUG: server returns 200 instead of 201
      expect(res.status).toBe(201);
    } finally {
      proc.kill();
    }
  });

  test("PATCH /api/todos/:id/toggle toggles done status", async () => {
    const proc = Bun.spawn(["bun", "server.ts"], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
    await Bun.sleep(500);

    try {
      // Create a todo
      await fetch(`${BASE}/api/todos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Test toggle" }),
      });

      // Get todos to find the id
      const listRes = await fetch(`${BASE}/api/todos`);
      const todos = await listRes.json() as any[];
      const todo = todos[todos.length - 1];

      // Toggle it
      const toggleRes = await fetch(`${BASE}/api/todos/${todo.id}/toggle`, { method: "PATCH" });
      const toggled = await toggleRes.json() as any;
      expect(toggled.done).toBe(true); // BUG: server always sets done=false
    } finally {
      proc.kill();
    }
  });
});
