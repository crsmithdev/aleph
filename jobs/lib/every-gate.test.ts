// One file that shows each gate that stops a goal start or a land: it holds or refuses.
import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import type { Runner } from "./acceptance.ts";
import { dispatchIssues } from "./factory.ts";
import { change, fakes, goal, mk, setup, teardown, dispatch } from "./factory.helpers.ts";
import { readHolds } from "./factory-status.ts";
import { git } from "./git.ts";
import { land, type LandPorts } from "./landing.ts";
import { readRun, writeRun, type Repo, type Run } from "./ledger.ts";
import { heldAndReview, reviewBack } from "./unit.ts";

setDefaultTimeout(120_000);

// ---- Dispatch gates: the start port is not called for the goal, and a hold record says why.
beforeEach(setup);
afterEach(teardown);
{

  test("gate open after: a goal that waits on an open goal is not started and gets a waits_on hold", async () => {
    const blocker = goal();
    const waiter = goal();
    await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
    const f = fakes();
    // The blocker itself cannot start, so it stays open.
    const start = async (r: unknown, n: string, id: number | string, spec: string) => (n === `fac-${blocker}` ? "no slot" : f.start(r, n, id, spec));
    const out = await dispatchIssues(start, async () => null, f.land, f.rescue);
    expect(f.calls).not.toContain(`start fac-${waiter}`);
    expect(out.started).not.toContain(`fac-${waiter}`);
    expect(readHolds([`fac-${waiter}`]).map((r) => r.kind)).toEqual(["waits_on"]);
  });

  test("gate red main: a goal is not started while main is red and gets a red hold", async () => {
    const id = goal();
    const f = fakes();
    const out = await dispatchIssues(f.start, async () => ({ cause: "check" as const, checkName: "tests", reason: "tests failed" }), f.land, f.rescue);
    expect(f.calls).toEqual([]);
    expect(out.started).toEqual([]);
    expect(readHolds([`fac-${id}`]).map((r) => r.kind)).toEqual(["red"]);
  });

  test("gate busy file: a goal that shares a busy file with a live goal is not started and gets a busy hold", async () => {
    const surface = "## Edit surface\n- jobs/busy.ts (the change)\n";
    const mkGoal = () => writeList({ key: "fac" }, "add a goal", (doc) => issues.add(doc, "ship it", { spec: surface }).id, true)!.value;
    for (const n of [901, 902, 903]) mk(`fac-${n}`, "land", "dropped", { conflicts: ["jobs/busy.ts"] });
    const first = mkGoal();
    const second = mkGoal();
    mk(`fac-${first}`, "build", "passed");
    const f = fakes();
    await dispatchIssues(f.start, async () => null, f.land, f.rescue);
    expect(f.calls).not.toContain(`start fac-${second}`);
    expect(readHolds([`fac-${second}`]).map((r) => r.kind)).toEqual(["busy"]);
  });

  test("gate live cap: with ALEPH_LIVE_CAP at 1 and one live run, a goal is not started and gets a gate hold", async () => {
    process.env.ALEPH_LIVE_CAP = "1";
    const id = goal();
    mk("fac-900", "build", "running", { made: Date.now() });
    const f = fakes();
    const out = await dispatch(f);
    expect(f.calls).not.toContain(`start fac-${id}`);
    expect(out.started).toEqual([]);
    expect(readHolds([`fac-${id}`]).map((r) => r.kind)).toEqual(["gate"]);
  });

  test("gate run cap: a fourth start in an hour is not started and gets a run-cap hold", async () => {
    const id = goal();
    for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
    const f = fakes();
    const out = await dispatch(f);
    expect(f.calls).not.toContain(`start fac-${id}`);
    expect(out.started).toEqual([]);
    expect(readHolds([`fac-${id}`]).map((r) => r.kind)).toEqual(["run-cap"]);
  });

  test("gate parked: a parked goal is not started", async () => {
    const id = goal();
    await change(id, (item) => issues.setStatus(item, "parked"));
    const f = fakes();
    const out = await dispatch(f);
    expect(f.calls).toEqual([]);
    expect(out.started).toEqual([]);
  });
}

