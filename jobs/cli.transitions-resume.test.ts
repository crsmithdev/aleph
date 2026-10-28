import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, aleph, base, jobsDir, state as stateOf, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

// Every transition dispatches at once: none of these tests runs `aleph tick`. The dispatch is on, the
// timer is not, so a run that starts did so from the process call or its detached dispatch.
describe("every transition dispatches at once", () => {
  let startLog: string, startCmd: string;
  const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
  const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
  const gate = (n: string) => join(base, `tgate-${n}`);
  const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100); expect(f()).toBe(true); };
  const runs = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`));
  const settled = (id: number) => runs(id).every((r) => state(r).state !== "running");
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
    writeFileSync(startCmd, `#!/bin/bash\necho "$2" >> "$START_LOG"\nALEPH_JOB_FOREGROUND=1 bun ${CLI} job "$1" "$2" --spec - --todo "$3" > /dev/null 2>&1 < /dev/stdin &\nfor i in $(seq 100); do ls ${jobsDir}/*-fac-"$2"-*/pid > /dev/null 2>&1 && exit 0; sleep 0.1; done\n`, { mode: 0o755 });
  });
  beforeEach(async () => {
    rmSync(startLog, { force: true });
    // What an earlier test left: release its holds, then close its jobs and issues.
    for (const g of gates) writeFileSync(gate(g), "");
    for (const id of ids.splice(0)) {
      await until(() => settled(id));
      await aleph(["drop", `fac-${id}`]);
      await aleph(["todo", "drop", "fac", String(id), "test over"]);
    }
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
