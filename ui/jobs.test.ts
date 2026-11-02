import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../todo/lib/store.ts";
import { add, setStatus } from "../todo/lib/todo.ts";
import { routes } from "./api/jobs.ts";
import { withEnv } from "./test-server.ts";
// @ts-ignore jobs.js is plain JS, shared with the page
import * as v from "./views/jobs.js";
// @ts-ignore plain JS, shared with the page
import * as jobView from "./views/job.js";

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

describe("a land that found the job lock busy", () => {
  test("the job's state is the run that counts; the run list keeps the land", async () => {
    const ids = ["20261027-000040-a", "20261027-000041-a"];
    run(ids[0], { job: "fac-7", name: "fac-7", repo: "fac", condition: "passed", started: ago(3) });
    run(ids[1], { kind: "land", job: "fac-7", name: "fac-7", repo: "fac", condition: "failed", reason: "job lock busy", started: ago(2) });
    try {
      const d = await (await get("/api/jobs/fac-7")).json();
      expect(d.condition).toBe("passed");
      expect(d.reason).toBeUndefined();
      expect(d.runs.find((r: any) => r.id === ids[1])).toMatchObject({ condition: "failed", reason: "job lock busy" });
      expect((await (await get("/api/jobs?condition=failed")).json()).map((j: any) => j.name)).not.toContain("fac-7");
      expect((await (await get("/api/jobs?condition=passed")).json()).map((j: any) => j.name)).toContain("fac-7");
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
    expect(jobs[1].condition).toBe("landed");
    expect(jobs[1].followups).toEqual(["tidy"]);
  });
  test("filters by repo, state and days", async () => {
    expect((await (await get("/api/jobs?repo=fac")).json()).map((j: any) => j.name)).toEqual(["fac-9"]);
    expect((await (await get("/api/jobs?condition=stuck")).json()).map((j: any) => j.name)).toEqual(["oth-1"]);
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
    run("20261027-000006-a", { job: "fac-7", name: "fac-7", repo: "fac", condition: "running", on: "fac-1" });
    const title = async () => (await (await get("/api/jobs")).json()).find((j: any) => j.name === "fac-7").item.title;
    expect(await title()).toBe("old title");
    writeList({ key: "fac" }, "rename", (doc) => { doc.items.find((i) => i.id === 1)!.title = "new title"; return true; });
    expect(readList({ key: "fac" })!.items[0].title).toBe("new title");
    expect(await title()).toBe("new title");
    expect((await (await get("/api/jobs/fac-7")).json()).item.title).toBe("new title");
  });
});

describe("GET /api/jobs/:name", () => {
  test("a job whose issue waits names its blockers, and the page shows them; a closed issue waits on nothing", async () => {
    let refs: number[] = [];
    writeList({ key: "oth" }, "blockers", (doc) => {
      const gone = add(doc, "gone work"); setStatus(gone, "dropped");
      const open = add(doc, "waiter"); open.fm.after = [`oth-${gone.id}`];
      const shut = add(doc, "closed waiter"); shut.fm.after = [`oth-${gone.id}`]; setStatus(shut, "done");
      refs = [gone.id, open.id, shut.id];
      return true;
    }, true);
    const [gone, open, shut] = refs;
    const ids = ["20261027-000050-a", "20261027-000051-a"];
    run(ids[0], { job: `oth-${open}`, name: `oth-${open}`, repo: "oth", condition: "stuck", on: `oth-${open}`, started: ago(1) });
    run(ids[1], { job: `oth-${shut}`, name: `oth-${shut}`, repo: "oth", condition: "landed", on: `oth-${shut}`, started: ago(1) });
    const j = await (await get(`/api/jobs/oth-${open}`)).json();
    const closed = await (await get(`/api/jobs/oth-${shut}`)).json();
    for (const id of ids) rmSync(join(jobsDir, id), { recursive: true, force: true });
    expect(j.blockers).toEqual([expect.objectContaining({ id: `oth-${gone}`, title: "gone work", dead: "dropped" })]);
    expect(closed.blockers).toBeUndefined();
    const html = v.renderJob(j);
    expect(html).toContain('<span class="quiet">Blocked by</span>');
    expect(html).toContain(`data-act="unblock" data-repo="oth" data-id="${open}"`);
  });
  test("a build run reads like an agent run: review row and result", async () => {
    run("20261027-000006-a", { job: "oth-2", name: "oth-2", kind: "build", repo: "oth", condition: "passed", started: ago(1), ended: ago(0.5) },
      { "result.md": "built it\n", "review.md": "Fine.\nVERDICT: pass\n" });
    const j = await (await get("/api/jobs/oth-2")).json();
    rmSync(join(jobsDir, "20261027-000006-a"), { recursive: true, force: true });
    expect(j.runs.map((r: any) => r.kind)).toEqual(["worker", "review"]);
    expect(j.result).toBe("built it\n");
    expect(j.review).toContain("VERDICT: pass");
  });
  test("an explain run is listed with its own kind, not as a worker", async () => {
    run("20261027-000007-a", { job: "oth-3", name: "oth-3", kind: "explain", repo: "oth", condition: "passed", started: ago(1), ended: ago(0.5) });
    const j = await (await get("/api/jobs/oth-3")).json();
    rmSync(join(jobsDir, "20261027-000007-a"), { recursive: true, force: true });
    expect(j.runs.map((r: any) => r.kind)).toEqual(["explain"]);
  });
  test("returns runs in order, the review and the log tails", async () => {
    const j = await (await get("/api/jobs/fac-9")).json();
    expect(j.runs.map((r: any) => r.kind)).toEqual(["worker", "worker", "review", "land"]);
    expect(j.runs[0]).toMatchObject({ condition: "failed", cost: 0.5, model: "claude-sonnet-5-5" });
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
    run("20261001-000001-a", { job: "dup-old", name: "fac-dup", repo: "fac", branch: "factory/gone", condition: "dropped", started: ago(24 * 40), ended: ago(24 * 40 - 1) });
    run("20261001-000002-a", { job: "dup-new", name: "fac-dup", repo: "fac", branch: "factory/fac-9", condition: "landed", started: ago(24 * 39), ended: ago(24 * 39 - 1), commit: "def5678" });
    const j = await (await get("/api/jobs/fac-dup?days=60")).json();
    expect(j.condition).toBe("landed");
    expect(j.runs.map((r: any) => r.condition)).toEqual(["landed"]);
    const d = await get("/api/jobs/fac-dup/diff?days=60");
    expect(d.status).toBe(200);
    expect(await d.text()).toContain("+two");
  });
});

describe("run logs", () => {
  const id = "20261027-000090-a";
  const stream = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "looking" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a\nb" }] } }),
  ].join("\n");
  async function logs(file: string, q = "") {
    const url = new URL(`http://x/api/jobs/oth-90/runs/${id}/logs/${encodeURIComponent(file)}${q}`);
    return routes["GET /api/jobs/:name/runs/:run/logs/:file"](new Request(url), { name: "oth-90", run: id, file }, url);
  }
  test("lists the known logs with sizes, serves them whole or as a transcript, and refuses other names", async () => {
    run(id, { job: "oth-90", name: "oth-90", kind: "build", repo: "oth", condition: "passed", started: ago(1), ended: ago(0.5) },
      { "output.log": stream, "land.log": "landed\n", "notes.txt": "x" });
    const j = await (await get("/api/jobs/oth-90")).json();
    expect(j.runs[0].logs).toEqual([{ name: "output.log", size: stream.length }, { name: "land.log", size: 7 }].sort((a, b) => ["output.log", "land.log"].indexOf(a.name) - ["output.log", "land.log"].indexOf(b.name)));
    expect(await (await logs("land.log")).text()).toBe("landed\n");
    const steps = await (await logs("output.log", "?as=transcript")).json();
    expect(steps).toEqual([{ kind: "text", text: "looking" }, { kind: "tool", name: "Bash", input: { command: "ls" }, output: "a\nb" }]);
    expect(v.renderTranscript(steps)).toContain("Bash");
    expect(v.renderJob(j)).toContain('data-file="output.log"');
    for (const bad of ["state.json", "state.json/../../x", "notes.txt", "stderr.log"]) expect((await logs(bad)).status).toBe(404);
    expect((await logs("land.log", "?as=transcript")).status).toBe(404);
    const other = new URL("http://x/");
    expect((await routes["GET /api/jobs/:name/runs/:run/logs/:file"](new Request(other), { name: "oth-90", run: "../x", file: "land.log" }, other)).status).toBe(404);
    rmSync(join(jobsDir, id), { recursive: true, force: true });
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
  test("a landed job sealed with scenarios shows the sealed look and the scenarios in checkedBy", async () => {
    const fac = join(base, "fac");
    sh(fac, "git", "switch", "-qc", "tmp-seal");
    writeFileSync(join(fac, "c.txt"), "sealed\n");
    sh(fac, "git", "add", "."); sh(fac, "git", "commit", "-qm", "sealed work");
    const commit = sh(fac, "git", "rev-parse", "HEAD");
    sh(fac, "git", "switch", "-q", "main");
    sh(fac, "git", "branch", "-D", "tmp-seal");
    run("20261027-000060-a", { job: "fac-S", name: "fac-S", repo: "fac", branch: "factory/fac-S", condition: "landed", commit }, { "review.md": "land", "review-prompt.md": "## Sealed scenarios\n- s\n" });
    const d = (await (await get("/api/jobs/fac-S")).json()) as any;
    expect(d.look).toBe(2);
    expect(d.checkedBy).toEqual(["reviewer", "sealed scenarios"]);
  });
  test("a dropped job's kept diff.patch is served when the branch is gone; none recorded says so", async () => {
    run("20261027-000051-a", { job: "fac-K", name: "fac-K", repo: "fac", branch: "factory/fac-K", condition: "dropped" }, { "diff.patch": "+kept line\n", "diff.stat": " k.txt | 1 +\n" });
    expect(await (await get("/api/jobs/fac-K/diff")).text()).toContain("+kept line");
    expect(((await (await get("/api/jobs/fac-K")).json()) as any).stat).toContain("k.txt");
    run("20261027-000052-a", { job: "fac-N", name: "fac-N", repo: "fac", branch: "factory/fac-N", condition: "dropped" });
    const res = await get("/api/jobs/fac-N/diff");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No diff was recorded");
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
    name: "fac-9", repo: "fac", item: { id: 9, title: "Fix <it>" }, condition: "landed", started: ago(5), cost: 0.75, defaults: ["a? -> b"], followups: ["tidy"],
    runs: [
      { id: "1", kind: "worker", condition: "failed", started: ago(5), ended: ago(4), cost: 0.5, model: "m1" },
      { id: "2", kind: "worker", condition: "passed", started: ago(3.5), ended: ago(3), cost: 0.25 },
      { id: "2-review", kind: "review", condition: "passed", started: ago(3) },
      { id: "3", kind: "land", condition: "landed", started: ago(2.5), ended: ago(2) },
    ],
    result: "fixed it", review: "Looks right.", checksLog: "## test: exit 1", stderr: "warn", stat: " a.txt | 1 +", trace: "http://lf/sessions/s",
  };
  test("the job view shows each run of a fix round as a bar and an event, and the result, review and diff", () => {
    const h = v.renderJob(job);
    // The review runs inside its build, so it is no bar of its own.
    expect(h.match(/class="dp-bar /g)).toHaveLength(3);
    for (const t of ["build 1 · m1 · $0.50", "build 2 · $0.25", ">land<", "fixed it", "Looks right.", "a.txt | 1 +", 'href="http://lf/sessions/s"', 'data-job="fac-9"', "Fix &lt;it&gt;"]) expect(h).toContain(t);
    for (const t of [">Failed<", ">Passed<", ">Landed<", ">Default<", ">Follow-up<", "a? -&gt; b", "tidy"]) expect(h).toContain(t);
    expect(h).toContain("1 stuck, then fixed");
    expect(h).not.toContain("<it>");
  });
  test("the list shows jobs with filters, and an empty state", () => {
    const h = v.renderJobs([job], { repo: "fac", condition: "landed" });
    expect(h).toContain('href="#/jobs/fac-9"');
    expect(h).toContain('<table class="tbl">');
    expect(h.match(/<th[ >]/g)).toHaveLength(8);
    expect(h).toContain('data-name="condition"');
    expect(h).toContain('data-value="landed" aria-pressed="true"');
    expect(h).toContain('aria-pressed="true"');
    expect(h).not.toContain("<style>");
    expect(h).not.toContain("data-more");
    const many = v.renderJobs(Array.from({ length: 51 }, (_, i) => ({ ...job, name: `fac-${i}` })), {});
    expect(many.match(/<tr class="rowlink"/g)).toHaveLength(50);
    expect(many).toContain('data-more="1"');
    expect(many).toContain("50 of 51");
    expect(v.renderJobs([], {})).toContain("No job matches.");
  });
  test("the list reads the route query from its argument", () => {
    expect(v.view.api({}, new URLSearchParams("condition=stuck&repo=fac"))).toBe("/api/jobs?repo=fac&condition=stuck");
    expect(v.view.api({}, new URLSearchParams())).toBe("/api/jobs");
    const h = v.view.render([job], {}, new URLSearchParams("condition=stuck"));
    expect(h).toContain('data-value="stuck" aria-pressed="true"');
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
  test("a failed run's event names it, gives its reason with code set as code, and offers its logs", () => {
    const h = v.renderJob({ ...job, runs: [{ id: "1", kind: "worker", condition: "failed", started: ago(5), ended: ago(4), cost: 1.0276, model: "opus", reason: "checks failed in `a.ts`", logs: [{ name: "output.log", size: 10 }, { name: "checks.log", size: 2048 }] }] });
    const ev = h.match(/<div class="dp-ev">.*?<\/div><\/div><\/div>/)?.[0] ?? "";
    expect(ev).toContain('<span class="badge stuck">Failed</span>');
    expect(ev).toContain("Build · opus: checks failed in <code>a.ts</code>");
    expect(ev).toContain('data-log="1" data-job="fac-9" data-file="output.log" data-as="transcript"');
    expect(ev).toContain('data-file="checks.log" title="checks.log, 2.0 KiB">checks</button>');
    expect(h).toContain("$1.03");
  });
  test("diff lines are coloured and escaped", () => {
    const h = v.renderDiff("--- a\n+++ b\n+x<y\n-z");
    expect(h).toContain('<span class="add">+x&lt;y</span>');
    expect(h).toContain('<span class="del">-z</span>');
  });
});

test("the issue and job pages use pageHead, table.tbl, idLink and when", async () => {
  const { renderIssue } = require("./views/issues.js");
  // This year's date, so when() prints "Oct 01 10:00" whatever the clock says.
  const started = `${new Date().getFullYear()}-10-01T10:00:00`;
  const issue = renderIssue({ repo: "fac", id: 9, title: "T", status: "open", frontmatter: { labels: ["ui"] }, body: "", notes: [], jobs: [{ name: "fac-9", condition: "landed", started }], commits: [{ hash: "abcdef123", subject: "s", date: started, commitUrl: "http://x/c" }] });
  for (const t of ['<header class="ph">', '<table class="tbl">', 'class="idl"', 'class="chips"', "Oct 01 10:00"]) expect(issue).toContain(t);
  expect(issue).not.toContain('class="ih"');
  const job = require("./views/jobs.js").renderJob({ name: "fac-9", repo: "fac", item: { title: "T" }, condition: "landed", started, runs: [] });
  for (const t of ['<header class="ph">', "Oct 01 10:00"]) expect(job).toContain(t);
  expect(job).not.toContain("<style>");
  expect(job).toContain('class="dp-panel dp-kpis"');
});

describe("a worker round the reviewer sent back", () => {
  test("reads sent back while a later worker run follows, stuck when it is the last", async () => {
    const ids = ["20261102-000101-a", "20261102-000102-a", "20261102-000103-a"];
    const job = { job: "oth-sb", name: "oth-sb", repo: "oth", branch: "factory/oth-sb", failed: "review", started: ago(4), ended: ago(3.5) };
    run(ids[0], { ...job, condition: "stuck", reason: "needs work", next: "worker", round: 0 }, { "review.md": "Redo it.\nVERDICT: fail\n" });
    run(ids[1], { ...job, condition: "stuck", reason: "still wrong", round: 1, started: ago(3), ended: ago(2.5) }, { "review.md": "Still wrong.\nVERDICT: fail\n" });
    run(ids[2], { job: "oth-sb", name: "oth-sb", repo: "oth", kind: "build", condition: "running", started: ago(2) });
    try {
      const j = await (await get("/api/jobs/oth-sb")).json();
      const cond = Object.fromEntries(j.runs.map((r: any) => [r.id, r.condition]));
      expect(cond).toEqual({
        [ids[0]]: "sent back", [`${ids[0]}-review`]: "sent back",
        [ids[1]]: "sent back", [`${ids[1]}-review`]: "sent back",
        [ids[2]]: "running",
      });
    } finally {
      for (const id of ids) rmSync(join(jobsDir, id), { recursive: true, force: true });
    }
  });
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
