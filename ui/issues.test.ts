import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add } from "../todo/lib/todo.ts";
import { serve } from "./server.ts";
// @ts-ignore plain JS, shared with the page
import * as v from "./views/issues.js";
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
  server = await serve(0);
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

  test("the factory lens lists only goals in chain order", async () => {
    const rows = await getJson("/api/issues?repo=fac");
    const h = v.renderIssues(rows, { lens: true });
    expect(h).not.toContain("plain task");
    // second goal (fac-3) waits on fac-4, so fac-4 comes first
    const ids = [...h.matchAll(/<li><a class="id"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(ids).toEqual(["fac-1", "fac-4", "fac-3"]);
    expect(h).toContain("waits on fac-4");
  });

  test("the view renders with the route query it is given", async () => {
    const rows = await getJson("/api/issues?repo=fac");
    const h = v.view.render(rows, {}, new URLSearchParams("status=done"));
    expect(h).not.toContain("first goal</span>");
    expect(h).toContain("fac-2");
  });

  test("the list groups by repo and filters by title", async () => {
    const rows = await getJson("/api/issues");
    const h = v.renderIssues(rows, {});
    expect(h).toContain("<h2>fac</h2>");
    expect(h).toContain("<h2>oth</h2>");
    expect(h).toContain("## Goal");
    const f = v.renderIssues(rows, { q: "plain" });
    expect(f).toContain("plain task");
    expect(f).not.toContain("first goal</span>");
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
