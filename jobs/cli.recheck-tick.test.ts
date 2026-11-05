import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, state, setup, teardown, seedItem } from "./cli.helpers";
import { dispatch, job, land } from "./inproc";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, o: { land?: boolean } = {}) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o, extra);

  // `aleph pause` and `resume` keep their CLI test here: each is composed in jobs/cli.ts. The rest is in-process.
  // `aleph tick` keeps its CLI test in jobs/cli.reviewer-sweep.test.ts.
  test("pause stops the tick and the unit's follow-up land, but not Chris's land", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    expect((await aleph(["pause"])).json).toEqual({ paused: true });
    const id = seedItem("fac", "while paused", { kind: "goal" }, "ACTION: commit paused.txt\n".trim());
    expect((await dispatch()).json).toMatchObject({ started: [], paused: true });
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("paused");
    const r = await fjob("fpaused", "commit fpaused.txt", {}, { land: true });
    expect(state(r.json.run).condition).toBe("passed");
    expect(state(r.json.run).next).toBe("land");
    expect(file(r.json.run, "next.log")).toContain("paused");
    expect(file(r.json.run, "paused-next")).toBe("land\n");
    const l = await land("fpaused");
    expect(state(l.json.run).condition).toBe("landed");
    expect((await aleph(["resume"])).json).toEqual({ paused: false });
    // The start command only logs the issue: the test is about the tick's choice, not about the run it would start.
    const startCmd = join(base, "pause-start"), startLog = join(base, "pause-start.log");
    writeFileSync(startCmd, `#!/bin/sh\necho "$2" >> ${startLog}\n`, { mode: 0o755 });
    expect((await dispatch({ ALEPH_START_CMD: startCmd })).json.started).toEqual([`fac-${id}`]);
    expect(readFileSync(startLog, "utf8")).toBe(`fac-${id}\n`);
  }, 30_000);
});
