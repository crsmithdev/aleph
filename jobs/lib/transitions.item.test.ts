import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { addOld, sh, worktree, setup, teardown } from "../cli.helpers";
import { actionJob, drop, issueClose } from "../inproc.ts";
import { reportText } from "./flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
// The CLI tests of a job on an item (its land, and the jobs list that reads fate from git) are in jobs/cli.item.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("fate from git", () => {
  test("each worker commit carries the job's trailer", async () => {
    const j = await actionJob("stamped", "commit stamped.txt");
    expect(sh(worktree("stamped"), "git", "log", "-1", "--format=%B")).toContain(`Job: ${j.json.job}`);
    await drop("stamped");
  });
});

describe("prospective memory", () => {
  // Old-shape items, seeded: no verb of `aleph issue` sets `goal` or `after` on an old-shape item now. The tick below does the dispatching.
  const addGoal = (title: string, ...more: string[]) => addOld(title, "", more, { ALEPH_DISPATCH: "off" });

  test("a goal waiting on several items comes due once every one is done", async () => {
    const a = await addGoal("wait a"), b = await addGoal("wait b");
    const w = await addGoal("waits on two", "--after", `fac-${a},fac-${b}`);
    await issueClose("fac", a, "done");
    expect(await reportText()).not.toContain(`fac-${w} waits on two`);
    await issueClose("fac", b, "done");
    expect(await reportText()).toContain(`fac-${w} waits on two`);
    await issueClose("fac", w, "drop", "test over");
  }, 60_000);
});
