import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, setAsk, writeList } from "../todo/lib/store.ts";
import { add, addPart, setStatus, type Doc } from "../todo/lib/todo.ts";
import * as todos from "../todo/lib/todo.ts";
import { readAsk } from "../jobs/lib/ask.ts";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/contents.js";
// @ts-ignore
import { view as issueView } from "./views/issue.js";

/** An item stored as a goal: `kind: goal` on a plain number. */
const seedGoal = (doc: Doc, title: string, body = "") => { return add(doc, title, { spec: body || "Do it." }); };

let base: string, server: Awaited<ReturnType<typeof serve>>, jobsDir: string, argvFile: string, stdinFile: string;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, init);
const getJson = async (p: string) => (await at(p)).json() as Promise<any>;
const post = (body: object, headers: Record<string, string> = { "x-aleph-ui": "1" }, q = "") =>
  at(`/api/issues${q}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function run(id: string, extra: Record<string, unknown>) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "build", told: true, started: new Date().toISOString(), ...extra }));
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-issues-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  // a product repo whose origin/main has one commit with an Item trailer and one that names it in prose
  const remote = join(base, "demo.git"), repo = join(base, "demo");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  writeFileSync(join(repo, "a"), "1");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "real work\n\nIssue: fac-1\nJob: fac-1");
  writeFileSync(join(repo, "b"), "2");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "prose only\n\nthis finishes Item: fac-1 in words.\n\nbut no trailer");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  mkdirSync(join(base, "none"));
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo }, oth: { path: join(base, "none") } }));
  argvFile = join(base, "argv"); stdinFile = join(base, "stdin");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\ncat > ${stdinFile}\necho '{"repo":"fac","added":7}'\n`);
  chmodSync(fake, 0o755);
  for (const [k, val] of Object.entries({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake })) {
    saved[k] = process.env[k];
    process.env[k] = val;
  }
  Object.assign(process.env, gitEnv);
  writeList({ key: "fac" }, "seed", (doc) => {
    seedGoal(doc, "first goal", "# Heading\n\n- one\n\n<script>alert(1)</script>");
    add(doc, "plain task", { labels: ["bug"] });
    seedGoal(doc, "second goal").fm.after = ["fac-4"];
    seedGoal(doc, "third goal");
    setStatus(doc.items[1], "done");
    return true;
  }, true);
  writeList({ key: "oth" }, "seed", (doc) => { add(doc, "other thing"); return true; }, true);
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", condition: "landed", on: "fac-1" });
  run("20261027-000002-a", { job: "oth-1", name: "oth-1", repo: "oth", condition: "running", on: "oth-1" });
  server = await serve(0, { warm: false });
});
afterAll(() => {
  server.stop(true);
  for (const [k, val] of Object.entries(saved)) if (val === undefined) delete process.env[k]; else process.env[k] = val;
  rmSync(base, { recursive: true, force: true });
});

describe("GET /api/issues", () => {
  test("filters by status and label", async () => {
    expect((await getJson("/api/issues?repo=fac")).map((r: any) => r.id)).toEqual([1, 2, 3, 4]);
    expect((await getJson("/api/issues?repo=fac&status=done")).map((r: any) => r.id)).toEqual([2]);
    const [r] = await getJson("/api/issues?repo=fac");
    expect(r).toMatchObject({ repo: "fac", title: "first goal", status: "open", priority: "medium", labels: [], after: [], notes: 0 });
    expect(r.updated).toBeTruthy();
    expect((await at("/api/issues?status=bogus")).status).toBe(400);
  });

  test("no repo gives the recent repos", async () => {
    const rows = await getJson("/api/issues");
    expect(new Set(rows.map((r: any) => r.repo))).toEqual(new Set(["fac", "oth"]));
  });

  test("?project narrows it", async () => {
    expect(new Set((await getJson("/api/issues?project=oth")).map((r: any) => r.repo))).toEqual(new Set(["oth"]));
    expect((await getJson("/api/issues?project=fac&repo=oth"))).toEqual([]);
  });

  test("a row carries its stage", async () => {
    const rows = await getJson("/api/issues?repo=fac");
    expect(rows[0].stage).toBe("done");
    expect(rows[2].stage).toBe("blocked");
  });
});

