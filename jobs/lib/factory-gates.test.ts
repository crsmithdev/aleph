import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dispatchIssues, setPaused } from "./factory.ts";
import { gates, gpuSlot, liveRuns } from "./factory-status.ts";
import { LOCAL, setModel } from "./models.ts";
import { waitingToLand } from "./landing.ts";
import type { Run } from "./ledger.ts";
import { startKept } from "./unit.ts";
import { ctx, goal, mk, setup, teardown } from "./factory.helpers.ts";

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

test("a stuck or failed run stops no gate: its open job keeps only its own goal not ready", () => {
  expect(gates({ jobs: [[entry("build", "stuck")]] as any })).toBeNull();
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = entry("build", "passed");
  agent.run.land = true;
  agent.run.next = "land";
  expect(waitingToLand([[agent, entry("land", "failed", "job lock busy")]])).toEqual(["n1"]);
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
  expect(setModel("worker.haiku", "local")).toBeNull();
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    // Made just now with no pid yet: the run is starting, so it is live.
    mk("local-1", "build", "running", { model: LOCAL.model, made: NOW });
    expect(liveRuns()).toBe(0);
    expect(gates({ run: { model: "haiku" } })).toMatchObject({ gate: "live-cap", why: "1 local agent runs are live", text: "Waiting for the GPU slot (1 of 1 running)" });
    expect(gates({ run: { model: "sonnet" } })).toBeNull();
    expect(gates()).toBeNull();
  } finally {
    setSystemTime();
  }
});

test("while a title or judge call holds the GPU slot, a local agent run is held by the local cap and a Claude run still starts", async () => {
  expect(setModel("worker.haiku", "local")).toBeNull();
  const release = (await gpuSlot(0))!;
  try {
    expect(gates({ run: { model: "haiku" } })).toMatchObject({ gate: "live-cap", why: "a local call holds the GPU", text: "Waiting for the GPU slot (1 of 1 running)" });
    expect(gates({ run: { model: "sonnet" } })).toBeNull();
  } finally {
    release();
  }
  expect(gates({ run: { model: "haiku" } })).toBeNull();
});

test("with the live cap full of Claude runs and the GPU free, the dispatch starts a goal whose tier is on the local backend", async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ answers: { tier: { type: "choice", choice: "haiku", probabilities: { haiku: 1 } } } }) });
  const saved = { url: process.env.ALEPH_JEV_URL, key: process.env.OPENROUTER_API_KEY };
  Object.assign(process.env, { ALEPH_LIVE_CAP: "1", ALEPH_JEV_URL: `http://127.0.0.1:${server.port}/`, OPENROUTER_API_KEY: "k-test" });
  expect(setModel("worker.haiku", "local")).toBeNull();
  const NOW = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(NOW);
  try {
    mk("claude-1", "build", "running", { model: "sonnet", made: NOW });
    const id = goal();
    const tiers: unknown[] = [];
    const out = await dispatchIssues(async (_r, _n, _id, _spec, tier) => { tiers.push(tier); return null; });
    expect(out.started).toEqual([`fac-${id}`]);
    expect(tiers).toEqual(["haiku"]);
  } finally {
    setSystemTime();
    server.stop(true);
    process.env.ALEPH_JEV_URL = saved.url;
    process.env.OPENROUTER_API_KEY = saved.key;
  }
});
