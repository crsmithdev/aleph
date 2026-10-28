import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../todo/lib/store.ts";
import { add } from "../todo/lib/todo.ts";
import { routes } from "./api/jobs.ts";
// @ts-ignore jobs.js is plain JS, shared with the page
import * as v from "./views/jobs.js";
// @ts-ignore plain JS, shared with the page
import * as jobView from "./views/job.js";

let base: string, jobsDir: string;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const now = Date.now();
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
function run(id: string, extra: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "agent", told: true, started: ago(3), ...extra }));
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t);
}
async function get(path: string) {
  const url = new URL(`http://x${path}`);
  const key = Object.keys(routes).find((k) => {
    const [, p] = k.split(" ");
    return new RegExp("^" + p.replace(/:\w+/g, "([^/]+)") + "$").test(url.pathname);
  })!;
  const m = url.pathname.match(new RegExp("^" + key.split(" ")[1].replace(/:\w+/g, "([^/]+)") + "$"))!;
  const params: Record<string, string> = m[1] ? { name: m[1] } : {};
  return routes[key](new Request(url), params, url);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-jobs-"));
  jobsDir = join(base, "jobs");
  mkdirSync(jobsDir);
  const mk = (name: string) => { const p = join(base, name); sh(base, "git", "init", "-q", "-b", "main", p); return p; };
  const fac = mk("fac"), oth = mk("oth");
  for (const r of [fac, oth]) {
    writeFileSync(join(r, "a.txt"), "one\n");
    sh(r, "git", "add", "."); sh(r, "git", "commit", "-qm", "init");
    sh(r, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  }
  sh(fac, "git", "switch", "-qc", "factory/fac-9");
  writeFileSync(join(fac, "a.txt"), "one\ntwo\n");
  sh(fac, "git", "commit", "-qam", "work");
  sh(fac, "git", "switch", "-q", "main");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: fac }, oth: { path: oth } }));
  for (const [k, val] of Object.entries({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, LANGFUSE_PUBLIC_KEY: "" })) {
    saved[k] = process.env[k]; process.env[k] = val;
  }
  Object.assign(process.env, gitEnv);
  writeList({ key: "fac" }, "seed", (doc) => { add(doc, "old title"); return true; }, true);
  // fac-9: a worker, a fix round with a reviewer, then a land.
  run("20261027-000001-a", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", state: "failed", reason: "review held", started: ago(5), ended: ago(4), cost: 0.5, model: "claude-sonnet-5-5" },
    { "result.md": "first\nFOLLOWUP: tidy\n", "checks.log": "## test: exit 1\n" + Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n", "stderr.log": "warn\n" });
  run("20261027-000002-a", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", state: "passed", started: ago(3.5), ended: ago(3), cost: 0.25, defaults: ["a? -> b"] },
    { "result.md": "fixed it\nFOLLOWUP: tidy\n", "review.md": "Looks right.\nVERDICT: pass\n" });
  run("20261027-000003-a", { job: "fac-9", name: "fac-9", kind: "land", repo: "fac", branch: "factory/fac-9", state: "landed", started: ago(2.5), ended: ago(2), commit: "abc1234" });
  run("20261027-000004-a", { job: "oth-1", name: "oth-1", repo: "oth", state: "stuck", started: ago(1) });
  run("20261027-000005-a", { job: "fac-2", name: "fac-2", repo: "fac", branch: "factory/gone", state: "landed", started: ago(24 * 20), ended: ago(24 * 20 - 1) });
});
afterAll(() => {
  for (const [k, val] of Object.entries(saved)) if (val === undefined) delete process.env[k]; else process.env[k] = val;
  rmSync(base, { recursive: true, force: true });
});

describe("a land that found the job lock busy", () => {
  test("the job's state is the run that counts; the run list keeps the land", async () => {
    const ids = ["20261027-000040-a", "20261027-000041-a"];
    run(ids[0], { job: "fac-7", name: "fac-7", repo: "fac", state: "passed", started: ago(3) });
    run(ids[1], { kind: "land", job: "fac-7", name: "fac-7", repo: "fac", state: "failed", reason: "job lock busy", started: ago(2) });
    try {
      const d = await (await get("/api/jobs/fac-7")).json();
      expect(d.state).toBe("passed");
      expect(d.reason).toBeUndefined();
      expect(d.runs.find((r: any) => r.id === ids[1])).toMatchObject({ state: "failed", reason: "job lock busy" });
      expect((await (await get("/api/jobs?state=failed")).json()).map((j: any) => j.name)).not.toContain("fac-7");
      expect((await (await get("/api/jobs?state=passed")).json()).map((j: any) => j.name)).toContain("fac-7");
    } finally {
      for (const id of ids) rmSync(join(jobsDir, id), { recursive: true });
    }
  });
});

