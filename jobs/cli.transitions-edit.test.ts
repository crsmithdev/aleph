import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, state as stateOf, setup, teardown, dispatching, starting, unitAlive, until, seedItem } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

// Every transition dispatches at once: none of these tests runs `aleph tick`. The dispatch is on, the
// timer is not, so a run that starts did so from the process call or its detached dispatch.
describe("every transition dispatches at once", () => {
  let startLog: string, startCmd: string;
  const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
  const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
  const gate = (n: string) => join(base, `tgate-${n}`);
  const runs = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`));
  // Settled: no start is in flight (its run folder may not be there yet), and every run has ended and its unit,
  // with its run-end dispatch, has exited.
  const settled = (id: number) => !starting(startLog) && runs(id).every((r) => state(r).state !== "running" && !unitAlive(join(jobsDir, r)));
  // An old-shape goal, seeded: no verb of `aleph issue` writes one. `aleph dispatch` starts it; the transitions below are what these tests check.
  const add = async (title: string, action: string, fm: Record<string, unknown> = { labels: ["goal"] }, env: Record<string, string> = {}) => {
    const id = seedItem("fac", title, fm, `ACTION: ${action}`);
    await aleph(["dispatch"], on(env));
    return id;
  };
  // A run's folder exists a moment before its state.json.
  const state = (r: string) => { try { return stateOf(r); } catch { return { state: "" }; } };
  const gates = new Set<string>();
  const open = (name: string) => { gates.add(name); return `hold ${gate(name)}`; };
  const ids: number[] = [];
  const track = (id: number) => { ids.push(id); return id; };
  beforeAll(() => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    startLog = join(base, "tstart.log");
    startCmd = join(base, "tstart-cmd");
    startScript(startCmd, jobsDir);
  });
  beforeEach(async () => {
    rmSync(startLog, { force: true });
    // What an earlier test left: release its holds, then close its jobs and issues.
    for (const g of gates) writeFileSync(gate(g), "");
    for (const id of ids.splice(0)) {
      await until(() => settled(id));
      // The issue goes first: while it is open and has no live job, a detached dispatch can rerun it.
      expect((await aleph(["issue", "drop", "fac", String(id), "test over"])).code).toBe(0);
      // A job that passed, landed or was dropped has no open job to drop. Any other refusal leaves it open,
      // and a stuck or failed one holds every later dispatch.
      const d = await aleph(["drop", `fac-${id}`]);
      if (d.code !== 0) expect(d.stderr).toContain("no open job");
      await until(() => settled(id));
    }
    // A detached dispatch from this test may still hold a lock that the next test's dispatch meets.
    await until(() => !dispatching());
    await Bun.sleep(300);
    rmSync(startLog, { force: true });
  }, 120_000);

  test("a land that lands starts the goal that waits on that job", async () => {
    const a = track(await add("lands first", "commit tr/a.txt", { labels: ["goal"] }));
    await until(() => started().includes(`fac-${a}`));
    await until(() => settled(a) && runs(a).some((r) => state(r).state === "passed"));
    const b = track(await add("waits on the first", open("land"), { labels: ["goal"], waiting_on: `fac-${a}` }));
    await Bun.sleep(1000);
    expect(started()).not.toContain(`fac-${b}`);
    const l = await aleph(["land", `fac-${a}`], on());
    expect(l.code).toBe(0);
    await until(() => started().includes(`fac-${b}`));
  }, 90_000);

  test("an edit that sets the status back to open starts the goal", async () => {
    // A dispatch left by an earlier test's run may still be alive. It starts any open goal it sees, so the
    // goal is seeded already dropped.
    const x = track(await add("dropped, then reopened", open("reopen"), { labels: ["goal"], status: "dropped" }, { ALEPH_DISPATCH: "off" }));
    await Bun.sleep(300);
    expect(started()).toEqual([]);
    expect((await aleph(["issue", "edit", "fac", String(x), "--status", "open"], on())).code).toBe(0);
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);
});