describe("POST /api/issues/:repo/:id/drop", () => {
  test("drops the issue through the real CLI and returns its status; an unknown id is 404", async () => {
    const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
    writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "..", "jobs", "cli.ts")} "$@"\n`);
    chmodSync(wrap, 0o755);
    process.env.ALEPH_CLI = wrap;
    try {
      const h = { "x-aleph-ui": "1", "content-type": "application/json" };
      expect((await at("/api/issues/fac/99/drop", { method: "POST", headers: h })).status).toBe(404);
      expect((await at("/api/issues/nope/1/drop", { method: "POST", headers: h })).status).toBe(404);
      expect((await at("/api/issues/fac/3/drop", { method: "POST" })).status).toBe(403);
      const r = await at("/api/issues/fac/3/drop", { method: "POST", headers: h, body: JSON.stringify({}) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ repo: "fac", id: 3, status: "dropped" });
      expect((await getJson("/api/issues/fac/3")).status).toBe("dropped");
    } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
  });
});

describe("GET /api/issues/:repo/:n", () => {
  test("lists runs by on, goals included, and by todo for old runs", async () => {
    run("20261027-000010-a", { job: "on-4", name: "on-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000011-a", { job: "goal-4-1", name: "goal-4-1", repo: "fac", condition: "running", on: "fac-4.1" });
    run("20261027-000012-a", { job: "on-2", name: "on-2", repo: "fac", condition: "running", on: "fac-2" });
    run("20261027-000013-a", { job: "todo-4", name: "todo-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000014-a", { job: "other-4", name: "other-4", repo: "oth", condition: "running", on: "oth-4" });
    const d = await getJson("/api/issues/fac/4");
    expect(d.jobs.map((j: any) => j.name).sort()).toEqual(["goal-4-1", "on-4", "todo-4"]);
    const g = await getJson("/api/issues/fac/2");
    expect(g.jobs.map((j: any) => j.name)).toEqual(["on-2"]);
  });

  test("lists the job and the trailer commit, not the prose one", async () => {
    const d = await getJson("/api/issues/fac/1");
    expect(d.title).toBe("first goal");
    expect(d.spec).toContain("# Heading");
    expect(d.status).toBe("open");
    expect(d.derived.stage).toBe("done");
    expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-1"]);
    expect(d.commits.map((c: any) => c.subject)).toEqual(["real work"]);
    expect(d.commits[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(d.commits[0].date).toBeTruthy();
    expect(Object.keys(d.commits[0])).not.toContain("commitUrl");
  });

  test("unknown issue and other project are 404", async () => {
    expect((await at("/api/issues/fac/99")).status).toBe(404);
    expect((await at("/api/issues/fac/1?project=oth")).status).toBe(404);
    expect((await at("/api/issues/fac/1?project=fac")).status).toBe(200);
  });
});

describe("views", () => {
  test("the Markdown body escapes <script>", async () => {
    const h = issueView.render(await getJson("/api/issues/fac/1"));
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<h1>Heading</h1>");
    expect(h).toContain("<li>one</li>");
    expect(h).toContain("real work");
    expect(h).toContain('href="#/jobs/fac-1"');
  });

  test("/api/contents gives the issues with their run counts and the registry's keys", async () => {
    const d = await getJson("/api/contents");
    expect(d.issues.length).toBeGreaterThan(3);
    expect([...d.projects].sort()).toEqual(["fac", "oth"]);
    expect(d).not.toHaveProperty("specs");
    expect([...new Set(d.issues.map((i: any) => i.repo))].sort()).toEqual(["fac", "oth"]);
    expect(d.issues.every((i: any) => typeof i.runs === "number" && typeof i.cost === "number")).toBe(true);
    expect((await getJson("/api/contents?project=fac")).projects).toEqual(["fac"]);
  });

  test("the view is Inventory at #/inventory; #/issues and #/projects redirect, the detail routes do not", () => {
    expect(v.view.path).toBe("/inventory");
    expect(v.view.title).toBe("Inventory");
    expect(v.view.group).toBe("factory");
    expect(v.redirect("#/issues")).toBe("#/inventory");
    expect(v.redirect("#/issues?status=open")).toBe("#/inventory");
    expect(v.redirect("#/projects")).toBe("#/inventory");
    expect(v.redirect("#/contents")).toBe("#/inventory");
    expect(v.redirect("#/issues/fac/1")).toBeNull();
    expect(v.redirect("#/projects/fac")).toBeNull();
    expect(v.redirect("#/inventory")).toBeNull();
  });

  const section = (h: string, id: string) => h.split(`<div id="${id}">`)[1]?.split("</table>")[0] ?? "";

  test("the page is tiles, charts, search, filters and one table, with no Projects or Specs tables", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("status=any"));
    expect(h).not.toContain("<h2>Projects");
    expect(h).not.toContain("<h2>Specs");
    expect(h).toContain('class="tiles"');
    expect(h).toContain('data-chart="flow"');
    expect(h).toContain('data-chart="age"');
    expect(h.indexOf('class="tiles"')).toBeLessThan(h.indexOf('data-chart="flow"'));
    expect(h.indexOf('data-chart="flow"')).toBeLessThan(h.indexOf('data-ui="inv-search"'));
    const ths = (html: string) => [...html.matchAll(/<th(?: [^>]*)?>(?:<button[^>]*data-sort="(\w+)")?/g)].map((m) => m[1] ?? "");
    expect(ths(section(h, "issues-table"))).toEqual(["id", "title", "stage", "project", "priority", "labels", "notes", "runs", "cost", "age", "updated", ""]);
    expect(h).toContain(`<div class="sh"><h2>Issues</h2><span class="count">${d.issues.length}</span></div>`);
  });

  test("issue rows: Id, Title, Stage, Project, Labels, Updated and an X on an open issue only", async () => {
    const d = await getJson("/api/contents");
    const h = section(v.view.render(d, {}, new URLSearchParams("status=any")), "issues-table");
    expect(h).toContain('href="#/issues/fac/1"');
    expect(h).not.toContain('href="#/projects/');
    const rows = h.split("<tr class=\"crow").slice(1);
    const closed = rows.filter((r: string) => r.includes("plain task"));
    expect(closed).toHaveLength(1);
    expect(closed[0]).not.toContain("data-cancel");
    expect(rows.some((r: string) => r.includes("data-cancel"))).toBe(true);
    expect(closed[0]).toContain(">done</span>");
    expect(v.view.render(d, {}, new URLSearchParams())).toContain("File an issue");
  });

  test("the project filter is a button per project with what the other filters leave", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(h).toContain('data-project="oth" aria-pressed="true"');
    expect(h).toContain('data-project="fac" aria-pressed="false"');
    expect(h).toContain('data-project="" aria-pressed="false"');
    const rows = v.issueRows(d);
    const counts = (o: object) => v.renderProjects(d.projects, rows, o);
    const n = rows.filter((r: any) => r.project === "oth" && r.status === "open").length;
    expect(counts({ status: "open" })).toContain(`data-project="oth" aria-pressed="false">oth<span class="n">${n}</span>`);
    expect(v.hashOptions(new URLSearchParams("type=project"))).not.toHaveProperty("type");
    expect(v.filterRows(rows, { status: "done" }).every((r: any) => r.status === "done")).toBe(true);
    expect(v.filterRows(rows, { project: "oth" }).every((r: any) => r.project === "oth")).toBe(true);
    expect(v.filterRows(rows, { project: "oth" }).length).toBeGreaterThan(0);
    expect(v.filterRows(rows, { q: "plain" }).map((r: any) => r.title)).toEqual(["plain task"]);
  });

  const fz = (title: string, extra: object = {}) => ({ id: "fac-1", project: "fac", labels: [], stage: "new", priority: "medium", title, ...extra });
  test("search is fuzzy: letters in order, a typo, ids and labels; unrelated text does not match", () => {
    const yes = (q: string, r: any) => expect(v.fuzzyMatch(q, r)).not.toBeNull();
    const no = (q: string, r: any) => expect(v.fuzzyMatch(q, r)).toBeNull();
    yes("flaky", fz("Flaky tests seen by runs"));
    yes("flky tsts", fz("Flaky tests seen by runs"));
    yes("flakey", fz("Flaky tests seen by runs"));
    yes("flkay", fz("Flaky tests seen by runs"));
    yes("fac-1", fz("x"));
    yes("ui", fz("x", { labels: ["ui"] }));
    no("zebra", fz("Flaky tests seen by runs"));
    no("fks", fz("Fix the long path in the kernel and system"));
    no("flaky zebra", fz("Flaky tests"));
  });

  test("the best match comes first with a search and no sort; a chosen sort wins; the hits are marked", () => {
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "fac", title: "Workstatus page", status: "open", labels: [], updated: "2026-10-30" },
      { id: 2, repo: "fac", title: "status of the land", status: "open", labels: [], updated: "2026-10-01" },
      { id: 3, repo: "fac", title: "Set up a tiny ultra stack", status: "open", labels: [], updated: "2026-10-31" },
    ] });
    const titles = (o: object) => [...v.renderTable(rows, { status: "open", ...o }).matchAll(/<td class="wide"><a[^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<\/?mark>/g, ""));
    expect(titles({ q: "status" })[0]).toBe("status of the land");
    expect(titles({ q: "status" })).not.toContain("Set up a tiny ultra stack");
    expect(titles({ q: "status", sort: { key: "id", dir: -1 } })).toEqual(["status of the land", "Workstatus page"]);
    expect(v.renderTable(rows, { status: "open", q: "land" })).toContain("<mark>land</mark>");
  });

  test("the numbers: open, filed and closed in 7 days, the week before, age and runs; a part's run is not counted twice", () => {
    const now = new Date("2026-11-01T12:00");
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "open", stage: "new", labels: [], created: "2026-11-01", runs: 2, cost: 1 },
      { id: 1, ref: "1.1", repo: "f", title: "a part", status: "open", stage: "building", labels: [], created: "2026-10-20", runs: 2, cost: 1 },
      { id: 2, repo: "f", title: "b", status: "done", labels: [], created: "2026-10-21", closed: "2026-10-30", runs: 3, cost: 0.5 },
      { id: 3, repo: "f", title: "c", status: "dropped", labels: [], created: "2026-10-26", closed: "2026-10-25", runs: 0, cost: 0 },
    ] });
    expect(v.stats(rows, now)).toMatchObject({ total: 4, open: 2, stages: { new: 1, building: 1 }, filed: 2, filedBefore: 2, closed: 1, done: 1, dropped: 0, closedBefore: 1, medianAge: 6, oldest: 12, runs: 5, cost: 1.5 });
    const f = v.flow(rows, 14, now);
    expect(f.labels).toHaveLength(14);
    expect(f.labels.at(-1)).toBe("Nov 1");
    expect(f.filed.at(-1)).toBe(1);
    expect(f.closed.at(-3)).toBe(1);
    expect(v.ageBins(rows, now).counts).toEqual([1, 0, 0, 1, 0, 0]);
    expect(v.renderTiles(v.stats(rows, now))).toContain("1 done, 0 dropped");
  });

  test("each number column sorts; age counts to the closing", () => {
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "open", priority: "low", labels: [], created: "2026-10-01", notes: 1, runs: 9, cost: 0 },
      { id: 2, repo: "f", title: "b", status: "open", priority: "high", labels: [], created: "2026-10-20", notes: 5, runs: 1, cost: 3 },
    ] });
    const first = (key: string, dir = -1) => v.sortRows(rows, { key, dir })[0].title;
    expect(first("priority")).toBe("b");
    expect(first("notes")).toBe("b");
    expect(first("runs")).toBe("a");
    expect(first("cost")).toBe("b");
    expect(first("age")).toBe("a");
    expect(v.ageText({ status: "done", created: "2026-10-01", closed: "2026-10-11" })).toBe("10 d");
    expect(v.dateText("2026-10-20", new Date("2026-11-01T12:00"))).toBe("Oct 20");
    expect(v.dateText("2025-10-20", new Date("2026-11-01T12:00"))).toBe("2025-10-20");
  });

  test("the Status filter defaults to Open, newest first; Any shows every status", async () => {
    const d = await getJson("/api/contents");
    expect(v.hashOptions(new URLSearchParams()).status).toBe("open");
    expect(v.hashOptions(new URLSearchParams("status=any")).status).toBe("");
    expect(v.hashOptions(new URLSearchParams("status=done")).status).toBe("done");
    const def = v.view.render(d, {}, new URLSearchParams());
    const issues = section(def, "issues-table");
    expect(issues).not.toContain("plain task");
    expect(def).toContain('data-value="open" aria-pressed="true"');
    expect(v.view.render(d, {}, new URLSearchParams("status=any"))).toContain(">done</span>");
    expect(v.view.render(d, {}, new URLSearchParams("status=any"))).toContain('data-value="any" aria-pressed="true"');
    const t = [...v.sortRows(v.filterRows(v.issueRows(d), { status: "open" }))].map((r: any) => Date.parse(r.at) || 0);
    expect(t).toEqual([...t].sort((x, y) => y - x));
  });

  test("the filter bar is one filterBar; the row is the link, the title plain text", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(h.match(/class="fbar"/g)).toHaveLength(1);
    for (const n of ["status", "priority"]) expect(h).toContain(`data-name="${n}"`);
    expect(h).toContain('role="group" aria-label="Project"');
    expect(h).toContain('name="q"');
    expect(section(h, "issues-table")).not.toContain("<td>fac</td>");
    expect(h).toContain("<td>oth</td>");
    expect(h).toContain("tr.crow { position: relative; }");
    expect(h).toContain('td.wide a::after { content: ""; position: absolute; inset: 0; }');
    expect(h).toContain('<td class="wide"><a href="#/issues/oth/1">other thing</a></td>');
  });

  test("the header sorts: a query key and direction order the rows", async () => {
    const d = await getJson("/api/contents");
    const ids = (q: string) => [...v.view.render(d, {}, new URLSearchParams(q + "&type=issue&status=any")).matchAll(/class="idl" href="[^"]*">([^<]+)</g)].map((m) => m[1]);
    expect(ids("sort=id&dir=asc")).toEqual([...ids("sort=id&dir=asc")].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(ids("sort=id&dir=desc")).toEqual(ids("sort=id&dir=asc").reverse());
    expect(v.view.render(d, {}, new URLSearchParams("sort=title&dir=asc"))).toContain('aria-sort="ascending"');
  });

  test("the Issues table shows 50 rows and a pager that asks for 50 more", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: 100 + i, repo: "fac", title: `t${i}`, status: "open", labels: [], updated: "2026-10-01T00:00:00Z" }));
    const d = { issues: rows, projects: [], specs: [] };
    const h = v.view.render(d, {}, new URLSearchParams());
    expect(h.match(/<tr class="crow"/g)).toHaveLength(50);
    expect(h).toContain('<span class="of">50 of 120</span>');
    expect(h).toContain('data-more="50"');
    expect(v.hashOptions(new URLSearchParams("limit=100")).limit).toBe(100);
    const more = v.view.render(d, {}, new URLSearchParams("limit=100"));
    expect(more.match(/<tr class="crow"/g)).toHaveLength(100);
    expect(more).toContain('data-more="20"');
  });

  test("a part row names its part and nests", () => {
    const rows = v.issueRows({ issues: [
      { id: 910, ref: "910", repo: "fac", title: "ask", status: "open", labels: [] },
      { id: 910, ref: "910.1", repo: "fac", title: "part", status: "open", labels: [] },
    ] });
    const [, goal] = rows;
    expect(goal).toMatchObject({ id: "fac-910.1", href: "#/issues/fac/910.1", part: true });
    expect(v.dropTarget(goal).url).toBe("/api/issues/fac/910.1/drop");
    expect(v.renderRow(goal)).toContain("part-row");
    expect(v.sortRows(rows, { key: "id", dir: -1 })[0]).toBe(goal);
  });

  test("the X drops through the issue's drop route", async () => {
    const d = await getJson("/api/contents");
    const open = v.issueRows(d).find((r: any) => r.status === "open");
    expect(v.dropTarget(open)).toMatchObject({ url: `/api/issues/${open.repo}/${open.n}/drop` });
    expect(v.dropTarget({ ...open, status: "done" })).toBeNull();
  });
});

describe("POST /api/issues", () => {
  test("turns the spec label into --spec -, and passes title, labels and the text on stdin to `aleph issue add`", async () => {
    const res = await post({ repo: "fac", title: "new one", body: "## Goal\n\ndo it", labels: ["spec", "x"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 7 });
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["issue", "add", "fac", "new one", "--spec", "-", "--labels", "x"]);
    expect(readFileSync(stdinFile, "utf8")).toBe("## Goal\n\ndo it");
  });

  test("without the spec label the text is the body", async () => {
    const res = await post({ repo: "fac", title: "plain one", body: "just words", labels: ["x"] });
    expect(res.status).toBe(200);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["issue", "add", "fac", "plain one", "--request", "-", "--labels", "x"]);
  });

  test("an after goes through to `aleph issue add`", async () => {
    const res = await post({ repo: "fac", title: "waits", body: "x", labels: [], after: "fac-1" });
    expect(res.status).toBe(200);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toContain("--after");
  });

  test("without the header it is 403, and with a foreign Origin too", async () => {
    rmSync(argvFile, { force: true });
    expect((await post({ repo: "fac", title: "t" }, {})).status).toBe(403);
    expect((await post({ repo: "fac", title: "t" }, { "x-aleph-ui": "1", origin: "http://evil.example" })).status).toBe(403);
    expect((await post({ repo: "fac", title: "t" }, { "x-aleph-ui": "1", origin: `http://127.0.0.1:${server.port}` })).status).toBe(200);
  });

  test("an empty title is 400 and runs nothing", async () => {
    rmSync(argvFile, { force: true });
    expect((await post({ repo: "fac", title: "  " })).status).toBe(400);
    expect(await Bun.file(argvFile).exists()).toBe(false);
  });

  test("a project filter keeps it to that project", async () => {
    rmSync(argvFile, { force: true });
    expect((await post({ repo: "fac", title: "t" }, { "x-aleph-ui": "1" }, "?project=oth")).status).toBe(400);
    expect(await Bun.file(argvFile).exists()).toBe(false);
  });
});

