import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, issueRuns, jobsDir, now, startScript, stateNow as state, state as record, setup, teardown, idle, when, addOld, seedItem } from "./cli.helpers";
import { dispatch, drop, issueClose } from "./flow.testkit.ts";
import { hookLines } from "./lib/transitions/factory.ts";
import { patchRun } from "./lib/records/record.ts";

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
  const runs = (id: number) => issueRuns(id);
  // addOld's item, then the dispatch that `add` ran, in-process.
  const add = async (title: string, action: string, extra: string[] = [], env: Record<string, string> = {}) => {
    const id = await addOld(title, action, extra, { ALEPH_DISPATCH: "off" });
    await dispatch(on(env));
    return id;
  };
  // An old-shape issue, seeded: no verb of `aleph issue` writes one. `aleph dispatch` starts it.
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
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date(now).toISOString(), ok: true, failed: [] }));
    startLog = join(base, "tstart.log");
    startCmd = join(base, "tstart-cmd");
    startScript(startCmd, jobsDir);
  });
  beforeEach(async () => {
    rmSync(startLog, { force: true });
    // What an earlier test left: release its holds, then close its jobs and issues.
    for (const g of gates) writeFileSync(gate(g), "");
    for (const id of ids.splice(0)) {
      await idle(startLog);
      // The issue goes first: while it is open and has no live job, a detached dispatch can rerun it.
      expect((await issueClose("fac", id, "drop", "test over")).code).toBe(0);
      // A job that passed, landed or was dropped has no open job to drop. Any other refusal leaves it open,
      // and a stuck or failed one holds every later dispatch.
      const d = await drop(`fac-${id}`);
      if (d.code !== 0) expect(d.stderr).toContain("no open job");
      await idle(startLog);
    }
    // A detached dispatch from this test may still hold a lock that the next test's dispatch meets.
    await idle(startLog);
    rmSync(startLog, { force: true });
  }, 120_000);

  test("an edit that sets the status back to open starts the issue", async () => {
    // A dispatch left by an earlier test's run may still be alive. It starts any open issue it sees, so the
    // issue is seeded already dropped.
    const x = track(await seed("dropped, then reopened", open("reopen"), { kind: "goal", status: "dropped" }, { ALEPH_DISPATCH: "off" }));
    await idle(startLog);
    expect(started()).toEqual([]);
    expect((await aleph(["issue", "edit", "fac", String(x), "--status", "open"], on())).code).toBe(0);
    await when(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("a stuck run holds only its own issue: the next issue starts beside it", async () => {
    // The safe default actions would release the run; without them it stays stuck.
    const rescue = process.env.ALEPH_RESCUE;
    process.env.ALEPH_RESCUE = "off";
    try {
      const s = track(await add("ends stuck", "commit-all FAIL gate/x", ["--labels", "goal"], { ALEPH_FIX_ROUNDS: "0" }));
      await idle(startLog);
      expect(runs(s).some((r) => ["stuck", "failed"].includes(state(r).condition))).toBe(true);
      const b = track(await add("starts beside it", open("hold-b"), ["--labels", "goal"]));
      await when(() => started().includes(`fac-${b}`));
      expect(started()).toEqual([`fac-${s}`, `fac-${b}`]);
    } finally {
      if (rescue === undefined) delete process.env.ALEPH_RESCUE;
      else process.env.ALEPH_RESCUE = rescue;
    }
  }, 90_000);

  test("dropping an issue drops its open job, so its Ask stops waiting for Chris", async () => {
    const x = track(await seed("dropped with its job", open("drop-with"), { kind: "goal" }));
    await when(() => started().includes(`fac-${x}`));
    // The held run waits on an Ask, as a job that needs Chris does.
    const [run] = runs(x);
    patchRun(run, { condition: "waiting", ask: { kind: "approval", reason: "held-path", question: "A or B?", options: [{ label: "A", line: "do a" }], recommended: "A", why: ["w"] } });
    expect(hookLines().join("\n")).toContain(`fac-${x}`);
    expect((await issueClose("fac", x, "drop", "not needed")).code).toBe(0);
    expect(state(run).condition).toBe("dropped");
    expect(record(run).reason).toBe(`issue fac-${x} was dropped`);
    const again = await drop(`fac-${x}`);
    expect(again.code).not.toBe(0);
    expect(again.stderr).toContain("no open job");
    expect(hookLines().join("\n")).not.toContain(`fac-${x}`);
  }, 60_000);

  test("parking an issue drops its open job, so it cannot land", async () => {
    const x = track(await seed("parked with its job", open("park-with"), { kind: "goal" }));
    await when(() => started().includes(`fac-${x}`));
    const [run] = runs(x);
    expect((await aleph(["issue", "edit", "fac", String(x), "--status", "parked"], on())).code).toBe(0);
    expect(state(run).condition).toBe("dropped");
    expect(record(run).reason).toBe(`issue fac-${x} was parked`);
    const again = await drop(`fac-${x}`);
    expect(again.code).not.toBe(0);
    expect(again.stderr).toContain("no open job");
  }, 60_000);
});
