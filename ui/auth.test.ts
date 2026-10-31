import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";

let dir: string;
const saved: Record<string, string | undefined> = {};
const servers: Awaited<ReturnType<typeof serve>>[] = [];
const sessions = () => join(dir, "ui-sessions.json");
const tokens = () => (existsSync(sessions()) ? JSON.parse(readFileSync(sessions(), "utf8")) : []);
const start = async () => { const s = await serve(0, { warm: false }); servers.push(s); return (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${s.port}${p}`, init); };
const login = (at: Awaited<ReturnType<typeof start>>, password: string) =>
  at("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-ui-auth-"));
  for (const [k, v] of Object.entries({ ALEPH_UI_PASSWORD: "hunter2", ALEPH_FACTORY_DIR: dir, ALEPH_JOBS_DIR: join(dir, "jobs"), ALEPH_REPOS: join(dir, "repos.json"), ALEPH_ITEMS: join(dir, "items") })) { saved[k] = process.env[k]; process.env[k] = v; }
});
afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});

test("password gate: login, session across servers, logout", async () => {
  const at = await start();
  const home = await at("/");
  const html = await home.text();
  expect(home.status).toBe(200);
  expect(html).toContain("<input");
  expect(html).toContain('type="password"');
  expect(html).not.toContain("/api/views");
  expect((await at("/api/state")).status).toBe(401);
  expect((await at("/lib.js")).status).toBe(401);
  expect((await at("/api/pause", { method: "POST" })).status).toBe(401);
  expect(tokens()).toEqual([]);

  const bad = await login(at, "nope");
  expect(bad.status).toBe(401);
  expect(await bad.json()).toEqual({ error: "wrong password" });
  expect(tokens()).toEqual([]);

  const ok = await login(at, "hunter2");
  expect(ok.status).toBe(204);
  const set = ok.headers.get("set-cookie")!;
  expect(set).toContain("aleph_session=");
  expect(set).toContain("HttpOnly");
  expect(set).not.toContain("Secure");
  const cookie = set.split(";")[0];
  expect(tokens()).toHaveLength(1);

  const headers = { cookie };
  expect(await (await at("/", { headers })).text()).toContain("/api/views");
  expect((await at("/api/state", { headers })).status).toBe(200);

  const again = await start();
  expect((await again("/api/state", { headers })).status).toBe(200);

  expect((await at("/api/logout", { method: "POST", headers })).status).toBe(204);
  expect((await at("/api/state", { headers })).status).toBe(401);
  expect(tokens()).toEqual([]);
});

test("gate off without ALEPH_UI_PASSWORD", async () => {
  delete process.env.ALEPH_UI_PASSWORD;
  const at = await start();
  expect((await at("/")).status).toBe(200);
  expect((await at("/api/state")).status).toBe(200);
  expect((await login(at, "x")).status).toBe(404);
});
