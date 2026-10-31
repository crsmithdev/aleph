import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, file, remote, repo, sh, specFile, state, told, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];


  test("the worker's branch comes back as a bundle; the run passes and its run folder is gone", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", state: "passed", branch: "factory/fpass", cost: 0.01, defaults: [] });
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

  test("the land pushes the tested tree with Issue and Job trailers, and the clean main checkout follows", async () => {
    const id = (await aleph(["issue", "add", "fac", "a factory item"])).json.added;
    const j = await fjob("fitem", "commit fitem.txt", {}, ["--on", String(id)]);
    const r = await aleph(["land", "fitem"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed" });
    expect(remoteGit("log", "-1", "--format=%B", "main").trim()).toBe(`add fitem.txt\n\nIssue: fac-${id}\nJob: ${j.json.job}`);
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main").trim()).toBe(`Issue: fac-${id}\nJob: ${j.json.job}`);
    expect(readFileSync(join(base, "trees"), "utf8").trim().split("\n").at(-1)).toBe(remoteGit("rev-parse", "main^{tree}"));
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain")]).toEqual([remoteGit("rev-parse", "main"), ""]);
    expect(factoryBranch("fitem")).toBe(false);
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  });

  test("a goal .1 lands with Issue, Goal and Job trailers; its run is a build run on the goal, and the issue is done", async () => {
    const GOAL = "## Goal\n\nAdd a file.\n\n## Oracle\n\n`bun test`\n\n## Time box\n\n10 minutes\n";
    const added = (await aleph(["issue", "add", "fac", "t", "--goal", "-"], { ALEPH_DISPATCH: "off" }, GOAL)).json;
    const id = added.added as number;
    const j = await fjob("fgoal", "commit fgoal.txt", {}, ["--on", `${id}.1`]);
    const s0 = state(j.json.run);
    expect(s0).toMatchObject({ kind: "build", on: `fac-${id}.1`, state: "passed" });
    expect(s0.todo).toBeUndefined();
    expect(j.json.run).toEndWith("-build");
    const r = await aleph(["land", "fgoal"]);
    expect(state(r.json.run)).toMatchObject({ kind: "land", state: "landed", on: `fac-${id}.1` });
    expect(remoteGit("log", "-1", "--format=%B", "main").trim()).toBe(`add fgoal.txt\n\nIssue: fac-${id}\nGoal: fac-${id}.1\nJob: ${j.json.job}`);
    const st = await aleph(["status", `fac-${id}`]);
    expect(st.stdout).toContain("done");
  });

  test("an error result, no result, a line after the result, or no commit ends stuck", async () => {
    expect(state((await fjob("ferr", "error")).json.run)).toMatchObject({ state: "stuck", reason: "API Error: 500" });
    expect(state((await fjob("fnone", "noresult")).json.run)).toMatchObject({ state: "stuck", reason: expect.stringContaining('"type":"assistant"') });
    expect(state((await fjob("ftrail", "trailing")).json.run)).toMatchObject({ state: "stuck", reason: "one more line" });
    expect(state((await fjob("fidle", "none")).json.run)).toMatchObject({ state: "stuck", reason: "no commit" });
    expect(told).toContain("fac/ferr stuck");
    for (const n of ["ferr", "fnone", "ftrail", "fidle"]) await aleph(["drop", n]);
  });

  test("a worker that says the goal is already met, with the checks green on main, closes the item", async () => {
    const id = (await aleph(["issue", "add", "fac", "timeline already uses itemTimes"])).json.added;
    const r = await fjob("fmet", "already-met", {}, ["--on", String(id)]);
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "no commit" });
    // A tick's probe runs the sandbox; a passing probe is written as the other tick tests do.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const tick = await aleph(["tick"]);
    expect(tick.json.episodes).toEqual(expect.any(Array));
    expect(state(r.json.run)).toMatchObject({ state: "dropped", reason: expect.stringContaining("the item is done") });
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  }, 60_000);

});

describe("a worker's FOLLOWUP line (criterion 15)", () => {
  test("files an issue with source worker that status calls new; FLAKE adds a tracker note and no issue", async () => {
    const titles = async () => (await aleph(["issue", "list", "fac", "--json"])).json as any[];
    const before = (await titles()).map((i) => i.id);
    const r = await aleph(["job", "fac", "ffollow", "--spec", specFile("Goal: ffollow\nACTION: defaults\n")]);
    expect(r.code, r.stderr).toBe(0);
    const added = (await titles()).filter((i) => !before.includes(i.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ title: "paint the fence", source: "worker", kind: "issue" });
    const full = (await aleph(["issue", "show", "fac", String(added[0].id), "--json"])).json;
    expect(full.body).toContain("## Request");
    expect(full.body).toContain("ffollow");
    expect((await aleph(["status", `fac-${added[0].id}`])).stdout).toContain("new");
    expect(existsSync(join(base, "factory", "followups.log"))).toBe(false);

    const mid = (await titles()).length;
    const f = await aleph(["job", "fac", "fflake2", "--spec", specFile("Goal: fflake2\nACTION: flake\n")]);
    expect(f.code, f.stderr).toBe(0);
    const after = await titles();
    // A tracker (once) and the followup line's issue, but none for the FLAKE line.
    expect(after.length).toBe(mid + 2);
    expect(after.map((i) => i.title)).not.toContain("a.test.ts > slow one: timed out, passed alone");
    const tracker = after.find((i) => i.areas.includes("flakes"));
    expect((await aleph(["issue", "show", "fac", String(tracker.id), "--json"])).json.notes.join("\n")).toContain("job fflake2: a.test.ts > slow one");
  }, 60_000);
});
