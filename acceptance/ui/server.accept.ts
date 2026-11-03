// Archived goal tests from ui/server.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv, withServer } from "../../ui/test-server.ts";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, pageDir: string, apiDir: string;

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
  for (const f of ["index.html", "app.css", "lib.js", "system-parts.js", "decision.js", "timeline.js", "views", "vendor"]) cpSync(join((import.meta.dir + "/../../ui"), f), join(pageDir, f), { recursive: true });
  mkdirSync(apiDir);
  writeFileSync(join(pageDir, "views", "_test.js"), `export const view = { path: "/_test/:id", title: "Test", group: "work", order: 9, api: "/api/_test/:id", render: (d) => d.id };\n`);
  writeFileSync(join(apiDir, "_test.ts"), `import type { Routes } from "../server.ts";\nexport const routes: Routes = { "GET /api/_test/:id": (_req, params, url) => Response.json({ id: params.id, project: url.searchParams.get("project") }) };\n`);
  ({ stop, at } = await withServer({ warm: false, pageDir, apiDir }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("/api/state is JSON with the spec's keys", async () => {
  const res = await at("/api/state");
  expect(res.headers.get("content-type")).toContain("application/json");
  const body: any = await res.json();
  expect(Object.keys(body).sort()).toEqual(["always", "asks", "delivered", "done", "factory", "incoming", "issues", "landing", "newIssues", "now", "openIssues", "planner", "proposals", "queued", "running", "runningIssues", "speed", "stuck", "usage", "velocity"]);
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
