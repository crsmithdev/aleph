import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, env, base, jobsDir, startScript, stateNow as state, setup, teardown, dispatching, starting, unitAlive, until } from "./cli.helpers";

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
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"verdict":"goal","title":"Hold","body":"## Request\\nx\\nACTION: hold ${gate("triage")}"}'\n`, { mode: 0o755 });
    const t = await aleph(["triage", `fac-${x}`], on({ ALEPH_TRIAGE_CMD: cmd }));
    expect(t.json.triaged).toEqual({ goal: 1 });
    await until(() => started().includes(`fac-${x}`));
  }, 60_000);

});
