// Archived goal tests from jobs/lib/transitions.item.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, jobsDir, state, setup, teardown } from "../../../jobs/cli.helpers";
import { drop, issueAdd, issueShow, job } from "../../../jobs/inproc.ts";

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
});

describe("prospective memory", () => {
  // A fresh probe, so the tick does not run one.
  beforeAll(() => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });
});
