import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../todo/lib/store.ts";
import { add } from "../todo/lib/todo.ts";
import * as todos from "../todo/lib/todo.ts";
import { readDecision, writeDecision } from "../jobs/lib/decision.ts";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/contents.js";
// @ts-ignore
import { view as issueView } from "./views/issue.js";

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
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "agent", told: true, started: new Date().toISOString(), ...extra }));
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
  sh(repo, "git", "add", "."); sh(repo, "git", "commit", "-q", "-m", "real work\n\nItem: fac-1\nJob: fac-1");
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
  for (const [k, val] of Object.entries({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_CLI: fake })) {
    saved[k] = process.env[k];
    process.env[k] = val;
  }
  Object.assign(process.env, gitEnv);
  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "first goal", { labels: ["goal"], body: "# Heading\n\n- one\n\n<script>alert(1)</script>" });
    add(doc, "plain task", { labels: ["bug"] });
    add(doc, "second goal", { labels: ["goal"], waitingOn: "fac-4" });
    add(doc, "third goal", { labels: ["goal"] });
    doc.items[1].fm.status = "done";
    return true;
  }, true);
  writeList({ key: "oth" }, "seed", (doc) => { add(doc, "other thing"); return true; }, true);
  run("20261027-000001-a", { job: "fac-1", name: "fac-1", repo: "fac", state: "landed", todo: 1 });
  run("20261027-000002-a", { job: "oth-1", name: "oth-1", repo: "oth", state: "running", todo: 1 });
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
    expect((await getJson("/api/issues?repo=fac&label=goal")).map((r: any) => r.id)).toEqual([1, 3, 4]);
    const [r] = await getJson("/api/issues?repo=fac&label=goal");
    expect(r).toMatchObject({ repo: "fac", title: "first goal", status: "open", priority: "medium", labels: ["goal"], due: null, waiting_on: null, notes: 0 });
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

  test("a goal carries its derived state", async () => {
    const rows = await getJson("/api/issues?repo=fac&label=goal");
    expect(rows[0].state).toBe("done");
    expect(rows[1].state).toBe("open");
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
  test("lists the job and the trailer commit, not the prose one", async () => {
    const d = await getJson("/api/issues/fac/1");
    expect(d.title).toBe("first goal");
    expect(d.body).toContain("# Heading");
    expect(d.frontmatter.status).toBe("open");
    expect(d.derived.state).toBe("done");
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

  test("/api/contents gives the issues and the projects", async () => {
    const d = await getJson("/api/contents");
    expect(d.issues.length).toBeGreaterThan(3);
    expect(d.projects.map((p: any) => p.key).sort()).toEqual(["fac", "oth"]);
    expect([...new Set(d.issues.map((i: any) => i.repo))].sort()).toEqual(["fac", "oth"]);
    expect((await getJson("/api/contents?project=fac")).projects.map((p: any) => p.key)).toEqual(["fac"]);
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

  test("two columns: Issues first, then Projects with Name, Open issues, Last activity", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("status=any"));
    expect(h.indexOf("<h2>Projects")).toBeGreaterThan(-1);
    expect(h.indexOf("<h2>Projects")).toBeGreaterThan(h.indexOf("<h2>Issues"));
    const ths = (html: string) => [...html.matchAll(/<th(?: [^>]*)?>(?:<button[^>]*data-sort="(\w+)")?/g)].map((m) => m[1] ?? "");
    expect(ths(section(h, "projects-table"))).toEqual(["title", "open", "updated"]);
    expect(ths(section(h, "issues-table"))).toEqual(["id", "title", "status", "project", "labels", "updated", ""]);
    expect(h).not.toContain('data-name="type"');
    expect(h).toContain(`<div class="sh"><h2>Projects</h2><span class="count">${d.projects.length}</span></div>`);
    expect(h).toContain(`<div class="sh"><h2>Issues</h2><span class="count">${d.issues.length}</span></div>`);
  });

  test("issue rows: Id, Title, Status, Project, Labels, Updated and an X on an open issue only", async () => {
    const d = await getJson("/api/contents");
    const h = section(v.view.render(d, {}, new URLSearchParams("status=any")), "issues-table");
    expect(h).toContain('href="#/issues/fac/1"');
    expect(h).not.toContain('href="#/projects/');
    const rows = h.split("<tr class=\"crow\"").slice(1);
    for (const r of rows) expect(r.includes("data-cancel")).toBe(r.includes(">open</span>"));
    expect(rows.some((r: string) => r.includes(">done</span>"))).toBe(true);
    expect(v.view.render(d, {}, new URLSearchParams())).toContain("File an issue");
  });

  test("project rows: every registered project, open issues, last activity; no X", async () => {
    const d = await getJson("/api/contents");
    const h = section(v.view.render(d, {}, new URLSearchParams()), "projects-table");
    expect(h).toContain('<a href="#/inventory?project=fac" data-project="fac">fac</a>');
    expect(h).toContain('<a href="#/inventory?project=oth" data-project="oth">oth</a>');
    expect(h).not.toContain("data-cancel");
    const fac = d.projects.find((p: any) => p.key === "fac");
    expect(h).toContain(`<td class="num">${fac.openItems}</td>`);
    const rows = v.projectRows({ projects: [{ key: "empty", openItems: 0, activity: null }, { key: "b", openItems: 2, activity: "2026-10-01T00:00:00Z" }] });
    const html = v.renderProjectsTable(rows, { psort: { key: "title", dir: 1 } });
    expect(html).toContain('<td class="num">0</td>');
    expect(html.indexOf(">b<")).toBeLessThan(html.indexOf(">empty<"));
  });

  test("the filters apply to Issues; the Project filter also narrows Projects; there is no Type filter", async () => {
    const d = await getJson("/api/contents");
    expect(v.hashOptions(new URLSearchParams("type=project"))).not.toHaveProperty("type");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(section(h, "projects-table")).toContain("project=oth");
    expect(section(h, "projects-table")).not.toContain("project=fac");
    const rows = v.issueRows(d);
    expect(v.filterRows(rows, { status: "done" }).every((r: any) => r.status === "done")).toBe(true);
    expect(v.filterRows(rows, { project: "oth" }).every((r: any) => r.project === "oth")).toBe(true);
    expect(v.filterRows(rows, { project: "oth" }).length).toBeGreaterThan(0);
    expect(v.filterRows(rows, { q: "plain" }).map((r: any) => r.title)).toEqual(["plain task"]);
    // the Projects table is not narrowed by Status, Label or Title
    const s = v.view.render(d, {}, new URLSearchParams("status=done&q=zzzz"));
    expect(section(s, "projects-table")).toContain("project=fac");
  });

  test("the Status filter defaults to Open, newest first; Any shows every status", async () => {
    const d = await getJson("/api/contents");
    expect(v.hashOptions(new URLSearchParams()).status).toBe("open");
    expect(v.hashOptions(new URLSearchParams("status=any")).status).toBe("");
    expect(v.hashOptions(new URLSearchParams("status=done")).status).toBe("done");
    const def = v.view.render(d, {}, new URLSearchParams());
    const issues = section(def, "issues-table");
    expect(issues).not.toContain(">done</span>");
    expect(issues).toContain(">open</span>");
    expect(def).toContain('data-value="open" aria-pressed="true"');
    expect(v.view.render(d, {}, new URLSearchParams("status=any"))).toContain(">done</span>");
    expect(v.view.render(d, {}, new URLSearchParams("status=any"))).toContain('data-value="any" aria-pressed="true"');
    const t = (h: string) => [...h.matchAll(/<td class="time">([^<]*)</g)].map((m) => m[1]);
    expect(t(issues)).toEqual([...t(issues)].sort().reverse());
  });

  test("the filter bar is one filterBar; the row is the link, the title plain text", async () => {
    const d = await getJson("/api/contents");
    const h = v.view.render(d, {}, new URLSearchParams("project=oth&status=any"));
    expect(h.match(/class="fbar"/g)).toHaveLength(1);
    for (const n of ["project", "status", "label"]) expect(h).toContain(`data-name="${n}"`);
    expect(h).toContain('name="q"');
    expect(h).toContain('data-value="oth" aria-pressed="true"');
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
    expect(section(v.view.render(d, {}, new URLSearchParams("psort=open&pdir=asc")), "projects-table")).toContain('aria-sort="ascending"');
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

  test("the X drops through the issue's drop route", async () => {
    const d = await getJson("/api/contents");
    const open = v.issueRows(d).find((r: any) => r.status === "open");
    expect(v.dropTarget(open)).toMatchObject({ url: `/api/issues/${open.repo}/${open.n}/drop` });
    expect(v.dropTarget({ ...open, status: "done" })).toBeNull();
  });
});

describe("POST /api/issues", () => {
  test("passes title, labels, --waiting-on and the body on stdin to the CLI", async () => {
    const res = await post({ repo: "fac", title: "new one", body: "## Goal\n\ndo it", labels: ["goal", "x"], waitingOn: "fac-1", due: "2026-12-01" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ added: 7 });
    expect(readFileSync(argvFile, "utf8").trim().split("\n")).toEqual(["todo", "add", "fac", "new one", "--body", "-", "--labels", "goal,x", "--waiting-on", "fac-1", "--due", "2026-12-01"]);
    expect(readFileSync(stdinFile, "utf8")).toBe("## Goal\n\ndo it");
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
    const i = add(doc, "which way", { labels: ["needs-chris"], body: "x" });
    if (decision) writeDecision(i, { question: "A or B?", options: [{ label: "A", line: "do a", ...(wait ? { waiting_on: wait } : {}) }, { label: "B", line: "do b" }], recommended: "B", why: ["w"] });
    else todos.note(i, "triage: for Chris: Should it be A or B? My recommendation is B, it is smaller.");
    return i.id;
  })!.value;

  test("approving an option writes the note, swaps needs-chris for goal and clears the fields", async () => {
    const n = ask(true);
    await withRealCli(async () => {
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", body: "{}" })).status).toBe(403);
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "Z" }) })).status).toBe(400);
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      const i = item(n);
      expect(i.notes.at(-1)).toContain("Chris decided: A: do a");
      expect(i.fm.labels).toEqual(["goal"]);
      expect(i.fm.question).toBeUndefined();
      expect((await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) })).status).toBe(409);
    });
  });

  test("an option that waits sets waiting_on in the same write as the goal label", async () => {
    const n = ask(true, "fac-1");
    expect(readDecision(item(n))!.options[0].waiting_on).toBe("fac-1");
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ label: "A" }) });
      expect(r.status).toBe(200);
      expect(item(n).fm.labels).toEqual(["goal"]);
      expect(item(n).fm.waiting_on).toBe("fac-1");
    });
  });

  test("an old prose note is approved by its recommendation sentence", async () => {
    const n = ask(false);
    await withRealCli(async () => {
      const r = await at(`/api/issues/fac/${n}/decide`, { method: "POST", headers: h, body: JSON.stringify({ recommendation: true }) });
      expect(r.status).toBe(200);
      expect(item(n).notes.at(-1)).toContain("Chris decided: My recommendation is B, it is smaller.");
      expect(item(n).fm.labels).toEqual(["goal"]);
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
