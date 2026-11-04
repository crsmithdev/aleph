import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, stateNow as state, setup, teardown, dispatching, starting, unitAlive, until, addOld, seedItem } from "./cli.helpers";
import { dispatch, drop, issueClose } from "./inproc";

beforeAll(setup);
afterAll(teardown);

// Every transition dispatches at once: none of these tests runs `aleph tick`. The dispatch is on, the
// timer is not, so a run that starts did so from the process call or its detached dispatch. The edit keeps its CLI
// test: the dispatch after an edit is started by jobs/cli.ts. The other transitions are called in-process.
describe("every transition dispatches at once", () => {
  let startLog: string, startCmd: string;
  const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
  const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
  const gate = (n: string) => join(base, `tgate-${n}`);
  const runs = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`));
  // Settled: no start is in flight (its run folder may not be there yet), and every run has ended and its unit,
  // with its run-end dispatch, has exited.
  const settled = (id: number) => !starting(startLog) && runs(id).every((r) => state(r).condition !== "running" && !unitAlive(join(jobsDir, r)));
  // addOld's item, then the dispatch that `add` ran, in-process.
  const add = async (title: string, action: string, extra: string[] = [], env: Record<string, string> = {}) => {
    const id = await addOld(title, action, extra, { ALEPH_DISPATCH: "off" });
    await dispatch(on(env));
    return id;
  };
  // An old-shape goal, seeded: no verb of `aleph issue` writes one. `aleph dispatch` starts it.
  const seed = async (title: string, action: string, fm: Record<string, unknown> = { kind: "goal" }, env: Record<string, string> = {}) => {
    const id = seedItem("fac", title, fm, `ACTION: ${action}`);
    await dispatch(on(env));
    return id;
  };
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
      expect((await issueClose("fac", id, "drop", "test over")).code).toBe(0);
      // A job that passed, landed or was dropped has no open job to drop. Any other refusal leaves it open,
      // and a stuck or failed one holds every later dispatch.
      const d = await drop(`fac-${id}`);
      if (d.code !== 0) expect(d.stderr).toContain("no open job");
      await until(() => settled(id));
    }
    // A detached dispatch from this test may still hold a lock that the next test's dispatch meets.
    await until(() => !dispatching());
    rmSync(startLog, { force: true });
  }, 120_000);

  test("an edit that sets the status back to open starts the goal", async () => {
    // A dispatch left by an earlier test's run may still be alive. It starts any open goal it sees, so the
    // goal is seeded already dropped.
    const x = track(await seed("dropped, then reopened", open("reopen"), { kind: "goal", status: "dropped" }, { ALEPH_DISPATCH: "off" }));
    await until(() => !dispatching());
    expect(started()).toEqual([]);
    expect((await aleph(["issue", "edit", "fac", String(x), "--status", "open"], on())).code).toBe(0);
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("a stuck run holds only its own goal: the next goal starts beside it", async () => {
    // The safe default actions would release the run; without them it stays stuck.
    process.env.ALEPH_RESCUE = "off";
    try {
      const s = track(await add("ends stuck", "commit-all FAIL gate/x", ["--labels", "goal"], { ALEPH_FIX_ROUNDS: "0" }));
      await until(() => runs(s).some((r) => ["stuck", "failed"].includes(state(r).condition)));
      const b = track(await add("starts beside it", open("hold-b"), ["--labels", "goal"]));
      await until(() => started().includes(`fac-${b}`));
      expect(started()).toEqual([`fac-${s}`, `fac-${b}`]);
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 90_000);
});
