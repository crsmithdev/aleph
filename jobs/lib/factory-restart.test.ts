import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchIssues, setPaused } from "./factory.ts";
import { readRun, writeRun } from "./ledger.ts";
import { type Run } from "./ledger.ts";
import { ctx, goal, mk, notes, ask, fakes, dispatch, setup, sh, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

// A run that a host restart killed: `running`, started before this boot, its process gone.
const BEFORE_BOOT = "2020-01-01T00:00:00.000Z";
const killedRun = (name: string, kind: Run["kind"] = "build", files: Record<string, string> = { pid: "999999999" }) => mk(name, kind, "running", { started: BEFORE_BOOT }, files);

test("a run killed by a host restart is dropped, its goal starts at once, and no Ask or rescue mark is left", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`);
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(f.specs[0]).toContain("a host restart killed build run");
  expect(notes(id)).toContain("a host restart killed build run");
  expect(ask(id)).toBeNull();
  expect(existsSync(join(r.folder, "rescued"))).toBe(false);
});

test("a build a host restart killed, with a commit ahead of main, starts a recheck of its branch and no new run", async () => {
  const id = goal();
  const repo = join(ctx.base, "repo");
  sh(repo, "git", "checkout", "-q", "-b", "work");
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "the worker's work");
  sh(repo, "git", "checkout", "-q", "main");
  const r = killedRun(`fac-${id}`, "build", {});
  // The run's branch is `work`: its commit is ahead of main.
  writeRun(r.folder, { ...readRun(r.folder)!, branch: "work" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(notes(id)).toContain("its branch has the worker's commits");
  expect(readRun(r.folder)).toMatchObject({ condition: "failed", reason: "host restart" });
  expect(ask(id)).toBeNull();
  expect(existsSync(join(r.folder, "rescued"))).toBe(false);
});

test("a recheck a host restart killed, with a commit ahead of main, starts a new recheck of its branch and no new goal run, and uses no rerun", async () => {
  const id = goal();
  const repo = join(ctx.base, "repo");
  sh(repo, "git", "checkout", "-q", "-b", "work");
  sh(repo, "git", "commit", "-q", "--allow-empty", "-m", "the worker's work");
  sh(repo, "git", "checkout", "-q", "main");
  const r = killedRun(`fac-${id}`, "recheck", {});
  writeRun(r.folder, { ...readRun(r.folder)!, branch: "work" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(notes(id)).toContain("its branch has the worker's commits");
  expect(readRun(r.folder)).toMatchObject({ condition: "failed", reason: "host restart" });
  expect(ask(id)).toBeNull();
  expect(existsSync(join(r.folder, "rescued"))).toBe(false);
});

test("a goal whose run a host restart killed keeps its rerun: the next no commit reruns it with no Ask", async () => {
  const id = goal();
  killedRun(`fac-${id}`);
  const f = fakes();
  f.start = async () => null;
  await dispatchIssues(f.start, f.land, f.rescue);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  await dispatchIssues(f.start, f.land, f.rescue);
  expect(f.calls).toEqual([`drop fac-${id}`, `drop fac-${id}`]);
  expect(ask(id)).toBeNull();
});

test("a killed run with a pid that another process now holds is still killed", async () => {
  const id = goal();
  killedRun(`fac-${id}`, "build", { pid: String(process.pid) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`drop fac-${id}`);
});

test("a killed run that wrote no pid yet is killed too", async () => {
  const id = goal();
  killedRun(`fac-${id}`, "build", {});
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`drop fac-${id}`);
});

test("a run from before this boot whose pid's process names its folder is live and stays", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`, "build", {});
  // bash runs only builtins, so it execs nothing that would lose the folder, and blocks on its stdin until killed.
  const p = Bun.spawn(["bash", "-c", `echo up; read; : ${r.folder}`], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  try {
    // Until the child execs bash, its cmdline is this process's; once bash has said up, it is bash's.
    await p.stdout.getReader().read();
    writeFileSync(join(r.folder, "pid"), String(p.pid));
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
    expect(readRun(r.folder)!.condition).toBe("running");
  } finally { p.kill(); }
});

// A lost run: `running`, started in this boot, its process gone with no `exit` written.
const lostRun = (name: string, kind: Run["kind"] = "build", extra: Partial<Run> = {}) => mk(name, kind, "running", extra, { pid: "999999999" });

test("a lost run is marked failed and the goal reruns once; a second lost run of the goal is a rescue Ask", async () => {
  const id = goal();
  const r = lostRun(`fac-${id}`);
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(readRun(r.folder)).toMatchObject({ condition: "dropped", reason: expect.stringContaining("was lost") });
  expect(existsSync(join(r.folder, "exit"))).toBe(true);
  expect(readFileSync(join(r.folder, "rescued"), "utf8").trim()).toBe("lost");
  expect(notes(id)).toContain("was lost: its process ended with no end written: dropped, and the goal reruns once");
  expect(ask(id)).toBeNull();

  const again = lostRun(`fac-${id}`);
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(readRun(again.folder)).toMatchObject({ condition: "failed", reason: "lost: its process ended with no end written" });
  expect(ask(id)).toMatchObject({ reason: "rescue" });
  // The Ask is set: the next dispatch leaves the run alone.
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
});

test("a lost land is marked failed and lands again, and the goal does not start over", async () => {
  const id = goal();
  const first = mk(`fac-${id}`, "build", "passed", { branch: "b" });
  const l = lostRun(`fac-${id}`, "land", { job: first.job, branch: "b" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`land fac-${id}`);
  expect(f.calls).not.toContain(`drop fac-${id}`);
  expect(readRun(l.folder)).toMatchObject({ condition: "failed", reason: "lost: its process ended with no end written" });
});

test("a land killed by a host restart fails and lands again, and the goal does not start over", async () => {
  const id = goal();
  const first = mk(`fac-${id}`, "build", "passed", { branch: "b", started: BEFORE_BOOT });
  const l = mk(`fac-${id}`, "land", "running", { job: first.job, branch: "b", started: BEFORE_BOOT }, { pid: "999999999" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`land fac-${id}`);
  expect(f.calls).not.toContain(`drop fac-${id}`);
  expect(readRun(l.folder)).toMatchObject({ condition: "failed", reason: "host restart" });
  expect(existsSync(join(l.folder, "exit"))).toBe(true);
});

// A run held before v6 phase 6, whose second review a host restart killed: call.md says PENDING from before the boot.
test("an old held run with a PENDING call.md from before the boot is left alone: no review starts and the run keeps its Ask", async () => {
  const r = mk(`fac-${goal()}`, "build", "awaiting", { ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } }, { "call.md": "PENDING\n" });
  utimesSync(join(r.folder, "call.md"), new Date(BEFORE_BOOT), new Date(BEFORE_BOOT));
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(readRun(r.folder)).toMatchObject({ condition: "awaiting", ask: { reason: "held-path" } });
  expect(readFileSync(join(r.folder, "call.md"), "utf8")).toBe("PENDING\n");
});

test("a paused factory leaves a killed run alone", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`);
  setPaused(true);
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(readRun(r.folder)!.condition).toBe("running");
});
