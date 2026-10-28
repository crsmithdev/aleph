import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, jobsDir, other, remote, repo, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);


  describe("recheck", () => {
    const red = () => {
      sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
      writeFileSync(join(other, "FAIL"), "red\n");
      sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
    };
    const mend = (...extra: [string, string][]) => {
      sh(other, "git", "rm", "-q", "FAIL");
      for (const [f, text] of extra) { writeFileSync(join(other, f), text); sh(other, "git", "add", f); }
      sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
    };
    const agentRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.endsWith(`-fac-${name}-agent`));
    const kinds = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => state(d).kind);
    const NOFIX = { ALEPH_FIX_ROUNDS: "0" };

    test("a job stuck on a failed check passes once main is fixed, keeps the worker's commit and starts no worker", async () => {
      red();
      const r = await fjob("rc1", "commit rc1.txt", NOFIX);
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
      const worker = sh(repo, "git", "rev-parse", "factory/rc1");
      mend();
      const c = await aleph(["recheck", "rc1"], NOFIX);
      expect(c.code).toBe(0);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", state: "passed", job: r.json.job });
      expect(kinds("rc1")).toEqual(["agent", "recheck"]);
      expect(agentRuns("rc1")).toHaveLength(1);
      expect(sh(repo, "git", "merge-base", "--is-ancestor", worker, "factory/rc1")).toBe("");
      expect(sh(repo, "git", "log", "--format=%s", "factory/rc1")).toContain("add rc1.txt");
      expect(sh(repo, "git", "ls-tree", "--name-only", "factory/rc1")).not.toContain("FAIL");
      const l = await aleph(["land", "rc1"]);
      expect(state(l.json.run).state).toBe("landed");
    }, 60_000);

    test("refuses a running, passed or landed job, and one whose branch is gone", async () => {
      const p = await fjob("rc2", "commit rc2.txt");
      expect(state(p.json.run).state).toBe("passed");
      const refused = await aleph(["recheck", "rc2"]);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("rc2 is passed, not stuck or failed");
      await aleph(["land", "rc2"]);
      const landed = await aleph(["recheck", "rc2"]);
      expect(landed.code).toBe(1);
      expect(landed.stderr).toContain("no open job named rc2");
      red();
      const s = await fjob("rc3", "commit rc3.txt", NOFIX);
      expect(state(s.json.run).state).toBe("stuck");
      const file = join(jobsDir, s.json.run, "state.json");
      const saved = readFileSync(file, "utf8");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), state: "running" }));
      const running = await aleph(["recheck", "rc3"]);
      expect(running.code).toBe(1);
      expect(running.stderr).toMatch(/rc3 is running/);
      writeFileSync(file, saved);
      sh(repo, "git", "branch", "-D", "factory/rc3");
      const gone = await aleph(["recheck", "rc3"]);
      expect(gone.code).toBe(1);
      expect(gone.stderr).toContain("rc3 has no branch");
      mend();
      await aleph(["drop", "rc3"]);
    }, 60_000);

    test("a merge of main that conflicts ends stuck and names the files", async () => {
      red();
      const r = await fjob("rc4", "commit-fixed rc4.txt", NOFIX);
      expect(state(r.json.run).state).toBe("stuck");
      mend(["rc4.txt", "different\n"]);
      const c = await aleph(["recheck", "rc4"], NOFIX);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", state: "stuck", conflicts: ["rc4.txt"] });
      expect(state(c.json.run).reason).toContain("rc4.txt");
      expect(kinds("rc4")).toEqual(["agent", "recheck"]);
      await aleph(["drop", "rc4"]);
    }, 60_000);
  });

  test("a tick triages an open issue that is not a goal, and its line counts the verdicts", async () => {
    const cmd = join(base, "triage-fake");
    writeFileSync(cmd, `#!/bin/bash\ncat > /dev/null\necho '{"verdict":"live","note":"check the live site"}'\n`, { mode: 0o755 });
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id = (await aleph(["todo", "add", "fac", "needs a live look"])).json.added;
    const first = (await aleph(["todo", "list", "fac", "--json"])).json.filter((i: any) => i.status === "open" && !i.labels.some((l: string) => ["goal", "needs-chris", "triaged", "proposal"].includes(l)))[0];
    const t = await aleph(["tick"], { ALEPH_TRIAGE_CAP: "1", ALEPH_TRIAGE_CMD: cmd });
    expect(t.json.triaged).toEqual({ live: 1 });
    expect((await aleph(["todo", "show", "fac", String(first.id), "--json"])).json.labels).toEqual(expect.arrayContaining(["live-check", "triaged"]));
    expect(readdirSync(jobsDir).filter((d) => d.endsWith("-triage")).map((d) => state(d).kind)).toContain("triage");
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("triaged live 1");
    expect(id).toBeGreaterThan(0);
  }, 30_000);

  test("a tick starts no run while the waiting cap binds, and a drop frees a place", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const env = { ALEPH_WAITING_CAP: "2" };
    await fjob("fwait1", "commit held/w1.txt");
    await fjob("fwait2", "commit held/w2.txt");
    const id = (await aleph(["todo", "add", "fac", "behind the cap", "--labels", "goal", "--body", "-"], {}, "ACTION: commit capped.txt\n")).json.added;
    const t = await aleph(["tick"], env);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toContain(`fac-${id}: 2 runs wait for Chris`);
    expect((await aleph(["report"], env)).stdout).toContain("health: 2 runs wait for Chris; no new run starts");
    await aleph(["drop", "fwait1"]);
    expect((await aleph(["tick"], env)).json.started).toEqual([`fac-${id}`]);
    await aleph(["drop", "fwait2"]);
  }, 30_000);

  test("pause stops the tick and the unit's follow-up land, but not Chris's land", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    expect((await aleph(["pause"])).json).toEqual({ paused: true });
    const id = (await aleph(["todo", "add", "fac", "while paused", "--labels", "goal", "--body", "-"], {}, "ACTION: commit paused.txt\n")).json.added;
    expect((await aleph(["tick"])).json).toMatchObject({ started: [], paused: true });
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain("paused");
    const r = await fjob("fpaused", "commit fpaused.txt", {}, ["--land"]);
    expect(state(r.json.run).state).toBe("passed");
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("paused");
    const l = await aleph(["land", "fpaused"]);
    expect(state(l.json.run).state).toBe("landed");
    expect((await aleph(["resume"])).json).toEqual({ paused: false });
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
  }, 30_000);

  test("a red main starts no run, is checked once per commit, and clears with a passing commit", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "FAIL"), "red\n");
    sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
    const sha7 = remoteGit("rev-parse", "main").slice(0, 7);
    const id = (await aleph(["todo", "add", "fac", "wait for green", "--labels", "goal", "--body", "-"], {}, "ACTION: commit green.txt\n")).json.added;
    const before = trees();
    const t = await aleph(["tick"]);
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect((await aleph(["report"])).stdout).toContain(`health: fac main is red at ${sha7}: tests`);
    expect(trees()).toBe(before);
    expect((await aleph(["tick"])).json.skipped).toEqual([`fac-${id}: main is red at ${sha7}: tests`]);
    expect(trees()).toBe(before);
    sh(other, "git", "rm", "-q", "FAIL"); sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
    expect(trees()).toBeGreaterThan(before);
    expect((await aleph(["report"])).stdout).not.toContain("main is red");
  }, 60_000);

  test("two dispatches at once run the baseline once; the second reports it running", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const trees = () => existsSync(join(base, "trees")) ? readFileSync(join(base, "trees"), "utf8").trim().split("\n").length : 0;
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "new.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "new.txt"); sh(other, "git", "commit", "-qm", "new commit"); sh(other, "git", "push", "-q", "origin", "main");
    const id = (await aleph(["todo", "add", "fac", "baseline once", "--labels", "goal", "--body", "-"], {}, "ACTION: commit once.txt\n")).json.added;
    const before = trees();
    writeFileSync(join(base, "slowbase"), "");
    const first = aleph(["tick"]);
    for (let i = 0; i < 300 && trees() === before; i++) await Bun.sleep(100);
    const second = await aleph(["tick"]);
    expect(second.json.started).toEqual([]);
    expect(second.json.skipped).toEqual([`fac-${id}: main baseline running`]);
    expect(trees() - before).toBe(1);
    rmSync(join(base, "slowbase"));
    expect((await first).json.started).toEqual([`fac-${id}`]);
  }, 60_000);

  test("a baseline whose checks cannot start records no red, and the next dispatch runs it again", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "new.txt"), `${Math.random()}\n`);
    sh(other, "git", "add", "new.txt"); sh(other, "git", "commit", "-qm", "another commit"); sh(other, "git", "push", "-q", "origin", "main");
    const id = (await aleph(["todo", "add", "fac", "baseline retried", "--labels", "goal", "--body", "-"], {}, "ACTION: commit retried.txt\n")).json.added;
    const broken = join(base, "broken-sandbox");
    // Only the baseline's script fails to start; the probe and the runs go through.
    writeFileSync(broken, `#!/bin/bash\ncase "\${@: -1}" in *base.bundle*) exit 3 ;; esac\nexec ${join(base, "pass")} "$@"\n`, { mode: 0o755 });
    const t = await aleph(["tick"], { ALEPH_SANDBOX_CMD: broken });
    expect(t.json.started).toEqual([]);
    expect(t.json.skipped[0]).toContain(`fac-${id}: main is unchecked: checks did not start`);
    expect((await aleph(["report"])).stdout).not.toContain("main is red");
    expect((await aleph(["tick"])).json.started).toEqual([`fac-${id}`]);
  }, 60_000);

});