describe("issue form project select", () => {
  test("renderForm gives a select of the keys", () => {
    const h = v.renderForm([], { keys: ["aleph", "sidetone"], project: "sidetone" });
    expect(h).toContain('<select name="repo"');
    expect(h.match(/<option /g)?.length).toBe(2);
    expect(h).toContain('<option value="sidetone" selected>');
  });
  test("projectOptions escapes and selects", () => {
    const h = v.projectOptions(["a", "<b>"], "a");
    expect(h.match(/<option /g)?.length).toBe(2);
    expect(h).toContain('<option value="a" selected>');
    expect(h).toContain("&lt;b&gt;");
    expect(h).not.toContain("<b>");
  });
  test("exports mount", () => {
    expect(typeof v.mount).toBe("function");
  });
});

describe("POST /api/issues/:repo/:id/decide and deny", () => {
  const h = { "x-aleph-ui": "1", "content-type": "application/json" };
  const item = (n: number) => readList({ key: "fac" })!.items.find((i) => i.id === n)!;
  async function withRealCli(fn: () => Promise<void>) {
    const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
    writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "..", "jobs", "cli.ts")} "$@"\n`);
    chmodSync(wrap, 0o755);
    process.env.ALEPH_CLI = wrap;
    try { await fn(); } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
  }
  const ask = (decision: boolean, wait?: string) => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, "which way", { request: "x" });
    if (wait && !doc.items.some((x) => x.id === 1 && x.sub === 1)) addPart(doc, doc.items.find((x) => x.id === 1 && x.sub === undefined)!, { title: "g", spec: "x" });
    if (decision) setAsk(i, { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a", ...(wait ? { after: wait } : {}) }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] });
    else { setAsk(i, { kind: "input", reason: "question", question: "Should it be A or B?", options: [], why: [] }); todos.note(i, "triage: for Chris: Should it be A or B? My recommendation is B, it is smaller."); }
    return i.id;
  })!.value;

  test("approving an option writes the note, clears the Ask and its fields, and makes no goal", async () => {
    const n = ask(true);
    await withRealCli(async () => {
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", body: "{}" })).status).toBe(403);
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "Z" }) })).status).toBe(400);
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      const i = item(n);
      expect(i.notes.at(-1)).toContain("Chris decided: A: do a");
      expect(i.fm.labels).toBeUndefined();
      expect(i.fm.question).toBeUndefined();
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) })).status).toBe(409);
    });
  });

  test("an option that waits sets after in the same write as the Ask clears", async () => {
    const n = ask(true, "fac-1.1");
    expect(readAsk(item(n))!.options[0].after).toBe("fac-1.1");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      expect(item(n).fm.labels).toBeUndefined();
      expect(item(n).fm.after).toEqual(["fac-1.1"]);
      expect(item(n).fm.question).toBeUndefined();
    });
  });

  test("an old prose note is approved by its recommendation sentence", async () => {
    const n = ask(false);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ recommendation: true }) });
      expect(r.status).toBe(200);
      expect(item(n).notes.at(-1)).toContain("Chris decided: My recommendation is B, it is smaller.");
      expect(item(n).fm.labels).toBeUndefined();
    });
  });

  const migrated = (reason: string, kind: "approval" | "input") => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, "a migrated ask", { request: "x" });
    Object.assign(i.fm, { kind: "issue", ask: kind, reason, question: "a migrated ask" });
    return i.id;
  })!.value;

  test("approving a migrated proposal clears the Ask and leaves the issue to triage", async () => {
    const n = migrated("proposal", "approval");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ approve: true }) });
      expect(r.status).toBe(200);
      const i = item(n);
      expect(i.notes.at(-1)).toContain("Chris approved it");
      for (const k of ["ask", "reason", "question"]) expect(i.fm[k]).toBeUndefined();
    });
  });

  test("the card routes take a goal's dotted id", async () => {
    const dotted = () => writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "a capped goal", { request: "x" });
      Object.assign(i, { id: 9000 + i.id, sub: 1 });
      Object.assign(i.fm, { kind: "goal", ask: "input", reason: "run-cap", question: "stopped" });
      return `${i.id}.1`;
    })!.value;
    const find = (ref: string) => readList({ key: "fac" })!.items.find((i) => `${i.id}.${i.sub}` === ref)!;
    await withRealCli(async () => {
      const a = dotted();
      expect((await at(`/api/issues/fac/${a}/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
      expect(find(a).fm.ask).toBeUndefined();
      expect(find(a).notes.at(-1)).toContain("run it again");
      const b = dotted();
      expect((await at(`/api/issues/fac/${b}/checked`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
      expect(todos.status(find(b))).toBe("done");
      const c = dotted();
      expect((await at(`/api/issues/fac/${c}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "no" }) })).status).toBe(200);
      expect(todos.status(find(c))).toBe("dropped");
      expect((await at(`/api/issues/fac/x.y/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(404);
    });
  });

  test("marking a migrated host check as checked closes it as done", async () => {
    const n = migrated("host-check", "input");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/checked`, { method: "POST", headers: h, body: "{}" });
      expect(r.status).toBe(200);
      expect(todos.status(item(n))).toBe("done");
      expect(item(n).notes.at(-1)).toContain("checked on the host");
    });
  });

  test("denying drops the issue with the reason", async () => {
    const n = ask(true);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "Chris denied: not now" }) });
      expect(r.status).toBe(200);
      expect(todos.status(item(n))).toBe("dropped");
      expect(item(n).notes.at(-1)).toContain("not now");
    });
  });
});

describe("POST /api/issues/:repo/:id/retriage and rerun", () => {
  const h = { "x-aleph-ui": "1", "content-type": "application/json" };
  const ask = () => writeList({ key: "fac" }, "seed", (doc) => (() => { const i = add(doc, "stuck triage", { request: "x" }); setAsk(i, { kind: "input", reason: "triage-failed", question: "triage failed", options: [], why: [] }); return i.id; })(), true)!.value;

  for (const [verb, argv] of [["retriage", ["issue", "note", "fac", "N", "Chris: run triage again"]], ["rerun", ["issue", "decide", "fac", "N", "Chris: run it again"]]] as const) {
    test(`${verb} refuses without the header, 404s an unknown issue and runs the CLI on an item with an ask`, async () => {
      const n = ask();
      rmSync(argvFile, { force: true });
      expect((await at(`/api/issues/fac/${n}/${verb}`, { method: "POST" })).status).toBe(403);
      expect((await at(`/api/issues/fac/${n}/${verb}`, { method: "POST", headers: { ...h, origin: "http://evil.example" } })).status).toBe(403);
      expect((await at(`/api/issues/fac/9999/${verb}`, { method: "POST", headers: h })).status).toBe(404);
      expect((await at(`/api/issues/nope/${n}/${verb}`, { method: "POST", headers: h })).status).toBe(404);
      expect(await Bun.file(argvFile).exists()).toBe(false);
      const r = await at(`/api/issues/fac/${n}/${verb}`, { method: "POST", headers: h });
      expect(r.status).toBe(200);
      expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(argv.map((a) => (a === "N" ? String(n) : a)));
    });
  }

  test("an issue that is not waiting for you is a 409", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "plain", { request: "x" }).id, true)!.value;
    expect((await at(`/api/issues/fac/${n}/retriage`, { method: "POST", headers: h })).status).toBe(409);
  });
});

describe("shared table CSS", () => {
  test("a chip in table.tbl is width-limited and td.wide has a min-width outside the 720px query", () => {
    const css = readFileSync(join(import.meta.dir, "index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    expect(rule("table.tbl .chip")).toMatch(/max-width:\s*\d+ch/);
    expect(rule("table.tbl .chip")).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule("table.tbl td.wide")).toMatch(/min-width:\s*16ch/);
    // the chip column's minimum is no wider than the chip cap, so a capped chip leaves the Title its room
    const cap = Number(rule("table.tbl .chip").match(/max-width:\s*(\d+)ch/)![1]);
    expect(Number(css.match(/\ntable\.tbl td:has\(> \.chips\)\s*\{[^}]*min-width:\s*(\d+)ch/)![1])).toBeLessThanOrEqual(cap);
  });
});
