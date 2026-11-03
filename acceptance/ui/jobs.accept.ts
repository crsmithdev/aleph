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

describe("GET /api/jobs/:name", () => {
  test("a build run reads like an agent run: review row and result", async () => {
    run("20261027-000006-a", { job: "oth-2", name: "oth-2", kind: "build", repo: "oth", condition: "passed", started: ago(1), ended: ago(0.5) },
      { "result.md": "built it\n", "review.md": "Fine.\nVERDICT: pass\n" });
    const j = await (await get("/api/jobs/oth-2")).json();
    rmSync(join(jobsDir, "20261027-000006-a"), { recursive: true, force: true });
    expect(j.runs.map((r: any) => r.kind)).toEqual(["worker", "review"]);
    expect(j.result).toBe("built it\n");
    expect(j.review).toContain("VERDICT: pass");
  });
});

describe("render", () => {
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
});
