import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, file, repo, sh, specFile, state, told, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];


  test("the worker's branch comes back as a bundle; the run passes and its run folder is gone", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", condition: "passed", branch: "factory/fpass", cost: 0.01, defaults: [] });
    expect(s.worktree).toBeUndefined();
    expect(factoryBranch("fpass")).toBe(true);
    expect(sh(repo, "git", "log", "-1", "--format=%s", "factory/fpass")).toBe("add fpass.txt");
    expect(runsLeft()).toEqual([]);
    expect(file(r.json.run, "prompt.md")).toContain("inside\na sandbox");
    expect(s.checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
  });

  test("the sandbox's environment holds the worker token and nothing of Chris's", () => {
    const env = readFileSync(join(fakeLog, "env"), "utf8");
    expect(env).toContain("CLAUDE_CODE_OAUTH_TOKEN=tok-123");
    expect(env).toMatch(/^HOME=.*\/runs\/.*\/home$/m);
    expect(env).not.toMatch(/^(ALEPH_(?!TEST_PARALLEL=)[A-Z_]+|SIDETONE_[A-Z_]+|GIT_AUTHOR_NAME|XDG_RUNTIME_DIR)=/m);
  });

  test("an error result, no result, a line after the result, or no commit ends stuck", async () => {
    expect(state((await fjob("ferr", "error")).json.run)).toMatchObject({ condition: "stuck", reason: "API Error: 500" });
    expect(state((await fjob("fnone", "noresult")).json.run)).toMatchObject({ condition: "stuck", reason: expect.stringContaining('"type":"assistant"') });
    expect(state((await fjob("ftrail", "trailing")).json.run)).toMatchObject({ condition: "stuck", reason: "one more line" });
    expect(state((await fjob("fidle", "none")).json.run)).toMatchObject({ condition: "stuck", reason: "no commit" });
    expect(told).toContain("fac/ferr stuck");
    for (const n of ["ferr", "fnone", "ftrail", "fidle"]) await aleph(["drop", n]);
  });

  test("a worker that says the goal is already met, with the checks green on main, closes the item", async () => {
    const id = (await aleph(["issue", "add", "fac", "timeline already uses itemTimes"])).json.added;
    const r = await fjob("fmet", "already-met", {}, ["--on", String(id)]);
    expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "no commit" });
    // A tick's probe runs the sandbox; a passing probe is written as the other tick tests do.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const tick = await aleph(["tick"]);
    expect(tick.json.episodes).toEqual(expect.any(Array));
    expect(state(r.json.run)).toMatchObject({ condition: "dropped", reason: expect.stringContaining("the item is done") });
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  }, 60_000);

});

describe("a worker's FOLLOWUP line (criterion 15)", () => {
  test("a line on the topic of an open issue is a note on it, and files no issue", async () => {
    const titles = async () => (await aleph(["issue", "list", "fac", "--json"])).json as any[];
    await aleph(["issue", "add", "fac", "paint the fence"]);
    const open = (await titles()).find((i) => i.title === "paint the fence");
    const count = (await titles()).length;
    const r = await aleph(["job", "fac", "fsame", "--spec", specFile("Goal: fsame\nACTION: defaults\n")]);
    expect(r.code, r.stderr).toBe(0);
    expect((await titles()).length).toBe(count);
    expect(JSON.stringify((await aleph(["issue", "show", "fac", String(open.id), "--json"])).json)).toContain("also met in run fsame: paint the fence");
    await aleph(["issue", "done", "fac", String(open.id), "test over"]);
    await aleph(["drop", "fsame"]);
  });

  test("a FOLLOWUP line about a flake is a tracker note and files no issue", async () => {
    const titles = async () => (await aleph(["issue", "list", "fac", "--json"])).json as any[];
    const line = "Fix the flaky paint test in a.test.ts";
    expect((await aleph(["job", "fac", "fflakeup", "--spec", specFile(`Goal: fflakeup\nACTION: flake-followup\n`)])).code).toBe(0);
    const all = await titles();
    expect(all.map((i) => i.title)).not.toContain(line);
    const tracker = all.find((i) => i.areas.includes("flakes"));
    expect((await aleph(["issue", "show", "fac", String(tracker.id), "--json"])).json.notes.join("\n")).toContain(`job fflakeup: ${line}`);
  }, 60_000);
});
