import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { gates, hold, saveProbe, setPaused, waitingToLand } from "./factory.ts";
import { ctx, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

const entry = (kind: string, state: string, reason?: string): any =>
  ({ id: `x-${kind}-${state}`, folder: join(ctx.base, "none", `${kind}-${state}`), run: { kind, job: "j1", name: "n1", repo: "fac", condition: state, started: "2026-10-28T00:00:00Z", ...(reason ? { reason } : {}) } });

test("gates returns the first reason, in the order pause, hold, probe, live cap, day cap, waiting", () => {
  const stuck = [[entry("build", "stuck")]];
  const order = () => gates({ jobs: stuck as any })?.gate;
  Object.assign(process.env, { ALEPH_LIVE_CAP: "0", ALEPH_DAY_CAP: "0", ALEPH_AWAITING_CAP: "0" });
  try {
    setPaused(true);
    saveProbe({ at: "2026-10-28T00:00:00Z", ok: false, failed: ["x"] });
    expect(order()).toBe("pause");
    setPaused(false);
    expect(order()).toBe("hold");
    expect(gates({ jobs: [] })?.gate).toBe("probe");
    saveProbe({ at: "2026-10-28T00:00:00Z", ok: true, failed: [] });
    expect(gates({ jobs: [] })?.gate).toBe("live");
    process.env.ALEPH_LIVE_CAP = "5";
    expect(gates({ jobs: [] })?.gate).toBe("day");
    process.env.ALEPH_DAY_CAP = "100";
    expect(gates({ jobs: [] })?.gate).toBe("awaiting");
    process.env.ALEPH_AWAITING_CAP = "5";
    expect(gates({ jobs: [] })).toBeNull();
    // `only` leaves the others out.
    process.env.ALEPH_DAY_CAP = "0";
    expect(gates({ jobs: stuck as any, only: ["day"] })?.gate).toBe("day");
  } finally {
    delete process.env.ALEPH_AWAITING_CAP;
  }
});

test("a land that failed 'job lock busy' does not hold the factory", () => {
  expect(hold([[entry("build", "passed"), entry("land", "failed", "job lock busy")]])).toBeNull();
});

test("a land that failed for another reason holds the factory", () => {
  expect(hold([[entry("build", "passed"), entry("land", "failed", "not landed")]])?.name).toBe("n1");
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = entry("build", "passed");
  agent.run.land = true;
  expect(waitingToLand([[agent, entry("land", "failed", "job lock busy")]])).toEqual(["n1"]);
  expect(waitingToLand([[agent, entry("land", "failed", "not landed")]])).toEqual([]);
});
