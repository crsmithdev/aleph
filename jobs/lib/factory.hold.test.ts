import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, diagnose, dispatching, file, jobsDir, state, stateNow, setup, teardown, unitAlive, until, seedItem } from "../cli.helpers";
import { dispatch, drop, issueClose, job, land } from "../inproc.ts";
import { pause, reportText, resume, tick } from "./flow.testkit.ts";

// The dispatches and ticks run in-process, as `aleph dispatch` and `aleph tick` run them; each run's unit is a process of its own.
// setup spawns openssl and git, so it can outlast the 5 s bun default; bun run test uses 30 s.
beforeAll(setup, 30_000);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, o: { land?: boolean } = {}) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o);
  test("a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
      mkdirSync(join(base, "factory"), { recursive: true });
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
      const stuckId = seedItem("fac", "the stuck one", { kind: "goal" }, "ACTION: error\n".trim());
      expect((await tick()).started).toEqual([`fac-${stuckId}`]);
      const id = seedItem("fac", "behind the hold", { kind: "goal" }, "ACTION: commit behind.txt\n".trim());
      const d = (await dispatch()).json;
      expect(d.started).toEqual([]);
      expect(d.held).toContain(`Held: fac-${stuckId} is stuck`);
      expect(d.skipped).toEqual([d.held]);
      expect((await tick()).held).toContain(`fac-${stuckId}`);
      expect(await reportText()).toContain(`Held: fac-${stuckId} is stuck`);
      // a run that passes waits, and lands once the hold clears
      const r = await fjob("fheld", "commit fheld.txt", { land: true });
      expect(state(r.json.run).condition).toBe("passed");
      expect(file(r.json.run, "next.log")).toContain("held:");
      expect((await dispatch()).json.landed).toBeUndefined();
      expect(state(r.json.run).condition).toBe("passed");
      // pause and the hold are independent
      await pause();
      await resume();
      expect((await dispatch()).json.held).toContain(`fac-${stuckId}`);
      // Chris's land still works while held
      const other2 = await fjob("fheld2", "commit fheld2.txt");
      expect(state((await land("fheld2")).json.run).condition).toBe("landed");
      expect(other2.code).toBe(0);
      await drop(`fac-${stuckId}`);
      await issueClose("fac", stuckId, "drop", "test over");
      await pause();
      expect((await dispatch()).json).toMatchObject({ paused: true });
      await resume();
      const free = (await dispatch()).json;
      expect(free.held).toBeUndefined();
      expect(free.landed).toEqual(["fheld"]);
      expect(free.started).toEqual([`fac-${id}`]);
      await drop(`fac-${id}`);
      await issueClose("fac", id, "drop", "test over");
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);

  test("a stuck or failed run holds the factory only once no next run is pending for it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      // The first test leaves a dropped run, a landed one and maybe a detached dispatch: let them end, so no run but ours is open.
      await until(() => !dispatching() && readdirSync(jobsDir).every((r) => stateNow(r).condition !== "running" && !unitAlive(join(jobsDir, r))));
      const seen = async (label: string) => diagnose(`${label}: runs ${readdirSync(jobsDir).map((r) => `${r}=${stateNow(r).condition}`).join(", ")}`, []);
      // Runs written as the ledger holds them: a conflicted land that goes back to its worker, and a stuck run.
      const made: string[] = [];
      const run = (name: string, extra: Record<string, unknown>) => {
        const folder = join(jobsDir, `${new Date().toISOString().slice(0, 19).replace(/:/g, "").replace("T", "-")}-fac-${name}-${extra.kind ?? "build"}`);
        mkdirSync(folder);
        writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", job: name, name, repo: "fac", told: true, started: new Date().toISOString(), ...extra }));
        made.push(folder);
        return folder;
      };
      const landRun = { kind: "land", condition: "failed", reason: "merge conflict", conflicts: ["x.txt"] };
      const pending = run("fheldland", { ...landRun, next: "worker", ended: new Date().toISOString() });
      const d1 = (await dispatch()).json;
      expect(d1.held, await seen(`line 76: ${JSON.stringify(d1)}`)).toBeUndefined();
      writeFileSync(join(pending, "state.json"), JSON.stringify({ ...state(pending.split("/").pop()!), next: undefined }));
      const d2 = (await dispatch()).json;
      expect(d2.held, await seen(`line 78: ${JSON.stringify(d2)}`)).toContain("Held: fheldland is failed");
      // a stuck run whose unit is still live does not hold; once the unit ends, it does
      const live = run("fstuck", { condition: "stuck", reason: "tests" });
      const unit = Bun.spawn(["sh", "-c", "sleep 60; :", live], { stdout: "ignore", stderr: "ignore" });
      writeFileSync(join(live, "pid"), String(unit.pid));
      // Straight after the spawn, /proc/<pid>/cmdline can be empty: the child has not reached exec.
      await until(() => unitAlive(live));
      const d3 = (await dispatch()).json;
      // the hold line names only the oldest holder, so the live run must not be counted in "and N more"
      expect(d3.held, await seen(`line 83: ${JSON.stringify(d3)}`)).toContain("Held: fheldland is failed");
      expect(d3.held).not.toContain("fstuck");
      unit.kill();
      await unit.exited;
      writeFileSync(join(live, "exit"), "0\n");
      const d4 = (await dispatch()).json;
      expect(d4.held, await seen(`line 87: ${JSON.stringify(d4)}`)).toContain("Held: fheldland and 1 more are");
      for (const f of made) rmSync(f, { recursive: true, force: true });
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);
});
