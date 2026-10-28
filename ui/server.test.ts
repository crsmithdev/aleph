import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "./server.ts";

let base: string, server: Awaited<ReturnType<typeof serve>>;
const saved: Record<string, string | undefined> = {};
const testView = join(import.meta.dir, "views", "_test.js");
const testApi = join(import.meta.dir, "api", "_test.ts");
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, init);

const run = (o: object) => JSON.stringify({ kind: "agent", state: "running", started: new Date().toISOString(), ...o });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-server-"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ aleph: { path: join(base, "aleph") }, other: { path: join(base, "other") } }));
  for (const [repo, name] of [["aleph", "aleph-1"], ["other", "other-2"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), run({ name, job: name, repo }));
  }
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  // A view added the way a view goal adds one: two new files, no edit to server.ts.
  writeFileSync(testView, `export const view = { path: "/_test/:id", title: "Test", group: "work", order: 9, api: "/api/_test/:id", render: (d) => d.id };\n`);
  writeFileSync(testApi, `import type { Routes } from "../server.ts";\nexport const routes: Routes = { "GET /api/_test/:id": (_req, params, url) => Response.json({ id: params.id, project: url.searchParams.get("project") }) };\n`);
  server = await serve(0, { warm: false });
});
afterAll(() => {
  server.stop(true);
  rmSync(testView, { force: true });
  rmSync(testApi, { force: true });
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("binds 127.0.0.1", () => {
  expect(server.hostname).toBe("127.0.0.1");
});

test("/api/state is JSON with the spec's keys", async () => {
  const res = await at("/api/state");
  expect(res.headers.get("content-type")).toContain("application/json");
  const body: any = await res.json();
  expect(Object.keys(body).sort()).toEqual(["delivered", "factory", "issues", "landing", "needs", "newIssues", "now", "running", "stuck", "triage", "velocity", "waiting"]);
});

test("/api/state?project= keeps only that project's jobs", async () => {
  const all: any = await (await at("/api/state")).json();
  expect(all.running.map((j: any) => j.name).sort()).toEqual(["aleph-1", "other-2"]);
  const other: any = await (await at("/api/state?project=other")).json();
  expect(other.running.map((j: any) => j.name)).toEqual(["other-2"]);
  for (const k of ["needs", "stuck", "running", "delivered", "waiting"]) expect(other[k].every((j: any) => j.repo === "other")).toBe(true);
});

test("/api/projects/keys lists the registry's repos", async () => {
  expect(await (await at("/api/projects/keys")).json()).toEqual(["aleph", "other"]);
});

test("a new view file and api file are served with no edit to server.ts", async () => {
  const names: string[] = await (await at("/api/views")).json();
  expect(names).toContain("_test.js");
  expect(names).toContain("now.js");
  const js = await at("/views/_test.js");
  expect(js.headers.get("content-type")).toContain("javascript");
  expect(await js.text()).toContain('path: "/_test/:id"');
  expect(await (await at("/api/_test/a%20b?project=other")).json()).toEqual({ id: "a b", project: "other" });
});

test("/ is the page, /lib.js and /views/now.js its modules", async () => {
  const res = await at("/");
  expect(res.headers.get("content-type")).toContain("text/html");
  const page = await res.text();
  expect(page.toLowerCase()).toContain("<html");
  expect(page).toContain("/api/views");
  expect(page).toContain("/api/projects/keys");
  const lib = await at("/lib.js");
  expect(lib.headers.get("content-type")).toContain("javascript");
  expect(await lib.text()).toContain("export function esc");
  expect(await (await at("/views/now.js")).text()).toContain("export function renderJobs");
});

test("other paths are 404 and writes are refused", async () => {
  expect((await at("/nope")).status).toBe(404);
  expect((await at("/views/../server.ts")).status).toBe(404);
  expect((await at("/views/nope.js")).status).toBe(404);
  expect((await at("/api/state", { method: "POST" })).status).toBe(405);
  expect((await at("/", { method: "POST" })).status).toBe(405);
});
