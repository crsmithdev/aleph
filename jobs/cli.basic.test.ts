import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, branchExists, fakeLog, file, job, jobsDir, repo, setupLog, sh, specFile, state, told, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("job", () => {
  test("refuses an unknown repo, prints the keys, creates nothing", async () => {
    const r = await aleph(["job", "nowhere", "alpha", "--spec", specFile("x")]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo, auto, other, fac");
    expect(readdirSync(jobsDir)).toEqual([]);
  });

  test("a worker that commits ends passed, with setup, checks, result and news", async () => {
    const r = await aleph(["job", "De mo", "alpha", "--spec", "-"], {}, "Goal: alpha\nACTION: commit a.txt\n");
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "agent", name: "alpha", repo: "demo", state: "passed", told: true, branch: "job/alpha", worktree: worktree("alpha") });
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
    expect(told).toContain("demo/alpha passed");
    const args = readFileSync(join(fakeLog, "args"), "utf8");
    expect(args).toContain(`--session-id ${s.session}`);
    expect(args).toContain("--output-format stream-json --verbose");
    const workerEnv = readFileSync(join(fakeLog, "env"), "utf8");
    expect(workerEnv).toContain(`ALEPH_JOB_ID=${r.json.run}`);
    expect(workerEnv).not.toMatch(/^(CLAUDECODE|ANTHROPIC_API_KEY)=/m);
  });

  test("a follow-up runs in the same worktree with the spec, notes and previous result", async () => {
    const r = await job("alpha", "commit b.txt");
    expect(r.code).toBe(0);
    const first = readdirSync(jobsDir).sort().find((d) => d.endsWith("-demo-alpha-agent"))!;
    expect(r.json.job).toBe(first);
    expect(r.json.run).not.toBe(first);
    expect(state(r.json.run).state).toBe("passed");
    expect(existsSync(join(jobsDir, first, "notes", "001.md"))).toBe(true);
    const prompt = readFileSync(join(fakeLog, "prompt"), "utf8");
    expect(prompt).toContain("You are a worker on job `alpha`");
    expect(prompt).toContain("## Spec\n\nGoal: alpha\nACTION: commit a.txt");
    expect(prompt).toContain("## Note 001\n\nGoal: alpha\nACTION: commit b.txt");
    expect(prompt).toContain("## Previous run: agent, passed");
    expect(prompt).toContain("did commit a.txt");
    expect(readFileSync(setupLog, "utf8")).toBe("ran\n");
    expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add b.txt\nadd a.txt\ninit");
  });

  test("jobs lists open jobs; jobs <name> adds the result", async () => {
    const list = await aleph(["jobs"]);
    const alpha = list.json.find((j: any) => j.name === "alpha");
    expect(alpha).toMatchObject({ repo: "demo", goal: "Goal: alpha", state: "passed" });
    const one = await aleph(["jobs", "alpha"]);
    expect(one.json.result).toBe("did commit b.txt");
    expect(one.json.checks).toContain("## tests: exit 0");
  });

  test("a name open in another repo is refused, naming that repo", async () => {
    const r = await job("alpha", "commit c.txt", {}, "other");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("alpha is open in demo");
  });

  test("with no name, jobs lists the open jobs, then the jobs that ended in the last 24 hours, the latest first", async () => {
    await job("older", "commit older.txt");
    await aleph(["drop", "older"]);
    await job("newer", "commit newer.txt");
    await aleph(["drop", "newer"]);
    await job("stale", "commit stale.txt");
    await aleph(["drop", "stale"]);
    const folder = (await aleph(["jobs", "stale"])).json.run;
    const file = join(jobsDir, folder, "state.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ended: new Date(Date.now() - 25 * 3600_000).toISOString() }));
    await job("open", "commit open.txt");
    const names = (await aleph(["jobs"])).json.map((j: any) => j.name).filter((n: string) => ["older", "newer", "stale", "open"].includes(n));
    expect(names).toEqual(["open", "newer", "older"]);
    await aleph(["drop", "open"]);
  });

  test("drop removes the worktree and branch and ends the job", async () => {
    const r = await aleph(["drop", "alpha", "not", "needed"]);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ state: "dropped", reason: "not needed" });
    expect(existsSync(worktree("alpha"))).toBe(false);
    expect(branchExists("alpha")).toBe(false);
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "alpha")).toMatchObject({ state: "dropped" });
    expect((await aleph(["drop", "alpha"])).code).toBe(1);
  });

  test("a new job with an ended job's name starts fresh, clearing a leftover branch", async () => {
    sh(repo, "git", "branch", "job/alpha", "origin/main");
    const r = await job("alpha", "commit d.txt");
    expect(r.json.job).toBe(r.json.run);
    expect(state(r.json.run).state).toBe("passed");
    expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add d.txt\ninit");
    await aleph(["drop", "alpha"]);
  });
});