// ---- Land gates.
let root = "";
let repo: Repo;
let folder = "";
const base_run = { kind: "build", job: "j1", name: "j1", condition: "running", checks: [{ name: "test", ok: true, seconds: 1 }] } as Run;

/** A repo with main, and a branch `work` that changes `file` (default a.txt). */
function landSetup(file = "a.txt", held: string[] = []): string {
  root = mkdtempSync(join(tmpdir(), "every-gate-"));
  const path = join(root, "repo");
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "a@b.c");
  git(path, "config", "user.name", "a");
  writeFileSync(join(path, "a.txt"), "1");
  git(path, "add", "."); git(path, "commit", "-qm", "one");
  git(path, "switch", "-q", "-c", "work");
  mkdirSync(join(path, file, ".."), { recursive: true });
  writeFileSync(join(path, file), "2");
  git(path, "add", "."); git(path, "commit", "-qm", "two");
  git(path, "switch", "-q", "main");
  repo = { key: "r", path, main: "main", setup: [], checks: [{ name: "test", run: "bun run test" }], manual: [], autoland: true, sandbox: true, held } as unknown as Repo;
  mkdirSync(join(root, "j1"));
  folder = join(root, "j1-run");
  mkdirSync(folder);
  writeFileSync(join(root, "j1", "spec.md"), "## Oracle\n- `bun run test` passes.\n- `bun test x.test.ts` passes.\n");
  writeFileSync(join(folder, "state.json"), JSON.stringify(base_run));
  return git(path, "rev-parse", "main").out;
}
const held = (base: string, review: () => Promise<{ reason: string | null }>, runner: Runner = async () => ({ code: 0, output: "" })) =>
  heldAndReview("j1-run", folder, base_run, repo, root, base, "work", {}, [], { runner, review: review as never });
const cleanup = () => { if (root) rmSync(root, { recursive: true, force: true }); root = ""; };

