import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { aleph, jobRuns, state, setup, teardown } from "./cli.testkit";
import { actionJob as job } from "./flow.testkit.ts";
import { setState } from "./lib/records/record.ts";

beforeAll(setup);
afterAll(teardown);

// `aleph drop --quiet` keeps one CLI test: cli/cli.ts maps --quiet to no fate.
describe("an item that is already on main", () => {
  const runsOf = (name: string) => jobRuns(name).map((d) => ({ id: d, ...state(d) }));

  test("drop keeps the fact that a no-commit run ended with no commit", async () => {
    await job("nocom", "commit nocom.txt");
    const [agent] = runsOf("nocom");
    setState(agent.id, "failed", { cause: "no-commit", reason: "no commit" });
    const r = await aleph(["drop", "nocom", "dropped as a duplicate", "--quiet"]);
    expect(r.code).toBe(0);
    const after = state(agent.id);
    expect(after.reason).toBe("dropped as a duplicate");
    expect(after.cause).toBe("no-commit");
  }, 60_000);
});
