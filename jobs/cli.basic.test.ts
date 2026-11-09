import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, branchExists, fakeLog, file, job, jobRuns, jobsDir, now, seedRun, setupLog, sh, state, stateNow, told, worktree, setup, teardown, when } from "./cli.helpers";
import { actionJob, drop, jobView } from "./inproc";

// The wiring of `aleph job`, `jobs`, `drop` and `run`, and the cases whose code is in jobs/cli.ts itself: the jobs list,
// the news, the --fate check, and six `aleph job` processes at once. The other cases run in-process in jobs/lib/roles/unit.flow.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("job", () => {
  test("a worker that commits ends passed, with setup, checks, result and news", async () => {
    const r = await aleph(["job", "De mo", "alpha", "--spec", "-"], {}, "Goal: alpha\nACTION: commit a.txt\n");
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "build", name: "alpha", repo: "demo", condition: "passed", told: true, branch: "job/alpha", worktree: worktree("alpha") });
    expect(s.session).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.phase).toBeUndefined();
    expect(file(r.json.run, "exit")).toBe("0");
    expect(file(r.json.run, "result.md")).toBe("did commit a.txt");
    expect(file(r.json.run, "checks.log")).toContain("## tests: exit 0");
    expect(file(r.json.run, "checks.log")).not.toContain("android");
    expect(s.checks.map((c: any) => c.name)).toContain("tests");
    expect(s.checks.map((c: any) => c.name)).not.toContain("android build");
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
    expect(readFileSync(setupLog, "utf8")).toBe("ran\n");
    expect(told).toContain("alpha#1 passed");
    const args = readFileSync(join(fakeLog, "args"), "utf8");
    expect(args).toContain(`--session-id ${s.session}`);
    expect(args).toContain("--output-format stream-json --verbose");
    const workerEnv = readFileSync(join(fakeLog, "env"), "utf8");
    expect(workerEnv).toContain(`ALEPH_JOB_ID=${r.json.run}`);
    expect(workerEnv).not.toMatch(/^(CLAUDECODE|ANTHROPIC_API_KEY)=/m);
  });

  // In-process, but here: the jobs list below reads the result of this follow-up.
  // flaky: tests/flaky.md#basic-follow-up
  test.skip("a follow-up runs in the same worktree with the spec, notes and previous result", async () => {
    const r = await actionJob("alpha", "commit b.txt");
    expect(r.code).toBe(0);
    const first = jobRuns("alpha", "build")[0];
    expect(r.json.job).toBe(first);
    expect(r.json.run).not.toBe(first);
    expect(state(r.json.run).condition).toBe("passed");
    expect(existsSync(join(jobsDir, first, "notes", "001.md"))).toBe(true);
    const prompt = readFileSync(join(fakeLog, "prompt"), "utf8");
    expect(prompt).toContain("You are a worker on job `alpha`");
    expect(prompt).toContain("## Spec\n\nGoal: alpha\nACTION: commit a.txt");
    expect(prompt).toContain("## Note 001\n\nGoal: alpha\nACTION: commit b.txt");
    expect(prompt).toContain("## Previous run: build, passed");
    expect(prompt).toContain("did commit a.txt");
    expect(readFileSync(setupLog, "utf8")).toBe("ran\n");
    expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add b.txt\nadd a.txt\ninit");
  });

  // flaky: tests/flaky.md#basic-jobs-lists
  test.skip("jobs lists open jobs; jobs <name> adds the result", async () => {
    const list = await aleph(["jobs"]);
    const alpha = list.json.find((j: any) => j.name === "alpha");
    expect(alpha).toMatchObject({ repo: "demo", goal: "Goal: alpha", condition: "passed" });
    const one = await aleph(["jobs", "alpha"]);
    expect(one.json.result).toBe("did commit b.txt");
    expect(one.json.checks).toContain("## tests: exit 0");
  });

  // flaky: tests/flaky.md#basic-no-name
  test.skip("with no name, jobs lists the open jobs, then the jobs that ended in the last 24 hours, the latest first", async () => {
    // The runs are seeded with their end times: the order comes from the test, not from how fast the jobs ran.
    const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
    const ended = (name: string, h: number) => seedRun("demo", { kind: "build", condition: "dropped", name, job: name, ended: hoursAgo(h) });
    ended("older", 2);
    ended("newer", 1);
    ended("stale", 25);
    seedRun("demo", { kind: "build", condition: "passed", name: "open", job: "open" });
    const names = (await aleph(["jobs"])).json.map((j: any) => j.name).filter((n: string) => ["older", "newer", "stale", "open"].includes(n));
    expect(names).toEqual(["open", "newer", "older"]);
  });

  test("drop removes the worktree and branch and ends the job", async () => {
    const r = await aleph(["drop", "alpha", "not", "needed"]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ condition: "dropped", reason: "not needed" });
    expect(existsSync(worktree("alpha"))).toBe(false);
    expect(branchExists("alpha")).toBe(false);
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "alpha")).toMatchObject({ condition: "dropped" });
    expect((await aleph(["drop", "alpha"])).code).toBe(1);
  });

  test("drop --fate with an unknown value is refused and the job stays open", async () => {
    await actionJob("alpha", "commit r.txt");
    const r = await aleph(["drop", "alpha", "--fate", "bogus"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("duplicate, met, manual");
    expect((await jobView("alpha")).json.condition).not.toBe("dropped");
    await drop("alpha");
  });
});

