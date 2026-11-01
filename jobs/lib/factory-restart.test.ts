import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchIssues, setPaused } from "./factory.ts";
import { readRun } from "./ledger.ts";
import { type Run } from "./ledger.ts";
import { goal, mk, notes, ask, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";

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

test("a goal whose run a host restart killed keeps its rerun: the next no commit reruns it with no Ask", async () => {
  const id = goal();
  killedRun(`fac-${id}`);
  const f = fakes();
  f.start = async () => null;
  await dispatchIssues(f.start, async () => null, f.land, f.rescue);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  await dispatchIssues(f.start, async () => null, f.land, f.rescue);
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
  // The sleep comes first: bash execs a last command, and its cmdline would lose the folder.
  const p = Bun.spawn(["bash", "-c", `sleep 20; : ${r.folder}`], { stdout: "ignore", stderr: "ignore" });
  try {
    writeFileSync(join(r.folder, "pid"), String(p.pid));
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
    expect(readRun(r.folder)!.condition).toBe("running");
  } finally { p.kill(); }
});

test("a run started in this boot whose process is gone is left alone", async () => {
  const id = goal();
  const r = mk(`fac-${id}`, "build", "running", {}, { pid: "999999999" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(readRun(r.folder)!.condition).toBe("running");
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

// A landed job whose facts run is `running` with no pid: a facts run writes none, so only its start tells a restart from a live review.
const factsOf = (id: number, started: string) => {
  const first = mk(`fac-${id}`, "build", "passed", { branch: "b", started: BEFORE_BOOT });
  mk(`fac-${id}`, "land", "landed", { job: first.job, branch: "b", commit: "abc1234", facts: true, started: BEFORE_BOOT });
  return mk(`fac-${id}`, "facts", "running", { job: first.job, phase: "facts", shown: false, started });
};

test("a facts run a host restart killed ends done, with the reason, and stays unshown for the news", async () => {
  const id = goal();
  const fr = factsOf(id, BEFORE_BOOT);
  await dispatch(fakes());
  const run = readRun(fr.folder)!;
  expect(run).toMatchObject({ condition: "done", reason: "host restart", shown: false });
  expect(run.ended).toBeTruthy();
  expect(run.phase).toBeUndefined();
});

test("a facts run started after this boot is still running", async () => {
  const id = goal();
  const fr = factsOf(id, new Date().toISOString());
  await dispatch(fakes());
  expect(readRun(fr.folder)!.condition).toBe("running");
});

// A review that a host restart killed: the run is awaiting a held-path ask, call.md says PENDING.
const heldRun = (id: number, call: string, mtime: Date) => {
  const r = mk(`fac-${id}`, "build", "awaiting", { ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } }, { "call.md": call });
  utimesSync(join(r.folder, "call.md"), mtime, mtime);
  return r;
};
const reviewDispatch = (starts: string[]) => {
  const f = fakes();
  // Like startReview: the start writes a new PENDING.
  f.rescue.review = (folder) => { starts.push(folder); writeFileSync(join(folder, "call.md"), "PENDING\n"); return true; };
  return dispatch(f);
};

test("a held run whose PENDING call.md is older than the boot gets one new review start", async () => {
  const r = heldRun(goal(), "PENDING\n", new Date(BEFORE_BOOT));
  const starts: string[] = [];
  await reviewDispatch(starts);
  expect(starts).toEqual([r.folder]);
  await reviewDispatch(starts);
  expect(starts).toEqual([r.folder]);
});

test("a held run whose PENDING call.md was written after the boot gets no start", async () => {
  heldRun(goal(), "PENDING\n", new Date());
  const starts: string[] = [];
  await reviewDispatch(starts);
  expect(starts).toEqual([]);
});

test("a held run with a verdict or an ERROR in an old call.md gets no start", async () => {
  heldRun(goal(), "VERDICT: land\n", new Date(BEFORE_BOOT));
  heldRun(goal(), "ERROR: could not start: x\n", new Date(BEFORE_BOOT));
  const starts: string[] = [];
  await reviewDispatch(starts);
  expect(starts).toEqual([]);
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
