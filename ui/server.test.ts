import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { putRun } from "../jobs/lib/records/record.ts";

// The test's clock: the server reads it, and the runs start at it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, pageDir: string, apiDir: string;

const run = (o: object) => JSON.stringify({ n: 1, kind: "build", condition: "running", started: new Date(NOW).toISOString(), ...o });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-server-"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ aleph: { path: join(base, "aleph") }, other: { path: join(base, "other") } }));
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") });
  for (const [repo, name] of [["aleph", "aleph-1"], ["other", "other-2"]]) {
    const folder = join(base, "jobs", `20261027-100000-${repo}-${name}-agent`);
    mkdirSync(folder, { recursive: true });
    putRun(basename(folder), JSON.parse(run({ name, job: name, repo })));
  }
  // A view added the way a view issue adds one: two new files, no edit to server.ts.
  pageDir = join(base, "page"); apiDir = join(base, "api");
  for (const f of ["index.html", "app.css", "lib.js", "router.js", "chart.js", "system-parts.js", "decision.js", "timeline.js", "views", "vendor"]) cpSync(join(import.meta.dir, f), join(pageDir, f), { recursive: true });
  cpSync(join(import.meta.dir, "..", "lib"), join(base, "lib"), { recursive: true });
  mkdirSync(apiDir);
  writeFileSync(join(pageDir, "views", "_test.js"), `export const view = { path: "/_test/:id", title: "Test", group: "factory", order: 9, api: "/api/_test/:id", render: (d) => d.id };\n`);
  writeFileSync(join(apiDir, "_test.ts"), `import type { Routes } from "../server.ts";\nexport const routes: Routes = { "GET /api/_test/:id": (_req, params, url) => Response.json({ id: params.id, project: url.searchParams.get("project") }), "GET /api/_big/:n": (_req, params) => Response.json("x".repeat(Number(params.n))) };\n`);
  ({ server, stop, at } = await withServer({ warm: false, pageDir, apiDir }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

// Security: the server must listen on loopback only; home-proxy puts the login in front of it on the LAN.
test("binds 127.0.0.1", () => {
  expect(server.hostname).toBe("127.0.0.1");
});

test("/api/factory?project= keeps only that project's jobs", async () => {
  const all: any = await (await at("/api/factory")).json();
  expect(all.running.map((j: any) => j.name).sort()).toEqual(["aleph-1", "other-2"]);
  const other: any = await (await at("/api/factory?project=other")).json();
  expect(other.running.map((j: any) => j.name)).toEqual(["other-2"]);
  for (const k of ["stuck", "running", "queued"]) expect(other[k].every((j: any) => j.repo === "other")).toBe(true);
});

test("/api/factory carries the asks and no Done count; /api/automation carries no asks and no factory block", async () => {
  const f: any = await (await at("/api/factory?window=month")).json();
  expect("doneCount" in f).toBe(false);
  expect(Array.isArray(f.asks)).toBe(true);
  expect("doneStamps" in f).toBe(false);
  expect((await at("/api/factory?window=year")).status).toBe(400);
  const a: any = await (await at("/api/automation")).json();
  for (const k of ["asks", "factory", "codes"]) expect(k in a).toBe(false);
});

test("/api/projects maps each registry repo to its code, open issue count and onboarded flag", async () => {
  const p: any = await (await at("/api/projects")).json();
  expect(Object.keys(p)).toEqual(["aleph", "other"]);
  for (const v of Object.values<any>(p)) expect(v).toEqual({ code: null, issues: expect.any(Number), onboarded: false });
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

test("/app.css is the style sheet, and the page links it", async () => {
  const res = await at("/app.css");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/css");
  const css = await res.text();
  expect(css).toContain(":root");
  expect(css).not.toContain(".spark");
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
  expect((await at("/api/factory", { method: "POST" })).status).toBe(405);
  expect((await at("/", { method: "POST" })).status).toBe(405);
  for (const [path, method] of [["/api/state", "GET"], ["/api/land/x", "POST"], ["/api/approve/x", "POST"], ["/api/gates/caps", "POST"], ["/api/contents", "GET"]]) expect((await at(path, { method })).status, path).toBe(404);
});

test("every API answer carries the server's version; the page and its modules are revalidated on each load", async () => {
  const { version } = await import("./server.ts");
  const a = await at("/api/_test/x");
  expect(a.headers.get("x-aleph-version")).toBe(version(pageDir));
  for (const p of ["/", "/lib.js", "/views/_test.js"]) expect((await at(p)).headers.get("cache-control")).toBe("no-cache");
});

test("lib/naming.ts reaches the page as JS at the path ui/lib.js imports", async () => {
  const r = await at("/lib/naming.ts");
  expect(r.headers.get("content-type")).toContain("text/javascript");
  const js = await r.text();
  expect(js).toContain("export function parseId(s) {");
  expect(js).not.toContain("export interface");
});

test("lib/status-words.ts reaches the page as JS", async () => {
  const r = await at("/lib/status-words.ts");
  expect(r.headers.get("content-type")).toContain("text/javascript");
  const js = await r.text();
  expect(js).toContain("export const labelOf = (tone, text) =>");
});

test("x-aleph-login is on every API answer behind the gate, and absent without a password", async () => {
  expect((await at("/api/_test/x")).headers.get("x-aleph-login")).toBeNull();
  expect((await at("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "x" }) })).status).toBe(404);
  const restorePassword = withEnv({ ALEPH_UI_PASSWORD: "hunter2" });
  const { at: g, stop: stopGated } = await withServer({ warm: false });
  try {
    const ok = await g("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "hunter2" }) });
    const cookie = ok.headers.get("set-cookie")!.split(";")[0];
    expect((await g("/api/factory", { headers: { cookie } })).headers.get("x-aleph-login")).toBe("1");
  } finally {
    stopGated();
    restorePassword();
  }
});

test("without a password, a Host that is not this machine gets a 403 that names ALEPH_UI_PASSWORD", async () => {
  for (const path of ["/", "/api/factory"]) {
    const r = await at(path, { headers: { host: "aleph.home" } });
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("ALEPH_UI_PASSWORD");
    expect((await at(path)).status).toBe(200);
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

test("x-aleph-stale appears once a file of the server graph changes, and not for a page file", async () => {
  const root = mkdtempSync(join(tmpdir(), "aleph-ui-root-"));
  mkdirSync(join(root, "ui/views"), { recursive: true });
  writeFileSync(join(root, "ui/server.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "ui/views/v.js"), "one");
  const { at: atRoot, stop: stopRoot } = await withServer({ warm: false, pageDir, apiDir, root });
  const stale = async () => (await atRoot("/api/_test/x")).headers.get("x-aleph-stale");
  try {
    expect(await stale()).toBeNull();
    writeFileSync(join(root, "ui/views/v.js"), "two");
    expect(await stale()).toBeNull();
    writeFileSync(join(root, "ui/server.ts"), "export const a = 2;\n");
    expect(await stale()).toBe("1");
  } finally {
    stopRoot();
  }
});

test("a JSON answer over 1024 bytes is gzipped when the request accepts gzip, and plain otherwise", async () => {
  const get = (n: number, enc: string) => at(`/api/_big/${n}`, { headers: { "accept-encoding": enc }, decompress: false } as RequestInit);
  const big = JSON.stringify("x".repeat(2000));
  const gz = await get(2000, "gzip, deflate");
  expect(gz.headers.get("content-encoding")).toBe("gzip");
  expect(gz.headers.get("vary")).toBe("Accept-Encoding");
  expect(gz.headers.get("x-aleph-version")).toBeTruthy();
  expect(new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await gz.arrayBuffer())))).toBe(big);
  const plain = await get(2000, "identity");
  expect(plain.headers.get("content-encoding")).toBeNull();
  expect(await plain.text()).toBe(big);
  const small = await get(1022, "gzip");
  expect(small.headers.get("content-encoding")).toBeNull();
  expect(await small.text()).toBe(JSON.stringify("x".repeat(1022)));
});
