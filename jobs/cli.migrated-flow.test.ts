import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, itemsRemote, seedItem, sh, startScript, until } from "./cli.helpers";
import { setup, teardown } from "./cli.helpers";

// The factory on the new store shape: `aleph migrate --apply` on one open goal, one standalone goal and one
// proposal, then `aleph resume` and `aleph dispatch`. Goal `.1` starts, runs and lands; the proposal starts nothing
// and triage leaves it alone; a second dispatch starts nothing new.
beforeAll(setup);
afterAll(teardown);

describe("the flow on migrated items", () => {
  test("goal .1 starts, runs and lands, the proposal is left alone, and a second dispatch starts nothing", async () => {
    const dir = (n: string) => join(base, n);
    mkdirSync(dir("runs"), { recursive: true });
    mkdirSync(dir("factory"), { recursive: true });
    // Old-shape items, seeded: `aleph migrate --apply` is what turns them into the new shape.
    // The goal's body tells the fake worker what to commit.
    const goal = seedItem("fac", "migrated goal", { labels: ["goal"] }, "ACTION: commit migrated.txt");
    const standalone = seedItem("fac", "standalone goal", { labels: ["goal"], due: "2999-01-01" });
    const proposal = seedItem("fac", "bump left-pad", { labels: ["proposal", "deps"] });
    const plain = seedItem("fac", "an untriaged issue", {}, "");

    writeFileSync(join(dir("factory"), "paused"), "now\n");
    const mig = await aleph(["migrate", "--apply"], { ALEPH_BACKUPS_DIR: dir("backups") });
    expect(mig.code, mig.stderr).toBe(0);

    const startLog = join(base, "start.log"), startCmd = join(base, "start-cmd"), triageLog = join(base, "triage.log");
    // The new layout: the store in issues, the ledger in runs, the sandbox folders in sandbox.
    const jobs = dir("runs");
    // The stock start command with `--land`, as the production start passes it: a passed run lands.
    startScript(startCmd, jobs);
    writeFileSync(startCmd, readFileSync(startCmd, "utf8").replace('--todo "$3"', '--todo "$3" --land'), { mode: 0o755 });
    writeFileSync(join(base, "fake-triage"), `#!/bin/bash\ncat > /dev/null\necho triaged >> ${triageLog}\necho '{"verdict":"close","reason":"test"}'\n`, { mode: 0o755 });
    const on = {
      ALEPH_ISSUES: dir("issues"), ALEPH_JOBS_DIR: jobs, ALEPH_SANDBOX_DIR: dir("sandbox"), ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog,
      ALEPH_TRIAGE_CAP: "5", ALEPH_TRIAGE_CMD: join(base, "fake-triage"),
    };
    const stateOf = (r: string): string => { try { return JSON.parse(readFileSync(join(jobs, r, "state.json"), "utf8")).state; } catch { return ""; } };
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);

    expect((await aleph(["resume"], on)).code).toBe(0);
    // `resume` dispatches in the background; an explicit dispatch beside it starts the goal once, whichever holds the baseline.
    const d = await aleph(["dispatch"], on);
    expect(d.code, d.stderr).toBe(0);
    await until(() => started().length > 0);
    expect(started()).toEqual([`fac-${goal}.1`]);
    // The run lands by itself and its issue closes.
    await until(() => readdirSync(jobs).some((r) => r.includes(`-fac-fac-${goal}.1-`) && stateOf(r) === "landed"));
    expect(sh(itemsRemote, "git", "log", "-1", "--format=%B", "main").length).toBeGreaterThan(0);
    expect(sh(base, "git", "--git-dir", join(base, "remote.git"), "log", "-1", "--format=%B", "main")).toContain(`Item: fac-${goal}.1`);
    await until(() => readFileSync(join(dir("issues"), "fac", "backlog", "tasks", `fac-${goal}.1.md`), "utf8").includes("status: done"));

    // The proposal started no run, and the tick's triage does not touch it.
    writeFileSync(join(dir("factory"), "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const tick = await aleph(["tick"], on);
    expect(tick.code, tick.stderr).toBe(0);
    // The control: the plain issue was triaged (once); the proposal was not.
    expect(tick.json.triaged).toEqual({ close: 1 });
    expect(readFileSync(triageLog, "utf8").trim().split("\n")).toEqual(["triaged"]);
    expect(readFileSync(join(dir("issues"), "fac", "backlog", "tasks", `fac-${plain}.md`), "utf8")).toContain("status: done");
    const text = readFileSync(join(dir("issues"), "fac", "backlog", "tasks", `fac-${proposal}.md`), "utf8");
    expect(text).toContain("ask: approval");
    expect(text).toContain("status: open");
    expect(readdirSync(jobs).filter((r) => r.includes(`fac-${proposal}`))).toEqual([]);

    const again = await aleph(["dispatch"], on);
    expect(again.json.started).toEqual([]);
    expect(again.json.skipped.join("\n")).not.toContain(`fac-${proposal}`);
    expect(started()).toEqual([`fac-${goal}.1`]);
    expect(standalone).toBeGreaterThan(0);
  }, 120_000);
});
