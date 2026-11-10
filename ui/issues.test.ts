import { afterAll, beforeAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readList, writeList } from "../issues/lib/store.ts";
import { setCodes } from "../lib/naming.ts";
import { add, setStatus, type Doc } from "../issues/lib/todo.ts";
import { addPart } from "../issues/lib/parts.fixture.ts";
import * as todos from "../issues/lib/todo.ts";
import { askOf, setAsk, refIn } from "../jobs/lib/asks/ask.ts";
import { withEnv, withServer, type TestServer } from "./test-server.ts";
import { updater } from "./updater.ts";

// The fixtures change between tests, with no watcher to see it: each test starts with no kept answer.
beforeEach(() => updater.reset());
// @ts-ignore plain JS, shared with the page
import * as v from "./views/issues.js";
// @ts-ignore plain JS, shared with the page
import * as lib from "./lib.js";
// @ts-ignore plain JS, shared with the page
import { label, option } from "./chart.js";
// @ts-ignore plain JS, shared with the page
import { xLabel } from "./views/speed.js";
// @ts-ignore plain JS, shared with the page
import { when } from "./lib.js";
import { putRun } from "../jobs/lib/records/record.ts";

// The test's clock: the server reads it, and the runs start at it.
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const NOW = Date.parse("2026-11-04T12:00:00Z");
/** A local time as the ISO UTC string the store keeps. */
const iso = (t: string) => new Date(t.length === 10 ? `${t}T00:00` : t).toISOString();
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

/** An item stored as an issue: `kind: goal` on a plain number. */
const seedPart = (doc: Doc, title: string, body = "") => { return add(doc, title, { spec: body || "Do it." }); };

let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, jobsDir: string, argvFile: string, stdinFile: string;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, init);
const getJson = async (p: string) => (await at(p)).json() as Promise<any>;
/** The issue rows of `GET /api/issues`, of one project or of all. */
const rowsOf = async (project?: string): Promise<any[]> => (await getJson(project ? `/api/issues?project=${project}` : "/api/issues")).issues;
const post = (body: object, headers: Record<string, string> = { "x-aleph-ui": "1" }, q = "") =>
  at(`/api/issues${q}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function run(id: string, extra: Record<string, unknown>) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  putRun(basename(join(dir)), { kind: "build", told: true, started: new Date(NOW).toISOString(), ...extra } as any);
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
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    seedPart(doc, "first goal", "# Heading\n\n- one\n\n<script>alert(1)</script>");
    add(doc, "plain task", { kind: "bug", labels: ["bug"] });
    seedPart(doc, "second goal").fm.after = ["fac-4"];
    seedPart(doc, "third goal");
    setStatus(doc.items[1], "done");
    return true;
  }, true);
  writeList({ key: "oth" }, "seed", (doc) => { add(doc, "other thing"); return true; }, true);
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", condition: "landed", on: "fac-1" });
  run("20261027-000002-a", { job: "oth-1", name: "oth-1", repo: "oth", condition: "running", on: "oth-1" });
  ({ server, stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

describe("GET /api/issues", () => {
  test("lists the rows of a project", async () => {
    expect((await rowsOf("fac")).map((r: any) => r.id)).toEqual([1, 2, 3, 4]);
    expect((await rowsOf("fac")).filter((r: any) => r.status === "done").map((r: any) => r.id)).toEqual([2]);
    const [r] = await rowsOf("fac");
    expect(r).toMatchObject({ repo: "fac", title: "first goal", status: "open", priority: "medium", labels: [], after: [], notes: 0 });
    expect(r.updated).toBeTruthy();
  });

  test("a row and the issue page carry the kind, and the views show it as a chip", async () => {
    const n = 2;
    const row = (await rowsOf("fac")).find((r: any) => r.id === n);
    expect(row.kind).toBe("bug");
    const d = await getJson(`/api/issues/fac-${n}`);
    expect(d.kind).toBe("bug");
    expect(v.renderIssue(d)).toContain('<span class="chip kind">kind: bug</span>');
    expect(v.renderRow(v.issueRows({ issues: [row] })[0])).toContain('<span class="chip kind">bug</span>');
  });

  test("the issue page's head is pageHead: the view-only title, the title input and the Edit button", async () => {
    const d = await getJson("/api/issues/fac-2");
    const real = { ...lib }, tagged = (t: string, o: object) => `<!--pageHead-->${real.pageHead(t, o)}`;
    mock.module("./lib.js", () => ({ ...real, pageHead: tagged }));
    try {
      const h = v.renderIssue(d);
      expect(h.match(/<header class="ph">/g)).toHaveLength(1);
      expect(h).toContain(`<!--pageHead--><header class="ph"><h1 class="view-only">${d.title}</h1><input class="edit-only title-edit" name="title" form="issue-edit" required aria-label="Title" value="${d.title}"><div class="aside"><button class="act view-only" type="button" data-edit="start">Edit</button>`);
    } finally {
      mock.module("./lib.js", () => real);
    }
  });

  test("a row carries its stage", async () => {
    const rows = await rowsOf("fac");
    expect(rows[0].stage).toBe("done");
    expect(rows[2].stage).toBe("held");
  });
});

describe("POST /api/issues/:id/drop", () => {
  test("drops the issue through the real CLI and returns its status; an unknown id is 404", async () => {
    const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
    writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "..", "jobs", "cli.ts")} "$@"\n`);
    chmodSync(wrap, 0o755);
    process.env.ALEPH_CLI = wrap;
    try {
      const h = { "x-aleph-ui": "1", "content-type": "application/json" };
      expect((await at("/api/issues/fac-99/drop", { method: "POST", headers: h })).status).toBe(404);
      expect((await at("/api/issues/nope-1/drop", { method: "POST", headers: h })).status).toBe(404);
      expect((await at("/api/issues/fac-3/drop", { method: "POST" })).status).toBe(403);
      const r = await at("/api/issues/fac-3/drop", { method: "POST", headers: h, body: JSON.stringify({}) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ repo: "fac", id: 3, status: "dropped" });
      expect((await getJson("/api/issues/fac-3")).status).toBe("dropped");
    } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
  });
});

