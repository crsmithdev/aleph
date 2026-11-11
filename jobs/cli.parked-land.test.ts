import { afterAll, beforeAll, expect, test } from "bun:test";
import { jobRuns, repo, setup, sh, state, teardown, seedItem } from "./cli.helpers";
import { dispatch, issueEdit, job } from "./flow.testkit.ts";

beforeAll(setup);
afterAll(teardown);

test("a passed run on a parked issue starts no land, and the dispatch lands it once the issue is open", async () => {
  const id = seedItem("fac", "parked goal", { kind: "goal" }, "ACTION: commit parked.txt");
  expect((await issueEdit("fac", id, { status: "parked" })).code).toBe(0);
  const r = await job("fac", "parkedland", "Goal: parkedland\nACTION: commit parked.txt\n", { on: `fac-${id}`, land: true });
  expect(state(r.json.run)).toMatchObject({ condition: "passed", next: "land", reason: `issue fac-${id} is parked` });
  expect(jobRuns("parkedland", "land")).toEqual([]);
  expect(sh(repo, "git", "branch", "--list", "factory/parkedland")).toContain("factory/parkedland");

  expect((await issueEdit("fac", id, { status: "open" })).code).toBe(0);
  await dispatch();
  const last = state(jobRuns("parkedland").at(-1)!);
  expect(last).toMatchObject({ kind: "land", condition: "landed" });
}, 60_000);
