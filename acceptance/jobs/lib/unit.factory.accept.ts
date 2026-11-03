// Archived goal tests from jobs/lib/unit.factory.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, state, setup, teardown } from "../../../jobs/cli.helpers";
import { issueAdd, issueShow, job } from "../../../jobs/inproc.ts";
import { tick } from "../../../jobs/lib/flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  test("a worker that says the goal is already met, with the checks green on main, closes the item", async () => {
    const id = (await issueAdd("fac", "timeline already uses itemTimes")).json.added;
    const r = await job("fac", "fmet", "Goal: fmet\nACTION: already-met\n", { on: String(id) });
    expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "no commit" });
    // A tick's probe runs the sandbox; a passing probe is written as the other tick tests do.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const t = await tick();
    expect(t.episodes).toEqual(expect.any(Array));
    expect(state(r.json.run)).toMatchObject({ condition: "dropped", reason: expect.stringContaining("the item is done") });
    expect((await issueShow("fac", id)).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  }, 60_000);
});

describe("a worker's FOLLOWUP line (criterion 15)", () => {
});