describe("GET /api/issues/:id", () => {
  test("lists runs by on, parts included, and by todo for old runs", async () => {
    run("20261027-000010-a", { job: "on-4", name: "on-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000011-a", { job: "goal-4-1", name: "goal-4-1", repo: "fac", condition: "running", on: "fac-4.1" });
    run("20261027-000012-a", { job: "on-2", name: "on-2", repo: "fac", condition: "running", on: "fac-2" });
    run("20261027-000013-a", { job: "todo-4", name: "todo-4", repo: "fac", condition: "running", on: "fac-4" });
    run("20261027-000014-a", { job: "other-4", name: "other-4", repo: "oth", condition: "running", on: "oth-4" });
    const d = await getJson("/api/issues/fac-4");
    expect(d.jobs.map((j: any) => j.name).sort()).toEqual(["goal-4-1", "on-4", "todo-4"]);
    const g = await getJson("/api/issues/fac-2");
    expect(g.jobs.map((j: any) => j.name)).toEqual(["on-2"]);
  });

  test("unknown issue and other project are 404", async () => {
    expect((await at("/api/issues/fac-99")).status).toBe(404);
    expect((await at("/api/issues/fac-1?project=oth")).status).toBe(404);
    expect((await at("/api/issues/fac-1?project=fac")).status).toBe(200);
  });
});

describe("views", () => {

  test("/api/issues gives the issues with their run counts and the registry's keys", async () => {
    const d = await getJson("/api/issues");
    expect(d.issues.length).toBeGreaterThan(3);
    expect([...d.projects].sort()).toEqual(["fac", "oth"]);
    expect(d).not.toHaveProperty("specs");
    expect([...new Set(d.issues.map((i: any) => i.repo))].sort()).toEqual(["fac", "oth"]);
    expect(d.issues.every((i: any) => typeof i.runs === "number" && typeof i.cost === "number")).toBe(true);
    expect((await getJson("/api/issues?project=fac")).projects).toEqual(["fac"]);
  });

  test("the tests card charts the suite history of the selected project in the window", async () => {
    const rec = (repo: string, at: string, ran: number, rerunPassed: number) => ({ repo, commit: "c", at, ran, passed: ran, failed: 0, skipped: 0, rerunPassed });
    const now = new Date("2026-11-04T12:00:00Z"), recs = [rec("fac", "2026-11-04T10:00:00Z", 120, 2), rec("fac", "2026-10-01T10:00:00Z", 90, 1), rec("oth", "2026-11-04T11:00:00Z", 40, 0)];
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "suite-history.jsonl"), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const d = await getJson("/api/issues");
    expect(Object.keys(d.tests).sort()).toEqual(["fac", "oth"]);
    expect(d.tests.fac.map((r: any) => r.ran)).toEqual([120, 90]);
    expect(Object.keys((await getJson("/api/issues?project=oth")).tests)).toEqual(["oth"]);
    const page = v.view.render(d, {}, new URLSearchParams());
    expect(page).toContain('<aleph-chart key="issues/tests"');
    const all = v.testsFrame(d.tests, "", "week", now);
    expect(all.by.keys.map((k: any) => k.name)).toEqual(["fac tests", "fac passed on rerun", "oth tests", "oth passed on rerun"]);
    expect(all.rows.map((r: any) => [r.at, r["fac tests"] ?? 0, r["fac passed on rerun"] ?? 0, r["oth tests"] ?? 0]))
      .toEqual([[Date.parse("2026-11-04T10:00:00Z"), 120, 2, 0], [Date.parse("2026-11-04T11:00:00Z"), 0, 0, 40]]);
    const fac = v.testsFrame(d.tests, "fac", "month", now);
    expect(fac.by.keys.map((k: any) => k.name)).toEqual(["fac tests", "fac passed on rerun"]);
    expect(fac.rows.map((r: any) => r["fac tests"])).toEqual([120]);
    expect(v.testsFrame(d.tests, "fac", "month", new Date("2026-10-02T00:00:00Z")).rows).toHaveLength(1);
    // The frame counts tests, so its axis and tooltip read as whole numbers.
    expect(option(all, "lines", {}).yAxis.axisLabel.formatter(120)).toBe("120");
  });

  test("the view is Issues at #/issues; #/inventory and #/projects redirect, the detail routes do not", () => {
    expect(v.view.path).toBe("/issues");
    expect(v.view.title).toBe("Issues");
    expect(v.view.group).toBe("factory");
    expect(v.redirect("#/inventory")).toBe("#/issues");
    expect(v.redirect("#/inventory?status=open")).toBe("#/issues?status=open");
    expect(v.redirect("#/projects")).toBe("#/issues");
    expect(v.redirect("#/contents")).toBe("#/issues");
    expect(v.redirect("#/issues/fac/1")).toBeNull();
    expect(v.redirect("#/projects/fac")).toBeNull();
    expect(v.redirect("#/issues")).toBeNull();
  });

  const section = (h: string, id: string) => h.split(`<div id="${id}">`)[1]?.split("</table>")[0] ?? "";

  test("the page is tiles, charts, search, filters and one table, with no Projects or Specs tables", async () => {
    const d = await getJson("/api/issues");
    const h = v.view.render(d, {}, new URLSearchParams("status=any"));
    expect(h).not.toContain("<h2>Projects");
    expect(h).not.toContain("<h2>Specs");
    expect(h).toContain('class="tiles"');
    for (const q of ["status=any", "tile=filed&status=any", "tile=age"]) {
      const page = v.view.render(d, {}, new URLSearchParams(q));
      for (const c of ["backlog", "close"]) expect(page).toContain(`<aleph-chart key="issues/${c}"`);
      expect(page).not.toContain('key="issues/age"');
      expect(page).not.toContain("Open issues by age");
    }
    expect(h.indexOf('class="tiles"')).toBeLessThan(h.indexOf('key="issues/backlog"'));
    expect(h.indexOf('key="issues/backlog"')).toBeLessThan(h.indexOf('data-ui="inv-search"'));
    const ths = (html: string) => [...html.matchAll(/<th(?: [^>]*)?>(?:<button[^>]*data-sort="(\w+)")?/g)].map((m) => m[1] ?? "");
    expect(ths(section(h, "issues-table"))).toEqual(["updated", "id", "title", "stage", "project", "priority", "labels", "notes", "runs", "cost", "age"]);
    expect(h).toContain(`<div class="sh"><h2>Issues</h2><span class="count">${d.issues.length}</span></div>`);
  });

  test("issue rows: Updated first, then Id, Title, Stage, Project and Labels, and no X", async () => {
    const d = await getJson("/api/issues");
    const h = section(v.view.render(d, {}, new URLSearchParams("status=any")), "issues-table");
    expect(h).toContain('href="#/issues/fac/1"');
    expect(h).not.toContain('href="#/projects/');
    const rows = h.split("<tr class=\"rowlink").slice(1);
    const closed = rows.filter((r: string) => r.includes("plain task"));
    expect(closed).toHaveLength(1);
    expect(rows.some((r: string) => r.includes("data-cancel"))).toBe(false);
    expect(rows.every((r: string) => /^[^>]*><td class="time">/.test(r))).toBe(true);
    expect(closed[0]).toContain(">done</span>");
    expect(v.view.render(d, {}, new URLSearchParams())).toContain("File an issue");
  });

  test("the project filter is a select with what the other filters leave", async () => {
    const d = await getJson("/api/issues");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(h).toMatch(/<option value="oth" selected>oth \(\d+\)<\/option>/);
    expect(h).toMatch(/<option value="fac">fac \(\d+\)<\/option>/);
    expect(h).toMatch(/<option value="">All \(\d+\)<\/option>/);
    expect(h).not.toMatch(/oth \d+<\/option>/);
    const rows = v.issueRows(d);
    const counts = (o: object) => v.renderProjects(d.projects, rows, o);
    const n = rows.filter((r: any) => r.project === "oth" && r.status === "open").length;
    expect(counts({ status: "open" })).toContain(`<option value="oth">oth (${n})</option>`);
    expect(counts({})).toContain('aria-label="Window" data-name="window"');
    expect(counts({})).not.toContain('class="fl">Window');
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
      { id: 1, repo: "fac", title: "Workstatus page", status: "open", labels: [], updatedTime: iso("2026-10-30") },
      { id: 2, repo: "fac", title: "status of the land", status: "open", labels: [], updatedTime: iso("2026-10-01") },
      { id: 3, repo: "fac", title: "Set up a tiny ultra stack", status: "open", labels: [], updatedTime: iso("2026-10-31") },
    ] });
    const titles = (o: object) => [...v.renderTable(rows, { status: "open", ...o }).matchAll(/<td class="wide"><a[^>]*>(.*?)<\/a>/g)].map((m) => m[1].replace(/<\/?mark>/g, ""));
    expect(titles({ q: "status" })[0]).toBe("status of the land");
    expect(titles({ q: "status" })).not.toContain("Set up a tiny ultra stack");
    expect(titles({ q: "status", sort: { key: "id", dir: -1 } })).toEqual(["status of the land", "Workstatus page"]);
    expect(v.renderTable(rows, { status: "open", q: "land" })).toContain("<mark>land</mark>");
  });

  test("a child and an old part show indented under their parent, whatever the sort; a child whose parent is filtered out keeps its place", () => {
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "fac", title: "parent", status: "open", labels: [], updatedTime: iso("2026-10-01") },
      { id: 2, repo: "fac", title: "other", status: "open", labels: [], updatedTime: iso("2026-10-20") },
      { id: 3, repo: "fac", title: "child", parent: "1", status: "open", labels: [], updatedTime: iso("2026-10-31") },
      { id: 1, ref: "1.1", parent: "1", repo: "fac", title: "old part", status: "open", labels: [], updatedTime: iso("2026-10-30") },
      { id: 4, repo: "fac", title: "lone child", parent: "9", status: "open", labels: [], updatedTime: iso("2026-10-10") },
    ] });
    const html = v.renderTable(rows, { status: "open" });
    expect([...html.matchAll(/<td class="wide"><a[^>]*>(.*?)<\/a>/g)].map((m) => m[1])).toEqual(["other", "lone child", "parent", "child", "old part"]);
    expect([...html.matchAll(/<tr class="rowlink( part-row)?"[^>]*data-n="([^"]+)"/g)].filter((m) => m[1]).map((m) => m[2])).toEqual(["4", "3", "1.1"]);
  });

  test("the numbers: open, filed and closed in 7 days, the week before, age and runs; a part's run is not counted twice", () => {
    const now = new Date("2026-11-01T12:00");
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "open", stage: "new", labels: [], createdTime: iso("2026-11-01"), runs: 2, cost: 1 },
      { id: 1, ref: "1.1", parent: "1", repo: "f", title: "a part", status: "open", stage: "working", labels: [], createdTime: iso("2026-10-20"), runs: 2, cost: 1 },
      { id: 2, repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-10-21"), closedTime: iso("2026-10-30T12:00"), runs: 3, cost: 0.5 },
      { id: 3, repo: "f", title: "c", status: "dropped", labels: [], createdTime: iso("2026-10-26"), closedTime: iso("2026-10-25"), runs: 0, cost: 0 },
    ] });
    expect(v.stats(rows, now)).toMatchObject({ total: 4, open: 2, stages: { new: 1, working: 1 }, filed: 2, filedBefore: 2, closed: 1, done: 1, dropped: 0, closedBefore: 1, medianAge: 6, oldest: 12, runs: 5, cost: 1.5 });
    const f = v.flow(rows, "month", now);
    expect(f.ats).toHaveLength(30);
    expect(lib.day(f.ats.at(-1), now)).toBe("Nov 01");
    expect(f.filed.at(-1)).toBe(1);
    expect(f.closed.at(-3)).toBe(1);
    const b = v.backlog(rows, "month", now);
    expect(b.ats).toHaveLength(30);
    // Row 1 is open from Nov 01; the part from Oct 20; row 2 from Oct 21 to Oct 30; row 3 closed before it was created.
    expect(b.counts.medium.at(-1)).toBe(2);
    expect(b.counts.medium.at(-3)).toBe(2);
    expect(b.counts.medium.at(-2)).toBe(1);
    expect(b.counts.medium[0]).toBe(0);
    expect(b.counts.high.at(-1)).toBe(0);
    const c = v.closeTimes([
      ...[1, 2, 3, 4, 5].map((n) => ({ status: "done", kind: "bug", createdTime: iso("2026-10-01"), closedTime: iso(`2026-10-0${n + 1}`) })),
      { status: "done", kind: "task", createdTime: iso("2026-10-01"), closedTime: iso("2026-10-05") },
      { status: "open", kind: "flake", createdTime: iso("2026-10-01"), closedTime: null },
    ], "month", new Date("2026-10-10T12:00"));
    expect(c.kinds).toEqual(["task", "bug", "check", "proposal", "flake"]);
    expect(c.p50).toEqual([4, 3, null, null, null]);
    expect(c.p90[1]).toBeCloseTo(4.6);
    expect(v.flow(rows, "week", now).ats).toHaveLength(7);
    expect(lib.day(v.flow(rows, "week", now).ats.at(-1), now)).toBe("Nov 01");
    // The frame carries every bucket: the four priorities, then the filed and closed counts of the same buckets.
    const fr = v.backlogFrame(b, f, "month");
    expect(fr.over).toEqual({ kind: "time", window: "month" });
    expect(fr.by.keys.map((k: any) => k.name)).toEqual(["low", "medium", "high", "critical", "Filed", "Closed"]);
    expect(fr.rows.map((r: any) => [r.at, r.medium, r.filed, r.closed])).toEqual(b.ats.map((at: number, i: number) => [at, b.counts.medium[i], f.filed[i], f.closed[i]]));
    // The option draws the keys with a value: the priorities with none are left out.
    const o = option(fr, "area", {});
    expect(o.series.map((s: any) => s.name)).toEqual(["medium", "Filed", "Closed"]);
    expect([o.yAxis.minInterval, o.yAxis.axisLabel.formatter(3)]).toEqual([1, "3"]);
    expect(v.renderTiles(v.stats(rows, now))).toContain('<b>1<em> / 0</em></b><span class="q"><span>closed</span><span class="m"> / dropped</span></span>');
  });

  test("the window sets the Open backlog buckets, the Time to close rows and the backlog card title", async () => {
    const now = new Date("2026-11-04T16:00");
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "open", labels: [], createdTime: iso("2026-11-04T15:30") },
      { id: 2, repo: "f", title: "b", status: "done", kind: "bug", labels: [], createdTime: iso("2026-10-20"), closedTime: iso("2026-10-25") },
      { id: 3, repo: "f", title: "c", status: "done", kind: "bug", labels: [], createdTime: iso("2026-11-01"), closedTime: iso("2026-11-02") },
    ] });
    const one = rows.filter((r: any) => r.id === "f-1");
    const hour = v.backlog(one, "hour", now), dayB = v.backlog(one, "day", now);
    expect(hour.ats).toHaveLength(60);
    expect(dayB.ats).toHaveLength(24);
    for (const b of [hour, dayB]) {
      const i = b.counts.medium.findIndex((n: number) => n > 0);
      expect(b.counts.medium.slice(i).every((n: number) => n === 1)).toBe(true);
    }
    expect(hour.counts.medium.indexOf(1)).toBe(29);
    expect(dayB.counts.medium.indexOf(1)).toBe(23);
    const w = v.backlog(rows, "week", now), m = v.backlog(rows, "month", now);
    expect(w.ats).toHaveLength(7);
    expect(lib.day(w.ats.at(-1), now)).toBe("Nov 04");
    expect(m.ats).toHaveLength(30);
    expect(v.closeTimes(rows, "week", now).p50[1]).toBe(24);
    expect(v.closeTimes(rows, "month", now).p50[1]).toBe(3);
    const d = await getJson("/api/issues");
    const page = v.view.render(d, {}, new URLSearchParams("window=week"));
    expect(page).toContain("<h2>Open Backlog, Filed and Closed</h2>");
    expect(page).toMatch(/<header class="ph"><h1>Issues<\/h1><span class="count">last week<\/span>/);
    expect(page).toContain("<h2>Time to Close</h2>");
    // Each panel's title, aria label and empty line come from its frame.
    expect(label(v.backlogFrame(w, v.flow(rows, "week", now), "week"))).toBe("Open Backlog, Filed and Closed: medium peak 1, Filed peak 1, Closed peak 1");
    expect(page).toContain('aria-label="Open Backlog, Filed and Closed"');
    expect(page).toContain('aria-label="Time to Close"');
    for (const k of ["backlog", "close", "tests"]) expect(page).toMatch(new RegExp(`<aleph-chart key="issues/${k}"[^>]*><section class="card" aria-label="[^"]+">`));
    expect(page).toMatch(/<div class="chartbox" role="img" aria-label="Open Backlog, Filed and Closed: [^"]+">/);
    expect(page).not.toContain("30 days");
  });

  test("a chart panel with nothing to plot shows the frame's empty line and no chart box", () => {
    const page = v.renderIssues({ issues: [], tests: { f: [{ at: "2020-01-01T00:00:00Z", ran: 5, rerunPassed: 0 }] } }, { window: "week" });
    expect(page).toContain("<h2>Tests</h2>");
    for (const k of ["backlog", "close", "tests"]) expect(page).toContain(`<aleph-chart key="issues/${k}"`);
    expect(page).not.toContain("chartbox");
    expect(page.match(/class="empty"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(page.match(/Nothing to plot in this window\./g)!.length).toBe(3);
  });

  test("Time to close counts from the stored times and shows hours when every value is under 2 days", () => {
    const now = new Date("2026-11-04T16:00");
    const c = v.closeTimes([
      { status: "done", kind: "bug", createdTime: iso("2026-11-04T08:00"), closedTime: iso("2026-11-04T11:00") },
      { status: "done", kind: "bug", createdTime: iso("2026-11-04T08:00"), closedTime: iso("2026-11-04T13:00") },
    ], "week", now);
    expect(c.unit).toBe("hours");
    expect(c.p50[1]).toBe(4);
    const t = { muted: "#123456" };
    // The frame keeps the p50 and the p90 in seconds, so the axis formats them as a duration, and its note names the unit.
    expect(option(v.closeFrame({ ...c, unit: "days" }), "grouped", t).xAxis.axisLabel.formatter(4320)).toBe("1h 12m");
    expect(v.closeFrame({ ...c, unit: "days" }).note).toContain("Days from filed to closed");
    expect(v.closeFrame(c).note).toContain("Hours from filed to closed");
    expect(option(v.closeFrame(c), "grouped", t).series.find((s: any) => s.name === "p90").color).toBe(t.muted);
  });

  test("the window sets the Filed and Closed tiles; the Open tile is a Status card; the head holds the window; the form comes first", async () => {
    const now = new Date("2026-11-01T12:00");
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "done", labels: [], createdTime: iso("2026-11-01"), closedTime: iso("2026-11-01"), runs: 0, cost: 0 },
      { id: 2, repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-10-28"), closedTime: iso("2026-10-28"), runs: 0, cost: 0 },
    ] });
    expect(v.stats(rows, now, 1)).toMatchObject({ filed: 1, closed: 1 });
    expect(v.stats(rows, now, 1 / 24)).toMatchObject({ filed: 0, closed: 0 });
    expect(v.stats(rows, now, 7)).toMatchObject({ filed: 2, closed: 2 });
    // The table under a Filed or Closed tile follows the window too; the test's clock is NOW, 2026-11-04.
    const recent = v.issueRows({ issues: ["2026-11-04", "2026-11-01"].map((d, i) => ({ id: i, repo: "f", title: "t", status: "done", labels: [], createdTime: iso(d), closedTime: iso(d), runs: 0, cost: 0 })) });
    for (const tile of ["filed", "closed"]) {
      expect(v.filterRows(recent, { tile, window: "hour" })).toHaveLength(0);
      expect(v.filterRows(recent, { tile, window: "day" })).toHaveLength(1);
      expect(v.filterRows(recent, { tile, window: "week" })).toHaveLength(2);
    }
    const html = v.renderTiles(v.stats(rows, now, 1), "open", "day");
    for (const k of ["Filed", "Closed", "Open Age"]) expect(html).toContain(`>${k}<`);
    for (const k of ["Filed, last", "Closed, last", "Median open age"]) expect(html).not.toContain(k);
    expect(html).toContain("<span>open</span><span class=\"m\"> / in store</span>");
    const bare = v.renderTiles({ ...v.stats(rows, now, 1), medianAge: null, oldest: null, runs: undefined, cost: undefined } as any, "open", "day");
    expect(bare).not.toMatch(/undefined|NaN/);
    expect(bare).toContain("<b>–</b>");
    const up = v.renderTiles({ ...v.stats(rows, now, 1), filed: 3, filedBefore: 1, closed: 3, closedBefore: 1, medianAge: 2, oldest: 5 }, "open", "day");
    expect(up).toContain("<span>open age</span><span class=\"m\"> / oldest</span>");
    expect(up.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Closed[\s\S]*?<\/button>/)![0]).toMatch(/class="[^"]*\bgood\b/);
    expect(up.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?Filed[\s\S]*?<\/button>/)![0]).toMatch(/class="[^"]*\bwarn\b/);
    expect(html).not.toContain("7 days");
    const open = html.match(/<button[^>]*class="tile sc"[\s\S]*?<\/button>/)![0];
    expect(open.match(/<(span|b)\b[^>]*class="(r1|q|q m)"|<b>/g)).toHaveLength(3);
    const page = v.view.render(await getJson("/api/issues"), {}, new URLSearchParams("window=day"));
    const head = page.match(/<header class="ph">[\s\S]*?<\/header>/)![0];
    expect(head).toContain('<span class="count">last day</span>');
    expect(page).not.toContain("Filed and closed per");
    const t = new Date(2026, 10, 4, 16, 0), tr = [{ status: "done", createdTime: iso("2026-11-04T15:30"), closedTime: iso("2026-11-04T15:45") }, { status: "open", createdTime: iso("2026-11-04T09:10") }];
    const fh = v.flow(tr, "hour", t), fd = v.flow(tr, "day", t);
    const hourAt = (s: string) => fh.ats.findIndex((at: number) => xLabel(at, "hour") === s);
    const dayAt = (s: string) => fd.ats.findIndex((at: number) => xLabel(at, "day") === s);
    expect(fh.ats).toHaveLength(60);
    expect(fh.filed.reduce((a: number, b: number) => a + b)).toBe(1);
    expect(fh.filed[hourAt("3:30p")]).toBe(1);
    expect(fh.closed[hourAt("3:45p")]).toBe(1);
    expect(fd.ats).toHaveLength(24);
    expect(fd.filed[dayAt("9a")]).toBe(1);
    expect(head).toContain('data-name="window"');
    for (const w of ["Hour", "Day", "Week", "Month"]) expect(head).toContain(`>${w}</button>`);
    expect(head).toContain('<select name="project"');
    expect(head.indexOf('<select name="project"')).toBeLessThan(head.indexOf('data-name="window"'));
    expect(head).not.toContain('data-act="pause"');
    expect(page.indexOf('<details class="new">')).toBeLessThan(page.indexOf('id="issues-table"'));
  });

  test("each number column sorts; age counts to the closing", () => {
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "open", priority: "low", labels: [], createdTime: iso("2026-10-01"), notes: 1, runs: 9, cost: 0 },
      { id: 2, repo: "f", title: "b", status: "open", priority: "high", labels: [], createdTime: iso("2026-10-20"), notes: 5, runs: 1, cost: 3 },
    ] });
    const first = (key: string, dir = -1) => v.sortRows(rows, { key, dir })[0].title;
    expect(first("priority")).toBe("b");
    expect(first("notes")).toBe("b");
    expect(first("runs")).toBe("a");
    expect(first("cost")).toBe("b");
    expect(first("age")).toBe("a");
    expect(v.ageText({ status: "done", createdTime: iso("2026-10-01"), closedTime: iso("2026-10-11") })).toBe("10d");
    expect(v.dateText("2026-10-20", new Date("2026-11-01T12:00"))).toBe("Oct 20");
    expect(v.dateText("2025-10-20", new Date("2026-11-01T12:00"))).toBe("2025-10-20");
  });

  test("the Status filter defaults to Open, newest first; Any shows every status", async () => {
    const d = await getJson("/api/issues");
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

  test("the header sorts: a query key and direction order the rows", async () => {
    const d = await getJson("/api/issues");
    const ids = (q: string) => [...v.view.render(d, {}, new URLSearchParams(q + "&type=issue&status=any")).matchAll(/class="idl" href="[^"]*">([^<]+)</g)].map((m) => m[1].replace(/^\D+/, ""));
    expect(ids("sort=id&dir=asc")).toEqual([...ids("sort=id&dir=asc")].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(ids("sort=id&dir=desc")).toEqual(ids("sort=id&dir=asc").reverse());
    expect(v.view.render(d, {}, new URLSearchParams("sort=title&dir=asc"))).toContain('aria-sort="ascending"');
  });

  test("a part row names its part and nests", () => {
    const rows = v.issueRows({ issues: [
      { id: 910, ref: "910", repo: "fac", title: "ask", status: "open", labels: [] },
      { id: 910, ref: "910.1", parent: "910", repo: "fac", title: "part", status: "open", labels: [] },
    ] });
    const [, partRow] = rows;
    expect(partRow).toMatchObject({ id: "fac-910.1", href: "#/issues/fac/910.1", part: true, parent: "fac-910" });
    expect(v.renderRow(partRow)).toContain("part-row");
    expect(v.sortRows(rows, { key: "id", dir: -1 })[0]).toBe(partRow);
  });
});

describe("POST /api/issues", () => {
  test("turns the spec label into --spec -, and passes title, labels and the text on stdin to `aleph issue add`", async () => {
    const res = await post({ repo: "fac", title: "new one", body: "## Goal\n\ndo it", labels: ["spec", "x"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 7 });
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["issue", "add", "--spec", "-", "--labels", "x", "--", "fac", "new one"]);
    expect(readFileSync(stdinFile, "utf8")).toBe("## Goal\n\ndo it");
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

describe("POST /api/issues/:id/decide and deny", () => {
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
    if (decision) setAsk(refIn(doc.repo!, i), { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a", ...(wait ? { after: wait } : {}) }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] });
    else { setAsk(refIn(doc.repo!, i), { kind: "input", reason: "question", question: "Should it be A or B?", options: [], why: [] }); todos.note(i, "triage: for Chris: Should it be A or B? My recommendation is B, it is smaller."); }
    return i.id;
  })!.value;

  test("approving an option writes the note, clears the Ask and its fields, and makes no issue", async () => {
    const n = ask(true);
    await withRealCli(async () => {
      expect((await at(`/api/issues/fac-${n}/decide`, { method: "POST", body: "{}" })).status).toBe(403);
      expect((await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "Z" }) })).status).toBe(400);
      const r = await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      const i = item(n);
      expect(i.notes.at(-1)).toContain("Chris decided: A: do a");
      expect(i.fm.labels).toBeUndefined();
      expect(i.fm.question).toBeUndefined();
      expect((await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) })).status).toBe(409);
    });
  });

  test("an option that waits sets after in the same write as the Ask clears", async () => {
    const n = ask(true, "fac-1.1");
    expect(askOf(`fac-${n}`)!.options[0].after).toBe("fac-1.1");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      expect(item(n).fm.labels).toBeUndefined();
      expect(item(n).fm.after).toEqual(["fac-1.1"]);
      expect(item(n).fm.question).toBeUndefined();
    });
  });

  test("an old prose note is approved by its recommendation sentence", async () => {
    const n = ask(false);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ recommendation: true }) });
      expect(r.status).toBe(200);
      expect(item(n).notes.at(-1)).toContain("Chris decided: My recommendation is B, it is smaller.");
      expect(item(n).fm.labels).toBeUndefined();
    });
  });

  const migrated = (reason: string, kind: "approval" | "input") => {
    const n = writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "a migrated ask", { request: "x" });
      Object.assign(i.fm, { kind: "issue" });
      return i.id;
    })!.value;
    setAsk(`fac-${n}`, { kind, reason, question: "a migrated ask", options: [], why: [] });
    return n;
  };

  test("approving a migrated proposal clears the Ask and leaves the issue to triage", async () => {
    const n = migrated("proposal", "approval");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ approve: true }) });
      expect(r.status).toBe(200);
      const i = item(n);
      expect(i.notes.at(-1)).toContain("Chris approved it");
      for (const k of ["ask", "reason", "question"]) expect(i.fm[k]).toBeUndefined();
    });
  });

  test("the card routes take a part's dotted id", async () => {
    const dotted = () => writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "a capped goal", { request: "x" });
      Object.assign(i, { id: 9000 + i.id, sub: 1 });
      Object.assign(i.fm, { kind: "goal" });
      return `${i.id}.1`;
    })!.value;
    const capped = () => { const r = dotted(); setAsk(`fac-${r}`, { kind: "input", reason: "run-cap", question: "stopped", options: [], why: [] }); return r; };
    const find = (ref: string) => readList({ key: "fac" })!.items.find((i) => `${i.id}.${i.sub}` === ref)!;
    await withRealCli(async () => {
      const a = capped();
      expect((await at(`/api/issues/fac-${a}/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
      expect(askOf(`fac-${a}`)).toBeNull();
      expect(find(a).notes.at(-1)).toContain("run it again");
      const b = capped();
      expect((await at(`/api/issues/fac-${b}/checked`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
      expect(todos.status(find(b))).toBe("done");
      const c = dotted();
      expect((await at(`/api/issues/fac-${c}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "no" }) })).status).toBe(200);
      expect(todos.status(find(c))).toBe("dropped");
      expect((await at(`/api/issues/fac-x.y/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(404);
    });
  });

  test("marking a migrated host check as checked closes it as done", async () => {
    const n = migrated("host-check", "input");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac-${n}/checked`, { method: "POST", headers: h, body: "{}" });
      expect(r.status).toBe(200);
      expect(todos.status(item(n))).toBe("done");
      expect(item(n).notes.at(-1)).toContain("checked on the host");
    });
  });
});