describe("the state rule", () => {
  test("a non-zero exit fails", async () => {
    const r = await job("exits", "exit3");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "worker exited 3" });
    expect(told).toContain("demo/exits failed");
  });

  test("a question needs Chris", async () => {
    const r = await job("asks", "question");
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "question", question: "which colour?" });
    expect(told).toContain("demo/asks needs-you question");
  });

  test("an untracked file fails", async () => {
    const r = await job("messy", "untracked");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "uncommitted: stray.txt" });
  });

  test("no commits is done, and the worktree goes", async () => {
    const r = await job("idle", "none");
    expect(state(r.json.run)).toMatchObject({ state: "done" });
    expect(existsSync(worktree("idle"))).toBe(false);
    expect(branchExists("idle")).toBe(false);
  });

  test("a failing check fails, with its name in the news", async () => {
    const r = await job("broken", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "tests failed" });
    expect(told).toContain("demo/broken failed tests");
    expect(file(r.json.run, "checks.log")).toContain("## tests: exit 1");
  });

  test("a change under a manual glob runs its checks and passes, keeping what to check", async () => {
    const r = await job("phone", "commit android/app.txt");
    expect(state(r.json.run)).toMatchObject({ state: "passed", say: "run it on the phone" });
    expect(state(r.json.run).needs).toBeUndefined();
    expect(readFileSync(join(base, "android.log"), "utf8")).toBe("built\n");
    await aleph(["drop", "phone"]);
  });

  test("a worker past its limit is stopped and fails as timed out", async () => {
    const start = Date.now();
    const r = await job("stuck", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    // The fake worker sleeps 60s, so anything well under that proves the limit
    // cut it short. The bound was 10s and flaked under load: the assertion is
    // that the sleep did not run, not that the machine was idle.
    expect(Date.now() - start).toBeLessThan(30_000);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "timed out: worker" });
  });

  test("a check past its limit is stopped and fails as timed out", async () => {
    const r = await job("slowcheck", "commit slow/x.txt", { ALEPH_CHECK_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "timed out: check slow" });
  });
});

