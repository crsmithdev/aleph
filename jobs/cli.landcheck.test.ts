import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { aleph, job, jobsDir, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a batch of lands", () => {
  const landRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`) && d.endsWith("-land")).sort().map((d) => ({ id: d, ...state(d) }));

  test("two lands of one job at once start one land run", async () => {
    await job("twice", "commit batch/twice.txt");
    const rs = await Promise.all([aleph(["land", "twice"]), aleph(["land", "twice"])]);
    expect(rs.filter((r) => r.code === 0).length).toBe(1);
    expect(landRuns("twice").length).toBe(1);
  }, 60_000);
});
