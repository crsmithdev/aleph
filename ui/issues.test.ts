import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { setPaused } from "../jobs/lib/gates/pause.ts";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../lib/store.ts";
import { setCodes } from "../lib/naming.ts";
import { add, noteOf, setStatus, type Doc } from "../lib/issue-file.ts";
import { addPart } from "../issues/lib/parts.testkit.ts";
import * as todos from "../lib/issue-file.ts";
import { askOf, setAsk, refIn, type Ask } from "../jobs/lib/asks/ask.ts";
import { deviceCookie, withEnv, withServer, type TestServer } from "./server.testkit.ts";
import { updater } from "./updater.ts";
import { state } from "./state.ts";
import { run as alephRun } from "../cli/commands.ts";

// The fixtures change between tests, with no watcher to see it: each test starts with no kept answer.
beforeEach(() => updater.reset());
// @ts-ignore plain JS, shared with the page
import * as v from "./views/issues.js";
// @ts-ignore plain JS, shared with the page
import * as lib from "./views/lib/html.js";
// @ts-ignore plain JS, shared with the page
import { label, option, shown, title } from "./views/lib/chart.js";
// @ts-ignore plain JS, shared with the page
import { day, xLabel } from "./views/lib/format.js";
// @ts-ignore plain JS, shared with the page
import { when } from "./views/lib/format.js";
// @ts-ignore plain JS, shared with the page
import * as tl from "./views/lib/timeline.js";
import { seed } from "../jobs/job.testkit.ts";
import { conn } from "../lib/db.ts";
import { logEvent } from "../lib/layout.ts";
import { writeRepos } from "../tests/projects.testkit.ts";

// The test's clock: the server reads it, and the runs start at it.
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const NOW = Date.parse("2026-11-04T12:00:00Z");
/** A local time as the ISO UTC string the store keeps. */
const iso = (t: string) => new Date(t.length === 10 ? `${t}T00:00` : t).toISOString();
/** The list row of one issue in the page's API form, as `groups()` draws it. */
const listRow = (r: object) => v.groups(v.issueRows({ issues: [{ status: "open", labels: [], ...r }] }), NOW).flatMap((g: any) => g.rows)[0];
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

/** An issue with a spec, on a plain number. */
const seedPart = (doc: Doc, title: string, body = "") => { return add(doc, title, { spec: body || "Do it." }); };

let items = "", seeded = "";
let base: string, server: TestServer, stop: () => void, restoreEnv: () => void, jobsDir: string, argvFile: string, stdinFile: string;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const at = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${server.port}${p}`, { ...init, headers: { cookie: deviceCookie, ...init?.headers as Record<string, string> } });
const getJson = async (p: string) => (await at(p)).json() as Promise<any>;
/** The issue rows of `GET /api/issues`, of one project or of all. */
const rowsOf = async (project?: string): Promise<any[]> => (await getJson(project ? `/api/issues?project=${project}` : "/api/issues")).issues;
let seeds = 0;
/** The rows after a test seeded jobs. `updater.reset()` sets the change counts back, so a kept job read can look fresh; a new env makes the build Worker drop it. */
const afterSeed = async (path: string): Promise<any> => { const restore = withEnv({ ALEPH_TEST_SEED: String(++seeds) }); try { return await getJson(path); } finally { restore(); } };
const rowsAfterSeed = async (project?: string): Promise<any[]> => (await afterSeed(project ? `/api/issues?project=${project}` : "/api/issues")).issues;
const post = (body: object, headers: Record<string, string> = { "x-aleph-ui": "1" }, q = "") =>
  at(`/api/issues${q}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** Put a job in the ledger; `on` is the issue `<repo>-<n>`. */
