import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchIssues, setPaused } from "./factory.ts";
import { gates, gpuSlot, liveEntries, liveRuns } from "../gates/factory-status.ts";
import { setModel } from "../routing/models.ts";
import { waitingToLand } from "../land/landing.ts";
import { allJobs, allRuns, type Run } from "../records/ledger.ts";
import * as record from "../records/record.ts";
import { setState } from "../records/record.ts";
import { layout, readEvents } from "../../../lib/layout.ts";
import { reseed, seed } from "../../job.testkit.ts";
import * as locks from "../infra/locks.ts";
import { held } from "../infra/locks.ts";
import { startJob } from "./transitions.ts";
import { startKept } from "../roles/unit.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { change, ctx, dispatch, fakes, newIssue, mk, setup, teardown } from "./factory.helpers.ts";

/** Called after each `held` check, the gate's check of the `gpu` lock among them: a test sets it to act in that gap. */
let afterHeld: ((name: string) => void) | undefined;
const real = { ...locks };
mock.module("../infra/locks.ts", () => ({ ...real, held: (name: string) => { const r = real.held(name); afterHeld?.(name); return r; } }));

beforeEach(setup);
afterEach(teardown);

const entry = (role: string, state: string, reason?: string): any =>
  ({ id: `job.1`, folder: join(ctx.base, "none", `${role}-${state}`), run: { role, job: "job.1", name: "issue.1", repo: "fac", state: state, started: "2026-10-28T00:00:00Z", ...(reason ? { reason } : {}) } });

test("gates returns the first factory gate, in the order pause, live cap", () => {
  const order = () => gates({ jobs: [] })?.gate;
  process.env.ALEPH_LIVE_CAP = "0";
  setPaused(true);
  expect(order()).toBe("pause");
  setPaused(false);
  expect(order()).toBe("live-cap");
  process.env.ALEPH_LIVE_CAP = "5";
  expect(gates({ jobs: [] })).toBeNull();
  // `only` leaves the others out.
  process.env.ALEPH_LIVE_CAP = "0";
  expect(gates({ jobs: [], only: ["pause"] })).toBeNull();
  expect(gates({ jobs: [], only: ["live-cap"] })?.gate).toBe("live-cap");
});

/** The `settings` events logged after `from`, as subject and detail. */
const settingsSince = (from: number) => readEvents().slice(from).filter((e) => e.object === "settings").map((e) => [e.subject, e.detail]);

test("pause logs one human settings event, and a dispatch while paused logs no event on the factory or an issue", async () => {
  const id = newIssue();
  const before = readEvents().length;
  setPaused(true);
  setPaused(true);
  await dispatchIssues(async () => null);
  expect(readEvents().slice(before).map((e) => [e.subject, e.action, e.object, e.detail])).toEqual([["human", "changed", "settings", "pause: on"]]);
  setPaused(false);
  expect(settingsSince(before)).toEqual([["human", "pause: on"], ["human", "pause: off"]]);
  expect(readEvents().filter((e) => e.object === "factory" || e.object === `issue.${id}`)).toEqual([]);
});

test("a full live cap logs one cap-on event over two dispatches and none on the skipped issues; it logs cap-off only once the cap frees", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    mk("fac-99", "build", "running", { model: "sonnet", made: NOW });
    const a = newIssue(), b = newIssue();
    const before = readEvents().length;
    for (let i = 0; i < 2; i++) expect((await dispatchIssues(async () => null)).started).toEqual([]);
    expect(settingsSince(before)).toEqual([["gate", "cap: on: 1 / 1 jobs"]]);
    expect(readEvents().slice(before).filter((e) => e.object === `issue.${a}` || e.object === `issue.${b}`)).toEqual([]);
    expect(record.read(`issue.${a}`)).toBeNull();
    // The cap is still full and no issue is open: the cap stays on.
    for (const id of [a, b]) change(id, (i) => issues.setStatus(i, "parked"));
    await dispatchIssues(async () => null);
    expect(settingsSince(before)).toHaveLength(1);
    // The run ends: the next dispatch logs the cap off, once.
    setState(allRuns().find((e) => e.run.name === "issue.99")!.id, "failed");
    await dispatchIssues(async () => null);
    await dispatchIssues(async () => null);
    expect(settingsSince(before)).toEqual([["gate", "cap: on: 1 / 1 jobs"], ["gate", "cap: off"]]);
  } finally {
    setSystemTime();
  }
});

