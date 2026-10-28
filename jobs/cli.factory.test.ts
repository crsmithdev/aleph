import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, file, jobsDir, lf, lfPosts, remote, repo, resetLf, setLfStatus, sh, specFile, state, told, setup, teardown } from "./cli.helpers";

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
    expect(env).not.toMatch(/^(ALEPH_[A-Z_]+|SIDETONE_[A-Z_]+|GIT_AUTHOR_NAME|XDG_RUNTIME_DIR)=/m);
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

  describe("hidden checks", () => {
    const SOURCE = `import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\n// SECRET-HIDDEN-LINE\ntest("hid file exists", () => { expect(existsSync("hid.txt")).toBe(true); });\n`;
    const hiddenItem = async () => {
      const id = (await aleph(["todo", "add", "fac", "an item with a hidden check"])).json.added;
      writeFileSync(join(base, "a.test.ts"), SOURCE);
      expect((await aleph(["todo", "hidden", "fac", String(id), join(base, "a.test.ts")])).code).toBe(0);
      return id;
    };
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a run whose code fails the hidden test is stuck with the count, and no source reaches the note", async () => {
      const id = await hiddenItem();
      const r = await fjob("hidbad", "commit hidbad.txt", { ALEPH_FIX_ROUNDS: "0" }, ["--todo", String(id)]);
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "hidden check failed: 1 of 1 tests" });
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(file(r.json.run, "hidden.log")).toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "checks.log")).not.toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-HIDDEN-LINE");
      expect(runsLeft()).toEqual([]);
      expect((await aleph(["report"])).stdout).toContain("hidden 0/1");
      await aleph(["drop", "hidbad"]);
    }, 30_000);

    test("the fix round's note has the line and the failing test names, and the job lands once it passes", async () => {
      const id = await hiddenItem();
      await fjob("hidfix", "hidden-fix", {}, ["--todo", String(id)]);
      const rs = runs("hidfix");
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["agent", "stuck"], ["agent", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "hidden check failed: 1 of 1 tests", failed: "hidden", next: "worker" });
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("hidden check failed: 1 of 1 tests");
      expect(p).toContain("hid file exists");
      expect(p).not.toContain("SECRET-HIDDEN-LINE");
      expect(p).not.toContain("expect(existsSync");
      // The run's own checks ran the hidden check; main had not moved, so the land skipped them.
      expect(rs[1].checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(rs[1].checks.at(-1)).toMatchObject({ ok: true, passed: 1, total: 1 });
      expect(readFileSync(join(jobsDir, rs[2].id, "land.log"), "utf8")).toContain("checks skipped");
      expect(runsLeft()).toEqual([]);
    }, 60_000);

    test("an item with no hidden files runs the same checks as before", async () => {
      const id = (await aleph(["todo", "add", "fac", "no hidden"])).json.added;
      const r = await fjob("hidnone", "commit hidnone.txt", {}, ["--todo", String(id)]);
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
      expect(existsSync(join(jobsDir, r.json.run, "hidden.log"))).toBe(false);
      await aleph(["drop", "hidnone"]);
    }, 30_000);
  });

  describe("flaky checks", () => {
    const flaky = () => JSON.parse(readFileSync(join(base, "factory", "flaky.json"), "utf8"));

    test("a check that fails then passes on the same tree passes the run, is recorded and reported; two make a health line", async () => {
      const r = await fjob("flk1", "flaky");
      expect(state(r.json.run).state).toBe("passed");
      expect(state(r.json.run).checks.find((c: any) => c.name === "flaky")).toMatchObject({ ok: true, rerun: true });
      expect(file(r.json.run, "checks.log")).toContain("## flaky: exit 1, run again");
      expect(flaky()).toHaveLength(1);
      expect(flaky()[0]).toMatchObject({ repo: "fac", check: "flaky", run: r.json.run });
      const out = (await aleph(["report"])).stdout;
      expect(out).toContain("flaky passed on rerun");
      expect(out).not.toContain("on rerun 2 times");
      await fjob("flk2", "flaky");
      expect(flaky()).toHaveLength(2);
      expect((await aleph(["report"])).stdout).toContain("health: fac check flaky passed on rerun 2 times in 7 days");
      rmSync(join(base, "factory", "flaky.json"));
    }, 60_000);

    test("a check that always fails is still stuck, with one rerun in its log", async () => {
      const r = await fjob("flk3", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
      const log = file(r.json.run, "checks.log");
      expect(log.match(/## tests: exit 1/g)).toHaveLength(2);
      expect(log).toContain("run again");
      await aleph(["drop", "flk3"]);
    }, 30_000);
  });

  describe("fix rounds", () => {
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a failed check goes back to the worker, whose note names it with the log; the job passes after 1 fix round", async () => {
      const r = await fjob("fix1", "fail-then-fix");
      const rs = runs("fix1");
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["agent", "stuck"], ["agent", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "tests failed", failed: "tests", next: "worker" });
      expect(rs[1].round).toBe(1);
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("The check `tests` failed");
      expect(p).toContain("FAIL is present 3");
      expect(told).toContain("fac/fix1 stuck; sent back to the worker");
      expect(runsLeft()).toEqual([]);
      expect(state(r.json.run).state).toBe("stuck");
      expect((await aleph(["report"])).stdout).toContain("fac/fix1 passed after 1 fix rounds");
    }, 30_000);

    test("a worker that keeps failing is stuck after 2 fix rounds, in 3 runs", async () => {
      await fjob("fixn", "fail-always");
      const rs = runs("fixn");
      expect(rs.map((x) => x.state)).toEqual(["stuck", "stuck", "stuck"]);
      expect(rs.at(-1)).toMatchObject({ reason: "tests failed after 2 fix rounds" });
      expect(rs.at(-1).next).toBeUndefined();
      await aleph(["drop", "fixn"]);
    }, 30_000);

    test("ALEPH_FIX_ROUNDS=0 is stuck at once, as before", async () => {
      await fjob("fix0", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      const rs = runs("fix0");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ state: "stuck", reason: "tests failed" });
      expect(rs[0].next).toBeUndefined();
      await aleph(["drop", "fix0"]);
    }, 30_000);

    test("the time box and an error result get no fix round", async () => {
      await fjob("fixbox", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
      await fjob("fixerr", "error");
      expect(runs("fixbox").map((x) => x.reason)).toEqual(["time box"]);
      expect(runs("fixerr").map((x) => x.reason)).toEqual(["API Error: 500"]);
      for (const n of ["fixbox", "fixerr"]) await aleph(["drop", n]);
    }, 30_000);
  });

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
