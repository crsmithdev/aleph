import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, file, jobsDir, remote, repo, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];


  describe("the reviewer", () => {
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`, extra: Record<string, string> = {}) =>
      aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name} ${mark}\nACTION: ${action}\n`)], extra);
    const calls = () => existsSync(join(fakeLog, "review-calls")) ? readFileSync(join(fakeLog, "review-calls"), "utf8").length : 0;

    test("a pass lands; the prompt holds the item and the diff; the cost adds up", async () => {
      const r = await rjob("rpass", "REVIEW:pass");
      expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.03 });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("Goal: rpass REVIEW:pass");
      expect(p).toContain("+++ b/rpass.txt");
      expect(runsLeft()).toEqual([]);
      expect(state((await aleph(["land", "rpass"])).json.run).state).toBe("landed");
    });

    test("a diff over ALEPH_REVIEW_DIFF_MAX is cut: the stat, the head of the diff, a line that says so", async () => {
      const r = await rjob("rbig", "REVIEW:pass", "commit-big rbig.txt", { ALEPH_REVIEW_DIFF_MAX: "200" });
      expect(state(r.json.run)).toMatchObject({ state: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      const m = p.match(/diff cut at 200 of (\d+) characters/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(200);
      expect(p).toContain("rbig.txt |");
      const body = p.slice(p.indexOf("diff --git"), p.indexOf("(diff cut at"));
      expect(body.trim().length).toBeLessThanOrEqual(200);
      expect(p).not.toContain("line 60 of the big file");
    });

    test("under the default cap the whole diff goes in and no line says it was cut", async () => {
      const r = await rjob("rwhole", "REVIEW:pass", "commit-big rwhole.txt");
      expect(state(r.json.run)).toMatchObject({ state: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("line 60 of the big file");
      expect(p).not.toContain("diff cut");
    });

    test("a hold needs Chris, pushes nothing, and his land adds Held-by", async () => {
      const r = await rjob("rhold", "REVIEW:hold");
      expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: "reviewer: tests do not cover the new flag" });
      expect(state(r.json.run).stat).toContain("rhold.txt");
      const before = remoteGit("rev-parse", "main");
      expect(before).toBe(remoteGit("rev-parse", "main"));
      expect(remoteGit("log", "-1", "--format=%s", "main")).not.toBe("add rhold.txt");
      const l = await aleph(["land", "rhold"]);
      expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
      expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
    });

    test("no verdict line, or an error result, holds the run", async () => {
      expect(state((await rjob("rnone", "REVIEW:none")).json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: expect.stringMatching(/^reviewer: no verdict/) });
      expect(state((await rjob("rerr", "REVIEW:error")).json.run)).toMatchObject({ state: "needs-you", reason: "reviewer: no verdict (API Error: 529)" });
      for (const n of ["rnone", "rerr"]) await aleph(["drop", n]);
    });

    test("a reviewer past the time box holds the run", async () => {
      const slow = join(base, "slow-reviewer");
      writeFileSync(slow, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });
      const t = await aleph(["job", "fac", "rslow2", "--spec", specFile("Goal: g\nACTION: commit rslow2.txt\n")], { ALEPH_REVIEWER_CMD: slow, ALEPH_REVIEW_TIMEOUT: "1" });
      expect(state(t.json.run)).toMatchObject({ state: "needs-you", reason: "reviewer: no verdict (time box)" });
      await aleph(["drop", "rslow2"]);
    });

    test("a held path holds without a review", async () => {
      const n = calls();
      const r = await rjob("rheld", "REVIEW:pass", "commit held/r.txt");
      expect(state(r.json.run)).toMatchObject({ needs: "held" });
      expect(calls()).toBe(n);
      await aleph(["drop", "rheld"]);
    });
  });

  test("a change to an existing test goes to the reviewer; its hold needs a review; drop leaves the item open", async () => {
    const id = (await aleph(["todo", "add", "fac", "tests"])).json.added;
    const r = await aleph(["job", "fac", "ftest", "--spec", specFile("Goal: ftest REVIEW:hold\nACTION: commit old.test.ts\n"), "--todo", String(id)]);
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: expect.stringMatching(/^reviewer: hold|^reviewer: tests do not/) });
    expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).toContain("The diff changes the test old.test.ts");
    expect((await aleph(["drop", "ftest"])).code).toBe(0);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("open");
    expect(factoryBranch("ftest")).toBe(false);
  });

  test("a follow-up on a stuck job starts from the job's previous branch", async () => {
    const r = await fjob("fagain", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
    expect(state(r.json.run).checks).toEqual([{ name: "tests", ok: false, seconds: expect.any(Number) }]);
    const f = await fjob("fagain", "branchlog");
    expect(readFileSync(join(fakeLog, "branchlog"), "utf8")).toContain("add FAIL");
    expect(state(f.json.run).state).toBe("passed");
    await aleph(["drop", "fagain"]);
  });

  test("a held path needs Chris with the rule and the diff stat; his land adds Held-by", async () => {
    const r = await fjob("fheld", "commit held/x.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ state: "needs-you", needs: "held", reason: "held path held/x.txt" });
    expect(s.stat).toContain("held/x.txt");
    const run = r.json.run;
    for (let i = 0; i < 100 && !file(run, "review2.md").includes("VERDICT"); i++) await Bun.sleep(100);
    expect(file(run, "review2.md")).toContain("VERDICT: back fix the held path");
    expect((await aleph(["jobs", "fheld"])).json.review2).toEqual({ verdict: "back", reason: "fix the held path" });
    const before = remoteGit("rev-parse", "main");
    expect(remoteGit("rev-parse", "main")).toBe(before);
    const l = await aleph(["land", "fheld"]);
    expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
  });


  test("DEFAULT lines and the cost reach the report once; FOLLOWUP lines become items", async () => {
    const r = await fjob("fdefault", "defaults");
    expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.25, defaults: ["which colour? -> blue"] });
    const items = (await aleph(["todo", "list", "fac", "--label", "followup", "--json"])).json;
    expect(items.map((i: any) => i.title)).toContain("paint the fence");
    const rep = await aleph(["report"]);
    expect(rep.stdout).toContain("fac/fdefault passed");
    expect(rep.stdout).toContain("DEFAULT: which colour? -> blue");
    expect(rep.stdout).toContain("cost $0.25 at the API price");
    expect(rep.stdout).toContain("fac/fheld needs-you (held): held path held/x.txt");
    expect(rep.stdout).toContain("aleph land fheld");
    expect(rep.stdout).toMatch(/runs in the last 24 hours: \d+ of 100, \$\d+\.\d{2} at the API price/);
    expect(state(r.json.run)).toMatchObject({ shown: true, told: true });
    expect((await aleph(["report"])).stdout).not.toContain("fdefault");
    await aleph(["drop", "fdefault"]);
  });

  test("the report hook prints JSON for SessionStart, and nothing when nothing is new", async () => {
    // Lands move the main checkout now; put it back before the commit that added held/x.txt.
    sh(repo, "git", "reset", "-q", "--hard", `${sh(repo, "git", "log", "-1", "--format=%H", "--diff-filter=A", "origin/main", "--", "held/x.txt")}~1`);
    const behind = await aleph(["report", "--hook"]);
    expect(behind.json.hookSpecificOutput.additionalContext).toMatch(/repo is \d+ commits? behind origin\/main; git pull brings:\n[\s\S]*held\/x\.txt/);
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
    const quiet = await aleph(["report", "--hook"]);
    expect(quiet.stdout.trim()).toBe("");
    await fjob("fhook", "error");
    const h = await aleph(["report", "--hook"]);
    expect(h.json.hookSpecificOutput.additionalContext).toContain("fac/fhook stuck: API Error: 500");
    expect(h.json.systemMessage).toContain("fac/fhook stuck");
    await aleph(["drop", "fhook"]);
  });

  test("a failed probe starts no run and puts a health line in the report", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: false, failed: ["read ~/.ssh"] }));
    const id = (await aleph(["todo", "add", "fac", "blocked by the probe", "--labels", "goal"])).json.added;
    const t = await aleph(["tick"]);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped[0]).toContain("failed: read ~/.ssh");
    expect((await aleph(["report"])).stdout).toContain("health: the sandbox probe at");
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });

  test("the nightly sweep files one proposal per stale package, once, and a moved latest files one more", async () => {
    const table = (latest: string) => [
      "| Package          | Current | Update | Latest |",
      "|------------------|---------|--------|--------|",
      "| left-pad         | 1.0.0   | 1.0.0  | 1.2.0  |",
      `| typescript (dev) | 5.8.3   | 5.9.2  | ${latest} |`,
    ].join("\n");
    const cmd = join(base, "outdated.sh");
    // The probe runs with the tick; the hook makes it pass without the sandbox.
    const give = (latest: string) => writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n${table(latest)}\nEOF\n`, { mode: 0o755 });
    const stale = () => rmSync(join(base, "factory", "probe.json"), { force: true });
    const proposals = async () => ((await aleph(["todo", "list", "fac", "--json"])).json as any[]).filter((r) => r.title.startsWith("Update "));
    // The sweep files into the fac list, and the store has no list until an item is added to it.
    await aleph(["todo", "add", "fac", "the list the nightly sweep files into", "--body", "Added so that fac has a list on main."]);
    give("5.9.2");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "fail" });
    expect(await proposals()).toHaveLength(0);
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    const first = await proposals();
    expect(first.map((r) => r.title).sort()).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update typescript 5.8.3 to 5.9.2"]);
    for (const r of first) {
      const item = (await aleph(["todo", "show", "fac", String(r.id), "--json"])).json;
      expect(item.labels).toEqual(["proposal", "deps"]);
    }
    const rep = (await aleph(["report"])).stdout;
    expect(rep).toContain("Update left-pad 1.0.0 to 1.2.0");
    expect((await aleph(["report"])).stdout).not.toContain("Update left-pad");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect(await proposals()).toHaveLength(2);
    give("5.9.3");
    stale();
    await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
    expect((await proposals()).map((r) => r.title)).toContain("Update typescript 5.8.3 to 5.9.3");
    expect(await proposals()).toHaveLength(3);
    for (const r of await proposals()) await aleph(["todo", "drop", "fac", String(r.id), "test over"]);
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  }, 120_000);

  test("the nightly sweep logs a repo with no list and still files the next repo's proposals", async () => {
    const cmd = join(base, "outdated-nolist.sh");
    writeFileSync(cmd, `#!/bin/bash\ncat <<'EOF'\n| Package | Current | Update | Latest |\n|---------|---------|--------|--------|\n| left-pad | 1.0.0 | 1.0.0 | 1.2.0 |\nEOF\n`, { mode: 0o755 });
    const reg = readFileSync(join(base, "repos.json"), "utf8");
    // "nolist" comes first, so the sweep must go on past it to "fac".
    writeFileSync(join(base, "repos.json"), JSON.stringify({ nolist: { path: repo, sandbox: true, checks: [], autoland: false }, ...JSON.parse(reg) }));
    try {
      rmSync(join(base, "factory", "probe.json"), { force: true });
      await aleph(["tick"], { ALEPH_OUTDATED_CMD: cmd, ALEPH_PROBE_FAKE: "pass" });
      expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toMatch(/deps nolist: .*no list/);
      const rows = ((await aleph(["todo", "list", "fac", "--json"])).json as any[]).filter((r) => r.title.startsWith("Update "));
      expect(rows.map((r) => r.title)).toContain("Update left-pad 1.0.0 to 1.2.0");
      for (const r of rows) await aleph(["todo", "drop", "fac", String(r.id), "test over"]);
    } finally {
      writeFileSync(join(base, "repos.json"), reg);
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    }
  }, 120_000);

  test("a tick starts one run per open goal, lands it, and then has nothing to start", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id =(await aleph(["todo", "add", "fac", "ship the goal", "--labels", "goal", "--body", "-"], {}, "ACTION: commit goal.txt\n")).json.added;
    const t = await aleph(["tick"]);
    expect(t.json.skipped).toEqual([]);
    expect(t.json.started).toEqual([`fac-${id}`]);
    const runs = readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${id}-`)).sort();
    expect(runs.map((d) => [state(d).kind, state(d).state])).toEqual([["agent", "passed"], ["land", "landed"]]);
    expect((await aleph(["todo", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Item: fac-${id}`);
    expect((await aleph(["tick"])).json.started).toEqual([]);
  }, 30_000);

  test("a tick skips a goal whose job is stuck, and the cap stops it", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id =(await aleph(["todo", "add", "fac", "a stuck goal", "--labels", "goal", "--body", "-"], {}, "ACTION: error\n")).json.added;
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
    const again = await aleph(["tick"]);
    expect(again.json.started).toEqual([]);
    expect(again.json.skipped).toEqual([expect.stringContaining(`Held: fac-${id} is stuck`)]);
    await aleph(["drop", `fac-${id}`]);
    const capped = await aleph(["tick"], { ALEPH_DAY_CAP: "0" });
    expect(capped.json.started).toEqual([]);
    expect(capped.json.skipped).toContain(`fac-${id}: cap of 0 runs in 24 hours`);
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 30_000);

  test("caps.json sets the day cap, and ALEPH_DAY_CAP wins over it", async () => {
    const file = join(base, "factory", "caps.json");
    const own = { ALEPH_JOBS_DIR: join(base, "caps-jobs") };
    mkdirSync(own.ALEPH_JOBS_DIR);
    const ids: number[] = [];
    for (const n of [1, 2, 3]) ids.push((await aleph(["todo", "add", "fac", `caps goal ${n}`, "--labels", "goal", "--body", "-"], {}, "ACTION: error\n")).json.added);
    mkdirSync(join(base, "factory"), { recursive: true });
    // A fresh passing probe, so the tick does not run the sandbox probe when this test runs alone.
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    writeFileSync(file, JSON.stringify({ day: 2 }));
    try {
      const t = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "" });
      expect(t.json.started.length).toBe(2);
      expect(t.json.skipped.some((x: string) => x.includes("cap of 2 runs in 24 hours"))).toBe(true);
      expect((await aleph(["report"], { ...own, ALEPH_DAY_CAP: "" })).stdout).toContain("of 2");
      // the two runs fail and hold the factory; drop them so the next tick can start one
      for (const job of t.json.started) await aleph(["drop", job], own);
      const wins = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "3" });
      expect(wins.json.started.length).toBe(1);
    } finally {
      rmSync(file, { force: true });
      for (const id of ids) await aleph(["todo", "drop", "fac", String(id), "test over"]);
    }
  }, 60_000);

  test("a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it", async () => {
    // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const stuckId = (await aleph(["todo", "add", "fac", "the stuck one", "--labels", "goal", "--body", "-"], {}, "ACTION: error\n")).json.added;
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${stuckId}`]);
    const id = (await aleph(["todo", "add", "fac", "behind the hold", "--labels", "goal", "--body", "-"], {}, "ACTION: commit behind.txt\n")).json.added;
    const d = await aleph(["dispatch"]);
    expect(d.json.started).toEqual([]);
    expect(d.json.held).toContain(`Held: fac-${stuckId} is stuck`);
    expect(d.json.skipped).toEqual([d.json.held]);
    expect((await aleph(["tick"])).json.held).toContain(`fac-${stuckId}`);
    expect((await aleph(["report"])).stdout).toContain(`Held: fac-${stuckId} is stuck`);
    // a run that passes waits, and lands once the hold clears
    const r = await fjob("fheld", "commit fheld.txt", {}, ["--land"]);
    expect(state(r.json.run).state).toBe("passed");
    expect(file(r.json.run, "next.log")).toContain("held:");
    expect((await aleph(["dispatch"])).json.landed).toBeUndefined();
    expect(state(r.json.run).state).toBe("passed");
    // pause and the hold are independent
    await aleph(["pause"]);
    await aleph(["resume"]);
    expect((await aleph(["dispatch"])).json.held).toContain(`fac-${stuckId}`);
    // Chris's land still works while held
    const other2 = await fjob("fheld2", "commit fheld2.txt");
    expect(state((await aleph(["land", "fheld2"])).json.run).state).toBe("landed");
    expect(other2.code).toBe(0);
    await aleph(["drop", `fac-${stuckId}`]);
    await aleph(["todo", "drop", "fac", String(stuckId), "test over"]);
    await aleph(["pause"]);
    expect((await aleph(["dispatch"])).json).toMatchObject({ paused: true });
    await aleph(["resume"]);
    const free = await aleph(["dispatch"]);
    expect(free.json.held).toBeUndefined();
    expect(free.json.landed).toEqual(["fheld"]);
    expect(free.json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", `fac-${id}`]);
    await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 60_000);

  test("a stuck or failed run holds the factory only once no next run is pending for it", async () => {
    // Runs written as the ledger holds them: a conflicted land that goes back to its worker, and a stuck run.
    const made: string[] = [];
    const run = (name: string, extra: Record<string, unknown>) => {
      const folder = join(jobsDir, `${new Date().toISOString().slice(0, 19).replace(/:/g, "").replace("T", "-")}-fac-${name}-${extra.kind ?? "agent"}`);
      mkdirSync(folder);
      writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: name, name, repo: "fac", told: true, started: new Date().toISOString(), ...extra }));
      made.push(folder);
      return folder;
    };
    const land = { kind: "land", state: "failed", reason: "merge conflict", conflicts: ["x.txt"] };
    const pending = run("fheldland", { ...land, next: "worker", ended: new Date().toISOString() });
    expect((await aleph(["dispatch"])).json.held).toBeUndefined();
    writeFileSync(join(pending, "state.json"), JSON.stringify({ ...state(pending.split("/").pop()!), next: undefined }));
    expect((await aleph(["dispatch"])).json.held).toContain("Held: fheldland is failed");
    // a stuck run whose unit is still live does not hold; once the unit ends, it does
    const live = run("fstuck", { state: "stuck", reason: "tests" });
    const unit = Bun.spawn(["sh", "-c", "sleep 60", live], { stdout: "ignore", stderr: "ignore" });
    writeFileSync(join(live, "pid"), String(unit.pid));
    expect((await aleph(["dispatch"])).json.held).not.toContain("fstuck");
    unit.kill();
    await unit.exited;
    writeFileSync(join(live, "exit"), "0\n");
    expect((await aleph(["dispatch"])).json.held).toContain("Held: fheldland and 1 more are");
    for (const f of made) rmSync(f, { recursive: true, force: true });
  }, 60_000);


});
