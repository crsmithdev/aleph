// Archived goal tests from jobs/cli.transitions.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, jobsDir, startScript, stateNow as state, setup, teardown, dispatching, starting, unitAlive, until, addOld, patchItem } from "../../jobs/cli.helpers";
import { dispatch, drop, issueClose, issueNote } from "../../jobs/inproc";

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

  test("a drop's rerun waits while the issue waits on an open item", async () => {
    const blocker = track(await add("holds the line", open("blocker"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${blocker}`));
    const a = track(await add("starts first", open("waiter"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${a}`));
    patchItem("fac", a, { after: [`fac-${blocker}`] });
    expect((await drop(`fac-${a}`, "waits now", false, on())).code).toBe(0);
    // The drop's detached dispatch and the dropped unit's run-end dispatch have both ended.
    await until(() => settled(a) && !dispatching());
    expect(started().filter((n) => n === `fac-${a}`)).toEqual([`fac-${a}`]);
    // A dispatch from any other path holds it too.
    await dispatch(on());
    expect(started().filter((n) => n === `fac-${a}`)).toEqual([`fac-${a}`]);
  }, 60_000);

  test("a rerun's prompt holds the reasons of the earlier drops and the issue's notes", async () => {
    const a = track(await add("steered", open("steer"), ["--labels", "goal"]));
    await until(() => started().includes(`fac-${a}`));
    await issueNote("fac", a, "mind the sliced list");
    expect((await drop(`fac-${a}`, "the card counts the sliced list", false, on())).code).toBe(0);
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
});