function run(_id: string, { on, job: _job, ...extra }: Record<string, unknown>) {
  made.push(seed({ role: "build", told: true, started: new Date(NOW).toISOString(), ...(on ? { target: `issue.${String(on).split("-")[1]}` } : {}), ...extra } as any));
}
/** The jobs a test made, which its cleanup drops; the fixture's stay. */
let made: { id: string; folder: string }[] = [];

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-issues-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  // a product repo whose origin/main has one commit with an Item trailer and one that names it in prose
  const remote = join(base, "demo.git"), repo = join(base, "demo");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, repo);
  writeFileSync(join(repo, "a"), "1");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "real work\n\nIssue: issue.1\nJob: job.1");
  writeFileSync(join(repo, "b"), "2");
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "prose only\n\nthis finishes Item: fac-1 in words.\n\nbut no trailer");
  sh(repo, "git", "push", "-q", "origin", "main");
  sh(repo, "git", "fetch", "-q", "origin");
  const itemsRemote = join(base, "items.git");
  items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  mkdirSync(join(base, "none"));
  writeRepos({ fac: { path: repo, sandbox: true }, oth: { path: join(base, "none") } }, items);
  argvFile = join(base, "argv"); stdinFile = join(base, "stdin");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvFile}\ncat > ${stdinFile}\necho '{"repo":"fac","added":7}'\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake, ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => {
    seedPart(doc, "first issue", "# Heading\n\n- one\n\n<script>alert(1)</script>");
    add(doc, "plain task", { kind: "bug", labels: ["bug"] });
    seedPart(doc, "second issue").fm.after = ["fac-4"];
    seedPart(doc, "third issue");
    setStatus(doc.items[1], "done");
    return true;
  }, true);
  writeList({ key: "oth" }, "seed", (doc) => { add(doc, "other thing"); return true; }, true);
  logEvent({ subject: "gate", action: "held", object: "issue.3", detail: "after: issue.4" });
  run("", { job: "fac-1", name: "fac-1", repo: "fac", state: "landed", on: "fac-1" });
  run("", { job: "oth-1", name: "oth-1", repo: "oth", state: "running", on: "oth-1" });
  seeded = sh(items, "git", "rev-parse", "origin/main");
  made = [];
  ({ server, stop } = await withServer({ warm: false }));
});
// Each test ends by putting back the fixture store and runs, so no test reads what another wrote.
afterEach(() => {
  // A fetch never moves origin/main back, so the reset sets the ref here as well as on the remote.
  sh(items, "git", "push", "-qf", "origin", `${seeded}:refs/heads/main`);
  sh(items, "git", "update-ref", "refs/remotes/origin/main", seeded);
  sh(items, "git", "reset", "-q", "--hard", seeded);
  for (const j of made.splice(0)) { conn().run("DELETE FROM jobs WHERE id = ?", [j.id]); rmSync(j.folder, { recursive: true, force: true }); }
  // The fixture sets no Ask, so every Ask is a test's.
  conn().run("DELETE FROM issue_state");
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
    expect(r).toMatchObject({ repo: "fac", title: "first issue", status: "open", priority: "medium", labels: [], after: [], notes: 0 });
    expect(r.updated).toBeTruthy();
  });

  test("a row and the issue page carry the kind; the issue page shows it as a chip, the table row does not", async () => {
    const n = 2;
    const row = (await rowsOf("fac")).find((r: any) => r.id === n);
    expect(row.kind).toBe("bug");
    const d = await getJson(`/api/issues/fac-${n}`);
    expect(d.kind).toBe("bug");
    expect(v.renderIssue(d)).toContain("kind: bug");
    expect(listRow(row).main).not.toContain("kind:");
  });

  test("the issue page shows a stored source chris as the user, in its chip and its Source select", async () => {
    const d = await getJson("/api/issues/fac-2");
    const h = v.renderIssue({ ...d, source: "user", frontmatter: { ...d.frontmatter, source: "chris" } });
    expect(h).toContain("source: user");
    expect(h).not.toContain("chris");
  });

  test("the issue page's head is pageHead: the title as editable() writes it and the Edit button", async () => {
    const d = await getJson("/api/issues/fac-2");
    const real = { ...lib }, tagged = (t: string, o: object) => `<!--pageHead-->${real.pageHead(t, o)}`;
    mock.module("./views/lib/html.js", () => ({ ...real, pageHead: tagged }));
    try {
      const h = v.renderIssue(d);
      expect(h.match(/<header class="ph">/g)).toHaveLength(1);
      expect(h).toContain("<!--pageHead--><header");
      expect(h).toMatch(new RegExp(`<h1><span class="view-only">${d.title}</span><span class="edit-only"><input name="title"[^>]*form="issue-edit"`));
      expect(h).toContain('data-editor="start">Edit</button>');
    } finally {
      mock.module("./views/lib/html.js", () => real);
    }
  });

  // Breaks if the detail API drops refs or the backlink, or the page does not draw them.
  test("the issue page lists its refs and the issues that reference it, across projects", async () => {
    const target = writeList({ key: "oth" }, "seed", (doc) => add(doc, "referenced thing").id, true)!.value;
    const n = writeList({ key: "fac" }, "seed", (doc) => { const i = add(doc, "refers to it"); i.fm.refs = [`issue.${target}`]; return i.id; }, true)!.value;
    const d = await getJson(`/api/issues/fac-${n}`);
    expect(d.refs).toMatchObject([{ id: `oth-${target}`, title: "referenced thing", status: "open" }]);
    expect(d.referencedBy).toEqual([]);
    const t = await getJson(`/api/issues/oth-${target}`);
    expect(t.referencedBy).toMatchObject([{ id: `fac-${n}`, title: "refers to it" }]);
    expect(v.renderIssue(d)).toContain('class="quiet">Refs<');
    expect(v.renderIssue(d)).not.toContain("Referenced by");
    expect(v.renderIssue(t)).toContain('class="quiet">Referenced by<');
    expect(v.renderIssue(d)).not.toContain("refs: issue.");
  });

  test("a row carries its stage", async () => {
    const rows = await rowsOf("fac");
    // The first issue has a trailer commit on main, and a trailer does not make it done.
    expect(rows[0].stage).toBe("queued");
    expect(rows[2].stage).toBe("held");
  });
});

// Runs fn with ALEPH_CLI pointed at the real CLI, so a route's command writes the store.
async function withRealCli(fn: () => Promise<void>) {
  const real = process.env.ALEPH_CLI, wrap = join(base, "real-aleph");
  writeFileSync(wrap, `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "..", "cli", "cli.ts")} "$@"\n`);
  chmodSync(wrap, 0o755);
  process.env.ALEPH_CLI = wrap;
  try { await fn(); } finally { if (real === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = real; }
}

describe("POST /api/issues/:id/drop", () => {
  test("drops the issue through the real CLI and returns its status; an unknown id is 404", async () => {
    await withRealCli(async () => {
      const h = { "x-aleph-ui": "1", "content-type": "application/json" };
      expect((await at("/api/issues/fac-99/drop", { method: "POST", headers: h })).status).toBe(404);
      expect((await at("/api/issues/nope-1/drop", { method: "POST", headers: h })).status).toBe(404);
      const r = await at("/api/issues/fac-3/drop", { method: "POST", headers: h, body: JSON.stringify({}) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ repo: "fac", id: 3, status: "dropped" });
      expect((await getJson("/api/issues/fac-3")).status).toBe("dropped");
    });
  });
});

describe("POST /api/issues/:id/media and GET /api/issues/:id/media/:name", () => {
  test("an upload attaches the file through the real CLI and the GET serves it with its type; no files is 400, an unknown name 404", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "with a screenshot").id)!.value;
    const h = { "x-aleph-ui": "1", "content-type": "application/json" };
    await withRealCli(async () => {
      const none = await at(`/api/issues/fac-${n}/media`, { method: "POST", headers: h, body: JSON.stringify({ media: [] }) });
      expect([none.status, (await none.json()).error]).toEqual([400, "send the files as media"]);
      const r = await at(`/api/issues/fac-${n}/media`, { method: "POST", headers: h, body: JSON.stringify({ media: [{ name: "shot.png", data: Buffer.from("png bytes").toString("base64") }] }) });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ repo: "fac", id: n, media: ["shot.png"] });
    });
    const f = await at(`/api/issues/fac-${n}/media/shot.png`);
    expect([f.status, f.headers.get("content-type"), await f.text()]).toEqual([200, "image/png", "png bytes"]);
    expect((await at(`/api/issues/fac-${n}/media/other.png`)).status).toBe(404);
    expect((await at("/api/issues/fac-999/media/shot.png")).status).toBe(404);
  });
});

