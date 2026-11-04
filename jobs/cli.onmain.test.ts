import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { aleph, jobsDir, state, setup, teardown } from "./cli.helpers";
import { actionJob as job } from "./inproc";
import { updateRun } from "./lib/ledger.ts";

beforeAll(setup);
afterAll(teardown);

// `aleph drop --quiet` keeps one CLI test: jobs/cli.ts maps --quiet to no fate.
describe("an item that is already on main", () => {
  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

  test("drop keeps the fact that a no-commit run ended with no commit", async () => {
    await job("nocom", "commit nocom.txt");
    const [agent] = runsOf("nocom");
    updateRun(join(jobsDir, agent.id), { condition: "stuck", reason: "no commit" });
    const r = await aleph(["drop", "nocom", "dropped as a duplicate", "--quiet"]);
    expect(r.code).toBe(0);
    const after = state(agent.id);
    expect(after.reason).toBe("dropped as a duplicate");
    expect(after.cause).toBe("no-commit");
  }, 60_000);
});
