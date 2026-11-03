import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addOld, base, jobsDir, sh, state, worktree, setup, teardown } from "../cli.helpers";
import { actionJob, drop, issueAdd, issueClose, issueShow, job } from "../inproc.ts";
import { reportText } from "./flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
// The CLI tests of a job on an item (its land, and the jobs list that reads fate from git) are in jobs/cli.item.test.ts.
beforeAll(setup);
afterAll(teardown);

const add = async (key: string, title: string, fields = {}) => (await issueAdd(key, title, fields)).json.added as number;
const show = async (key: string, id: number) => { const i = (await issueShow(key, id)).json; return { status: i.status, notes: i.notes as string[] }; };

describe("a job tied to a to-do item", () => {
  let dropId: number;
  beforeAll(async () => {
    dropId = await add("demo", "paint the shed");
  });

  test("an id the list does not have is refused, and nothing starts", async () => {
    const before = readdirSync(jobsDir).length;
    const r = await job("demo", "badlink", "x", { on: "99" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo has no issue 99");
    expect(readdirSync(jobsDir).length).toBe(before);
  });

  test("a run writes kind build and on, never todo", async () => {
    const id = await add("demo", "shape check", { spec: "ACTION: commit shape.txt" });
    const j = await job("demo", "shape", "Goal: shape\nACTION: commit shape.txt\n", { on: `demo-${id}` });
    const s = state(j.json.run);
    expect(s).toMatchObject({ kind: "build", on: `demo-${id}` });
    expect(s.todo).toBeUndefined();
    await drop("shape");
  });

  test("drop adds a note with the reason and leaves the item open", async () => {
    await job("demo", "shed", "Goal: shed\nACTION: commit shed.txt\n", { on: String(dropId) });
    expect((await drop("shed", "wrong colour")).code).toBe(0);
    const item = await show("demo", dropId);
    expect(item.status).toBe("open");
    expect(item.notes.at(-1)).toContain("job shed dropped: wrong colour");
  });
});

describe("fate from git", () => {
  test("each worker commit carries the job's trailer", async () => {
    const j = await actionJob("stamped", "commit stamped.txt");
    expect(sh(worktree("stamped"), "git", "log", "-1", "--format=%B")).toContain(`Job: ${j.json.job}`);
    await drop("stamped");
  });
});

describe("prospective memory", () => {
  // A fresh probe, so the tick does not run one.
  beforeAll(() => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });
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
