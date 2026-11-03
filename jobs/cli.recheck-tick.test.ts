import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, jobsDir, specFile, state, setup, teardown, items, seedItem } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  test("a tick triages an open issue that is not a goal, and its line counts the verdicts", async () => {
    const cmd = join(base, "triage-fake");
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"route":"live","note":"check the live site"}'\n`, { mode: 0o755 });
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id = (await aleph(["issue", "add", "fac", "needs a live look"])).json.added;
    const first = (await aleph(["issue", "list", "fac", "--json"])).json.filter((i: any) => i.status === "open" && !i.ask)[0];
    const t = await aleph(["tick"], { ALEPH_TRIAGE_CAP: "1", ALEPH_TRIAGE_CMD: cmd });
    expect(t.json.triaged).toEqual({ ask: 1 });
    const stored = readFileSync(join(items, "fac", "backlog", "tasks", `fac-${first.id}.md`), "utf8");
    expect(stored).toContain("ask: input");
    expect(stored).toContain("reason: host-check");
    expect(readdirSync(jobsDir).filter((d) => d.endsWith("-triage")).map((d) => state(d).kind)).toContain("triage");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("triaged ask 1");
    expect(id).toBeGreaterThan(0);
  }, 30_000);

  test("pause stops the tick and the unit's follow-up land, but not Chris's land", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    expect((await aleph(["pause"])).json).toEqual({ paused: true });
    const id = seedItem("fac", "while paused", { kind: "goal" }, "ACTION: commit paused.txt\n".trim());
    expect((await aleph(["tick"])).json).toMatchObject({ started: [], paused: true });
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("paused");
    const r = await fjob("fpaused", "commit fpaused.txt", {}, ["--land"]);
    expect(state(r.json.run).condition).toBe("passed");
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("paused");
    const l = await aleph(["land", "fpaused"]);
    expect(state(l.json.run).condition).toBe("landed");
    expect((await aleph(["resume"])).json).toEqual({ paused: false });
    // The start command only logs the goal: the test is about the tick's choice, not about the run it would start.
    const startCmd = join(base, "pause-start"), startLog = join(base, "pause-start.log");
    writeFileSync(startCmd, `#!/bin/sh\necho "$2" >> ${startLog}\n`, { mode: 0o755 });
    expect((await aleph(["tick"], { ALEPH_START_CMD: startCmd })).json.started).toEqual([`fac-${id}`]);
    expect(readFileSync(startLog, "utf8")).toBe(`fac-${id}\n`);
  }, 30_000);
});