describe("POST /api/issues/:id/retriage and rerun", () => {
  const h = { "x-aleph-ui": "1", "content-type": "application/json" };
  const ask = () => writeList({ key: "fac" }, "seed", (doc) => (() => { const i = add(doc, "stuck triage", { request: "x" }); setAsk(refIn(doc.repo!, i), { kind: "input", reason: "triage-failed", question: "triage failed", options: [], why: [] }); return i.id; })(), true)!.value;

  for (const [verb, argv] of [["retriage", ["issue", "note", "--", "fac", "N", "Chris: run intake again"]], ["rerun", ["issue", "decide", "--", "fac", "N", "Chris: run it again"]]] as const) {
    test(`${verb} refuses without the header, 404s an unknown issue and runs the CLI on an item with an ask`, async () => {
      const n = ask();
      rmSync(argvFile, { force: true });
      expect((await at(`/api/issues/fac-${n}/${verb}`, { method: "POST" })).status).toBe(403);
      expect((await at(`/api/issues/fac-${n}/${verb}`, { method: "POST", headers: { ...h, origin: "http://evil.example" } })).status).toBe(403);
      expect((await at(`/api/issues/fac-9999/${verb}`, { method: "POST", headers: h })).status).toBe(404);
      expect((await at(`/api/issues/nope-${n}/${verb}`, { method: "POST", headers: h })).status).toBe(404);
      expect(await Bun.file(argvFile).exists()).toBe(false);
      const r = await at(`/api/issues/fac-${n}/${verb}`, { method: "POST", headers: h });
      expect(r.status).toBe(200);
      expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(argv.map((a) => (a === "N" ? String(n) : a)));
    });
  }

  test("an issue that is not waiting for you is a 409", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "plain", { request: "x" }).id, true)!.value;
    expect((await at(`/api/issues/fac-${n}/retriage`, { method: "POST", headers: h })).status).toBe(409);
  });
});

