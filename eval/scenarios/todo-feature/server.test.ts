import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { type Subprocess } from "bun";

const BASE = "http://localhost:3847";
let proc: Subprocess;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "server.ts"], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
  await Bun.sleep(800);
});

afterAll(() => { proc?.kill(); });

async function addTodo(text: string, category = "general") {
  const res = await fetch(`${BASE}/api/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, category }),
  });
  return res.json() as Promise<{ id: number; text: string; done: boolean; category: string }>;
}

describe("existing features", () => {
  test("can add a todo", async () => {
    const todo = await addTodo("Test item");
    expect(todo.text).toBe("Test item");
    expect(todo.done).toBe(false);
  });

  test("can toggle a todo", async () => {
    const todo = await addTodo("Toggle me");
    const res = await fetch(`${BASE}/api/todos/${todo.id}/toggle`, { method: "PATCH" });
    const toggled = await res.json() as any;
    expect(toggled.done).toBe(true);
  });

  test("can filter by category", async () => {
    await addTodo("Work task", "work");
    const res = await fetch(`${BASE}/api/todos?category=work`);
    const todos = await res.json() as any[];
    expect(todos.every((t: any) => t.category === "work")).toBe(true);
  });
});

describe("due dates feature", () => {
  test("can add a todo with a due date", async () => {
    const res = await fetch(`${BASE}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Due soon", category: "work", dueDate: "2026-04-01" }),
    });
    const todo = await res.json() as any;
    expect(todo.dueDate).toBe("2026-04-01");
  });

  test("can list overdue todos", async () => {
    // Add a past-due todo
    await fetch(`${BASE}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Overdue task", dueDate: "2020-01-01" }),
    });
    const res = await fetch(`${BASE}/api/todos?overdue=true`);
    const todos = await res.json() as any[];
    expect(todos.length).toBeGreaterThan(0);
    expect(todos.every((t: any) => new Date(t.dueDate) < new Date())).toBe(true);
  });

  test("can sort by due date", async () => {
    await fetch(`${BASE}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Later", dueDate: "2026-12-31" }),
    });
    await fetch(`${BASE}/api/todos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Sooner", dueDate: "2026-06-01" }),
    });
    const res = await fetch(`${BASE}/api/todos?sort=dueDate`);
    const todos = await res.json() as any[];
    const dated = todos.filter((t: any) => t.dueDate);
    for (let i = 1; i < dated.length; i++) {
      expect(new Date(dated[i].dueDate).getTime()).toBeGreaterThanOrEqual(new Date(dated[i-1].dueDate).getTime());
    }
  });

  test("HTML includes due date UI elements", async () => {
    const res = await fetch(BASE);
    const html = await res.text();
    // Should have a date input for setting due dates
    expect(html).toContain('type="date"');
    // Should display due dates on todo items
    expect(html).toContain('todo-due');
  });
});