describe("GET /api/jobs", () => {
  test("lists the jobs in the window, newest first", async () => {
    const jobs = await (await get("/api/jobs")).json();
    expect(jobs.map((j: any) => j.name)).toEqual(["oth-1", "fac-9"]);
    expect(jobs[1].cost).toBeCloseTo(0.75);
    expect(jobs[1].state).toBe("landed");
    expect(jobs[1].followups).toEqual(["tidy"]);
  });
  test("filters by repo, state and days", async () => {
    expect((await (await get("/api/jobs?repo=fac")).json()).map((j: any) => j.name)).toEqual(["fac-9"]);
    expect((await (await get("/api/jobs?state=stuck")).json()).map((j: any) => j.name)).toEqual(["oth-1"]);
    expect((await (await get("/api/jobs?days=30")).json()).map((j: any) => j.name)).toEqual(["oth-1", "fac-9", "fac-2"]);
    expect(await (await get("/api/jobs?days=x")).status).toBe(400);
  });
  test("?project narrows to one project", async () => {
    expect((await (await get("/api/jobs?project=oth&days=30")).json()).map((j: any) => j.name)).toEqual(["oth-1"]);
    expect(await (await get("/api/jobs?project=nope")).json()).toEqual([]);
  });
});

describe("item titles", () => {
  test("a rename between two requests shows in the second", async () => {
    run("20261027-000006-a", { job: "fac-7", name: "fac-7", repo: "fac", state: "running", todo: 1 });
    const title = async () => (await (await get("/api/jobs")).json()).find((j: any) => j.name === "fac-7").item.title;
    expect(await title()).toBe("old title");
    writeList({ key: "fac" }, "rename", (doc) => { doc.items.find((i) => i.id === 1)!.title = "new title"; return true; });
    expect(readList({ key: "fac" })!.items[0].title).toBe("new title");
    expect(await title()).toBe("new title");
    expect((await (await get("/api/jobs/fac-7")).json()).item.title).toBe("new title");
  });
});

describe("GET /api/jobs/:name", () => {
  test("returns runs in order, the review and the log tails", async () => {
    const j = await (await get("/api/jobs/fac-9")).json();
    expect(j.runs.map((r: any) => r.kind)).toEqual(["worker", "worker", "review", "land"]);
    expect(j.runs[0]).toMatchObject({ state: "failed", cost: 0.5, model: "claude-sonnet-5-5" });
    expect(j.result).toBe("fixed it\nFOLLOWUP: tidy\n");
    expect(j.review).toContain("VERDICT: pass");
    expect(j.checksLog.split("\n")).toHaveLength(80);
    expect(j.checksLog.endsWith("line 99")).toBe(true);
    expect(j.stderr).toBe("warn");
    expect(j.stat).toContain("a.txt");
    expect(j.trace).toBeUndefined();
  });
  test("404 for an unknown name, or another project's job", async () => {
    expect((await get("/api/jobs/nope")).status).toBe(404);
    expect((await get("/api/jobs/fac-9?project=oth")).status).toBe(404);
    expect((await get("/api/jobs/fac-9?project=fac")).status).toBe(200);
  });
});

describe("a name reused by a dropped job and its rerun", () => {
  test("the job and its diff are the newest job's", async () => {
    run("20261001-000001-a", { job: "dup-old", name: "fac-dup", repo: "fac", branch: "factory/gone", state: "dropped", started: ago(24 * 40), ended: ago(24 * 40 - 1) });
    run("20261001-000002-a", { job: "dup-new", name: "fac-dup", repo: "fac", branch: "factory/fac-9", state: "landed", started: ago(24 * 39), ended: ago(24 * 39 - 1), commit: "def5678" });
    const j = await (await get("/api/jobs/fac-dup?days=60")).json();
    expect(j.state).toBe("landed");
    expect(j.runs.map((r: any) => r.state)).toEqual(["landed"]);
    const d = await get("/api/jobs/fac-dup/diff?days=60");
    expect(d.status).toBe(200);
    expect(await d.text()).toContain("+two");
  });
});

describe("GET /api/jobs/:name/diff", () => {
  test("returns the branch's diff from its merge base", async () => {
    const res = await get("/api/jobs/fac-9/diff");
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain("+two");
    expect(t).toContain("a/a.txt");
  });
  test("404 when the branch is gone, or the job unknown", async () => {
    expect((await get("/api/jobs/fac-2/diff?days=30")).status).toBe(404);
    expect((await get("/api/jobs/oth-1/diff")).status).toBe(404);
    expect((await get("/api/jobs/zzz/diff")).status).toBe(404);
    expect((await get("/api/jobs/fac-9/diff?project=oth")).status).toBe(404);
  });
});

