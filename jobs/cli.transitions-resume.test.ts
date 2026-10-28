import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, state as stateOf, setup, teardown, dispatching, starting, unitAlive, until } from "./cli.helpers";

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
  const add = async (title: string, action: string, extra: string[] = [], env: Record<string, string> = {}) =>
    (await aleph(["todo", "add", "fac", title, ...extra, "--body", "-"], on(env), `ACTION: ${action}\n`)).json.added as number;
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
      expect((await aleph(["todo", "drop", "fac", String(id), "test over"])).code).toBe(0);
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

  test("a recheck that clears the factory hold starts the next goal", async () => {
    // The hold is what this test is about: the safe default actions would release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      await (async () => {
    const s = track(await add("ends stuck", "commit FAIL", ["--labels", "goal"], { ALEPH_FIX_ROUNDS: "0" }));
    await until(() => runs(s).some((r) => ["stuck", "failed"].includes(state(r).state)));
    const b = track(await add("held behind it", open("hold-b"), ["--labels", "goal"]));
    await Bun.sleep(1500);
    expect(started()).toEqual([`fac-${s}`]);
    // The recheck is a live run, so the hold no longer counts; the dispatch must not wait for its end.
    const slow = join(base, "slowbase");
    writeFileSync(slow, "");
    try {
      expect((await aleph(["recheck", `fac-${s}`], on())).code).toBe(0);
      await until(() => started().includes(`fac-${b}`));
    } finally {
      rmSync(slow, { force: true });
    }
      })();
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 90_000);

  test("a resume starts the goals that waited for it", async () => {
    await aleph(["pause"]);
    const x = track(await add("added while paused", open("resume"), ["--labels", "goal"]));
    await Bun.sleep(1000);
    expect(started()).toEqual([]);
    await aleph(["resume"], on());
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("a due date in the future starts nothing until a tick after that date", async () => {
    const x = track(await add("due later", open("due"), ["--labels", "goal", "--due", "2026-12-01"], { ALEPH_NOW: "2026-10-27T12:00:00" }));
    await aleph(["dispatch"], on({ ALEPH_NOW: "2026-10-27T12:00:00" }));
    await Bun.sleep(1500);
    expect(started()).toEqual([]);
    expect((await aleph(["tick"], on({ ALEPH_NOW: "2026-11-30T12:00:00" }))).json.started).toEqual([]);
    expect((await aleph(["tick"], on({ ALEPH_NOW: "2026-12-01T08:00:00" }))).json.started).toEqual([`fac-${x}`]);
  }, 60_000);
});