test("gate checks fail: a land whose check port fails the run gives the run condition failed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "every-gate-land-"));
  const saved = { j: process.env.ALEPH_JOBS_DIR, x: process.env.XDG_RUNTIME_DIR, b: process.env.ALEPH_LAND_BATCH };
  const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`); };
  try {
    delete process.env.ALEPH_LAND_BATCH;
    Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run"), ...env });
    mkdirSync(join(dir, "jobs"));
    sh(dir, "git", "init", "-q", "--bare", "-b", "main", "repo.git");
    sh(dir, "git", "clone", "-q", "repo.git", "repo");
    sh(join(dir, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
    sh(join(dir, "repo"), "git", "push", "-q", "origin", "main");
    const r = { key: "demo", path: join(dir, "repo"), main: "main", checks: [], setup: [] } as unknown as Repo;
    sh(r.path, "git", "checkout", "-q", "-b", "job/bad", "origin/main");
    writeFileSync(join(r.path, "bad.txt"), "b\n");
    sh(r.path, "git", "add", ".");
    sh(r.path, "git", "commit", "-qm", "add bad");
    sh(r.path, "git", "checkout", "-q", "main");
    const started = new Date().toISOString();
    const b = { name: "bad", repo: "demo", job: "20261101-000000-demo-bad-build", branch: "job/bad", told: true, started } as const;
    mkdirSync(join(dir, "jobs", b.job));
    writeFileSync(join(dir, "jobs", b.job, "spec.md"), "");
    writeRun(join(dir, "jobs", b.job), { ...b, kind: "build", condition: "passed" } as Run);
    const id = "20261101-000001-demo-bad-land";
    const lf = join(dir, "jobs", id);
    mkdirSync(lf);
    const run = { ...b, kind: "land", condition: "running", made: 1 } as Run;
    writeRun(lf, run);
    const ports: LandPorts = {
      pull: async () => {},
      check: async () => ({ why: { cause: "check", checkName: "tests", reason: "tests failed" }, checks: [{ name: "tests", ok: false, seconds: 0 }], log: "boom\n" }),
    };
    const out = await land({ id, folder: lf, run }, r, ports);
    expect(out.outcome.condition).toBe("failed");
    expect(out.code).toBe(1);
    const before = Bun.spawnSync(["git", "--git-dir", join(dir, "repo.git"), "ls-tree", "-r", "--name-only", "main"]).stdout.toString();
    expect(before).not.toContain("bad.txt");
  } finally {
    for (const [k, v] of [["ALEPH_JOBS_DIR", saved.j], ["XDG_RUNTIME_DIR", saved.x], ["ALEPH_LAND_BATCH", saved.b]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gate failed Oracle command: heldAndReview gives condition stuck with checkName oracle and no review", async () => {
  try {
    const b = landSetup();
    let reviews = 0;
    const r = await held(b, async () => { reviews++; return { reason: null }; }, async () => ({ code: 1, output: "boom" }));
    expect(r.outcome).toMatchObject({ condition: "stuck", checkName: "oracle" });
    expect(reviews).toBe(0);
  } finally { cleanup(); }
});

test("gate reviewer hold: a review port that returns a reason gives no passed outcome", async () => {
  try {
    const b = landSetup();
    const r = await held(b, async () => ({ reason: "reviewer: the diff does not do what the goal asks" }));
    expect(r.outcome.condition).not.toBe("passed");
    expect(r.outcome.reason).toContain("the diff does not do what the goal asks");
  } finally { cleanup(); }
});

test("gate sealed scenario fail: a review port that returns a reason for a failed scenario gives no passed outcome (the reviewer hold path)", async () => {
  try {
    const b = landSetup();
    const r = await held(b, async () => ({ reason: "reviewer: a user sees an empty list where the goal needs one item (scenario 2)" }));
    expect(r.outcome.condition).not.toBe("passed");
    expect(r.outcome.reason).toContain("scenario 2");
  } finally { cleanup(); }
});

test("gate held path: a branch that changes a path in repo.held is awaiting, and sandbox.ts is held path jobs/lib/sandbox.ts", async () => {
  try {
    const b = landSetup("held/x.txt", ["held/**"]);
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "awaiting", reason: "held path held/x.txt" });
    expect(r.outcome.ask).toMatchObject({ reason: "held-path" });
  } finally { cleanup(); }
  try {
    const b = landSetup("jobs/lib/sandbox.ts");
    const r = await held(b, async () => ({ reason: null }));
    expect(r.outcome).toMatchObject({ condition: "awaiting", reason: "held path jobs/lib/sandbox.ts" });
  } finally { cleanup(); }
});

test("gate browser step: reviewBack on a held run leaves it awaiting when call.md says chris, and passes it when call.md says land", async () => {
  try {
    landSetup();
    const heldRun = (call: string): string => {
      const f = join(root, `held-${call.split(" ")[1]}`);
      mkdirSync(f);
      writeRun(f, { ...base_run, condition: "awaiting", told: true, started: new Date().toISOString(), reason: "held path held/x.txt", ask: { kind: "approval", reason: "held-path", question: "Land?", options: [], why: [] } } as Run);
      writeFileSync(join(f, "review.md"), "VERDICT: pass\n");
      writeFileSync(join(f, "call.md"), `browser/report.md looked at\n${call}\n`);
      return f;
    };
    const chris = heldRun("VERDICT: chris decide the held path");
    await reviewBack(chris);
    expect(readRun(chris)!.condition).toBe("awaiting");
    const ok = heldRun("VERDICT: land");
    await reviewBack(ok);
    expect(readRun(ok)!.condition).toBe("passed");
  } finally { cleanup(); }
});
