import { afterAll, afterEach, beforeAll, describe, expect, mock, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../lib/store.ts";
import { setCodes } from "../lib/naming.ts";
import { add, setStatus } from "../lib/todo.ts";
import { routes, transcript } from "./api/jobs.ts";
import { withEnv } from "./server.testkit.ts";
// @ts-ignore the module is plain JS, shared with the page
import * as lib from "./views/lib/html.js";
// @ts-ignore jobs.js is plain JS, shared with the page
import * as v from "./views/jobs.js";
// @ts-ignore plain JS, shared with the page
import * as jt from "./views/lib/jobs-table.js";
import { seed } from "../jobs/job.testkit.ts";
import { conn } from "../lib/db.ts";
import { logTo } from "../jobs/lib/records/run-files.ts";
import { writeRepos } from "../tests/projects.testkit.ts";

let base: string, jobsDir: string;
let restore: () => void;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());
const now = NOW;
const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
const seq: Record<string, number> = {};
// The runs a test adds, removed after it, so no test sees another's runs. `K` maps the label `<name>#<n>` of a job (its n-th run
// of that name or issue) to its key.
let made: { id: string; subject: string; group?: string }[] = [];
const K: Record<string, string> = {};
const lastOf: Record<string, string> = {};
const SECTIONS: Record<string, "checks" | "stderr" | "setup" | "land"> = { "checks.log": "checks", "stderr.log": "stderr", "setup.log": "setup", "land.log": "land" };
/** Put a job in the ledger. `job` groups the runs of one work (each follows the one before); `on` is the issue `<repo>-<n>`. Returns its key. */
function run(_id: string, extra: Record<string, unknown>, files: Record<string, string> = {}): string {
  const { job: group, on, ...rest } = extra as any;
  const subject = String(on ?? rest.name);
  seq[subject] = (seq[subject] ?? 0) + 1;
  const row = seed({ role: "build", told: true, started: ago(3), ...rest, ...(on ? { target: `issue.${String(on).split("-")[1]}` } : {}), ...(group && lastOf[group] ? { prev: lastOf[group] } : {}) });
  K[`${subject}#${seq[subject]}`] = row.id;
  if (group) lastOf[group] = row.id;
  made.push({ id: row.id, subject, group });
  for (const [f, t] of Object.entries(files)) {
    if (f === "output.log") writeFileSync(join(row.folder, "transcript.jsonl"), t);
    else if (SECTIONS[f]) logTo(row.folder, SECTIONS[f], t);
    else if (f !== "review.md" && f !== "review.json") writeFileSync(join(row.folder, f), t);
  }
  // The reviewer is a job of its own, the next of the build.
  if (files["review.md"] !== undefined || files["review.json"] !== undefined) {
    const rv = seed({ role: "review", name: rest.name, repo: rest.repo, prev: row.id, started: rest.ended ?? ago(3), ended: rest.ended ?? ago(3) });
    K[`review ${subject}#${seq[subject]}`] = rv.id;
    made.push({ id: rv.id, subject: `review ${rv.id}` });
    if (files["review.md"] !== undefined) writeFileSync(join(rv.folder, "result.md"), files["review.md"]);
    if (files["review.json"] !== undefined) writeFileSync(join(rv.folder, "review.json"), files["review.json"]);
  }
  return row.id;
}
async function get(path: string) {
  const url = new URL(`http://x${path}`);
  const key = Object.keys(routes).find((k) => {
    const [, p] = k.split(" ");
    return new RegExp("^" + p.replace(/:\w+/g, "([^/]+)") + "$").test(url.pathname);
  })!;
  const pattern = key.split(" ")[1], names = [...pattern.matchAll(/:(\w+)/g)].map((x) => x[1]);
  const m = url.pathname.match(new RegExp("^" + pattern.replace(/:\w+/g, "([^/]+)") + "$"))!;
  const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
  return routes[key](new Request(url), params, url);
}
/** The path of job `id`, with `#` encoded. */
const jp = (id: string, rest = "") => `/api/jobs/${encodeURIComponent(id)}${rest}`;
/** The job IDs of `GET /api/jobs?<q>`, newest first. */
async function idsOf(q = ""): Promise<string[]> {
  return (await (await get(`/api/jobs${q ? `?${q}` : ""}`)).json()).jobs.map((j: any) => j.id);
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
  writeRepos({ fac: { path: fac, sandbox: true }, oth: { path: oth } }, items);
  restore = withEnv({ ALEPH_JOBS_DIR: jobsDir, ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: items, LANGFUSE_PUBLIC_KEY: "", ...gitEnv });
  writeList({ key: "fac" }, "seed", (doc) => { add(doc, "old title"); return true; }, true);
  // fac-9: a worker, a fix round with a reviewer, then a land.
  run("", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", state: "failed", reason: "review held", started: ago(5), ended: ago(4), cost: 0.5, model: "claude-sonnet-5-5" },
    { "result.md": "first\nFOLLOWUP: tidy\n", "checks.log": "## test: exit 1\n" + Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n", "stderr.log": "warn\n" });
  run("", { job: "fac-9", name: "fac-9", repo: "fac", branch: "factory/fac-9", state: "passed", started: ago(3.5), ended: ago(3), cost: 0.25, defaults: ["a? -> b"] },
    { "result.md": "fixed it\nFOLLOWUP: tidy\n", "review.md": "Looks right.\nVERDICT: hold quoted\n", "review.json": '{"verdict":"pass","summary":"Looks right.","failures":[]}' });
  run("", { job: "fac-9", name: "fac-9", role: "land", repo: "fac", branch: "factory/fac-9", state: "landed", started: ago(2.5), ended: ago(2), commit: "abc1234" });
  run("", { job: "oth-1", name: "oth-1", repo: "oth", state: "failed", started: ago(1) });
  run("", { job: "fac-2", name: "fac-2", repo: "fac", branch: "factory/gone", state: "landed", started: ago(24 * 20), ended: ago(24 * 20 - 1) });
  made = [];
});
afterEach(() => {
  for (const { id, subject, group } of made) {
    rmSync(join(jobsDir, id.slice(4)), { recursive: true, force: true });
    conn().run("DELETE FROM jobs WHERE id = ?", [id]);
    if (!subject.startsWith("review ")) seq[subject]--;
    if (group) delete lastOf[group];
  }
  for (const k of Object.keys(K)) if (made.some((m) => m.id === K[k])) delete K[k];
  made = [];
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

describe("Run now on the Job page", () => {
  test("a closed job whose issue is open has the Run now button, and an open running job has none, as the dispatch refuses it for its job", async () => {
    const n = writeList({ key: "fac" }, "seed", (doc) => add(doc, "to run", { spec: "Do it." }).id)!.value;
    const closed = run("", { job: `fac-${n}`, name: `issue.${n}`, repo: "fac", state: "dropped", started: ago(2), ended: ago(1), on: `fac-${n}` });
    const j = await (await get(jp(closed))).json();
    expect(j.runNow).toBeNull();
    expect(v.renderJob(j)).toContain(`data-path="/api/issues/fac-${n}/run" data-label="Run now">Run now</button>`);
    const open = run("", { job: `fac-${n}`, name: `issue.${n}`, repo: "fac", state: "running", started: ago(0.5), on: `fac-${n}` });
    const o = await (await get(jp(open))).json();
    expect(o.runNow).toBe("Its job is running");
    expect(v.renderJob(o)).not.toContain("Run now");
  });
});

describe("a land that found the job lock busy", () => {
  test("the job's state is the run that counts; the run list keeps the land", async () => {
    run("", { job: "fac-7", name: "fac-7", repo: "fac", state: "passed", started: ago(3) });
    const land = run("", { role: "land", job: "fac-7", name: "fac-7", repo: "fac", state: "failed", cause: "locked", reason: "job lock busy", started: ago(2) });
    {
      const d = await (await get(jp(K["fac-7#2"]))).json();
      expect(d.state).toBe("passed");
      expect(d.reason).toBeUndefined();
      // The job record gives the next step from the run that counts: the passed run, which waits for a land by hand.
      expect(d.next).toEqual({ step: "wait", action: "passed", to: "human", text: "passed → human" });
      expect(d.next.text).not.toMatch(/[:;]/);
      expect(d.runs.find((r: any) => r.id === land)).toMatchObject({ state: "failed", reason: "job lock busy" });
      // A row is one job: the land that found the lock busy is a failed job of its own.
      expect(await idsOf("state=passed")).toContain(K["fac-7#1"]);
      expect(await idsOf("state=failed")).toContain(K["fac-7#2"]);
    }
  });
});

describe("GET /api/jobs", () => {
  test("one row per job, newest first, filtered by project, state and window", async () => {
    expect(await idsOf("project=fac")).toEqual([K["fac-9#3"], K["review fac-9#2"], K["fac-9#2"], K["fac-9#1"]]);
    expect(await idsOf("state=failed")).toEqual([K["oth-1#1"], K["fac-9#1"]]);
    expect(await idsOf("window=month")).toEqual([K["oth-1#1"], K["fac-9#3"], K["review fac-9#2"], K["fac-9#2"], K["fac-9#1"], K["fac-2#1"]]);
    expect((await get("/api/jobs?window=x")).status).toBe(400);
    const [row] = (await (await get("/api/jobs?project=fac")).json()).jobs;
    expect(row).toMatchObject({ id: K["fac-9#3"], subject: "fac-9", name: "fac-9", repo: "fac", kind: "land", actor: null, state: "landed", started: ago(2.5), ended: ago(2), seconds: 1800, cost: null });
  });
  test("?unusable=1 keeps the runs the monitor counts as failed: failed, returned, dropped, or with a cause; not passed or landed", async () => {
    run("", { job: "fac-3", name: "fac-3", repo: "fac", state: "returned", started: ago(1) });
    run("", { job: "fac-4", name: "fac-4", repo: "fac", state: "dropped", started: ago(1) });
    run("", { job: "fac-5", name: "fac-5", repo: "fac", state: "passed", cause: "timeout", started: ago(1) });
    expect(await idsOf("unusable=1")).toHaveLength(5);
    for (const l of ["fac-3#1", "fac-4#1", "fac-5#1", "fac-9#1", "oth-1#1"]) expect(await idsOf("unusable=1")).toContain(K[l]);
    expect(await idsOf("unusable=1&project=oth")).toEqual([K["oth-1#1"]]);
  });
  test("pages by ?limit= and ?before=, and says where the next page starts", async () => {
    const one = await (await get("/api/jobs?window=month&limit=2")).json();
    expect(one.jobs.map((j: any) => j.id)).toEqual([K["oth-1#1"], K["fac-9#3"]]);
    expect(one.next).toBe(ago(2.5));
    const two = await (await get(`/api/jobs?window=month&limit=2&before=${encodeURIComponent(one.next)}`)).json();
    expect(two.jobs.map((j: any) => j.id)).toEqual([K["review fac-9#2"], K["fac-9#2"]]);
    expect((await (await get(`/api/jobs?window=month&before=${encodeURIComponent(ago(5))}`)).json())).toEqual({ jobs: [expect.objectContaining({ id: K["fac-2#1"] })], next: null });
    for (const q of ["limit=0", "limit=x", "before=soon"]) expect((await get(`/api/jobs?${q}`)).status).toBe(400);
  });
  test("each row names its actor from its kind, for the page's Role filter", async () => {
    run("", { role: "intake", job: "oth-5", name: "oth-5", repo: "oth", state: "failed", started: ago(1) });
    run("", { role: "build", job: "oth-6", name: "oth-6", repo: "oth", state: "failed", started: ago(1) });
    run("", { role: "director", job: "oth-7", name: "oth-7", repo: "oth", state: "failed", started: ago(1) });
    {
      const rows = (await (await get("/api/jobs?project=oth")).json()).jobs;
      const actor = (id: string) => rows.find((j: any) => j.id === id).actor;
      expect([actor(K["oth-5#1"]), actor(K["oth-6#1"]), actor(K["oth-7#1"])]).toEqual(["intake", "worker", "director"]);
      expect(jt.renderJobsTable(rows, { role: "director" })).toContain(K["oth-7#1"]);
      expect(jt.renderJobsTable(rows, { role: "director" })).not.toContain(K["oth-6#1"]);
      expect(jt.renderJobsTable(rows)).toContain(`<tr class="rowlink" data-annotate="${K["oth-5#1"]}">`);
    }
  });
  test("the Role filter offers the six actors and no old role", () => {
    const h = jt.renderFilters({});
    const role = h.slice(h.indexOf('data-name="role"'));
    expect([...role.matchAll(/data-value="([^"]*)"/g)].map((m) => m[1])).toEqual(["", "worker", "reviewer", "intake", "director", "monitor"]);
    expect(h).not.toContain('value="triage"');
    expect(h).not.toContain('value="planner"');
  });
  test("the Runs filter shows ?unusable=1 as Failed and its absence as All", () => {
    const group = (h: string) => h.slice(h.indexOf('data-name="unusable"'), h.indexOf("</div>", h.indexOf('data-name="unusable"')));
    const pressed = (h: string) => Object.fromEntries([...group(h).matchAll(/data-value="([^"]*)" aria-pressed="(\w+)"/g)].map((m) => [m[1], m[2]]));
    expect(pressed(jt.renderFilters({ unusable: "1" }))).toEqual({ "": "false", "1": "true" });
    expect(pressed(jt.renderFilters({}))).toEqual({ "": "true", "1": "false" });
  });
  test("title and judge runs are not jobs", async () => {
    const ids = [run("", { role: "title", name: "title", started: ago(1) }), run("", { role: "judge", name: "judge", started: ago(1) })];
    expect(await idsOf()).not.toContain(ids[0]);
    expect(await idsOf()).not.toContain(ids[1]);
    expect(await idsOf()).toContain(K["oth-1#1"]);
  });
  test("?project narrows to one project", async () => {
    expect(await idsOf("project=oth&window=month")).toEqual([K["oth-1#1"]]);
    expect(await (await get("/api/jobs?project=nope")).json()).toEqual({ jobs: [], next: null });
  });
});

describe("item titles", () => {
  test("a rename between two requests shows in the second", async () => {
    run("", { job: "fac-7", name: "fac-7", repo: "fac", state: "running", on: "fac-1" });
    const title = async () => (await (await get("/api/jobs")).json()).jobs.find((j: any) => j.id === K["fac-1#1"]).title;
    expect(await title()).toBe("old title");
    writeList({ key: "fac" }, "rename", (doc) => { doc.items.find((i) => i.id === 1)!.title = "new title"; return true; });
    expect(readList({ key: "fac" })!.items[0].title).toBe("new title");
    expect(await title()).toBe("new title");
    expect((await (await get(jp(K["fac-1#1"]))).json()).item.title).toBe("new title");
  });
});

describe("GET /api/jobs/:id", () => {
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
    run("", { job: `oth-${open}`, name: `oth-${open}`, repo: "oth", state: "failed", on: `oth-${open}`, started: ago(1) });
    run("", { job: `oth-${shut}`, name: `oth-${shut}`, repo: "oth", state: "landed", on: `oth-${shut}`, started: ago(1) });
    const j = await (await get(jp(K[`oth-${open}#1`]))).json();
    const closed = await (await get(jp(K[`oth-${shut}#1`]))).json();
    expect(j.blockers).toEqual([expect.objectContaining({ id: `oth-${gone}`, title: "gone work", dead: "dropped" })]);
    expect(closed.blockers).toBeUndefined();
    const html = v.renderJob(j);
    expect(html).toContain('<span class="quiet">Waits on</span>');
    expect(html).toContain(`data-act="unblock" data-path="/api/issues/oth-${open}/unblock"`);
  });
  test("404 for an unknown name, or another project's job", async () => {
    expect((await get(jp(K["nope#1"]))).status).toBe(404);
    expect((await get(jp(K["fac-9#3"], "?project=oth"))).status).toBe(404);
    expect((await get(jp(K["fac-9#3"], "?project=fac"))).status).toBe(200);
  });
  test("the verdict comes from review.json beside review.md, not from review.md's text", async () => {
    const j = await (await get(jp(K["fac-9#3"]))).json();
    expect(j.id).toBe(K["fac-9#3"]);
    expect(j.review).toContain("VERDICT: hold quoted");
    expect(j.verdict).toBe("pass");
  });
});

describe("a name reused by a dropped job and its rerun", () => {
  test("each job ID names its own job, and its diff", async () => {
    run("", { job: "dup-old", name: "fac-dup", repo: "fac", branch: "factory/gone", state: "dropped", started: ago(24 * 40), ended: ago(24 * 40 - 1) });
    run("", { job: "dup-new", name: "fac-dup", repo: "fac", branch: "factory/fac-9", state: "landed", started: ago(24 * 39), ended: ago(24 * 39 - 1), commit: "def5678" });
    const j = await (await get(jp(K["fac-dup#2"]))).json();
    expect(j.state).toBe("landed");
    expect(j.runs.map((r: any) => r.state)).toEqual(["landed"]);
    expect((await (await get(jp(K["fac-dup#1"]))).json()).state).toBe("dropped");
    const d = await get(jp(K["fac-dup#2"], "/diff"));
    expect(d.status).toBe(200);
    expect(await d.text()).toContain("+two");
  });
});

describe("run logs", () => {
  const stream = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "looking" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a\nb" }] } }),
  ].join("\n");
  test("transcript joins the text parts of a tool_result with a newline", () => {
    const parts = [{ type: "text", text: "a" }, { type: "text", text: "b" }];
    const s = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: parts }] } }),
    ].join("\n");
    expect((transcript(s)[0] as any).output).toBe("a\nb");
  });
  async function logs(file: string, q = "") {
    const url = new URL(`http://x/api/jobs/oth-90%231/logs/${encodeURIComponent(file)}${q}`);
    return routes["GET /api/jobs/:id/logs/:file"](new Request(url), { id: K["oth-90#1"], file }, url);
  }
  test("lists the known logs with sizes, serves them whole or as a transcript, and refuses other names", async () => {
    run("", { job: "oth-90", name: "oth-90", role: "build", repo: "oth", state: "passed", started: ago(1), ended: ago(0.5) },
      { "output.log": stream, "land.log": "landed\n", "notes.txt": "x" });
    const j = await (await get(jp(K["oth-90#1"]))).json();
    expect(j.runs[0].logs).toEqual([{ name: "output.log", size: stream.length }, { name: "land.log", size: 7 }].sort((a, b) => ["output.log", "land.log"].indexOf(a.name) - ["output.log", "land.log"].indexOf(b.name)));
    expect(await (await logs("land.log")).text()).toBe("landed\n");
    const steps = await (await logs("output.log", "?as=transcript")).json();
    expect(steps).toEqual([{ kind: "text", text: "looking" }, { kind: "tool", name: "Bash", input: { command: "ls" }, output: "a\nb" }]);
    expect(v.renderTranscript(steps)).toContain("Bash");
    expect(v.renderJob(j)).toContain('data-file="output.log"');
    for (const bad of ["state.json", "state.json/../../x", "notes.txt", "stderr.log"]) expect((await logs(bad)).status).toBe(404);
    expect((await logs("land.log", "?as=transcript")).status).toBe(404);
    const other = new URL("http://x/");
    expect((await routes["GET /api/jobs/:id/logs/:file"](new Request(other), { id: K["nope#1"], file: "land.log" }, other)).status).toBe(404);
  });
});

