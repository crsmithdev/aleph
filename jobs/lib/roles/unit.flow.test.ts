import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, branchExists, fakeLog, file, jobsDir, repo, sh, state, told, worktree, setup, teardown } from "../../cli.helpers";
import { actionJob, drop, job, jobView } from "../../inproc.ts";
import { dropAs, run } from "../infra/flow.testkit.ts";
import { writeRun } from "../records/ledger.ts";

// The runs start in-process, as `aleph job` and `aleph run` start them; each run's unit is a process of its own.
// The CLI tests of `job`, `jobs`, `drop` and `run` are in jobs/cli.basic.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("job", () => {
  test("refuses an unknown repo, prints the keys, creates nothing", async () => {
    const r = await job("nowhere", "alpha", "x");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo, auto, other, fac");
    expect(readdirSync(jobsDir)).toEqual([]);
  });

  describe("with the job alpha open", () => {
    beforeAll(async () => {
      expect((await job("demo", "alpha", "Goal: alpha\nACTION: commit a.txt\n")).code).toBe(0);
    });

    test("a name open in another repo is refused, naming that repo", async () => {
      const r = await actionJob("alpha", "commit c.txt", {}, "other");
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("alpha is open in demo");
    });

    test("a follow-up started after the wall clock steps back sorts after the job's runs", async () => {
      const before = readdirSync(jobsDir).filter((d) => d.endsWith("-demo-alpha-build")).sort();
      setSystemTime(new Date(Date.now() - 60_000));
      const r = await actionJob("alpha", "commit s.txt").finally(() => setSystemTime());
      expect(r.code).toBe(0);
      expect(r.json.job).toBe(before[0]);
      expect([...before, r.json.run].sort().at(-1)).toBe(r.json.run);
      expect((await jobView("alpha")).json.run.id).toBe(r.json.run);
    });

    test("drop writes the fate by-hand, none with --quiet, and --fate overrides it", async () => {
      await actionJob("alpha", "commit p.txt");
      await drop("alpha", "not needed");
      expect(state((await jobView("alpha")).json.run.id)).toMatchObject({ fate: "by-hand", reason: "not needed" });
      await actionJob("alpha", "commit q.txt");
      await drop("alpha", "", true);
      expect(state((await jobView("alpha")).json.run.id).fate).toBeUndefined();
      await actionJob("alpha", "commit f.txt");
      await dropAs("alpha", { fate: "duplicate" });
      expect(state((await jobView("alpha")).json.run.id)).toMatchObject({ fate: "duplicate", reason: "dropped by Chris" });
    }, 30_000);

    test("a new job with an ended job's name starts fresh, clearing a leftover branch", async () => {
      sh(repo, "git", "branch", "job/alpha", "origin/main");
      const r = await actionJob("alpha", "commit d.txt");
      expect(r.json.job).toBe(r.json.run);
      expect(r.code).toBe(0);
      expect(state(r.json.run).condition).toBe("passed");
      expect(sh(worktree("alpha"), "git", "log", "--format=%s")).toBe("add d.txt\ninit");
      await drop("alpha");
    });
  });
});

describe("the state rule", () => {
  test("a non-zero exit fails", async () => {
    const r = await actionJob("exits", "exit3");
    expect(r.code).not.toBe(0);
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "worker exited 3" });
    expect(told).toContain("demo/exits failed");
  });

  test("a question needs Chris", async () => {
    const r = await actionJob("asks", "question");
    expect(state(r.json.run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "input", reason: "question" }), question: "which colour?" });
    expect(told).toContain("demo/asks awaiting question");
  });

  test("an untracked file fails", async () => {
    const r = await actionJob("messy", "untracked");
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "uncommitted: stray.txt" });
  });

  test("no commits is done, and the worktree goes", async () => {
    const r = await actionJob("idle", "none");
    expect(state(r.json.run)).toMatchObject({ condition: "done" });
    expect(existsSync(worktree("idle"))).toBe(false);
    expect(branchExists("idle")).toBe(false);
  });

  test("a failing check fails, with its name in the news", async () => {
    const r = await actionJob("broken", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "tests failed" });
    expect(told).toContain("demo/broken failed tests");
    expect(file(r.json.run, "checks.log")).toContain("## tests: exit 1");
  });

  test("a change under a manual glob runs its checks and passes, keeping what to check", async () => {
    const r = await actionJob("phone", "commit android/app.txt");
    expect(state(r.json.run)).toMatchObject({ condition: "passed", say: "run it on the phone" });
    expect(state(r.json.run).needs).toBeUndefined();
    expect(readFileSync(join(base, "android.log"), "utf8")).toBe("built\n");
    await drop("phone");
  });

  test("a worker past its limit is stopped and fails as timed out", async () => {
    // The fake worker sleeps 60 s: "timed out: worker" is the limit's cut, and a worker that ran out would pass the test's limit.
    const r = await actionJob("stuck", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "timed out: worker" });
  });

  test("a check past its limit is stopped and gives no verdict", async () => {
    const r = await actionJob("slowcheck", "commit slow/x.txt", { ALEPH_CHECK_TIMEOUT: "1" });
    expect(state(r.json.run)).toMatchObject({ condition: "failed", cause: "infra", reason: "no verdict: check slow timed out" });
  });
});

describe("guards", () => {
  test("a worker's push goes to aleph-no-push and gh has no credentials", async () => {
    await actionJob("pusher", "push");
    expect(readFileSync(join(fakeLog, "push.code"), "utf8").trim()).not.toBe("0");
    expect(readFileSync(join(fakeLog, "ssh.args"), "utf8")).toContain("aleph-no-push");
    expect(readFileSync(join(fakeLog, "gh.code"), "utf8").trim()).not.toBe("0");
    await drop("pusher");
  });
});

describe("news", () => {
  test("a run whose process died shows as lost", async () => {
    const folder = join(jobsDir, "20200101-000000-demo-ghost-agent");
    mkdirSync(folder);
    writeRun(join(folder), { kind: "build", job: "20200101-000000-demo-ghost-agent", name: "ghost", repo: "demo", condition: "running", told: false, started: "2020-01-01T00:00:00Z" } as any);
    writeFileSync(join(folder, "pid"), "999999");
    expect((await jobView("ghost")).json).toMatchObject({ condition: "running", lost: true });
    expect((await drop("ghost")).code).toBe(0);
  });
});

describe("run", () => {
  test("a failing plain command says it failed", async () => {
    const r = await run("build", ["false"]);
    expect(r.code).toBe(1);
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "exited 1" });
    expect(told).toContain("build failed");
  });
});
