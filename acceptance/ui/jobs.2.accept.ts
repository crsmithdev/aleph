// Archived goal tests from ui/jobs.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import { add } from "../../todo/lib/todo.ts";
import { routes } from "../../ui/api/jobs.ts";
import { withEnv } from "../../ui/test-server.ts";
// @ts-ignore jobs.js is plain JS, shared with the page
import * as v from "../../ui/views/jobs.js";
// @ts-ignore plain JS, shared with the page
import * as jobView from "../../ui/views/job.js";

let base: string, jobsDir: string;
let restore: () => void;
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
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "build", told: true, started: ago(3), ...extra }));
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
  restore = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, LANGFUSE_PUBLIC_KEY: "", ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => { add(doc, "old title"); return true; }, true);
  // fac-9: a worker, a fix round with a reviewer, then a land.
  run("20261027-000001-a", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", condition: "failed", reason: "review held", started: ago(5), ended: ago(4), cost: 0.5, model: "claude-sonnet-5-5" },
    { "result.md": "first\nFOLLOWUP: tidy\n", "checks.log": "## test: exit 1\n" + Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n", "stderr.log": "warn\n" });
  run("20261027-000002-a", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", condition: "passed", started: ago(3.5), ended: ago(3), cost: 0.25, defaults: ["a? -> b"] },
    { "result.md": "fixed it\nFOLLOWUP: tidy\n", "review.md": "Looks right.\nVERDICT: pass\n" });
  run("20261027-000003-a", { job: "fac-9", name: "fac-9", kind: "land", repo: "fac", branch: "factory/fac-9", condition: "landed", started: ago(2.5), ended: ago(2), commit: "abc1234" });
  run("20261027-000004-a", { job: "oth-1", name: "oth-1", repo: "oth", condition: "stuck", started: ago(1) });
  run("20261027-000005-a", { job: "fac-2", name: "fac-2", repo: "fac", branch: "factory/gone", condition: "landed", started: ago(24 * 20), ended: ago(24 * 20 - 1) });
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

describe("GET /api/jobs", () => {
  test("lists the jobs in the window, newest first", async () => {
    const jobs = await (await get("/api/jobs")).json();
    expect(jobs.map((j: any) => j.name)).toEqual(["oth-1", "fac-9"]);
    expect(jobs[1].cost).toBeCloseTo(0.75);
    expect(jobs[1].condition).toBe("landed");
    expect(jobs[1].followups).toEqual(["tidy"]);
  });
});

describe("GET /api/jobs/:name holds", () => {
  test("carries the job's hold records and no other name's; [] without any", async () => {
    const fdir = join(base, "factory-holds");
    mkdirSync(fdir, { recursive: true });
    const undo = withEnv({ ALEPH_FACTORY_DIR: fdir });
    try {
      expect((await (await get("/api/jobs/fac-9")).json()).holds).toEqual([]);
      const mine = { at: ago(2), name: "fac-9", kind: "queue", text: "waits for fac-8" };
      const theirs = { at: ago(1), name: "oth-1", kind: "queue", text: "waits" };
      writeFileSync(join(fdir, "holds.jsonl"), [mine, theirs].map((r) => JSON.stringify(r)).join("\n") + "\n");
      expect((await (await get("/api/jobs/fac-9")).json()).holds).toEqual([mine]);
    } finally { undo(); }
  });
});

describe("GET /api/jobs/:name", () => {
  test("an explain run is listed with its own kind, not as a worker", async () => {
    run("20261027-000007-a", { job: "oth-3", name: "oth-3", kind: "explain", repo: "oth", condition: "passed", started: ago(1), ended: ago(0.5) });
    const j = await (await get("/api/jobs/oth-3")).json();
    rmSync(join(jobsDir, "20261027-000007-a"), { recursive: true, force: true });
    expect(j.runs.map((r: any) => r.kind)).toEqual(["explain"]);
  });
  test("returns runs in order, the review, and ignores the log files", async () => {
    const j = await (await get("/api/jobs/fac-9")).json();
    expect(j.runs.map((r: any) => r.kind)).toEqual(["worker", "worker", "review", "land"]);
    expect(j.runs[0]).toMatchObject({ condition: "failed", cost: 0.5, model: "claude-sonnet-5-5" });
    expect(j.result).toBe("fixed it\nFOLLOWUP: tidy\n");
    expect(j.review).toContain("VERDICT: pass");
    expect(j.checksLog).toBeUndefined();
    expect(j.stderr).toBeUndefined();
    expect(j.stat).toContain("a.txt");
    expect(j.trace).toBeUndefined();
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
  test("a landed job's diff and stat come from its commit once the branch is gone", async () => {
    const fac = join(base, "fac");
    sh(fac, "git", "switch", "-qc", "tmp-land");
    writeFileSync(join(fac, "b.txt"), "landed\n");
    sh(fac, "git", "add", "."); sh(fac, "git", "commit", "-qm", "landed work");
    const commit = sh(fac, "git", "rev-parse", "HEAD");
    sh(fac, "git", "switch", "-q", "main");
    sh(fac, "git", "branch", "-D", "tmp-land");
    run("20261027-000050-a", { job: "fac-L", name: "fac-L", repo: "fac", branch: "factory/fac-L", condition: "landed", commit });
    const t = await (await get("/api/jobs/fac-L/diff")).text();
    expect(t).toContain("+landed");
    expect(((await (await get("/api/jobs/fac-L")).json()) as any).stat).toContain("b.txt");
  });
});

describe("render", () => {
  const job: any = {
    name: "fac-9", repo: "fac", item: { id: 9, title: "Fix <it>" }, condition: "landed", started: ago(5), cost: 0.75, defaults: ["a? -> b"], followups: ["tidy"],
    runs: [
      { id: "1", kind: "worker", condition: "failed", started: ago(5), ended: ago(4), cost: 0.5, model: "m1" },
      { id: "2", kind: "worker", condition: "passed", started: ago(3.5), ended: ago(3), cost: 0.25 },
      { id: "2-review", kind: "review", condition: "passed", started: ago(3) },
      { id: "3", kind: "land", condition: "landed", started: ago(2.5), ended: ago(2) },
    ],
    result: "fixed it", review: "Looks right.", stat: " a.txt | 1 +", trace: "http://lf/sessions/s",
  };
  test("a wait between runs names the hold reason with its minutes; an answer without holds keeps the plain text", () => {
    const at = (m: number) => new Date(now - 5 * 3600_000 + m * 60_000).toISOString();
    const j = { ...job, runs: [{ id: "1", kind: "worker", condition: "passed", started: at(0), ended: at(10) }, { id: "2", kind: "land", condition: "landed", started: at(40), ended: at(41) }] };
    const h = v.renderJob({ ...j, holds: [{ at: at(15), name: "fac-9", kind: "held", text: "main checks are red" }] });
    expect(h).toContain("Waited 30 min: 25 min because main checks are red.");
    expect(v.renderJob(j)).toContain("Waited 30 min.");
  });
  test("diff lines are coloured and escaped", () => {
    const h = v.renderDiff("--- a\n+++ b\n+x<y\n-z");
    expect(h).toContain('<span class="add">+x&lt;y</span>');
    expect(h).toContain('<span class="del">-z</span>');
  });
});

test("the issue and job pages use pageHead, table.tbl, idLink and when", async () => {
  const { renderIssue } = require("../../ui/views/issues.js");
  // This year's date, so when() prints "Oct 01 10:00" whatever the clock says.
  const started = `${new Date().getFullYear()}-10-01T10:00:00`;
  const issue = renderIssue({ repo: "fac", id: 9, title: "T", status: "open", frontmatter: { labels: ["ui"] }, body: "", notes: [], jobs: [{ name: "fac-9", condition: "landed", started }], commits: [{ hash: "abcdef123", subject: "s", date: started, commitUrl: "http://x/c" }] });
  for (const t of ['<header class="ph">', '<table class="tbl">', 'class="idl"', 'class="chips"', "Oct 01 10:00"]) expect(issue).toContain(t);
  expect(issue).not.toContain('class="ih"');
  const job = require("../../ui/views/jobs.js").renderJob({ name: "fac-9", repo: "fac", item: { title: "T" }, condition: "landed", started, runs: [] });
  for (const t of ['<header class="ph">', "Oct 01 10:00"]) expect(job).toContain(t);
  expect(job).not.toContain("<style>");
  expect(job).toContain('class="dp-panel dp-kpis"');
});

describe("a worker round the reviewer sent back", () => {
  test("a stuck round that is the job's last worker run still reads stuck", async () => {
    const id = "20261102-000104-a";
    run(id, { job: "oth-sl", name: "oth-sl", repo: "oth", branch: "factory/oth-sl", condition: "stuck", failed: "review", reason: "held", next: "worker", started: ago(2), ended: ago(1.5) }, { "review.md": "No.\nVERDICT: fail\n" });
    try {
      const j = await (await get("/api/jobs/oth-sl")).json();
      expect(j.runs.map((r: any) => [r.id, r.condition])).toEqual([[id, "stuck"], [`${id}-review`, "stuck"]]);
    } finally {
      rmSync(join(jobsDir, id), { recursive: true, force: true });
    }
  });
});
