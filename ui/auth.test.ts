import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "./test-server.ts";

let dir: string;
let restoreEnv: () => void;
const stops: (() => void)[] = [];
const sessions = () => join(dir, "ui-sessions.json");
const tokens = () => (existsSync(sessions()) ? JSON.parse(readFileSync(sessions(), "utf8")) : []);
const start = async () => { const s = await withServer({ warm: false }); stops.push(s.stop); return s.at; };
const login = (at: Awaited<ReturnType<typeof start>>, password: string) =>
  at("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-ui-auth-"));
  restoreEnv = withEnv({ ALEPH_UI_PASSWORD: "hunter2", ALEPH_FACTORY_DIR: dir, ALEPH_JOBS_DIR: join(dir, "jobs"), ALEPH_REPOS: join(dir, "repos.json"), ALEPH_ISSUES: join(dir, "items") });
});
afterAll(() => {
  for (const stop of stops) stop();
  restoreEnv();
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

test("loginPage declares an empty icon in its head", async () => {
  const { loginPage } = await import("./auth.ts");
  const html = loginPage();
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  expect(head).toContain('<link rel="icon" href="data:,">');
});