describe("a parked issue", () => {
  test("lists as status parked; the filter offers it and narrows to it; the badge differs; it is neither open nor closed", async () => {
    let n = 0;
    writeList({ key: "oth" }, "park", (doc) => { const p = add(doc, "shelved thing"); setStatus(p, "parked"); n = p.id; return true; }, true);
    const rows = (await rowsOf()).filter((r: any) => r.status === "parked");
    expect(rows.map((r: any) => [r.repo, r.id, r.status])).toEqual([["oth", n, "parked"]]);
    expect((await getJson(`/api/issues/oth-${n}`)).status).toBe("parked");
    const all = v.issueRows({ issues: [
      ...rows,
      { id: 8, repo: "f", title: "o", status: "open", stage: "new", labels: [], createdTime: iso("2026-11-01") },
      { id: 9, repo: "f", title: "d", status: "done", labels: [], createdTime: iso("2026-10-30"), closedTime: iso("2026-11-01") },
    ] });
    expect(v.renderFilters(all, { status: "" })).toContain("parked");
    const only = v.renderTable(all, { status: "parked" });
    expect(only).toContain("shelved thing");
    expect(only).not.toContain(">o<");
    expect(only).toContain('<span class="badge parked">parked</span>');
    expect(v.renderTable(all, { status: "open" })).not.toContain("shelved thing");
    expect(v.stats(all, new Date("2026-11-02T12:00"))).toMatchObject({ total: 3, open: 1, closed: 1 });
  });
});