test("a stuck or failed run stops no gate: its open job keeps only its own issue not ready", () => {
  expect(gates({ jobs: [[entry("build", "failed")]] as any })).toBeNull();
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = seed({ role: "build", name: "issue.1", repo: "fac", target: "issue.1", state: "passed", land: true, next: "land", started: "2026-10-28T00:00:00Z" });
  const busy = seed({ role: "land", name: "issue.1", repo: "fac", target: "issue.1", prev: agent.id, state: "failed", reason: "job lock busy", cause: "locked", started: "2026-10-28T00:00:00Z" });
  expect(waitingToLand()).toEqual(["issue.1"]);
  reseed(busy.id, { reason: "not landed", cause: undefined });
  expect(waitingToLand()).toEqual([]);
});

test("waitingToLand lists the job whose first run has the lower ID first, though it started later", () => {
  const job = (name: string, started: string) => seed({ role: "build", name, repo: "fac", target: name, state: "passed", land: true, next: "land", started });
  job("issue.1", "2026-10-28T02:00:00Z");
  job("issue.2", "2026-10-28T01:00:00Z");
  expect(waitingToLand([...allJobs()].reverse())).toEqual(["issue.1", "issue.2"]);
});

test("a passed run on a parked issue is not waiting to land, and waits again once the issue is open", async () => {
  const id = newIssue();
  const name = `issue.${id}`;
  mk(`p-${id}`, "build", "passed", { next: "land", land: true });
  change(id, (i) => issues.setStatus(i, "parked"));
  const f = fakes();
  expect(waitingToLand()).not.toContain(name);
  await dispatch(f);
  expect(f.calls).not.toContain(`land ${name}`);
  change(id, (i) => issues.setStatus(i, "open"));
  expect(waitingToLand()).toContain(name);
  await dispatch(f);
  expect(f.calls).toContain(`land ${name}`);
});

test("the first dispatch after the resume starts a next step the pause kept, once", async () => {
  const kept = mk("kept-1", "build", "failed", { failed: "test", next: "worker" }, { "paused-next": "worker\n" });
  mk("history-2", "build", "failed", { failed: "test", next: "worker" });
  const go: string[] = [];
  const step = async (_folder: string, run: Run, next: NonNullable<Run["next"]>) => { go.push(`${run.name} ${next}`); };
  expect(await startKept(step)).toEqual(["issue.1"]);
  expect(go).toEqual(["issue.1 worker"]);
  expect(existsSync(join(kept.folder, "paused-next"))).toBe(false);
  expect(await startKept(step)).toEqual([]);
});

test("with one live local-backend run a second local run is held by the local cap, a Claude run still starts, and the live cap leaves the local run out", () => {
  process.env.ALEPH_LIVE_CAP = "1";
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    // Made just now with no pid yet: the run is starting, so it is live.
    mk("local-1", "build", "running", { model: "gpt-oss-20b", made: NOW });
    expect(liveRuns()).toBe(0);
    expect(gates({ run: { model: "haiku" } })).toMatchObject({ gate: "live-cap", why: "1 local agent runs are live", text: "Waiting for the GPU slot (1 of 1 running)" });
    expect(gates({ run: { model: "sonnet" } })).toBeNull();
    expect(gates()).toBeNull();
  } finally {
    setSystemTime();
  }
});

test("while a title or judge call holds the GPU slot, a local agent run is held by the local cap and a Claude run still starts", async () => {
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  const release = (await gpuSlot(0))!;
  try {
    expect(gates({ run: { model: "haiku" } })).toMatchObject({ gate: "live-cap", why: "a local call holds the GPU", text: "Waiting for the GPU slot (1 of 1 running)" });
    expect(gates({ run: { model: "sonnet" } })).toBeNull();
  } finally {
    release();
  }
  expect(gates({ run: { model: "haiku" } })).toBeNull();
});

