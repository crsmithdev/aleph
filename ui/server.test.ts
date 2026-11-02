import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, pageDir: string, apiDir: string;

const run = (o: object) => JSON.stringify({ kind: "build", condition: "running", started: new Date().toISOString(), ...o });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-server-"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ aleph: { path: join(base, "aleph") }, other: { path: join(base, "other") } }));
  for (const [repo, name] of [["aleph", "aleph-1"], ["other", "other-2"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "state.json"), run({ name, job: name, repo }));
  }
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") });
  // A view added the way a view goal adds one: two new files, no edit to server.ts.
  pageDir = join(base, "page"); apiDir = join(base, "api");
  for (const f of ["index.html", "app.css", "lib.js", "system-parts.js", "decision.js", "timeline.js", "views", "vendor"]) cpSync(join(import.meta.dir, f), join(pageDir, f), { recursive: true });
  mkdirSync(apiDir);
  writeFileSync(join(pageDir, "views", "_test.js"), `export const view = { path: "/_test/:id", title: "Test", group: "work", order: 9, api: "/api/_test/:id", render: (d) => d.id };\n`);
  writeFileSync(join(apiDir, "_test.ts"), `import type { Routes } from "../server.ts";\nexport const routes: Routes = { "GET /api/_test/:id": (_req, params, url) => Response.json({ id: params.id, project: url.searchParams.get("project") }) };\n`);
  ({ server, stop, at } = await withServer({ warm: false, pageDir, apiDir }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("binds 127.0.0.1", () => {
  expect(server.hostname).toBe("127.0.0.1");
});

test("/api/state is JSON with the spec's keys", async () => {
  const res = await at("/api/state");
  expect(res.headers.get("content-type")).toContain("application/json");
  const body: any = await res.json();
  expect(Object.keys(body).sort()).toEqual(["always", "asks", "delivered", "done", "factory", "incoming", "issues", "landing", "newIssues", "now", "openIssues", "planner", "proposals", "queued", "running", "runningIssues", "speed", "stuck", "usage", "velocity"]);
});

test("/api/state?project= keeps only that project's jobs", async () => {
  const all: any = await (await at("/api/state")).json();
  expect(all.running.map((j: any) => j.name).sort()).toEqual(["aleph-1", "other-2"]);
  const other: any = await (await at("/api/state?project=other")).json();
  expect(other.running.map((j: any) => j.name)).toEqual(["other-2"]);
  for (const k of ["stuck", "running", "delivered", "queued"]) expect(other[k].every((j: any) => j.repo === "other")).toBe(true);
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
  const lib = await at("/lib.js");
  expect(lib.headers.get("content-type")).toContain("javascript");
  expect(await lib.text()).toContain("export function esc");
  expect(await (await at("/views/now.js")).text()).toContain("export function renderTiles");
});

test("/app.css is the style sheet, and the page links it", async () => {
  const res = await at("/app.css");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/css");
  expect(await res.text()).toContain(":root");
  expect(await (await at("/")).text()).toContain('<link rel="stylesheet" href="/app.css">');
});

test("/vendor/echarts.min.js is the vendored ECharts, served as JavaScript", async () => {
  const res = await at("/vendor/echarts.min.js");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
  const want = readFileSync(join(import.meta.dir, "vendor", "echarts.min.js"));
  expect(Buffer.from(await res.arrayBuffer()).equals(want)).toBe(true);
});

test("every module a view imports from ui/ is served", async () => {
  const dir = join(import.meta.dir, "views");
  const shared = new Set(readdirSync(dir).flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/from "\.\.\/([^"/]+\.js)"/g)].map((m) => m[1])));
  expect([...shared].sort()).toContain("lib.js");
  for (const f of shared) expect(`${f}: ${(await at(`/${f}`)).status}`).toBe(`${f}: 200`);
});

test("other paths are 404 and writes are refused", async () => {
  expect((await at("/nope")).status).toBe(404);
  expect((await at("/views/../server.ts")).status).toBe(404);
  expect((await at("/views/nope.js")).status).toBe(404);
  expect((await at("/api/state", { method: "POST" })).status).toBe(405);
  expect((await at("/", { method: "POST" })).status).toBe(405);
});

test("every API answer carries the server's version; the page and its modules are revalidated on each load", async () => {
  const { version } = await import("./server.ts");
  const a = await at("/api/_test/x");
  expect(a.headers.get("x-aleph-version")).toBe(version(pageDir));
  for (const p of ["/", "/lib.js", "/views/_test.js"]) expect((await at(p)).headers.get("cache-control")).toBe("no-cache");
});

test("x-aleph-login is on every API answer behind the gate, and absent without a password", async () => {
  expect((await at("/api/_test/x")).headers.get("x-aleph-login")).toBeNull();
  const restorePassword = withEnv({ ALEPH_UI_PASSWORD: "hunter2" });
  const { at: g, stop: stopGated } = await withServer({ warm: false });
  try {
    const ok = await g("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "hunter2" }) });
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect((await g("/api/state", { headers: { cookie } })).headers.get("x-aleph-login")).toBe("1");
  } finally {
    stopGated();
    restorePassword();
  }
});

test("x-aleph-version changes when a page file changes, is added or is removed", async () => {
  const pages = mkdtempSync(join(tmpdir(), "aleph-ui-pages-"));
  mkdirSync(join(pages, "views"));
  for (const f of ["index.html", "app.css", "lib.js", "decision.js", "views/a.js"]) writeFileSync(join(pages, f), "one");
  const { at: atPages, stop: stopPages } = await withServer({ warm: false, pageDir: pages, apiDir });
  const v = async () => (await atPages("/api/_test/x")).headers.get("x-aleph-version");
  try {
    const first = await v();
    expect(first).toBeTruthy();
    expect(await v()).toBe(first);
    writeFileSync(join(pages, "views", "a.js"), "changed content");
    const edited = await v();
    expect(edited).not.toBe(first);
    writeFileSync(join(pages, "app.css"), "changed style sheet");
    expect(await v()).not.toBe(edited);
    writeFileSync(join(pages, "views", "b.js"), "x");
    const added = await v();
    expect(added).not.toBe(edited);
    rmSync(join(pages, "views", "b.js"));
    expect(await v()).not.toBe(added);
  } finally {
    stopPages();
    rmSync(pages, { recursive: true, force: true });
  }
});