describe("what an issue waits on", () => {
  let waiter: string, live: string, dead: string, tracker: string;
  beforeAll(() => {
    writeList({ key: "oth" }, "blockers", (doc) => {
      const d = add(doc, "gone work"); setStatus(d, "dropped");
      const t = add(doc, "note log"); t.fm.tracker = "true";
      const l = add(doc, "live work");
      const w = add(doc, "waiter"); w.fm.after = [`oth-${d.id}`, `oth-${t.id}`, `oth-${l.id}`];
      const n = add(doc, "healthy waiter"); n.fm.after = [`oth-${l.id}`];
      dead = `oth-${d.id}`; tracker = `oth-${t.id}`; live = `oth-${l.id}`; waiter = String(w.id);
      return true;
    }, true);
  });
  const unblock = (id: string, headers: Record<string, string> = { "x-aleph-ui": "1" }) => at(`/api/issues/oth-${id}/unblock`, { method: "POST", headers });

  test("the detail names each wait, with what makes it dead", async () => {
    const d = await (await at(`/api/issues/oth-${waiter}`)).json();
    expect(d.blockers.map((b: any) => [b.id, b.title, b.dead])).toEqual([[dead, "gone work", "dropped"], [tracker, "note log", "tracker"], [live, "live work", null]]);
    expect((await (await at(`/api/issues/oth-${Number(waiter) + 1}`)).json()).blockers.map((b: any) => b.dead)).toEqual([null]);
  });

  test("the unblock route removes the dead waits, keeps the live one, and refuses the rest", async () => {
    rmSync(argvFile, { force: true });
    expect((await unblock(waiter, {})).status).toBe(403);
    expect((await unblock(waiter, { "x-aleph-ui": "1", origin: "http://evil.example" })).status).toBe(403);
    expect((await unblock("999")).status).toBe(404);
    expect((await unblock(String(Number(waiter) + 1))).status).toBe(409);
    expect(existsSync(argvFile)).toBe(false);
    const res = await unblock(waiter);
    expect(res.status).toBe(200);
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["issue", "edit", "--after", live, "--", "oth", waiter]);
  });
});

