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
    const first = (await aleph(["issue", "list", "fac", "--json"])).json.filter((i: any) => i.status === "open" && i.kind === "issue" && !i.ask && i.goals.length === 0)[0];
    const t = await aleph(["tick"], { ALEPH_TRIAGE_CAP: "1", ALEPH_TRIAGE_CMD: cmd });
    expect(t.json.triaged).toEqual({ ask: 1 });
    const stored = readFileSync(join(items, "fac", "backlog", "tasks", `fac-${first.id}.md`), "utf8");
    expect(stored).toContain("ask: input");
    expect(stored).toContain("reason: host-check");
    expect(readdirSync(jobsDir).filter((d) => d.endsWith("-triage")).map((d) => state(d).kind)).toContain("triage");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("triaged ask 1");
    expect(id).toBeGreaterThan(0);
  }, 30_000);

  test("a tick starts no run while the waiting cap binds, and a drop frees a place", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const env = { ALEPH_AWAITING_CAP: "2" };
    await fjob("fwait1", "commit held/w1.txt");
    await fjob("fwait2", "commit held/w2.txt");
    const id = seedItem("fac", "behind the cap", { labels: ["goal"] }, "ACTION: commit capped.txt\n".trim());
    const t = await aleph(["tick"], env);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toContain(`fac-${id}: 2 runs wait for Chris`);
    expect((await aleph(["report"], env)).stdout).toContain("health: 2 runs wait for Chris; no new run starts");
    await aleph(["drop", "fwait1"]);
    expect((await aleph(["tick"], env)).json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", "fwait2"]);
  }, 30_000);

  test("pause stops the tick and the unit's follow-up land, but not Chris's land", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    expect((await aleph(["pause"])).json).toEqual({ paused: true });
    const id = seedItem("fac", "while paused", { labels: ["goal"] }, "ACTION: commit paused.txt\n".trim());
    expect((await aleph(["tick"])).json).toMatchObject({ started: [], paused: true });
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("paused");
    const r = await fjob("fpaused", "commit fpaused.txt", {}, ["--land"]);
    expect(state(r.json.run).state).toBe("passed");
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("paused");
    const l = await aleph(["land", "fpaused"]);
    expect(state(l.json.run).state).toBe("landed");
    expect((await aleph(["resume"])).json).toEqual({ paused: false });
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
  }, 30_000);
});
