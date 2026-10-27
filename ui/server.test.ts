import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";

let base: string, server: ReturnType<typeof serve>;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-server-"));
  writeFileSync(join(base, "repos.json"), "{}");
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  server = serve(0);
});
afterAll(() => {
  server.stop(true);
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("binds 127.0.0.1", () => {
  expect(server.hostname).toBe("127.0.0.1");
});

test("/api/state is JSON with the spec's keys", async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/api/state`);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body: any = await res.json();
  expect(Object.keys(body).sort()).toEqual(["delivered", "factory", "needs", "now", "running", "stuck", "ticks", "waiting"]);
});

test("/ is HTML", async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/`);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect((await res.text()).toLowerCase()).toContain("<html");
});

test("other paths are 404 and writes are refused", async () => {
  expect((await fetch(`http://127.0.0.1:${server.port}/nope`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${server.port}/api/state`, { method: "POST" })).status).toBe(405);
});

test("/ is the page and /render.js its module", async () => {
  const page = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
  expect(page).toContain("/render.js");
  expect(page).toContain("/api/state");
  const js = await fetch(`http://127.0.0.1:${server.port}/render.js`);
  expect(js.headers.get("content-type")).toContain("javascript");
  expect(await js.text()).toContain("export function renderNeeds");
});