describe("the Issue page shows the ask row", () => {
  const seed = (stored: boolean) => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, stored ? "ask with text" : "plain", { request: "x" });
    setAsk(refIn(doc.repo!, i), { kind: "input", reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"],
      ...(stored ? { situation: "Two ways to go.", effects: [{ action: "decide:A", text: "Goes with A." }, { action: "decide:B", text: "Goes with B." }], recommend: { action: "decide:B", why: "smaller" } } : {}) });
    return i.id;
  }, true)!.value;

  test("renderIssue puts the Committed time first in the Commits table", async () => {
    const d = await getJson(`/api/issues/fac-1`);
    const date = "2026-11-02T09:00:00Z";
    const h = v.renderIssue({ ...d, commits: [{ hash: "abcdef1234567", subject: "s", date }] });
    expect(h).toContain("<th>Committed</th><th>Commit</th><th>Subject</th>");
    expect(h).toContain(`<tr><td class="time">${when(date)}</td><td><code>abcdef1</code></td>`);
  });

  test("renderIssue shows empty() for no commits and pages the Commits table at 50", async () => {
    const d = await getJson(`/api/issues/fac-1`);
    expect(v.renderIssue({ ...d, commits: [] })).toContain("No commit on main names this issue");
    const commits = Array.from({ length: 51 }, (_, i) => ({ hash: `abcdef${i}0000`, subject: `s${i}`, date: "2026-11-02T09:00:00Z" }));
    expect(v.renderIssue({ ...d, commits })).toContain("50 of 51");
  });

  test("renderIssue shows one row with the situation, effects and buttons, and no ask fields in the front matter", async () => {
    const n = seed(true);
    const d = await getJson(`/api/issues/fac-${n}`);
    d.frontmatter = { ...d.frontmatter, situation: "S", effects: "E", recommend: "R", extra: "kept" };
    const h = v.renderIssue(d);
    expect(h.match(/<article[^>]*issue-row/g)?.length).toBe(1);
    expect(h).toContain("Two ways to go.");
    expect(h).toContain("Goes with A.");
    expect(h).toContain("Goes with B.");
    expect(h).toContain(`data-id="${n}"`);
    expect(h).toContain('data-repo="fac"');
    const pills = h.slice(h.indexOf('<div class="status-row">'), h.indexOf("</div>", h.indexOf('<div class="status-row">')));
    expect(pills).toContain("extra: kept");
    for (const k of ["situation", "effects", "recommend"]) expect(pills).not.toContain(`${k}:`);
  });
});

