import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, diagnose, dispatching, file, jobsDir, specFile, state, stateNow, setup, teardown, unitAlive, until, seedItem } from "./cli.helpers";

// setup spawns openssl and git, so it can outlast the 5 s bun default; bun run test uses 30 s.
beforeAll(setup, 30_000);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  test("a run held for a held path is awaiting, with an approval ask and no needs; aleph jobs still lists it as needs-you held", async () => {
    // No background review: it would rewrite the run's reason.
    const r = await aleph(["job", "fac", "rheldpath", "--spec", specFile("Goal: rheldpath\nACTION: commit held/rp.txt\n")], { ALEPH_REVIEW_CMD: "/bin/false" });
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", state: "awaiting", ask: { kind: "approval", reason: "held-path" } });
    expect(s.needs).toBeUndefined();
    const listed = (await aleph(["jobs"])).json.find((j: any) => j.name === "rheldpath");
    expect(listed).toMatchObject({ state: "needs-you", needs: "held" });
    await aleph(["drop", "rheldpath"]);
  });
  test("a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      await (async () => {
    // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const stuckId = seedItem("fac", "the stuck one", { labels: ["goal"] }, "ACTION: error\n".trim());
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${stuckId}`]);
    const id = seedItem("fac", "behind the hold", { labels: ["goal"] }, "ACTION: commit behind.txt\n".trim());
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
    await aleph(["issue", "drop", "fac", String(stuckId), "test over"]);
    await aleph(["pause"]);
    expect((await aleph(["dispatch"])).json).toMatchObject({ paused: true });
    await aleph(["resume"]);
    const free = await aleph(["dispatch"]);
    expect(free.json.held).toBeUndefined();
    expect(free.json.landed).toEqual(["fheld"]);
    expect(free.json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", `fac-${id}`]);
    await aleph(["issue", "drop", "fac", String(id), "test over"]);
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
    // The first test leaves a dropped run, a landed one and maybe a detached dispatch: let them end, so no run but ours is open.
    await until(() => !dispatching() && readdirSync(jobsDir).every((r) => stateNow(r).state !== "running" && !unitAlive(join(jobsDir, r))));
    const seen = async (label: string) => diagnose(`${label}: runs ${readdirSync(jobsDir).map((r) => `${r}=${stateNow(r).state}`).join(", ")}`, []);
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
    const d1 = await aleph(["dispatch"]);
    expect(d1.json.held, await seen(`line 76: ${d1.stdout}`)).toBeUndefined();
    writeFileSync(join(pending, "state.json"), JSON.stringify({ ...state(pending.split("/").pop()!), next: undefined }));
    const d2 = await aleph(["dispatch"]);
    expect(d2.json.held, await seen(`line 78: ${d2.stdout}`)).toContain("Held: fheldland is failed");
    // a stuck run whose unit is still live does not hold; once the unit ends, it does
    const live = run("fstuck", { state: "stuck", reason: "tests" });
    const unit = Bun.spawn(["sh", "-c", "sleep 60; :", live], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(live, "pid"), String(unit.pid));
    expect(unitAlive(live)).toBe(true);
    const d3 = await aleph(["dispatch"]);
    // the hold line names only the oldest holder, so the live run must not be counted in "and N more"
    expect(d3.json.held, await seen(`line 83: ${d3.stdout}`)).toContain("Held: fheldland is failed");
    expect(d3.json.held).not.toContain("fstuck");
    unit.kill();
    await unit.exited;
    writeFileSync(join(live, "exit"), "0\n");
    const d4 = await aleph(["dispatch"]);
    expect(d4.json.held, await seen(`line 87: ${d4.stdout}`)).toContain("Held: fheldland and 1 more are");
    for (const f of made) rmSync(f, { recursive: true, force: true });
      })();
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);
});