describe("render", () => {
  const job: any = {
    name: "fac-9", repo: "fac", item: { id: 9, title: "Fix <it>" }, state: "landed", started: ago(5), cost: 0.75, defaults: ["a? -> b"], followups: ["tidy"],
    runs: [
      { id: "1", kind: "worker", state: "failed", started: ago(5), ended: ago(4), cost: 0.5, model: "m1" },
      { id: "2", kind: "worker", state: "passed", started: ago(3.5), ended: ago(3), cost: 0.25 },
      { id: "2-review", kind: "review", state: "passed", started: ago(3) },
      { id: "3", kind: "land", state: "landed", started: ago(2.5), ended: ago(2) },
    ],
    result: "fixed it", review: "Looks right.", checksLog: "## test: exit 1", stderr: "warn", stat: " a.txt | 1 +", trace: "http://lf/sessions/s",
  };
  test("the job view shows each run of a fix round", () => {
    const h = v.renderJob(job);
    expect(h.match(/class="run run-/g)).toHaveLength(4);
    for (const t of ["run-worker", "run-review", "run-land", "m1", "fixed it", "Looks right.", "## test: exit 1", "warn", "a.txt | 1 +", 'href="http://lf/sessions/s"', 'data-diff="fac-9"', "Fix &lt;it&gt;"]) expect(h).toContain(t);
    expect(h).not.toContain("<it>");
  });
  test("the list shows jobs with filters, and an empty state", () => {
    const h = v.renderJobs([job], { repo: "fac", state: "landed" });
    expect(h).toContain('href="#/jobs/fac-9"');
    expect(h).toContain('<table class="tbl">');
    expect(h.match(/<th[ >]/g)).toHaveLength(8);
    expect(h).toContain('<select name="state"');
    expect(h).toContain('<option value="landed" selected>');
    expect(h).toContain('aria-pressed="true"');
    expect(h).not.toContain("<style>");
    expect(h).not.toContain("data-more");
    const many = v.renderJobs(Array.from({ length: 51 }, (_, i) => ({ ...job, name: `fac-${i}` })), {});
    expect(many.match(/<tr hidden>/g)).toHaveLength(1);
    expect(many).toContain('data-more="1"');
    expect(many).toContain("50 of 51");
    expect(v.renderJobs([], {})).toContain("No job in this window.");
  });
  test("the list reads the route query from its argument", () => {
    expect(v.view.api({}, new URLSearchParams("state=stuck&repo=fac"))).toBe("/api/jobs?repo=fac&state=stuck");
    expect(v.view.api({}, new URLSearchParams())).toBe("/api/jobs");
    const h = v.view.render([job], {}, new URLSearchParams("state=stuck"));
    expect(h).toContain('<option value="stuck" selected>');
  });
  test("no render or api function reads location.hash", () => {
    expect(String(v.view.api)).not.toContain("location.hash");
    expect(String(v.view.render)).not.toContain("location.hash");
    expect(String(v.renderJobs)).not.toContain("location.hash");
  });
  test("the view and the detail are routed", () => {
    expect(v.view.path).toBe("/jobs");
    expect(v.view.group).toBe("factory");
    expect(v.detail.path).toBe("/jobs/:name");
    expect(jobView.view).toBe(v.detail);
  });
  test("each run field is its own element in its row", () => {
    const h = v.renderRuns([{ id: "1", kind: "worker", state: "failed", started: ago(5), ended: ago(4), cost: 1.0276, model: "opus", reason: "checks failed" }]);
    const row = h.match(/<li class="run run-worker">.*?<\/li>/)?.[0] ?? "";
    const fields = [...row.matchAll(/<span class="([^"]+)">([^<]*)<\/span>/g)].map((m) => m[1]);
    expect(fields).toEqual(["kind", "badge stuck", "start num", "took num", "cost num", "model quiet", "reason quiet"]);
    expect(row).toContain('<span class="kind">worker</span>');
    expect(row).toContain('<span class="badge stuck">failed</span>');
    expect(row).toContain('<span class="took num">');
    expect(row).toContain('<span class="cost num">$1.03</span>');
    expect(row).toContain('<span class="model quiet">opus</span>');
    expect(row).toContain('<span class="reason quiet">checks failed</span>');
  });
  test("diff lines are coloured and escaped", () => {
    const h = v.renderDiff("--- a\n+++ b\n+x<y\n-z");
    expect(h).toContain('<span class="add">+x&lt;y</span>');
    expect(h).toContain('<span class="del">-z</span>');
  });
});