describe("priority badges", () => {
  test("the table row, the issue header and a part's timeline row show the badge; the API's issues carry priority", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "prio parent", { request: "x" });
      addPart(doc, i, { title: "plain part", spec: "x" });
      const p = addPart(doc, i, { title: "hot part", spec: "x" });
      (p as any).fm.priority = "critical";
      return i.id;
    }, true)!.value;
    const d = await getJson(`/api/issues/fac-${n}`);
    expect(d.goals.map((g: any) => g.priority)).toEqual(["medium", "critical"]);
    d.priority = "critical";
    const h = v.renderIssue(d);
    const head = h.slice(h.indexOf('<div class="status-row">'), h.indexOf("</div>", h.indexOf('<div class="status-row">')));
    expect(head).toContain(">critical<");
    // A part's row in the timeline shows its priority when it is not medium.
    const rows = h.slice(h.indexOf("<h3>Sub-issues</h3>")).split('<div class="dp-row">');
    expect(rows.find((r: string) => r.includes("hot part"))).toContain(">critical<");
    expect(rows.find((r: string) => r.includes("plain part"))).not.toContain(">medium<");
    const row = v.renderRow({ repo: "fac", n: 1, id: "fac-1", href: "#/issues/fac/1", title: "t", stage: "new", project: "fac", priority: "critical", labels: [], notes: 0, runs: 0, cost: 0, at: null });
    expect(row).toContain('<td><span class="badge stuck">critical</span></td>');
  });
});