describe("GET /api/jobs/:id/diff", () => {
  test("a landed job shows its look and the reviewer in checkedBy", async () => {
    const fac = join(base, "fac");
    sh(fac, "git", "switch", "-qc", "tmp-seal");
    writeFileSync(join(fac, "c.txt"), "sealed\n");
    sh(fac, "git", "add", "."); sh(fac, "git", "commit", "-qm", "sealed work");
    const commit = sh(fac, "git", "rev-parse", "HEAD");
    sh(fac, "git", "switch", "-q", "main");
    sh(fac, "git", "branch", "-D", "tmp-seal");
    run("", { job: "fac-S", name: "fac-S", repo: "fac", branch: "factory/fac-S", state: "landed", commit }, { "review.md": "land" });
    const d = (await (await get(jp(K["fac-S#1"]))).json()) as any;
    expect(d.look).toBe(3);
    expect(d.checkedBy).toEqual(["reviewer"]);
  });
  test("a dropped job's kept diff.patch is served when the branch is gone; none recorded says so", async () => {
    run("", { job: "fac-K", name: "fac-K", repo: "fac", branch: "factory/fac-K", state: "dropped" }, { "diff.patch": "+kept line\n", "diff.stat": " k.txt | 1 +\n" });
    expect(await (await get(jp(K["fac-K#1"], "/diff"))).text()).toContain("+kept line");
    expect(((await (await get(jp(K["fac-K#1"]))).json()) as any).stat).toContain("k.txt");
    run("", { job: "fac-N", name: "fac-N", repo: "fac", branch: "factory/fac-N", state: "dropped" });
    const res = await get(jp(K["fac-N#1"], "/diff"));
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No diff was recorded");
  });
  test("404 when the branch is gone, or the job unknown", async () => {
    expect((await get(jp(K["fac-2#1"], "/diff"))).status).toBe(404);
    expect((await get(jp(K["oth-1#1"], "/diff"))).status).toBe(404);
    expect((await get(jp(K["zzz#1"], "/diff"))).status).toBe(404);
    expect((await get(jp(K["fac-9#3"], "/diff?project=oth"))).status).toBe(404);
  });
});