describe("GET /api/issues/:id", () => {
  test("lists the runs of the issue", async () => {
    run("", { job: "on-4", name: "on-4", repo: "fac", state: "running", on: "fac-4" });
    run("", { job: "on-2", name: "on-2", repo: "fac", state: "running", on: "fac-2" });
    run("", { job: "todo-4", name: "todo-4", repo: "fac", state: "running", on: "fac-4" });
    run("", { job: "other-4", name: "other-4", repo: "oth", state: "running", on: "oth-4" });
    const d = await afterSeed("/api/issues/fac-4");
    expect(d.jobs.map((j: any) => j.name).sort()).toEqual(["on-4", "todo-4"]);
    const g = await afterSeed("/api/issues/fac-2");
    expect(g.jobs.map((j: any) => j.name)).toEqual(["on-2"]);
  });

  test("unknown issue and other project are 404", async () => {
    expect((await at("/api/issues/fac-99")).status).toBe(404);
    expect((await at("/api/issues/fac-1?project=oth")).status).toBe(404);
    expect((await at("/api/issues/fac-1?project=fac")).status).toBe(200);
  });
});

describe("Run now", () => {
  /** An issue with a spec, and one that waits on it: their ids. */
  const pair = () => {
    const ids: number[] = [];
    writeList({ key: "fac" }, "seed", (doc) => {
      const ready = add(doc, "ready one", { spec: "Do it." });
      const waits = add(doc, "waits one", { spec: "Do it." });
      waits.fm.after = [`issue.${ready.id}`];
      ids.push(ready.id, waits.id);
      return true;
    }, true);
    return ids;
  };
  test("GET /api/issues/:id: runNow is null for a ready issue and the gate's text for one that waits", async () => {
    const [ready, waits] = pair();
    expect((await getJson(`/api/issues/fac-${ready}`)).runNow).toBeNull();
    expect((await getJson(`/api/issues/fac-${waits}`)).runNow).toBe(`Waits on issue.${ready}`);
  });
  test("a closed issue and one in a repo that is no sandbox have no Run now", async () => {
    expect((await getJson("/api/issues/fac-2")).runNow).toBeUndefined();
    const n = writeList({ key: "oth" }, "seed", (doc) => add(doc, "other spec", { spec: "Do it." }).id)!.value;
    expect((await getJson(`/api/issues/oth-${n}`)).runNow).toBe(`issue.${n} is not a queued issue`);
  });
  test("POST /api/issues/:id/run runs `aleph dispatch issue.N`, and the real parser reads the key as the one issue to start", async () => {
    const [ready, waits] = pair();
    rmSync(argvFile, { force: true });
    expect((await at("/api/issues/fac-99/run", { method: "POST", headers: { "x-aleph-ui": "1" } })).status).toBe(404);
    expect(existsSync(argvFile)).toBe(false);
    const r = await at(`/api/issues/fac-${waits}/run`, { method: "POST", headers: { "x-aleph-ui": "1" } });
    expect(r.status).toBe(200);
    const argv = readFileSync(argvFile, "utf8").trim().split("\n");
    expect(argv).toEqual(["dispatch", `issue.${waits}`]);
    // A `--` before the key makes it the tail: the parse then runs the whole dispatch (paused here, so it starts nothing), not Run now for the issue.
    setPaused(true);
    try {
      const err: string[] = [];
      const out = await alephRun(argv, { stderr: (t) => err.push(t) });
      expect([out.code, err.join("")]).toEqual([1, `Waits on issue.${ready}\n`]);
    } finally { setPaused(false); }
  });
  test("the Issue page has an enabled Run now button when runNow is null, and a disabled one with the reason when it is set", async () => {
    const [ready, waits] = pair();
    const on = v.renderIssue(await getJson(`/api/issues/fac-${ready}`));
    expect(on).toContain(`data-act="run" data-path="/api/issues/fac-${ready}/run"`);
    const off = v.renderIssue(await getJson(`/api/issues/fac-${waits}`));
    expect(off).toContain(`disabled title="Waits on issue.${ready}">Run now<`);
    expect(off).toContain(`>Waits on issue.${ready}<`);
    expect(off).not.toContain('data-act="run"');
    expect(v.renderIssue(await getJson("/api/issues/fac-2"))).not.toContain("Run now");
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

  test("a row's own holds the count and cost of the jobs on it, of its own repo alone", async () => {
    run("", { name: "on-4", repo: "fac", on: "fac-4", cost: 0.5 });
    const rows = await rowsAfterSeed("fac"), of = (id: number) => rows.find((r: any) => r.id === id);
    expect(of(4).own).toEqual({ runs: 1, cost: 0.5 });
    // The fixture's oth job is on issue.1 too, and counts only in oth.
    expect(of(1).own.runs).toBe(1);
  });

  test("a row's own counts a director job, which has no repo, on its issue", async () => {
    run("", { name: "dir-4", role: "director", target: "issue.4", cost: 0.25 } as any);
    const rows = await rowsAfterSeed("fac");
    expect(rows.find((r: any) => r.id === 4).own).toEqual({ runs: 1, cost: 0.25 });
  });

  test("a parent's runs hold its sub-issue's jobs; its own holds its alone", async () => {
    const sub = writeList({ key: "fac" }, "seed", (doc) => String(addPart(doc, todos.find(doc, "3")!, { title: "sub", spec: "x" }).id), true)!.value;
    run("", { name: "on-sub", repo: "fac", target: `issue.${sub}` });
    run("", { name: "on-3", repo: "fac", on: "fac-3" });
    const parent = (await rowsAfterSeed("fac")).find((r: any) => r.id === 3);
    expect([parent.runs, parent.own.runs]).toEqual([2, 1]);
  });

  test("the API marks an issue an event ever parked, and sends no suite history", async () => {
    logEvent({ subject: "human", action: "parked", object: "issue.1" });
    try {
      const rows = await rowsAfterSeed();
      expect(rows.some((r: any) => r.tests)).toBe(false);
      const marked = rows.filter((r: any) => r.everParked);
      expect(marked.length).toBeGreaterThan(0);
      expect(marked.every((r: any) => r.ref === "1")).toBe(true);
    } finally { conn().run("DELETE FROM events WHERE action = 'parked'"); }
    expect((await getJson("/api/issues")).tests).toBeUndefined();
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

  test("List groups Open, Parked and Closed in one list with search and filters; Flow opens with a band over four charts", async () => {
    const d = await getJson("/api/issues");
    const list = v.view.render(d, {}, new URLSearchParams());
    expect(list).toContain('data-view="list" aria-pressed="true"');
    expect([...list.matchAll(/<h3 class="sub-head">([^<]*)</g)].map((m) => m[1]).slice(0, 3)).toEqual(["Open", "Parked", "Closed"]);
    expect(list).toContain('class="factline"');
    expect(list).toContain('data-name="project"');
    expect(list).toContain('data-name="kind"');
    expect(list).not.toContain("aleph-chart");
    expect(list).not.toMatch(/<h2>(Projects|Specs)/);
    const flow = v.view.render(d, {}, new URLSearchParams("view=flow"));
    expect(flow).toContain('<section class="band"');
    expect(flow.match(/class="fig"/g)).toHaveLength(4);
    expect([...flow.matchAll(/<aleph-chart key="([^"]+)"/g)].map((m) => m[1])).toEqual(["issues/flow", "issues/source", "issues/close", "issues/levels"]);
    expect(flow).not.toContain("lrows");
  });

  test("a row links to its issue page and shows only what differs from the defaults; a done row is a muted word", async () => {
    const rows = v.issueRows(await getJson("/api/issues"));
    expect(rows.find((r: any) => r.title === "first issue").href).toBe("#/issues/fac/1");
    expect(rows.every((r: any) => r.href.startsWith("#/issues/"))).toBe(true);
    const plain = listRow({ id: 5, ref: "5", repo: "aleph", title: "plain", kind: "task", priority: "medium", cost: 0 });
    expect(plain.main).not.toMatch(/badge|chip/);
    expect(plain.cells[1]).toBe("");
    const odd = listRow({ id: 6, ref: "6", repo: "fac", title: "odd", kind: "bug", priority: "high", labels: ["ui"], cost: 1.5 });
    expect(odd.main).toMatch(/>high<.*>bug<.*>fac<.*>ui</);
    expect(odd.cells[1]).toBe("$1.50");
    const groups = v.groups(v.issueRows({ issues: [
      { id: 1, ref: "1", repo: "fac", title: "a", status: "done", labels: [], createdTime: iso("2026-10-01"), closedTime: iso("2026-10-03"), cost: 2 },
      { id: 2, ref: "2", repo: "fac", title: "b", status: "dropped", labels: [], createdTime: iso("2026-10-01"), closedTime: iso("2026-10-02") },
    ] }), NOW);
    const closed = groups[2];
    expect(closed.heads).toEqual(["", "Cost", "Took"]);
    expect(closed.rows.map((r: any) => r.cells)).toEqual([['<span class="quiet">done</span>', "$2.00", "2d 00h"], [expect.stringContaining('class="badge'), "", "1d 00h"]]);
  });

  test("the closed group holds every closed issue and draws the newest 40", () => {
    const issues = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, ref: String(i + 1), repo: "aleph", title: `t${i}`, status: "done", labels: [], createdTime: iso("2026-10-01"), closedTime: new Date(Date.UTC(2026, 9, 2, 0, i)).toISOString() }));
    const closed = v.groups(v.issueRows({ issues }), NOW)[2];
    expect([closed.rows.length, closed.count, closed.cap]).toEqual([45, "45", 40]);
    expect(closed.rows[0].key).toBe("aleph-45");
    const h = v.view.render({ issues }, {}, new URLSearchParams()) as string;
    expect(h.match(/class="lrow"/g)).toHaveLength(40);
    expect(h).toContain('<li class="lmore">40 of 45</li>');
  });

  test("the filters are the project and the kind of the rows", async () => {
    const h = v.view.render(await getJson("/api/issues"), {}, new URLSearchParams());
    expect(h).toContain('data-value="oth"');
    expect(h).toContain('data-value="fac"');
    expect(h).toContain('data-value="bug"');
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

  test("the numbers: open, parked, filed and closed in 7 days, the week before, and the time to close", () => {
    const now = new Date("2026-11-01T12:00");
    const rows = v.issueRows({ issues: [
      { id: 1, ref: "1", repo: "f", title: "a", status: "open", stage: "new", labels: [], createdTime: iso("2026-11-01"), runs: 2, cost: 1, own: { runs: 0, cost: 0 } },
      { id: 1, ref: "1.1", parent: "1", repo: "f", title: "a part", status: "open", stage: "working", labels: [], createdTime: iso("2026-10-20"), runs: 2, cost: 1, own: { runs: 2, cost: 1 } },
      { id: 2, ref: "2", repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-10-21"), closedTime: iso("2026-10-30T12:00"), runs: 3, cost: 0.5, own: { runs: 3, cost: 0.5 } },
      { id: 3, ref: "3", repo: "f", title: "c", status: "dropped", labels: [], createdTime: iso("2026-10-26"), closedTime: iso("2026-10-25"), runs: 0, cost: 0 },
    ] });
    // Row 2 took 9.5 days; row 3 closed before it was created, so it gives no time.
    expect(v.stats(rows, now)).toEqual({ open: 2, parked: 0, filed: 2, filedBefore: 2, closed: 1, closedBefore: 1, p50: 820800, p90: 820800, p50Before: null, dropped: 0 });
    expect(v.stats(rows.map((r: any) => ({ ...r, everParked: r.id === "f-2" })), now)).toMatchObject({ closed: 1, p50: null });
    const f = v.flow(rows, "month", now);
    expect(f.ats).toHaveLength(30);
    expect(day(f.ats.at(-1), now)).toBe("Nov 01");
    expect(f.filed.at(-1)).toBe(1);
    expect(f.closed.at(-3)).toBe(1);
    const b = v.levels(rows, "month", now);
    expect(b.ats).toHaveLength(30);
    // Row 1 is open from Nov 01; the part from Oct 20; row 2 from Oct 21 to Oct 30; row 3 closed before it was created.
    expect([b.backlog.at(-1), b.backlog.at(-2), b.backlog.at(-3), b.backlog[0]]).toEqual([2, 1, 2, 0]);
    expect([b.total.at(-1), b.total[0]]).toEqual([4, 0]);
    const c = v.closeTimes([
      ...[1, 2, 3, 4, 5].map((n) => ({ status: "done", kind: "bug", createdTime: iso("2026-10-01"), closedTime: iso(`2026-10-0${n + 1}`) })),
      { status: "done", kind: "task", createdTime: iso("2026-10-01"), closedTime: iso("2026-10-05") },
      { status: "open", kind: "flake", createdTime: iso("2026-10-01"), closedTime: null },
    ], "month", new Date("2026-10-10T12:00"));
    expect(c.kinds).toEqual(["task", "bug", "check", "flake"]);
    expect(c.p50).toEqual([4, 3, null, null]);
    expect(c.p90[1]).toBe(5);
    expect(v.flow(rows, "week", now).ats).toHaveLength(7);
    expect(day(v.flow(rows, "week", now).ats.at(-1), now)).toBe("Nov 01");
    // Each frame carries every bucket of one measure: filed and closed are a flow, the backlog and the total a level.
    const fr = v.flowFrame(f, "month");
    expect(fr.over).toEqual({ kind: "time", window: "month" });
    expect(fr.by.keys.map((k: any) => k.name)).toEqual(["filed", "closed"]);
    expect(fr.rows.map((r: any) => [r.at, r.filed, r.closed])).toEqual(f.ats.map((at: number, i: number) => [at, f.filed[i], f.closed[i]]));
    expect(v.levelFrame(b, "month").rows.at(-1)).toMatchObject({ backlog: 2, total: 4 });
    const o = option(fr, "lines", {});
    expect(o.series.map((s: any) => s.name)).toEqual(["filed", "closed"]);
    expect([o.yAxis.minInterval, o.yAxis.axisLabel.formatter(3)]).toEqual([1, "3"]);
  });

  /** The four chart frames over `rows` in the week to `now`, in page order. */
  const weekFrames = (rows: any[], now: Date) => [v.flowFrame(v.flow(rows, "week", now), "week"), v.sourceFrame(v.sources(rows, "week", now), "week"), v.closeFrame(v.closeTimes(rows, "week", now)), v.levelFrame(v.levels(rows, "week", now), "week")];

  test("the window sets the backlog buckets, the Time to close rows and the chart titles", () => {
    const now = new Date("2026-11-04T16:00");
    const rows = v.issueRows({ issues: [
      { id: 1, ref: "1", repo: "f", title: "a", status: "open", labels: [], createdTime: iso("2026-11-04T15:30") },
      { id: 2, ref: "2", repo: "f", title: "b", status: "done", kind: "bug", labels: [], createdTime: iso("2026-10-20"), closedTime: iso("2026-10-25") },
      { id: 3, ref: "3", repo: "f", title: "c", status: "done", kind: "bug", labels: [], createdTime: iso("2026-11-01"), closedTime: iso("2026-11-02") },
    ] });
    const one = rows.filter((r: any) => r.id === "f-1");
    const hour = v.levels(one, "hour", now), dayB = v.levels(one, "day", now);
    expect(hour.ats).toHaveLength(60);
    expect(dayB.ats).toHaveLength(24);
    for (const b of [hour, dayB]) {
      const i = b.backlog.findIndex((n: number) => n > 0);
      expect(b.backlog.slice(i).every((n: number) => n === 1)).toBe(true);
    }
    expect(hour.backlog.indexOf(1)).toBe(29);
    expect(dayB.backlog.indexOf(1)).toBe(23);
    const w = v.levels(rows, "week", now), m = v.levels(rows, "month", now);
    expect(w.ats).toHaveLength(7);
    expect(day(w.ats.at(-1), now)).toBe("Nov 04");
    expect(m.ats).toHaveLength(30);
    expect(v.closeTimes(rows, "week", now).p50[1]).toBe(24);
    // A p50 is the nearest rank: of 1 and 5 days, the lower.
    expect(v.closeTimes(rows, "month", now).p50[1]).toBe(1);
    expect(weekFrames(rows, now).map(title)).toEqual(["Issues Filed and Closed", "Issues Filed by Source", "Time to Close by Kind", "Backlog and Total"]);
    // Each panel's title, aria label and empty line come from its frame.
    expect(label(weekFrames(rows, now)[0])).toBe("Issues Filed and Closed: filed 2, closed 1");
  });

  test("a chart panel with nothing to plot has no series to show, and the page draws no chart box", () => {
    expect(weekFrames([], new Date(NOW)).map(shown)).toEqual([[], [], [], []]);
    expect(v.renderIssues({ issues: [] }, new URLSearchParams("view=flow"))).not.toContain("chartbox");
  });

  test("Time to close counts from the stored times and shows hours when every value is under 2 days", () => {
    const now = new Date("2026-11-04T16:00");
    const c = v.closeTimes([
      { status: "done", kind: "bug", createdTime: iso("2026-11-04T08:00"), closedTime: iso("2026-11-04T11:00") },
      { status: "done", kind: "bug", createdTime: iso("2026-11-04T08:00"), closedTime: iso("2026-11-04T13:00") },
    ], "week", now);
    expect(c.unit).toBe("hours");
    expect(c.p50[1]).toBe(3);
    const t = { muted: "#123456" };
    // The frame keeps the p50 and the p90 in seconds, so the axis formats them as a duration.
    expect(option(v.closeFrame({ ...c, unit: "days" }), "grouped", t).xAxis.axisLabel.formatter(4320)).toBe("1h 12m");
    expect(option(v.closeFrame(c), "grouped", t).series.find((s: any) => s.name === "p90").color).toBe(t.muted);
  });

  const now = new Date("2026-11-01T12:00");
  const twoDone = () => v.issueRows({ issues: [
    { id: 1, ref: "1", repo: "f", title: "a", status: "done", labels: [], createdTime: iso("2026-11-01"), closedTime: iso("2026-11-01"), runs: 0, cost: 0 },
    { id: 2, ref: "2", repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-10-28"), closedTime: iso("2026-10-28"), runs: 0, cost: 0 },
  ] });

  test("the window sets the Filed and Closed counts", () => {
    const rows = twoDone();
    expect(v.stats(rows, now, "day")).toMatchObject({ filed: 1, closed: 1 });
    expect(v.stats(rows, now, "hour")).toMatchObject({ filed: 0, closed: 0 });
    expect(v.stats(rows, now, "week")).toMatchObject({ filed: 2, closed: 2 });
  });

  test("the flow chart counts each issue in the bucket of its minute or hour", () => {
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
  });

  test("the Flow head holds the project, then the window; the List head holds neither", async () => {
    const d = await getJson("/api/issues");
    const head = (q: string) => v.view.render(d, {}, new URLSearchParams(q)).match(/<header class="ph">[\s\S]*?<\/header>/)![0];
    const flow = head("view=flow&window=day");
    expect(flow).toContain("<h1>Issues</h1>");
    expect(flow).toContain('data-name="window"');
    for (const w of ["Hour", "Day", "Week", "Month"]) expect(flow).toContain(`>${w}</button>`);
    expect(flow).toContain('<select name="project"');
    expect(flow.indexOf('<select name="project"')).toBeLessThan(flow.indexOf('data-name="window"'));
    expect(head("")).not.toContain('<select name="project"');
  });

  test("the Flow band holds Filed, Time to Close, Backlog and Dropped, each with its comparison", () => {
    const issues = [
      { id: 1, ref: "1", repo: "f", title: "a", status: "done", labels: [], createdTime: iso("2026-10-30"), closedTime: iso("2026-10-31") },
      { id: 2, ref: "2", repo: "f", title: "b", status: "dropped", labels: [], createdTime: iso("2026-10-30"), closedTime: iso("2026-11-01") },
      { id: 3, ref: "3", repo: "f", title: "c", status: "open", labels: [], createdTime: iso("2026-11-01") },
    ];
    const html = v.renderIssues({ issues }, new URLSearchParams("view=flow"));
    expect([...html.matchAll(/<span class="k">([^<]*)</g)].map((m) => m[1])).toEqual(["Filed", "Time to Close", "Backlog", "Dropped"]);
    expect(html).toMatch(/Dropped<\/span><b class="num">50%<\/b><span class="cmp">1 of 2</);
  });

  test("the search box files its text in the project filter, else aleph, and the list gets no row for it", async () => {
    const h = v.view.render({ issues: [{ repo: "aleph", ref: "1", id: 1, title: "alpha thing", status: "open", labels: [] }], projects: ["aleph", "fac"] }, {}, new URLSearchParams());
    expect(h).toContain('placeholder="Search or file an issue"');
    expect(h).toContain("Ctrl+Enter files");
    expect(h).not.toContain("file-row");
  });

  test("fileProject picks the scoped project, else aleph, else the first", () => {
    expect(v.fileProject("fac", ["aleph", "fac"])).toBe("fac");
    expect(v.fileProject("", ["aleph", "fac"])).toBe("aleph");
    expect(v.fileProject("", ["fac", "zed"])).toBe("fac");
  });

  test("a part row names its part", () => {
    const rows = v.issueRows({ issues: [
      { id: 910, ref: "910", repo: "fac", title: "ask", status: "open", labels: [] },
      { id: 910, ref: "910.1", parent: "910", repo: "fac", title: "part", status: "open", labels: [] },
    ] });
    expect(rows[1]).toMatchObject({ id: "fac-910.1", href: "#/issues/fac/910.1", part: true, parent: "fac-910" });
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
  const ask = (decision: boolean, wait?: string) => writeList({ key: "fac" }, "seed", (doc) => {
    const i = add(doc, "which way", { request: "x" });
    if (decision) setAsk(refIn(i), { reason: "question", question: "A or B?", options: [{ label: "A", line: "do a", ...(wait ? { after: wait } : {}) }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] });
    else { setAsk(refIn(i), { reason: "question", question: "Should it be A or B?", options: [], why: [] }); todos.note(i, "triage: for Chris: Should it be A or B? My recommendation is B, it is smaller."); }
    return i.id;
  })!.value;

  test("approving an option writes the note, clears the Ask and its fields, and makes no issue", async () => {
    const n = ask(true);
    await withRealCli(async () => {
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

  test("a part-dropped Ask stored with the old labels takes the card's Keep open: the issue stays open with plan", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "a parent", { request: "x" }).id)!.value;
    setAsk(`issue.${n}`, { reason: "part-dropped", question: "What now?", why: [], options: [
      { label: "Close with what landed", line: "Close the issue: the sub-issues that landed are enough." },
      { label: "Plan the missing part", line: "Plan a new sub-issue for what the dropped sub-issue was to do." }] });
    await withRealCli(async () => {
      expect((await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "Keep open" }) })).status).toBe(200);
      expect([todos.status(item(n)), item(n).fm.plan]).toEqual(["open", "true"]);
    });
  });

  test("an option that waits sets after in the same write as the Ask clears", async () => {
    const target = writeList({ key: "fac" }, "seed", (doc) => add(doc, "blocker", { request: "x" }).id, true)!.value;
    const n = ask(true, `issue.${target}`);
    expect(askOf(`issue.${n}`)!.options[0].after).toBe(`issue.${target}`);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac-${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      expect(item(n).fm.labels).toBeUndefined();
      expect(item(n).fm.after).toEqual([`issue.${target}`]);
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
    setAsk(`issue.${n}`, { kind, reason, question: "a migrated ask", options: [], why: [] } as Ask);
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

  test("the card routes take an issue's id", async () => {
    const dotted = () => writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "a capped issue", { request: "x" });
      return String(i.id);
    })!.value;
    const capped = () => { const r = dotted(); setAsk(`issue.${r}`, { reason: "run-cap", question: "stopped", options: [], why: [] }); return r; };
    const find = (ref: string) => readList({ key: "fac" })!.items.find((i) => String(i.id) === ref)!;
    await withRealCli(async () => {
      const a = capped();
      expect((await at(`/api/issues/fac-${a}/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
      expect(askOf(`issue.${a}`)).toBeNull();
      expect(find(a).notes.at(-1)).toContain("run it again");
      const c = dotted();
      expect((await at(`/api/issues/fac-${c}/drop`, { method: "POST", headers: h, body: JSON.stringify({ reason: "no" }) })).status).toBe(200);
      expect(todos.status(find(c))).toBe("dropped");
      expect((await at(`/api/issues/fac-x.y/rerun`, { method: "POST", headers: h, body: "{}" })).status).toBe(404);
    });
  });
});

describe("POST /api/issues/:id/retriage and rerun", () => {
  const h = { "x-aleph-ui": "1", "content-type": "application/json" };
  const ask = () => writeList({ key: "fac" }, "seed", (doc) => (() => { const i = add(doc, "errored triage", { request: "x" }); setAsk(refIn(i), { reason: "triage-failed", question: "triage failed", options: [], why: [] }); return i.id; })(), true)!.value;

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

  test("an issue that is not waiting for the user is a 409", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "plain", { request: "x" }).id, true)!.value;
    const r = await at(`/api/issues/fac-${n}/retriage`, { method: "POST", headers: h });
    expect(r.status).toBe(409);
    expect(JSON.stringify(await r.json())).toContain("not waiting for the user");
  });
});

describe("a parked issue", () => {
  test("approve and decline answer a held core-change verdict; an issue with none is refused", async () => {
    let n = 0;
    writeList({ key: "oth" }, "park", (doc) => { const p = add(doc, "held core note"); setStatus(p, "parked"); n = p.id; return true; }, true);
    for (const verb of ["approve", "decline"]) {
      const r = await at(`/api/issues/oth-${n}/${verb}`, { method: "POST", headers: { "x-aleph-ui": "1" } });
      expect(r.status).toBe(422);
      expect((await r.json()).error).toBe(`no held verdict for oth-${n}`);
    }
  });
  test("lists as status parked; the filter offers it and narrows to it; the badge differs; it is neither open nor closed", async () => {
    let n = 0;
    writeList({ key: "oth" }, "park", (doc) => { const p = add(doc, "shelved thing"); setStatus(p, "parked"); n = p.id; return true; }, true);
    const rows = (await rowsOf()).filter((r: any) => r.status === "parked");
    expect(rows.map((r: any) => [r.repo, r.id, r.status])).toEqual([["oth", n, "parked"]]);
    expect((await getJson(`/api/issues/oth-${n}`)).status).toBe("parked");
    const all = v.issueRows({ issues: [
      ...rows,
      { id: 8, ref: "8", repo: "f", title: "o", status: "open", stage: "new", labels: [], createdTime: iso("2026-11-01") },
      { id: 9, ref: "9", repo: "f", title: "d", status: "done", labels: [], createdTime: iso("2026-10-30"), closedTime: iso("2026-11-01") },
    ] });
    const [open, parked] = v.groups(all, NOW);
    expect(parked.rows.map((r: any) => r.main)).toEqual([expect.stringContaining("shelved thing")]);
    expect(open.rows.map((r: any) => r.key)).toEqual(["f-8"]);
    expect(v.stats(all, new Date("2026-11-02T12:00"))).toMatchObject({ open: 1, parked: 1, closed: 1 });
  });
});

describe("what an issue waits on", () => {
  let waiter: string, live: string, dead: string, tracker: string;
  beforeEach(() => {
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
    setAsk(refIn(i), { reason: "question", question: "A or B?", options: [{ label: "A", line: "do a" }, { label: "B", line: "do b" }], recommended: "B", why: ["w"],
      ...(stored ? { situation: "Two ways to go.", effects: [{ action: "resolve:A", text: "Goes with A." }, { action: "resolve:B", text: "Goes with B." }], recommend: { action: "resolve:B", why: "smaller" } } : {}) });
    return i.id;
  }, true)!.value;

  test("the Status awaiting list and the Issue page Ask row agree: an open waiting issue and a parked core-change one have both, a parked question has neither", async () => {
    const [open, core, shelved] = ([["question", "open"], ["core-change", "parked"], ["question", "parked"]] as const).map(([reason, status]) => writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, `${status} ${reason}`, { request: "x" });
      setAsk(refIn(i), { reason, question: "Which?", options: [], why: [] });
      if (status === "parked") setStatus(i, "parked");
      return i.id;
    }, true)!.value);
    const onStatus = (n: number) => state().asks.some((a) => a.id === `fac-${n}`);
    const onPage = async (n: number) => !!(await getJson(`/api/issues/fac-${n}`)).ask;
    expect([open, core, shelved].map(onStatus)).toEqual([true, true, false]);
    expect(await Promise.all([open, core, shelved].map(onPage))).toEqual([true, true, false]);
  });

  test("renderIssue lists commits as Commit, Subject and Committed with a span.idp titled with the hash, pages at 50, and shows no commits as the missing form", async () => {
    const d = await getJson(`/api/issues/fac-1`);
    const date = "2026-11-02T09:00:00Z";
    const h = v.renderIssue({ ...d, commits: [{ hash: "abcdef1234567", subject: "s", date }] });
    expect(h).toMatch(/>Commit<.*>Subject<.*>Committed</);
    expect(h).toContain('title="abcdef1234567">abcdef1<');
    expect(h).toContain('<td class="wide" title="s">s<');
    expect(h).toContain(`>${when(date)}<`);
    const none = v.renderIssue({ ...d, commits: [] });
    expect(none).toContain('<span class="dp-v"><span title="No commit on main yet">–<');
    expect(none).not.toContain("<span>Commits</span>");
    const commits = Array.from({ length: 51 }, (_, i) => ({ hash: `abcdef${i}0000`, subject: `s${i}`, date }));
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
    expect(d.parts.map((g: any) => g.priority)).toEqual(["medium", "critical"]);
    expect(d).not.toHaveProperty("goals");
    d.priority = "critical";
    const h = v.renderIssue(d);
    const head = h.slice(h.indexOf('<div class="status-row">'), h.indexOf("</div>", h.indexOf('<div class="status-row">')));
    expect(head).toContain(">critical<");
    // A part's row in the timeline shows its priority when it is not medium.
    const rows = h.slice(h.indexOf("<h3>Sub-issues</h3>")).split('<div class="dp-row">');
    expect(rows.find((r: string) => r.includes("hot part"))).toContain(">critical<");
    expect(rows.find((r: string) => r.includes("plain part"))).not.toContain(">medium<");
    expect(listRow({ id: 1, ref: "1", repo: "fac", title: "t", priority: "critical" }).main).toMatch(/class="badge error"[^>]*>critical</);
  });
});

describe("the Issue timeline names why a wait waited", () => {
  const run = (kind: string, started: string, ended: string) => ({ kind, name: "fac-1", on: "fac-1", state: "passed", started, ended });
  const d = (holds?: object[]) => ({ repo: "fac", id: 1, ref: "1", status: "done", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], parts: [], holds,
    timeline: { filed: "2026-11-01T10:00:00Z", runs: [run("triage", "2026-11-01T10:00:30Z", "2026-11-01T10:02:00Z"), run("build", "2026-11-01T10:30:00Z", "2026-11-01T10:40:00Z")] } });
  const evs = (x: any) => v.issueSegments(x).flatMap((s: any) => s.rows).flatMap((r: any) => r.events);
  const html = (x: any) => evs(x).map((e: any) => e.html).join("\n");
  test("a wait with hold records of the issue's job in its span names the hold word, its content and its minutes", () => {
    setCodes({ aleph: "a" });
    try {
      const holds = [
        { at: "2026-11-01T10:05:00Z", name: "fac-1", kind: "file", text: "both jobs change the busy file", event: { action: "held", detail: "file: ui/views/issues.js: job.1372" } },
        { at: "2026-11-01T10:06:00Z", name: "fac-2", kind: "red", text: "other job" },
      ];
      expect(evs(d(holds)).map((e: any) => e.tag)).toContain("file");
      expect(html(d(holds))).toContain("file: ui/views/issues.js: job.1372 · 28m 00s");
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
      { id: 1, ref: "1", repo: "f", title: "a", status: "done", labels: [], createdTime: iso("2026-11-04T15:30"), closedTime: iso("2026-11-04T15:45"), runs: 0, cost: 0 },
      { id: 2, ref: "2", repo: "f", title: "b", status: "done", labels: [], createdTime: iso("2026-11-04T09:00"), closedTime: iso("2026-11-04T08:00"), runs: 0, cost: 0 },
      { id: 3, ref: "3", repo: "f", title: "c", status: "done", labels: [], createdTime: iso("2026-11-04"), closedTime: iso("2026-11-04"), runs: 0, cost: 0 },
    ] });
    expect(v.stats(rows, now, "hour")).toMatchObject({ filed: 1, closed: 1 });
    expect(v.stats(rows, now, "day")).toMatchObject({ filed: 3, closed: 3 });
  });
});

describe("the Updated time", () => {
  const item = (fm: Record<string, unknown>, notes: string[] = []) => ({ id: 1, title: "t", fm, request: "", spec: "", notes }) as any;

  test("the updated time is the latest of the creation, the close and the last note", () => {
    const i = item({ created: "2026-01-01T00:00:00.000Z" });
    expect(todos.updated(i)).toBe("2026-01-01T00:00:00.000Z");
    todos.note(i, "hi", new Date(2026, 10, 5, 9, 7));
    expect(todos.updated(i)).toBe(new Date(2026, 10, 5, 9, 7).toISOString());
  });
});

test("the Issues row, the issue's id and its Work head show the short id, and the links keep the full id", () => {
  setCodes({ fac: "f" });
  try {
    expect(listRow({ id: 1, ref: "1", repo: "fac", title: "t" }).lead).toContain('href="#/issues/fac/1">f1<');
    setCodes({ fac: "f", lb: "lb" });
    const row = (repo: string) => listRow({ id: 12, ref: "12", repo, title: "t" }).lead;
    expect(row("fac")).toContain('href="#/issues/fac/12">f12<');
    expect(row("lb")).toContain('href="#/issues/lb/12">lb12<');
    const d = { repo: "fac", id: 1, ref: "1", status: "open", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], parts: [], timeline: { runs: [] } };
    expect(v.renderIssue(d)).toContain('class="idp">f1<');
    expect(v.issueSegments(d)[0].rows[0].head).toContain('class="idp">f1<');
  } finally {
    setCodes({});
  }
});

test("the Issue page's notes show an issue id in its short form", () => {
  setCodes({ aleph: "a" });
  try {
    const d = { repo: "fac", id: 1, ref: "1", status: "open", frontmatter: { created: "2026-11-01" }, commits: [], jobs: [], parts: [], timeline: { runs: [] },
      notes: ["- 2026-11-05T11:02:00.000Z: intake: filed aleph-1443 for x", "- 2026-11-05T11:03:00.000Z: director: filed aleph-1441 for x", "director: filed aleph-1444 for z"].map(noteOf) };
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

test("the Issue page gives a machine note and a plain note each a dp-ev row with its time, tag and body", () => {
  const d = { repo: "fac", id: 1, ref: "1", status: "open", frontmatter: { created: "2026-11-01" }, commits: [], jobs: [], parts: [], timeline: { runs: [] },
    notes: ["- 2026-11-05T11:02:00.000Z: intake: sized it", "- 2026-11-05T11:03:00.000Z: call me back"].map(noteOf) };
  const notes = v.renderIssue(d).match(/<ul class="notes">.*?<\/ul>/gs)!.join("");
  // The rows are the timeline's own event rows, as list items and never clamped.
  const ev = (at: string, tag: string, html: string) => tl.eventHtml({ at: Date.parse(at), tag, tone: "quiet", html }, { el: "li", clamped: false });
  expect(notes).toContain(ev("2026-11-05T11:02:00.000Z", "intake", "sized it"));
  expect(notes).toContain(ev("2026-11-05T11:03:00.000Z", "note", "call me back"));
});

describe("the labels say sub-issue and job", () => {
  /** The page's own labels: the table heads, the headings, and the tile and KPI keys. */
  const labels = (h: string) => [
    ...h.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]*)/g),
    ...h.matchAll(/<h[23][^>]*>([^<]*)</g),
    ...h.matchAll(/<span class="(?:dp-)?k">([^<]*)</g),
  ].map((m) => m[1]);
  const OLD = /runs|goal|part/i;

  test("the Issues page keeps no label with the old words", async () => {
    const rows = await rowsOf("fac");
    const h = v.renderIssues({ issues: rows, projects: ["fac"] }, new URLSearchParams());
    expect(labels(h).filter((t) => OLD.test(t))).toEqual([]);
  });

  test("the Issue page says Sub-issues and Sub-issues done, and no label keeps the old words", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => {
      const i = add(doc, "label parent", { request: "Do it." });
      addPart(doc, i, { title: "one", spec: "x" });
      return i.id;
    }, true)!.value;
    run("", { job: `fac-${n}`, name: `fac-${n}`, repo: "fac", state: "landed", on: `fac-${n}` });
    const h = v.renderIssue(await afterSeed(`/api/issues/fac-${n}`));
    expect(h).toContain(">Sub-issues<");
    expect(h).toContain(">Sub-issues done<");
    expect(h).toContain(">1 job<");
    expect(labels(h).filter((t) => OLD.test(t))).toEqual([]);
  });
});

test("the design page's values: a zero cost shows nothing, a kind with no closed rows has no p50 or p90, the Stage KPI is words, a part's stage is lower case", () => {
  expect(listRow({ id: 1, ref: "1", repo: "fac", title: "t", cost: 0 }).cells[1]).toBe("");
  const frame = v.closeFrame({ kinds: ["bug", "task"], unit: "days", p50: [null, 2], p90: [null, 3] });
  expect(frame.rows.map((r: any) => [r.p50, r.p90])).toEqual([[null, null], [172800, 259200]]);
  const d = { repo: "fac", id: 1, ref: "1", title: "A title", status: "open", frontmatter: { created: "2026-11-01" }, notes: [], commits: [], jobs: [], parts: [], timeline: { runs: [] } };
  const h = v.renderIssue(d);
  expect(h).toContain('class="dp-v text">open<');
  const parts = v.renderIssue({ ...d, parts: [{ id: "1.1", stage: "review", status: "open", title: "p", href: "#/issues/fac/1.1" }] });
  expect(parts).toContain(">1.1 review<");
});