describe("guards", () => {
  test("a worker's push goes to aleph-no-push and gh has no credentials", async () => {
    await job("pusher", "push");
    expect(readFileSync(join(fakeLog, "push.code"), "utf8").trim()).not.toBe("0");
    expect(readFileSync(join(fakeLog, "ssh.args"), "utf8")).toContain("aleph-no-push");
    expect(readFileSync(join(fakeLog, "gh.code"), "utf8").trim()).not.toBe("0");
    await aleph(["drop", "pusher"]);
  });

  test("six starts at once: five run, one is refused", async () => {
    const names = ["one", "two", "three", "four", "five", "six"];
    const started = names.map((n) => job(n, `hold ${join(fakeLog, "never-created")}`));
    const mine = async () => (await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name));
    try {
      // Five hold on a gate file nobody creates, so none ends before the drops; the sixth comes back refused.
      // No wall-clock window: the starts queue on the dispatch lock, which bounds each wait itself.
      // The held runs never end, so the first start to come back is the sixth, whatever it says.
      // Bounded: if all six start, nothing returns, so fail with what each run shows instead of waiting out the test.
      const none = Symbol("no start returned");
      const first = await Promise.race([...started, Bun.sleep(150_000).then(() => none)]);
      if (first === none) {
        const seen = (await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name)).map((j: any) => {
          const at = (f: string) => existsSync(join(jobsDir, j.run, f)) ? readFileSync(join(jobsDir, j.run, f), "utf8").trim() : null;
          return { name: j.name, state: j.state, phase: j.phase, pid: at("pid"), exit: at("exit") };
        });
        for (const j of await mine()) if (j.state === "running") await aleph(["drop", j.name]);
        const late = await Promise.allSettled(started);
        const stderr = late.map((l, i) => `${names[i]}: ${l.status === "fulfilled" ? l.value.stderr : String(l.reason)}`);
        throw new Error(`no start returned in 150 s\n${JSON.stringify(seen, null, 1)}\nstderr (after drop; look for "wrote no pid"):\n${stderr.join("\n")}`);
      }
      const refused = first as Awaited<(typeof started)[number]>;
      expect(refused.code, refused.stdout + refused.stderr).toBe(1);
      expect(refused.stderr).toContain("5 agent runs are live");
      // The refusal comes as soon as the fifth unit wrote `pid`; on a loaded machine some are still in phase setup.
      let live = await mine();
      for (const end = Date.now() + 90_000; Date.now() < end && !(live.length === 5 && live.every((j: any) => j.state === "running" && j.phase === "worker")); live = await mine()) await Bun.sleep(100);
      expect(live.length).toBe(5);
      expect(live.every((j: any) => j.state === "running" && j.phase === "worker")).toBe(true);
      for (const j of live) expect((await aleph(["drop", j.name])).code).toBe(0);
      const ends = await Promise.all(started);
      expect(ends.filter((r) => r.code === 0).length).toBe(5);
      for (const j of live) expect(state(j.run).state).toBe("dropped");
      expect((await aleph(["jobs"])).json.filter((j: any) => names.includes(j.name)).map((j: any) => j.state)).toEqual(live.map(() => "dropped"));
    } finally {
      // Drop every run that started, so a failure here does not leave five held runs for the next test.
      for (const j of await mine()) if (j.state === "running") await aleph(["drop", j.name]);
      await Promise.allSettled(started);
    }
  }, 300_000);
});

describe("news", () => {
  test("news that Sidetone missed is printed once by jobs --news", async () => {
    const r = await job("offline", "exit3", { SIDETONE_TELL_URL: "https://127.0.0.1:1/tell" });
    expect(state(r.json.run).told).toBe(false);
    const news = await aleph(["jobs", "--news"]);
    expect(news.json).toEqual([{ run: r.json.run, line: "demo/offline failed" }]);
    expect((await aleph(["jobs", "--news"])).json).toEqual([]);
  });

  test("a run whose process died shows as lost", async () => {
    const folder = join(jobsDir, "20200101-000000-demo-ghost-agent");
    mkdirSync(folder);
    writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: "20200101-000000-demo-ghost-agent", name: "ghost", repo: "demo", state: "running", told: false, started: "2020-01-01T00:00:00Z" }));
    writeFileSync(join(folder, "pid"), "999999");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "ghost")).toMatchObject({ state: "running", lost: true });
    expect((await aleph(["drop", "ghost"])).code).toBe(0);
  });
});

describe("run", () => {
  test("a plain command runs in the current directory and says it finished", async () => {
    const r = await aleph(["run", "build", "--", "bash", "-c", 'pwd; echo "it\'s done"']);
    expect(r.code).toBe(0);
    expect(state(r.json.run)).toMatchObject({ kind: "plain", state: "done", told: true });
    expect(file(r.json.run, "output.log")).toBe(`${base}\nit's done\n`);
    expect(told).toContain("build finished");
  });

  test("a failing plain command says it failed", async () => {
    const r = await aleph(["run", "build", "--", "false"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "exited 1" });
    expect(told).toContain("build failed");
  });
});

