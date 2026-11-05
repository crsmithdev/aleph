import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeLog, file, repo, sh, state, told, setup, teardown, worktree } from "../../cli.helpers";
import { actionJob, drop, issueAdd, issueClose, issueList, issueShow } from "../../inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string) => actionJob(name, action, {}, "fac");
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  /** The worktrees of the repo outside its .worktrees folder: the detached ones of the checks and the reviewer. */
  const detached = () => sh(repo, "git", "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ") && !l.includes("/.worktrees/") && l !== `worktree ${repo}`);

  test("the worker commits on its branch in the job's worktree; the checks and the reviewer run in worktrees that go after", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", condition: "passed", branch: "factory/fpass", worktree: worktree("fpass"), cost: 0.01, defaults: [] });
    expect(factoryBranch("fpass")).toBe(true);
    expect(sh(worktree("fpass"), "git", "symbolic-ref", "--short", "HEAD")).toBe("factory/fpass");
    expect(sh(repo, "git", "log", "-1", "--format=%s", "factory/fpass")).toBe("add fpass.txt");
    expect(detached()).toEqual([]);
    expect(file(r.json.run, "prompt.md")).toContain(`in \`${worktree("fpass")}\`, branch \`factory/fpass\`.\nWork only there.`);
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--disable-slash-commands --tools Read Write Edit Bash Grep Glob");
    expect(s.checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
  });

  test("the worker's environment cannot push to github or reach gh, and has no API key", () => {
    const env = readFileSync(join(fakeLog, "env"), "utf8");
    expect(env).toContain("GIT_CONFIG_VALUE_0=git@github.com:\n");
    expect(env).toMatch(/^GH_CONFIG_DIR=.*\/gh$/m);
    expect(env).not.toMatch(/^(ANTHROPIC_API_KEY|GH_TOKEN|GITHUB_TOKEN|CLAUDECODE)=./m);
  });

  test("an error result, no result, a line after the result, or no commit ends stuck", async () => {
    expect(state((await fjob("ferr", "error")).json.run)).toMatchObject({ condition: "stuck", reason: "API Error: 500" });
    expect(state((await fjob("fnone", "noresult")).json.run)).toMatchObject({ condition: "stuck", reason: expect.stringContaining('"type":"assistant"') });
    expect(state((await fjob("ftrail", "trailing")).json.run)).toMatchObject({ condition: "stuck", reason: "one more line" });
    expect(state((await fjob("fidle", "none")).json.run)).toMatchObject({ condition: "stuck", reason: "no commit" });
    expect(state((await fjob("fnoout", "nostructured")).json.run)).toMatchObject({ condition: "stuck", reason: "worker: no structured output" });
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--json-schema");
    expect(told).toContain("ferr stuck");
    for (const n of ["ferr", "fnone", "ftrail", "fidle", "fnoout"]) await drop(n);
  });
});

describe("a worker's FOLLOWUP line (criterion 15)", () => {
  const titles = async () => (await issueList("fac")).json as any[];

  test("a line on the topic of an open issue is a note on it, and files no issue", async () => {
    await issueAdd("fac", "paint the fence");
    const open = (await titles()).find((i) => i.title === "paint the fence");
    const count = (await titles()).length;
    const r = await actionJob("fsame", "defaults", {}, "fac");
    expect(r.code, r.stderr).toBe(0);
    expect((await titles()).length).toBe(count);
    expect(JSON.stringify((await issueShow("fac", open.id)).json)).toContain("also met in run fsame: paint the fence");
    await issueClose("fac", open.id, "done", "test over");
    await drop("fsame");
  });

  test("a FOLLOWUP line about a flake is a tracker note and files no issue", async () => {
    const line = "Fix the flaky paint test in a.test.ts";
    expect((await actionJob("fflakeup", "flake-followup", {}, "fac")).code).toBe(0);
    const all = await titles();
    expect(all.map((i) => i.title)).not.toContain(line);
    const tracker = all.find((i) => i.tracker);
    expect((await issueShow("fac", tracker.id)).json.notes.join("\n")).toContain(`job fflakeup: ${line}`);
  }, 60_000);
});
