import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLI, aleph, env, base, jobsDir, state as stateOf, setup, teardown } from "./cli.helpers";

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

  test("a land that lands starts the goal that waits on that job", async () => {
    const a = track(await add("lands first", "commit tr/a.txt", ["--labels", "goal"]));
    await until(() => started().includes(`fac-${a}`));
    await until(() => settled(a) && runs(a).some((r) => state(r).state === "passed"));
    const b = track(await add("waits on the first", open("land"), ["--labels", "goal", "--waiting-on", `fac-${a}`]));
    await Bun.sleep(1000);
    expect(started()).not.toContain(`fac-${b}`);
    const l = await aleph(["land", `fac-${a}`], on());
    expect(l.code).toBe(0);
    await until(() => started().includes(`fac-${b}`));
  }, 90_000);

  test("an edit that adds the goal label starts the goal", async () => {
    const x = track(await add("plain issue", open("label"), ["--labels", "needs-chris"]));
    await Bun.sleep(500);
    expect(started()).toEqual([]);
    expect((await aleph(["todo", "edit", "fac", String(x), "--labels", "goal"], on())).code).toBe(0);
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("an edit that removes waiting_on starts the goal", async () => {
    const blocker = track(await add("never done", "commit tr/never.txt", ["--labels", "needs-chris"]));
    const x = track(await add("waits", open("wait"), ["--labels", "goal", "--waiting-on", `fac-${blocker}`]));
    await Bun.sleep(1000);
    expect(started()).toEqual([]);
    await aleph(["todo", "edit", "fac", String(x), "--waiting-on", "none"], on());
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("an edit that sets the status back to open starts the goal", async () => {
    const x = track(await add("dropped, then reopened", open("reopen"), ["--labels", "goal"], { ALEPH_DISPATCH: "off" }));
    await aleph(["todo", "drop", "fac", String(x), "not now"]);
    await Bun.sleep(300);
    expect(started()).toEqual([]);
    expect((await aleph(["todo", "edit", "fac", String(x), "--status", "open"], on())).code).toBe(0);
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("the issue form (POST /api/issues) adds a goal that starts at once", async () => {
    const title = "from the form";
    const issues = await import("../ui/api/issues.ts");
    const create = issues.routes["POST /api/issues"];
    const saved = { ...process.env };
    Object.assign(process.env, env(on()));
    const req = new Request("http://x/api/issues", { method: "POST", headers: { "x-aleph-ui": "1" }, body: JSON.stringify({ repo: "fac", title, labels: "goal", body: `ACTION: ${open("form")}` }) });
    const res = await create(req, {}, new URL(req.url));
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    expect(res.status).toBe(200);
    track(((await res.json()) as any).added);
    await until(() => started().length === 1);
  }, 60_000);

  test("a triage run that ends with a goal starts it", async () => {
    const x = track(await add("vague", open("triage"), ["--labels", "followup"], { ALEPH_DISPATCH: "off" }));
    const cmd = join(base, "ttriage-cmd");
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"verdict":"goal","body":"ACTION: hold ${gate("triage")}"}'\n`, { mode: 0o755 });
    const t = await aleph(["triage", `fac-${x}`], on({ ALEPH_TRIAGE_CMD: cmd }));
    expect(t.json.triaged).toEqual({ goal: 1 });
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

  test("a drop that frees a live slot starts the next goal", async () => {
    const a = track(await add("holds the slot", open("slot-a"), ["--labels", "goal"], { ALEPH_LIVE_CAP: "1" }));
    await until(() => started().includes(`fac-${a}`));
    const b = track(await add("needs the slot", open("slot-b"), ["--labels", "goal"], { ALEPH_LIVE_CAP: "1" }));
    await Bun.sleep(1500);
    expect(started()).toEqual([`fac-${a}`]);
    expect((await aleph(["drop", `fac-${a}`], on({ ALEPH_LIVE_CAP: "1" }))).code).toBe(0);
    await until(() => started().includes(`fac-${b}`));
  }, 60_000);

  test("a drop that frees a waiting slot starts the next goal", async () => {
    const q = track(await add("asks Chris", "commit held/w.txt", ["--labels", "goal"], { ALEPH_WAITING_CAP: "1" }));
    await until(() => runs(q).some((r) => state(r).state === "needs-you"));
    const b = track(await add("needs the waiting slot", open("wait-b"), ["--labels", "goal"], { ALEPH_WAITING_CAP: "1" }));
    await Bun.sleep(1500);
    expect(started()).toEqual([`fac-${q}`]);
    await aleph(["drop", `fac-${q}`], on({ ALEPH_WAITING_CAP: "1" }));
    await until(() => started().includes(`fac-${b}`));
  }, 60_000);

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