test("with the live cap full of Claude runs and the GPU free, the dispatch starts an issue whose size is on the local backend", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ answers: { size: { type: "choice", choice: "small", probabilities: { small: 1 } } } }) });
  const saved = { url: process.env.ALEPH_JEV_URL, key: process.env.OPENROUTER_API_KEY };
  Object.assign(process.env, { ALEPH_LIVE_CAP: "1", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    mk("fac-99", "build", "running", { model: "sonnet", made: NOW });
    const id = newIssue();
    const sizes: unknown[] = [];
    const out = await dispatchIssues(async (_r, _n, _id, _spec, size) => { sizes.push(size); return null; });
    expect(out.started).toEqual([`issue.${id}`]);
    expect(sizes).toEqual(["small"]);
  } finally {
    setSystemTime();
    server.stop(true);
    process.env.ALEPH_JEV_URL = saved.url;
    process.env.OPENROUTER_API_KEY = saved.key;
  }
});

/** A `systemd-run` that does nothing, first on PATH, so a start reaches its run record and starts no unit. */
function stubUnit(): () => void {
  const bin = join(ctx.base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "systemd-run"), 0o755);
  const saved = { PATH: process.env.PATH, fg: process.env.ALEPH_JOB_FOREGROUND, wait: process.env.ALEPH_PID_WAIT_MS };
  Object.assign(process.env, { PATH: `${bin}:${saved.PATH}`, ALEPH_PID_WAIT_MS: "50" });
  delete process.env.ALEPH_JOB_FOREGROUND;
  return () => {
    process.env.PATH = saved.PATH;
    if (saved.fg !== undefined) process.env.ALEPH_JOB_FOREGROUND = saved.fg;
    if (saved.wait === undefined) delete process.env.ALEPH_PID_WAIT_MS; else process.env.ALEPH_PID_WAIT_MS = saved.wait;
  };
}

const folders = () => (existsSync(layout().jobs) ? readdirSync(layout().jobs).filter((d) => !d.startsWith(".")) : []);

test("while a local run's start is before its run record, gpuSlot returns null, and after the start the run is live local", async () => {
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  const undo = stubUnit();
  try {
    let probe: Promise<unknown> | undefined;
    // The spec is read in the start's prep step, before the run record is written.
    const a = { repo: "fac", name: "x", get spec() { probe = gpuSlot(0); return "s"; }, model: "haiku" };
    await startJob(a);
    expect(await probe).toBeNull();
    expect(held("gpu")).toBe(false);
    expect(liveEntries()).toHaveLength(1);
    expect(liveRuns()).toBe(0);
  } finally {
    undo();
  }
});

test("when gpuSlot takes the slot just after a local run's start checks the gate, the start is refused and makes no run folder, and a Claude run starts", async () => {
  expect(setModel("small", { model: "gpt-oss-20b" })).toBeNull();
  const undo = stubUnit();
  let call: Promise<(() => void) | null> | undefined;
  // gpuSlot takes the lock at once, so it holds the slot from the gate's check on.
  afterHeld = (name) => { if (name === "gpu" && !call) call = gpuSlot(0); };
  try {
    await expect(startJob({ repo: "fac", name: "x", spec: "s", model: "haiku" })).rejects.toThrow(/^a local call holds the GPU$/);
    afterHeld = undefined;
    expect(folders()).toEqual([]);
    const release = await call;
    expect(release).not.toBeNull();
    await startJob({ repo: "fac", name: "y", spec: "s", model: "sonnet" });
    expect(folders()).toHaveLength(1);
    release!();
  } finally {
    afterHeld = undefined;
    undo();
  }
});

test("when a local run starts while gpuSlot takes the free gpu lock, gpuSlot returns null and leaves the lock free until the run ends", async () => {
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    expect(held("gpu")).toBe(false);
    const probe = gpuSlot(0);
    // Made just now with no pid yet: the run is starting.
    const run = mk("local-1", "build", "running", { model: "gpt-oss-20b", made: NOW });
    expect(await probe).toBeNull();
    expect(held("gpu")).toBe(false);
    reseed(run.job, { state: "failed" });
    const release = await gpuSlot(0);
    expect(release).not.toBeNull();
    release!();
  } finally {
    setSystemTime();
  }
});
