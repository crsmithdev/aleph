import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, stateNow as state, setup, teardown, dispatching, starting, unitAlive, until, addOld, patchItem, seedItem } from "./cli.helpers";

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
  const settled = (id: number) => !starting(startLog) && runs(id).every((r) => state(r).condition !== "running" && !unitAlive(join(jobsDir, r)));
  const add = (title: string, action: string, extra: string[] = [], env: Record<string, string> = {}) => addOld(title, action, extra, on(env));
  // An old-shape goal, seeded: no verb of `aleph issue` writes one. `aleph dispatch` starts it.
  const seed = async (title: string, action: string, fm: Record<string, unknown> = { kind: "goal" }, env: Record<string, string> = {}) => {
    const id = seedItem("fac", title, fm, `ACTION: ${action}`);
    await aleph(["dispatch"], on(env));
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

  test("an edit that sets the status back to open starts the goal", async () => {
    // A dispatch left by an earlier test's run may still be alive. It starts any open goal it sees, so the
    // goal is seeded already dropped.
    const x = track(await seed("dropped, then reopened", open("reopen"), { kind: "goal", status: "dropped" }, { ALEPH_DISPATCH: "off" }));
    await Bun.sleep(300);
    expect(started()).toEqual([]);
    expect((await aleph(["issue", "edit", "fac", String(x), "--status", "open"], on())).code).toBe(0);
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("a drop's rerun waits while the issue waits on an open item", async () => {
    const blocker = track(await add("holds the line", open("blocker"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${blocker}`));
    const a = track(await add("starts first", open("waiter"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${a}`));
    patchItem("fac", a, { after: [`fac-${blocker}`] });
    expect((await aleph(["drop", `fac-${a}`, "waits now"], on())).code).toBe(0);
    await Bun.sleep(2000);
    expect(started().filter((n) => n === `fac-${a}`)).toEqual([`fac-${a}`]);
    // A dispatch from any other path holds it too.
    await aleph(["dispatch"], on());
    expect(started().filter((n) => n === `fac-${a}`)).toEqual([`fac-${a}`]);
  }, 60_000);

  test("a rerun's prompt holds the reasons of the earlier drops and the issue's notes", async () => {
    const a = track(await add("steered", open("steer"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${a}`));
    await aleph(["issue", "note", "fac", String(a), "mind the sliced list"]);
    expect((await aleph(["drop", `fac-${a}`, "the card counts the sliced list"], on())).code).toBe(0);
    await until(() => started().length === 2);
    const prompts = () => runs(a).map((r) => join(jobsDir, r, "prompt.md")).filter(existsSync).map((f) => readFileSync(f, "utf8"));
    await until(() => prompts().length === 2);
    // Folder names have one-second precision and readdir has no order: find the rerun by its content.
    const [second, ...rest] = prompts().filter((p) => p.includes("the card counts the sliced list"));
    expect(rest).toEqual([]);
    expect(second).toBeDefined();
    expect(second).toContain("the card counts the sliced list");
    expect(second).toContain("mind the sliced list");
    expect(second.indexOf("ACTION:")).toBeLessThan(second.indexOf("the card counts the sliced list"));
  }, 60_000);

  test("a recheck that clears the factory hold starts the next goal", async () => {
    // The hold is what this test is about: the safe default actions would release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      // gate/x makes the gate check run first, before the tests check that fails on FAIL.
      const s = track(await add("ends stuck", "commit-all FAIL gate/x", ["--labels", "goal"], { ALEPH_FIX_ROUNDS: "0" }));
      await until(() => runs(s).some((r) => ["stuck", "failed"].includes(state(r).condition)));
      const b = track(await add("held behind it", open("hold-b"), ["--labels", "goal"]));
      await Bun.sleep(1500);
      expect(started()).toEqual([`fac-${s}`]);
      // The recheck is a live run, so the hold no longer counts; the dispatch must not wait for its end.
      const hold = join(base, "gate-hold");
      writeFileSync(hold, "");
      try {
        // The gate check holds the recheck live until its dispatch has started the goal. A loaded dispatch that boots after the recheck ended meets the hold again.
        const recheck = aleph(["recheck", `fac-${s}`], on());
        await until(() => started().includes(`fac-${b}`));
        rmSync(hold, { force: true });
        expect((await recheck).code).toBe(1);
      } finally {
        rmSync(hold, { force: true });
      }
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 90_000);
});