describe("the Issue timeline names why a wait waited", () => {
  const run = (kind: string, started: string, ended: string) => ({ kind, name: "fac-1", on: "fac-1", condition: "passed", started, ended });
  const d = (holds?: object[]) => ({ repo: "fac", id: 1, ref: "1", status: "done", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], goals: [], holds,
    timeline: { filed: "2026-11-01T10:00:00Z", runs: [run("triage", "2026-11-01T10:00:30Z", "2026-11-01T10:02:00Z"), run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z")] } });
  const evs = (x: any) => v.issueSegments(x).flatMap((s: any) => s.rows).flatMap((r: any) => r.events);
  const html = (x: any) => evs(x).map((e: any) => e.html).join("\n");
  test("a wait with hold records of the issue's job in its span names the hold's action, its content and its minutes", () => {
    setCodes({ aleph: "a" });
    try {
      const holds = [
        { at: "2026-11-01T10:05:00Z", name: "fac-1", kind: "busy-file", text: "both jobs change the busy file", event: { action: "busy", on: ["aleph-1372"], file: "ui/views/issues.js" } },
        { at: "2026-11-01T10:06:00Z", name: "fac-2", kind: "baseline", text: "other job" },
      ];
      expect(evs(d(holds)).map((e: any) => e.tag)).toContain("busy");
      expect(html(d(holds))).toContain("a1372 → issues.js · 28m 00s");
      expect(html(d(holds))).not.toContain("other job");
    } finally { setCodes({}); }
  });
});

describe("exact times in the Hour window", () => {
  test("a row carries the stored ISO UTC times", async () => {
    const [r] = await rowsOf("fac");
    expect(r.createdTime).toMatch(ISO_UTC);
    expect(r.updatedTime).toMatch(ISO_UTC);
    expect((await rowsOf("fac")).find((r: any) => r.status === "done").closedTime).toMatch(ISO_UTC);
  });

  test("the Hour window counts by the minute, and the Day window by the day", () => {
    const now = new Date("2026-11-04T16:00");
    const rows = v.issueRows({ issues: [
      { id: 1, repo: "f", title: "a", status: "done", labels: [], createdTime: iso("2026-11-04T15:30"), closedTime: iso("2026-11-04T15:45"), runs: 0, cost: 0 },
      { id: 2, repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-11-04T09:00"), closedTime: iso("2026-11-04T08:00"), runs: 0, cost: 0 },
      { id: 3, repo: "f", title: "c", status: "done", labels: [], createdTime: iso("2026-11-04"), closedTime: iso("2026-11-04"), runs: 0, cost: 0 },
    ] });
    expect(v.stats(rows, now, 1 / 24)).toMatchObject({ filed: 1, closed: 1 });
    expect(v.stats(rows, now, 1)).toMatchObject({ filed: 3, closed: 3 });
  });
});

describe("the Updated time", () => {
  const item = (fm: Record<string, unknown>, notes: string[] = []) => ({ id: 1, title: "t", fm, request: "", spec: "", notes }) as any;

  test("updatedText gives when()'s form of the local minute; the sort uses the minute", () => {
    const y = new Date(NOW).getFullYear(), iso = (h: number, m = 0) => new Date(y, 10, 3, h, m).toISOString();
    expect(v.updatedText({ atTime: iso(14, 5) })).toBe("11/03 14:05");
    expect(v.updatedText({ atTime: null })).toBe("");
    const rows = [{ atTime: iso(8) }, { atTime: iso(17) }];
    expect(v.sortRows(rows, { key: "updated", dir: -1 })[0]).toBe(rows[1]);
  });

  test("a write sets updated_time", () => {
    const i = item({ updated_time: "2026-01-01T00:00:00.000Z" });
    todos.note(i, "hi", new Date(2026, 10, 5, 9, 7));
    expect(i.fm.updated_time).toBe(new Date(2026, 10, 5, 9, 7).toISOString());
  });
});

test("the Issues row, the issue's id and its Work head show the short id, and the links keep the full id", () => {
  setCodes({ fac: "f" });
  try {
    expect(v.renderRow({ repo: "fac", n: 1, id: "fac-1", href: "#/issues/fac/1", title: "t", stage: "new", project: "fac", priority: "medium", labels: [] })).toContain('<a class="idl" href="#/issues/fac/1">f1</a>');
    const d = { repo: "fac", id: 1, ref: "1", status: "open", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], goals: [], timeline: { runs: [] } };
    expect(v.renderIssue(d)).toContain('<span class="idp">f1</span></div>');
    expect(v.issueSegments(d)[0].rows[0].head).toContain('<span class="idp">f1</span>');
  } finally {
    setCodes({});
  }
});

test("the Issue page's notes show an issue id in its short form", () => {
  setCodes({ aleph: "a" });
  try {
    const d = { repo: "fac", id: 1, ref: "1", status: "open", frontmatter: { created: "2026-11-01" }, commits: [], jobs: [], goals: [], timeline: { runs: [] },
      notes: ["- 2026-11-05T11:02:00.000Z: intake: filed aleph-1443 for x", "- 2026-11-05T11:03:00.000Z: director: filed aleph-1441 for x", "director: filed aleph-1444 for z"] };
    const h = v.renderIssue(d);
    expect(h).toContain("filed a1443 for x");
    expect(h).toContain("director: filed a1441 for x");
    expect(h).toContain("director: filed a1444 for z");
    expect(h).not.toContain("aleph-1441");
    expect(h).not.toContain("aleph-1443");
    expect(h).not.toContain("aleph-1444");
  } finally {
    setCodes({});
  }
});

describe("the labels say sub-issue and job", () => {
  /** The page's own labels: the table heads, the headings, and the tile and KPI keys. */
  const labels = (h: string) => [
    ...h.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]*)/g),
    ...h.matchAll(/<h[23][^>]*>([^<]*)</g),
    ...h.matchAll(/<span class="(?:dp-)?k">([^<]*)</g),
  ].map((m) => m[1]);
  const OLD = /runs|goal|part/i;

  test("the Issues page heads its job count Jobs, and no label keeps the old words", async () => {
    const rows = await rowsOf("fac");
    const h = v.renderIssues({ issues: rows, projects: ["fac"] }, { tile: "runs" });
    expect(h).toContain('<button type="button" data-sort="runs">Jobs');
    expect(h).toContain("<h2>Issues by Jobs</h2>");
    expect(labels(h).filter((t) => OLD.test(t))).toEqual([]);
  });

  // Flaky under the parallel suite: the Cost tile shows "0 jobs" (aleph-1156).
  test.skip("the Issue page says Sub-issues and Sub-issues done, and no label keeps the old words", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "label parent", { request: "Do it." });
      addPart(doc, i, { title: "one", spec: "x" });
      return i.id;
    }, true)!.value;
    run("20261104-120001-a", { job: `fac-${n}`, name: `fac-${n}`, repo: "fac", condition: "landed", on: `fac-${n}` });
    const h = v.renderIssue(await getJson(`/api/issues/fac-${n}`));
    expect(h).toContain("<h3>Sub-issues</h3>");
    expect(h).toContain('<span class="dp-k">Sub-issues done</span>');
    expect(h).toContain('<span class="dp-sub">1 job</span>');
    expect(labels(h).filter((t) => OLD.test(t))).toEqual([]);
  });
});

test("an issue row carries its short id for a pin to anchor on", () => {
  setCodes({ aleph: "a" });
  try {
    expect(v.renderRow({ repo: "aleph", n: 1430, id: "aleph-1430", href: "#/issues/aleph/1430", title: "t", stage: "new", project: "aleph", priority: "medium", labels: [] })).toContain('data-annotate="a1430"');
  } finally { setCodes({}); }
});