describe("render", () => {
  const job: any = {
    id: "fac-9#3", name: "fac-9", repo: "fac", item: { id: 9, title: "Fix <it>" }, state: "landed", started: ago(5), cost: 0.75, defaults: ["a? -> b"], followups: ["tidy"],
    runs: [
      { id: "1", kind: "worker", state: "failed", started: ago(5), ended: ago(4), cost: 0.5, model: "m1" },
      { id: "2", kind: "worker", state: "passed", started: ago(3.5), ended: ago(3), cost: 0.25 },
      { id: "2-review", kind: "review", state: "passed", started: ago(3) },
      { id: "3", kind: "land", state: "landed", started: ago(2.5), ended: ago(2) },
    ],
    result: "fixed it", review: "Looks right.", stat: " a.txt | 1 +", trace: "http://lf/sessions/s",
  };
  test("the job view shows each run of a fix round as a bar and an event, and the result, review and diff", () => {
    const h = v.renderJob(job);
    // The review runs inside its build, so it is no bar of its own.
    expect(h.match(/class="dp-bar /g)).toHaveLength(3);
    for (const t of ["implement 1 · $0.50", "implement 2 · $0.25", ">land<", "fixed it", "Looks right.", "a.txt | 1 +", 'href="http://lf/sessions/s"', 'data-job="fac-9#3"', "Fix &lt;it&gt;"]) expect(h).toContain(t);
    for (const t of [">failed<", ">passed<", ">landed<", ">Default<", ">Follow-up<", "a? -&gt; b", "tidy"]) expect(h).toContain(t);
    expect(h).toContain("1 failed, then fixed");
    expect(h).not.toContain("<it>");
    expect(h).toContain('<div class="diff-panel" id="diff" data-job="fac-9#3"><p class="quiet" role="status"><i class="spin" aria-hidden="true"></i>Loading the diff…</p></div>');
  });
  test("the head is pageHead with the title and the nav links as aside", () => {
    const aside = '<a class="act" href="http://lf/sessions/s">Trace</a>';
    const real = { ...lib }, tagged = (t: string, o: object) => `<!--pageHead-->${real.pageHead(t, o)}`;
    mock.module("./views/lib/html.js", () => ({ ...real, pageHead: tagged }));
    try {
      expect(v.renderJob(job)).toContain(tagged("Fix <it>", { aside }));
    } finally {
      mock.module("./views/lib/html.js", () => real);
    }
  });
  test("the head of a job with no item title is its short id, not its full name", () => {
    setCodes({ fac: "f" });
    try {
      const h = v.renderJob({ ...job, item: undefined });
      expect(h).toContain('<header class="ph"><h1>f9</h1>');
      expect(h).not.toContain("<h1>fac-9</h1>");
    } finally {
      setCodes({});
    }
  });
  test("the next step sits under the pills, and a job with no next step shows no next line", () => {
    const next = { step: "wait", action: "passed", to: "human", text: "passed → human" };
    const h = v.renderJob({ ...job, next });
    expect(h).toContain(`<span class="quiet">Next</span> ${next.text}`);
    expect(h.indexOf(">Next<")).toBeGreaterThan(h.indexOf('class="status-row"'));
    expect(h.indexOf(">Next<")).toBeLessThan(h.indexOf("dp-kpis"));
    expect(v.renderJob({ ...job, next: { ...next, text: "a <b> → c" } })).toContain("a &lt;b&gt; → c");
    expect(v.renderJob(job)).not.toContain(">Next<");
  });
  test("a landed, done or dropped job shows no next line", () => {
    const next = { step: "none", action: "landed", text: "landed abc1234" };
    const h = v.renderJob({ ...job, next });
    expect(h).not.toContain(">Next<");
    expect(h).not.toContain(next.text);
    expect(v.renderJob({ ...job, next: { step: "wait", action: "passed", to: "human", text: "passed → human" } })).toContain('<span class="quiet">Next</span> passed → human');
  });
  test("the weekly % under the Cost tile carries the WK_TIP tooltip, and the pooled sentence when pooled", () => {
    const kpis = (o: object) => { const h = v.renderJob({ ...job, ...o }); return h.slice(h.indexOf("dp-kpis"), h.indexOf("</section>", h.indexOf("dp-kpis"))); };
    const wk = (h: string) => h.match(/<span class="wk" title="([^"]*)">([^<]*)<\/span>/);
    const one = wk(kpis({ wk: { pct: 1.4, pooled: false } }))!;
    expect(one[1]).toStartWith("An estimate of the share of the weekly plan limit");
    expect(one[1]).not.toContain("One rate prices all models");
    expect(one[2]).toBe("\u22481% wk");
    expect(kpis({ wk: { pct: 1.4, pooled: false } })).toContain("$0.75");
    expect(wk(kpis({ wk: { pct: 1.4, pooled: true } }))![1]).toContain("One rate prices all models");
    expect(kpis({ wk: undefined })).not.toContain('class="wk"');
  });
  test("the dp-detail block holds the detail panels, with no Detail head of its own", () => {
    const h = v.renderJob(job);
    expect(h.slice(h.indexOf('<div class="dp-detail">'))).toStartWith('<div class="dp-detail"><details class="dp-panel dp-fold" open>');
    expect(h).not.toContain("<h2>Detail</h2>");
    const css = readFileSync(join(import.meta.dir, "app.css"), "utf8");
    expect(css).not.toContain(".dp-detail > h2");
    expect(css).not.toContain(".dp-detail > .sh");
  });
  test("an open job on an issue shows the lifecycle buttons of its state, and a closed job shows none", () => {
    const head = (o: object) => { const h = v.renderJob({ ...job, ...o }); return h.slice(0, h.indexOf("</header>")); };
    const labels = (h: string) => [...h.matchAll(/<button class="act[^"]*" type="button"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
    expect(labels(head({ open: true, state: "waiting" }))).toEqual(["Land", "Recheck", "Park", "Cancel", "Cancel job"]);
    expect(labels(head({ open: true, state: "running" }))).toEqual(["Park", "Cancel", "Cancel job"]);
    expect(labels(head({ open: true, state: "waiting", parked: true }))).toEqual(["Recheck", "Unpark", "Cancel", "Cancel job"]);
    expect(head({ open: true, state: "running" })).toContain('data-path="/api/jobs/fac-9%233/park"');
    expect(head({ open: false })).not.toContain("<button");
    expect(head({ open: true, item: undefined })).not.toContain("<button");
  });
  test("a job whose issue's gate binds shows the button disabled with the gate's text", () => {
    const h = v.renderJob({ ...job, runNow: "Waits on issue.3" });
    expect(h).toContain('<button class="act" type="button" disabled title="Waits on issue.3">Run now</button> <span class="quiet">Waits on issue.3</span>');
  });
  test("the Cancel dialog offers park, restart and drop, with park chosen", () => {
    const h = v.renderJob({ ...job, open: true, state: "running" });
    expect([...h.matchAll(/name="then" value="(\w+)"/g)].map((m) => m[1])).toEqual(["park", "restart", "drop"]);
    expect(h).toContain('value="park" checked');
    expect(h).toContain(`data-body="${'{&quot;then&quot;:&quot;park&quot;}'}"`);
  });
  test("a job on an issue has no Issue button: its crumb goes through the issue", () => {
    const h = v.renderJob(job), href = "#/issues/fac/9";
    expect(h).not.toContain(">Issue</a>");
    expect(h.match(/<nav[^>]*>.*?<\/nav>/s)?.[0] ?? "").toContain(href);
    const bare = v.renderJob({ ...job, item: undefined });
    expect(bare).not.toContain("#/issues/");
  });
  test("the Checks panel shows each check's test counts and each failed test with its failure", () => {
    const tests = { ran: 1203, passed: 1180, failed: 23, skipped: 4, failures: [{ file: "a.test.ts", name: "s > <one>", message: "Error: boom\n  at a.test.ts:3" }] };
    const h = v.renderJob({ ...job, checks: [{ name: "tests", ok: false, seconds: 61, tests }, { name: "types", ok: true, seconds: 9 }] });
    expect(h).toContain('<td class="num">1,203</td><td class="num">1,180</td><td class="num bad">23</td><td class="num">4</td><td class="num">1m 01s</td>');
    expect(h).toContain('<td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">9s</td>');
    expect(h).toContain('<p><code>a.test.ts</code> s &gt; &lt;one&gt; <span class="quiet">tests</span></p><pre class="trailers">Error: boom\n  at a.test.ts:3</pre>');
    expect(h).toContain("22 more failed tests of tests not recorded.");
  });
  test("a job with no end and no cost shows the missing Took and Cost of span() and money()", () => {
    const row = jt.renderJobsTable([{ ...job, started: ago(5), ended: null, cost: null }]).split('<tr class="rowlink"')[1];
    expect(row).toContain('<td class="num"></td><td class="num">$0.00</td><td class="time">');
  });
  test("a failed count is badCount's cell, and no cell of the checks table holds a button", () => {
    const tests = { ran: 5, passed: 3, failed: 2, skipped: 0, failures: [] };
    const h = v.renderJob({ ...job, runs: [{ id: "1", job: "fac-9#1", kind: "worker", state: "failed", started: ago(5), ended: ago(4), logs: [{ name: "checks.log", size: 9 }] }], checks: [{ name: "tests", ok: false, seconds: 3, tests }] });
    expect(h).toContain('<td class="num bad">2</td>');
    expect(h).toContain('data-file="checks.log">checks.log</button>');
    const table = h.slice(h.indexOf('<table class="tbl">'), h.indexOf("</table>"));
    expect(table).not.toContain("<button");
  });
  test("the KPI strip shows its values through dur(), count() and miss(), with no hand-written look text", () => {
    const h = v.renderJob({ name: "fac-9", repo: "fac", state: "passed", runs: [], checkedBy: ["opus"], look: 5 });
    expect(h).toContain('<span class="dp-v">0</span>');
    expect(h).toContain('<span class="dp-v">–</span>');
    expect(h).toContain("look: 5m 00s");
    expect(h).not.toContain("about");
  });
  test("the Jobs table and the Job checks table head their duration column Took", () => {
    const heads = (h: string) => [...h.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((m) => m[1].trim());
    const list = heads(jt.renderJobsTable([{ ...job, started: ago(5), ended: ago(4) }]));
    expect(list).toContain("Took");
    expect(list).not.toContain("Time");
    const checks = heads(v.renderJob({ ...job, checks: [{ name: "tests", ok: true, seconds: 9 }] }));
    expect(checks).toContain("Took");
    expect(checks).not.toContain("Time");
  });
  test("the Jobs table puts Id and Title first and Started last, and each row opens with the job id link", () => {
    const h = jt.renderJobsTable([{ ...job, started: ago(5), ended: ago(4) }]);
    expect([...h.matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<]+)/g)].map((m) => m[1].trim())).toEqual(["Id", "Title", "State", "Project", "Model", "Took", "Cost", "Started"]);
    const row = h.split('<tr class="rowlink"').slice(1)[0];
    expect(/^[^>]*><td><a class="idl"[^>]*>[^<]*<\/a><\/td><td class="wide"[^>]*><a[^>]*>[^<]*<\/a><\/td><td>/.test(row)).toBe(true);
    expect(/<td class="time">[^<]*<\/td><\/tr>/.test(row)).toBe(true);
  });
  test("the Job page of a sub-issue says sub-issue, and its work lane counts jobs", () => {
    const parent = { id: "fac-9", href: "#/issues/fac/9", n: 1, of: 2, next: { id: "fac-10", href: "#/jobs/fac-10" } };
    const h = v.renderJob({ ...job, parent, runs: [{ id: "1", kind: "intake", state: "done", started: ago(3), ended: ago(2) }] });
    expect(h).toContain("sub-issue 1 of 2 of");
    expect(h).toContain("Next sub-issue: fac-10");
    expect(h).toContain(">1 job<");
    expect(h).not.toMatch(/\bparts?\b/i);
    expect(h).not.toMatch(/\bruns?\b/i);
  });
  test("the Review tag is the reviewer's JSON verdict, not a line of review.md", () => {
    const h = (o: object) => v.renderJob({ ...job, review: "Text says VERDICT: hold x.", ...o });
    expect(h({ verdict: "pass" })).toContain('class="badge done">passed<');
    expect(h({ verdict: "hold" })).toContain('class="badge error">returned<');
    expect(h({})).not.toContain("returned<");
  });
  test("the Job page of a job with no parent issue links back to the merged Jobs page only", () => {
    const h = v.renderJob({ ...job, item: undefined });
    expect(h).not.toContain('href="#/jobs"');
    expect(h).not.toContain('href="#/jobs?repo=');
    expect(h).toContain('href="#/factory/jobs"');
  });
  test("a failed run's event names it, gives its reason as the note with code set as code, and offers its logs", () => {
    const h = v.renderJob({ ...job, runs: [{ id: "1", job: "fac-9#1", kind: "worker", state: "failed", started: ago(5), ended: ago(4), cost: 1.0276, model: "opus", reason: "checks failed in `a.ts`", logs: [{ name: "output.log", size: 10 }, { name: "checks.log", size: 2048 }] }] });
    const ev = h.match(/<div class="dp-ev">.*?<\/div><\/div><\/div>/)?.[0] ?? "";
    expect(ev).toContain('<span class="badge error">failed</span>');
    expect(ev).toContain("implement · opus · checks failed in <code>a.ts</code>");
    expect(ev).toContain('data-log="1" data-job="fac-9#1" data-file="output.log" data-as="transcript"');
    expect(ev).toContain('data-file="checks.log" title="checks.log, 2.0KiB">checks</button>');
    expect(h).toContain("$1.03");
  });
});

test("the job check-log table is empty() with no checks and pages at 50", () => {
  const j = { name: "fac-9", repo: "fac", runs: [], checks: [] };
  expect(v.renderJob(j)).toContain('class="empty"');
  const c = Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, ok: true, seconds: 1, tests: { ran: 1, passed: 1, failed: 0, skipped: 0 } }));
  const h = v.renderJob({ ...j, checks: c });
  expect(h).toContain("50 of 51");
  expect(h).toContain('<th class="num">Ran</th>');
});

test("the Job page's id pill shows the short id", () => {
  setCodes({ fac: "f" });
  try {
    expect(v.renderJob({ name: "fac-1", repo: "fac", state: "passed", runs: [] })).toContain('<span class="idp">f1</span></div>');
  } finally {
    setCodes({});
  }
});
