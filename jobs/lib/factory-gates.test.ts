import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setPaused } from "./factory.ts";
import { gates } from "./factory-status.ts";
import { waitingToLand } from "./landing.ts";
import type { Run } from "./ledger.ts";
import { startKept } from "./unit.ts";
import { ctx, mk, setup, teardown } from "./factory.helpers.ts";

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
