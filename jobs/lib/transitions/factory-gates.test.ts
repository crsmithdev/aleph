import { afterEach, beforeEach, expect, mock, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { dispatchIssues, setPaused } from "./factory.ts";
import { gates, gpuSlot, liveEntries, liveRuns } from "../gates/factory-status.ts";
import { setModel } from "../routing/models.ts";
import { waitingToLand } from "../land/landing.ts";
import { runsDir, type Run } from "../records/ledger.ts";
import { patchRun } from "../records/record.ts";
import * as locks from "../infra/locks.ts";
import { held } from "../infra/locks.ts";
import { startJob } from "./transitions.ts";
import { startKept } from "../roles/unit.ts";
import { ctx, newIssue, mk, setup, teardown } from "./factory.helpers.ts";

/** Called after each `held` check, the gate's check of the `gpu` lock among them: a test sets it to act in that gap. */
let afterHeld: ((name: string) => void) | undefined;
const real = { ...locks };
mock.module("../infra/locks.ts", () => ({ ...real, held: (name: string) => { const r = real.held(name); afterHeld?.(name); return r; } }));

beforeEach(setup);
afterEach(teardown);

const entry = (kind: string, state: string, reason?: string): any =>
  ({ id: `x-${kind}-${state}`, folder: join(ctx.base, "none", `${kind}-${state}`), run: { kind, job: "j1", name: "n1", repo: "fac", condition: state, started: "2026-10-28T00:00:00Z", ...(reason ? { reason } : {}) } });

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

test("a stuck or failed run stops no gate: its open job keeps only its own issue not ready", () => {
  expect(gates({ jobs: [[entry("build", "failed")]] as any })).toBeNull();
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = entry("build", "passed");
  agent.run.land = true;
  agent.run.next = "land";
  const busy = entry("land", "failed", "job lock busy");
  busy.run.cause = "locked";
  expect(waitingToLand([[agent, busy]])).toEqual(["n1"]);
  expect(waitingToLand([[agent, entry("land", "failed", "not landed")]])).toEqual([]);
});

test("the first dispatch after the resume starts a next step the pause kept, once", async () => {
  const kept = mk("kept-1", "build", "failed", { failed: "test", next: "worker" }, { "paused-next": "worker\n" });
  mk("history-2", "build", "failed", { failed: "test", next: "worker" });
  const go: string[] = [];
  const step = async (_folder: string, run: Run, next: NonNullable<Run["next"]>) => { go.push(`${run.name} ${next}`); };
  expect(await startKept(step)).toEqual(["kept-1"]);
  expect(go).toEqual(["kept-1 worker"]);
  expect(existsSync(join(kept.folder, "paused-next"))).toBe(false);
  expect(await startKept(step)).toEqual([]);
});

test("with one live local-backend run a second local run is held by the local cap, a Claude run still starts, and the live cap leaves the local run out", () => {
  process.env.ALEPH_LIVE_CAP = "1";
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
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
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
  const release = (await gpuSlot(0))!;
  try {
    expect(gates({ run: { model: "haiku" } })).toMatchObject({ gate: "live-cap", why: "a local call holds the GPU", text: "Waiting for the GPU slot (1 of 1 running)" });
    expect(gates({ run: { model: "sonnet" } })).toBeNull();
  } finally {
    release();
  }
  expect(gates({ run: { model: "haiku" } })).toBeNull();
});

test("with the live cap full of Claude runs and the GPU free, the dispatch starts an issue whose tier is on the local backend", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ answers: { tier: { type: "choice", choice: "worker-low", probabilities: { "worker-low": 1 } } } }) });
  const saved = { url: process.env.ALEPH_JEV_URL, key: process.env.OPENROUTER_API_KEY };
  Object.assign(process.env, { ALEPH_LIVE_CAP: "1", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    mk("claude-1", "build", "running", { model: "sonnet", made: NOW });
    const id = newIssue();
    const tiers: unknown[] = [];
    const out = await dispatchIssues(async (_r, _n, _id, _spec, tier) => { tiers.push(tier); return null; });
    expect(out.started).toEqual([`fac-${id}`]);
    expect(tiers).toEqual(["worker-low"]);
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

const folders = () => (existsSync(runsDir()) ? readdirSync(runsDir()).filter((d) => !d.startsWith(".")) : []);

test("while a local run's start is before its run record, gpuSlot returns null, and after the start the run is live local", async () => {
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
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
  expect(setModel("worker-low", { model: "gpt-oss-20b" })).toBeNull();
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
    patchRun(basename(run.folder), { condition: "failed" });
    const release = await gpuSlot(0);
    expect(release).not.toBeNull();
    release!();
  } finally {
    setSystemTime();
  }
});
