import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, file, lf, lfPosts, remote, repo, resetLf, setLfStatus, sh, specFile, state, told, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];


  describe("its Langfuse trace", () => {
    const langfuse = () => ({ LANGFUSE_BASE_URL: `http://127.0.0.1:${lf.port}`, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" });
    const spans = () => lfPosts.flatMap((p) => p.resourceSpans.flatMap((r: any) => r.scopeSpans.flatMap((x: any) => x.spans)));
    beforeEach(resetLf);

    test("one trace is posted, its session id the job id", async () => {
      const r = await fjob("ftrace", "commit ftrace.txt", langfuse());
      expect(state(r.json.run).state).toBe("passed");
      const all = spans();
      expect(all.length).toBeGreaterThan(0);
      const root = all.find((s: any) => !s.parentSpanId);
      expect(root.name).toBe("worker");
      expect(new Set(all.map((s: any) => s.traceId)).size).toBe(1);
      const a = (k: string) => root.attributes.find((x: any) => x.key === k)?.value.stringValue;
      expect(a("langfuse.session.id")).toBe(state(r.json.run).job);
      expect(a("langfuse.trace.name")).toBe("factory ftrace");
      expect(a("langfuse.trace.metadata.state")).toBe("passed");
    });

    test("with Langfuse answering 500 the verdict is unchanged and one line is logged", async () => {
      setLfStatus(500);
      const r = await fjob("ftrace500", "commit ftrace500.txt", langfuse());
      expect(state(r.json.run).state).toBe("passed");
      expect(file(r.json.run, "trace.log").trim().split("\n").length).toBe(1);
    });

    test("with no Langfuse config nothing is posted", async () => {
      await fjob("ftracenone", "commit ftracenone.txt");
      expect(lfPosts).toEqual([]);
    });
  });

  test("the worker's branch comes back as a bundle; the run passes and its run folder is gone", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "agent", state: "passed", branch: "factory/fpass", cost: 0.01, defaults: [] });
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

  test("the land pushes the tested tree with Item and Job trailers, and the clean main checkout follows", async () => {
    const id = (await aleph(["todo", "add", "fac", "a factory item"])).json.added;
    const j = await fjob("fitem", "commit fitem.txt", {}, ["--todo", String(id)]);
    const r = await aleph(["land", "fitem"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed" });
    expect(remoteGit("log", "-1", "--format=%B", "main").trim()).toBe(`add fitem.txt\n\nItem: fac-${id}\nJob: ${j.json.job}`);
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main").trim()).toBe(`Item: fac-${id}\nJob: ${j.json.job}`);
    expect(readFileSync(join(base, "trees"), "utf8").trim().split("\n").at(-1)).toBe(remoteGit("rev-parse", "main^{tree}"));
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain")]).toEqual([remoteGit("rev-parse", "main"), ""]);
    expect(factoryBranch("fitem")).toBe(false);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
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
    const id = (await aleph(["todo", "add", "fac", "timeline already uses itemTimes"])).json.added;
    const r = await fjob("fmet", "already-met", {}, ["--todo", String(id)]);
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "no commit" });
    // A tick's probe runs the sandbox; a passing probe is written as the other tick tests do.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    await aleph(["tick"]);
    expect(state(r.json.run)).toMatchObject({ state: "dropped", reason: expect.stringContaining("the item is done") });
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(runsLeft()).toEqual([]);
  }, 60_000);

  test("a worker silent for ALEPH_STALL_SECONDS is stuck as stalled, with no fix round", async () => {
    const t = performance.now();
    const r = await fjob("fstall", "quiet", { ALEPH_STALL_SECONDS: "2" });
    expect(performance.now() - t).toBeLessThan(10_000);
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "stalled: no output for 2 seconds" });
    await aleph(["drop", "fstall"]);
  }, 30_000);

  test("a worker that keeps printing is not stalled", async () => {
    const r = await fjob("fchat", "chatty", { ALEPH_STALL_SECONDS: "2" });
    expect(state(r.json.run).state).not.toBe("stuck");
    await aleph(["drop", "fchat"]);
  }, 30_000);

  test("a worker past the time box ends stuck as \"time box\"", async () => {
    const r = await fjob("fslow", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "time box" });
    expect(runsLeft()).toEqual([]);
    await aleph(["drop", "fslow"]);
  });

});