/** The recorded state and reason of the run a start printed, for an assertion message. */
function endedRun(r: { stdout: string }): string {
  try {
    const run = JSON.parse(r.stdout).run;
    return run ? `\nrun ${run}: ${JSON.stringify(state(run))}` : "";
  } catch {
    return "";
  }
}

describe("guards", () => {
  // Six `aleph job` processes race for the dispatch lock: the process boundary is what this case tests.
  // flaky: tests/flaky.md#basic-six-starts
  test.skip("six starts at once: five run, one is refused", async () => {
    const names = ["one", "two", "three", "four", "five", "six"];
    const started = names.map((n) => job(n, `hold ${join(fakeLog, "never-created")}`));
    const mine = async () => (await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name));
    try {
      // Five hold on a gate file nobody creates, so none ends before the drops; the sixth comes back refused.
      // No wall-clock window: the starts queue on the dispatch lock, which bounds each wait itself.
      // The held runs never end, so the first start to come back is the sixth, whatever it says.
      // If all six start, nothing returns, and the test timeout ends the wait.
      const refused = await Promise.race(started);
      expect(refused.code, refused.stdout + refused.stderr + endedRun(refused)).toBe(1);
      expect(refused.stderr).toContain("5 agent runs are live");
      // The refusal comes as soon as the fifth unit wrote `pid`; on a loaded machine some are still in phase setup.
      const worker = (n: string) => jobRuns(n).some((r) => (stateNow(r) as any).phase === "worker" && stateNow(r).condition === "running");
      await when(() => names.filter(worker).length === 5, jobsDir);
      const live = await mine();
      expect(live.length).toBe(5);
      expect(live.every((j: any) => j.condition === "running" && j.phase === "worker")).toBe(true);
      for (const j of live) expect((await aleph(["drop", j.name])).code).toBe(0);
      const ends = await Promise.all(started);
      expect(ends.filter((r) => r.code === 143).length).toBe(5);
      for (const j of live) expect(state(j.run).condition).toBe("dropped");
      expect((await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name)).map((j: any) => j.condition)).toEqual(live.map(() => "dropped"));
    } finally {
      // Drop every run that started, so a failure here does not leave five held runs for the next test.
      for (const j of await mine()) if (j.condition === "running") await aleph(["drop", j.name]);
      await Promise.allSettled(started);
    }
  }, 300_000);
});

describe("news", () => {
  // flaky: tests/flaky.md#basic-news
  test.skip("news that Sidetone missed is printed once by jobs --news", async () => {
    const r = await actionJob("offline", "exit3", { SIDETONE_TELL_URL: "https://127.0.0.1:1/tell" });
    expect(state(r.json.run).told).toBe(false);
    const news = await aleph(["jobs", "--news"]);
    expect(news.json).toEqual([{ run: r.json.run, line: "offline#1 failed other" }]);
    expect((await aleph(["jobs", "--news"])).json).toEqual([]);
  });
});

describe("run", () => {
  test("a plain command runs in the current directory and says it is done", async () => {
    const r = await aleph(["run", "build", "--", "bash", "-c", 'pwd; echo "it\'s done"']);
    expect(r.code).toBe(0);
    expect(state(r.json.run)).toMatchObject({ kind: "plain", condition: "done", told: true });
    expect(file(r.json.run, "output.log")).toBe(`${base}\nit's done\n`);
    expect(told).toContain("build#1 done");
  });
});

describe("models", () => {
  test("set title gpt-oss-20b is printed by models; a bad tier exits non-zero", async () => {
    expect((await aleph(["models", "set", "title", "gpt-oss-20b"])).code).toBe(0);
    const r = await aleph(["models"]);
    expect(r.json).toMatchObject({ title: { enabled: true, model: "gpt-oss-20b" }, merge: { enabled: true, model: "haiku" } });
    const bad = await aleph(["models", "set", "nonexistent", "gpt-oss-20b"]);
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain("unknown tier");
  });
});
