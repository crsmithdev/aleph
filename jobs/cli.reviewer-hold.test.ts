import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, jobsDir, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  test("a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      await (async () => {
    // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const stuckId = (await aleph(["todo", "add", "fac", "the stuck one", "--labels", "goal", "--body", "-"], {}, "ACTION: error\n")).json.added;
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${stuckId}`]);
    const id = (await aleph(["todo", "add", "fac", "behind the hold", "--labels", "goal", "--body", "-"], {}, "ACTION: commit behind.txt\n")).json.added;
    const d = await aleph(["dispatch"]);
    expect(d.json.started).toEqual([]);
    expect(d.json.held).toContain(`Held: fac-${stuckId} is stuck`);
    expect(d.json.skipped).toEqual([d.json.held]);
    expect((await aleph(["tick"])).json.held).toContain(`fac-${stuckId}`);
    expect((await aleph(["report"])).stdout).toContain(`Held: fac-${stuckId} is stuck`);
    // a run that passes waits, and lands once the hold clears
    const r = await fjob("fheld", "commit fheld.txt", {}, ["--land"]);
    expect(state(r.json.run).state).toBe("passed");
    expect(file(r.json.run, "next.log")).toContain("held:");
    expect((await aleph(["dispatch"])).json.landed).toBeUndefined();
    expect(state(r.json.run).state).toBe("passed");
    // pause and the hold are independent
    await aleph(["pause"]);
    await aleph(["resume"]);
    expect((await aleph(["dispatch"])).json.held).toContain(`fac-${stuckId}`);
    // Chris's land still works while held
    const other2 = await fjob("fheld2", "commit fheld2.txt");
    expect(state((await aleph(["land", "fheld2"])).json.run).state).toBe("landed");
    expect(other2.code).toBe(0);
    await aleph(["drop", `fac-${stuckId}`]);
    await aleph(["todo", "drop", "fac", String(stuckId), "test over"]);
    await aleph(["pause"]);
    expect((await aleph(["dispatch"])).json).toMatchObject({ paused: true });
    await aleph(["resume"]);
    const free = await aleph(["dispatch"]);
    expect(free.json.held).toBeUndefined();
    expect(free.json.landed).toEqual(["fheld"]);
    expect(free.json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", `fac-${id}`]);
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
      })();
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);

  test("a stuck or failed run holds the factory only once no next run is pending for it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      await (async () => {
    // Runs written as the ledger holds them: a conflicted land that goes back to its worker, and a stuck run.
    const made: string[] = [];
    const run = (name: string, extra: Record<string, unknown>) => {
      const folder = join(jobsDir, `${new Date().toISOString().slice(0, 19).replace(/:/g, "").replace("T", "-")}-fac-${name}-${extra.kind ?? "agent"}`);
      mkdirSync(folder);
      writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: name, name, repo: "fac", told: true, started: new Date().toISOString(), ...extra }));
      made.push(folder);
      return folder;
    };
    const land = { kind: "land", state: "failed", reason: "merge conflict", conflicts: ["x.txt"] };
    const pending = run("fheldland", { ...land, next: "worker", ended: new Date().toISOString() });
    expect((await aleph(["dispatch"])).json.held).toBeUndefined();
    writeFileSync(join(pending, "state.json"), JSON.stringify({ ...state(pending.split("/").pop()!), next: undefined }));
    expect((await aleph(["dispatch"])).json.held).toContain("Held: fheldland is failed");
    // a stuck run whose unit is still live does not hold; once the unit ends, it does
    const live = run("fstuck", { state: "stuck", reason: "tests" });
    const unit = Bun.spawn(["sh", "-c", "sleep 60", live], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(live, "pid"), String(unit.pid));
    expect((await aleph(["dispatch"])).json.held).not.toContain("fstuck");
    unit.kill();
    await unit.exited;
    writeFileSync(join(live, "exit"), "0\n");
    expect((await aleph(["dispatch"])).json.held).toContain("Held: fheldland and 1 more are");
    for (const f of made) rmSync(f, { recursive: true, force: true });
      })();
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);
});
