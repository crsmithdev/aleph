import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { allRuns } from "./lib/records/ledger.ts";
import { join } from "node:path";
import { aleph, base, branchExists, section, itemsRemote, moveMain, remote, repo, seedItem, sh, state, told, worktree, setup, teardown } from "./cli.testkit";
import { actionJob as job, checked, drop, issueShow, jobView, land } from "./flow.testkit.ts";

beforeAll(setup);
afterAll(teardown);

// `aleph land` and `aleph jobs` keep one CLI test each, for their wiring; the other cases call the transitions in-process.
describe("land", () => {
  const remoteHead = () => sh(base, "git", "--git-dir", remote, "rev-parse", "main");

  test("a job that has not passed is refused", async () => {
    await job("unpassed", "exit3");
    const r = await land("unpassed");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unpassed is failed, not passed");
    await drop("unpassed");
  });

  test("a passed job lands as one commit on main, and the main checkout follows", async () => {
    const built = await job("shipit", "commit ship.txt");
    const before = remoteHead();
    const r = await aleph(["land", "shipit"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ role: "land", state: "landed", told: true });
    expect(remoteHead()).toBe(s.commit);
    expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s%n%b%n%P", "main")).toBe(`add ship.txt\nJob: ${built.json.run}\n\n${before}`);
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(s.commit);
    expect(existsSync(worktree("shipit"))).toBe(false);
    expect(branchExists("shipit")).toBe(false);
    expect(told).toContain(`${r.json.run} landed`);
    expect(section(r.json.run, "land")).toContain("## push: ok");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "shipit")).toMatchObject({ state: "landed" });
  });

  test("a manual check does not gate the land; --checked lands with no check open", async () => {
    await job("phoneland", "commit android/land.txt");
    const ok = await land("phoneland", { checked: true });
    expect(state(ok.json.run).state).toBe("landed");
    expect(state(ok.json.run).check).toBeUndefined();
    expect((await jobView("phoneland")).json.check).toBeUndefined();
  });

  test("a job with a manual check lands with the check open as a to-do item, until checked", async () => {
    await job("phonelater", "commit android/later.txt");
    const r = await land("phonelater");
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ role: "land", state: "landed", check: "open", say: "run it on the phone" });
    expect(remoteHead()).toBe(s.commit);
    const item = (await issueShow("demo", s.checkItem)).json;
    expect(item).toMatchObject({ title: "run it on the phone", status: "open", areas: [] });
    expect(item.title).not.toContain(": ");
    expect(item.request).toContain("phonelater");
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("android/later.txt");
    expect(told).toContain(`${r.json.run} landed`);
    // The list of `aleph jobs` is built in cli/cli.ts, not in a library: a landed job stays in it while its check is open.
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ check: "open" });

    const c = await checked("phonelater");
    expect(c.code).toBe(0);
    expect((await jobView("phonelater")).json).toMatchObject({ state: "landed", check: "done" });
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ state: "landed", check: "done" });
    expect((await issueShow("demo", s.checkItem)).json.status).toBe("done");
    const again = await checked("phonelater");
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("phonelater has no open check");
  });

  test("a land started after the wall clock steps back sorts after its build run", async () => {
    // WSL2 steps the wall clock back by about a second: a run's stamp must still come after its job's earlier runs.
    const b = await job("stepback", "commit stepback.txt");
    setSystemTime(new Date(Date.parse(state(b.json.run).started) - 1000));
    let r;
    try {
      r = await land("stepback");
    } finally {
      setSystemTime();
    }
    const runs = allRuns().filter((e) => e.run.name === "stepback").map((e) => e.id);
    expect(runs).toEqual([b.json.run, r.json.run]);
    expect((await jobView("stepback")).json).toMatchObject({ run: { role: "land" }, state: "landed" });
  });

  test("in a repo that lands by itself, a passed job lands with no aleph land", async () => {
    const r = await job("selfland", "commit selfland.txt", {}, "auto");
    expect(state(r.json.run)).toMatchObject({ state: "passed", next: "land" });
    const runs = allRuns().filter((e) => e.run.name === "selfland").map((e) => e.id);
    expect(runs.map((d) => state(d).role)).toEqual(["build", "land"]);
    expect(state(runs[1])).toMatchObject({ state: "landed" });
    expect(remoteHead()).toBe(state(runs[1]).commit);
    expect(told).toContain(`${runs[0]} passed`);
  });

  test("a to-do write during the checks goes to the work store and leaves the land's main alone", async () => {
    // The check notes demo-1. An item made here makes sure demo-1 exists, whether or not the manual-check test ran first.
    seedItem("demo", "the item the check notes");
    await job("patient", "commit todo-race/patient.txt");
    moveMain();
    const before = remoteHead();
    writeFileSync(join(base, "todo-once"), "");
    const l = await land("patient");
    const s = state(l.json.run);
    expect(s).toMatchObject({ state: "landed" });
    expect(sh(base, "git", "--git-dir", remote, "rev-parse", `${s.commit}~1`)).toBe(before);
    expect(sh(base, "git", "--git-dir", itemsRemote, "show", "main:issues/1/issue.md")).toContain("during the land");
  }, 30_000);

  test("a land changes no checkout: the main checkout's HEAD, index and working tree stay as they were", async () => {
    await job("still", "commit still.txt");
    writeFileSync(join(repo, "README"), "local edit\n");
    const before = [sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")];
    const r = await land("still");
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).reason).toBeUndefined();
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")]).toEqual(before);
    sh(repo, "git", "checkout", "README");
  });
});
