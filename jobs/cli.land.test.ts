import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, branchExists, file, itemsRemote, job, jobsDir, moveMain, remote, repo, sh, state, told, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("land", () => {
  const remoteHead = () => sh(base, "git", "--git-dir", remote, "rev-parse", "main");

  test("a job that has not passed is refused", async () => {
    await job("unpassed", "exit3");
    const r = await aleph(["land", "unpassed"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unpassed is failed, not passed");
    await aleph(["drop", "unpassed"]);
  });

  test("a passed job lands as one commit on main, and the main checkout follows", async () => {
    await job("shipit", "commit ship.txt");
    const before = remoteHead();
    const r = await aleph(["land", "shipit"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", told: true });
    expect(remoteHead()).toBe(s.commit);
    expect(sh(base, "git", "--git-dir", remote, "log", "-1", "--format=%s%n%b%n%P", "main")).toBe(`add ship.txt\nJob: ${r.json.job}\n\n${before}`);
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(s.commit);
    expect(existsSync(worktree("shipit"))).toBe(false);
    expect(branchExists("shipit")).toBe(false);
    expect(told).toContain("demo/shipit landed");
    expect(file(r.json.run, "land.log")).toContain("## push: ok");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "shipit")).toMatchObject({ state: "landed" });
  });

  test("a manual check does not gate the land; --checked lands with no check open", async () => {
    await job("phoneland", "commit android/land.txt");
    const ok = await aleph(["land", "phoneland", "--checked"]);
    expect(state(ok.json.run).state).toBe("landed");
    expect(state(ok.json.run).check).toBeUndefined();
    expect((await aleph(["jobs", "phoneland"])).json.check).toBeUndefined();
  });

  test("a job with a manual check lands with the check open as a to-do item, until checked", async () => {
    await job("phonelater", "commit android/later.txt");
    const r = await aleph(["land", "phonelater"]);
    expect(r.code).toBe(0);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", check: "open", say: "run it on the phone" });
    expect(remoteHead()).toBe(s.commit);
    const item = (await aleph(["issue", "show", "demo", String(s.checkItem), "--json"])).json;
    expect(item).toMatchObject({ title: "Check phonelater: run it on the phone", status: "open", areas: ["check"] });
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("android/later.txt");
    expect(told).toContain("demo/phonelater landed; check open");
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ check: "open" });

    const c = await aleph(["checked", "phonelater"]);
    expect(c.code).toBe(0);
    expect((await aleph(["jobs", "phonelater"])).json).toMatchObject({ state: "landed", check: "done" });
    expect((await aleph(["jobs"])).json.find((j: any) => j.name === "phonelater")).toMatchObject({ state: "landed", check: "done" });
    expect((await aleph(["issue", "show", "demo", String(s.checkItem), "--json"])).json.status).toBe("done");
    const again = await aleph(["checked", "phonelater"]);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain("phonelater has no open check");
  });

  test("in a repo that lands by itself, a passed job lands with no aleph land", async () => {
    const r = await job("selfland", "commit selfland.txt", {}, "auto");
    expect(state(r.json.run)).toMatchObject({ state: "passed", next: "land" });
    const runs = readdirSync(jobsDir).filter((d) => d.includes("-auto-selfland-")).sort();
    expect(runs.map((d) => state(d).kind)).toEqual(["agent", "land"]);
    expect(state(runs[1])).toMatchObject({ state: "landed" });
    expect(remoteHead()).toBe(state(runs[1]).commit);
    expect(told).toContain("auto/selfland passed; landing");
  });

  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

  test("a push that loses a race merges again in the same land, and lands", async () => {
    await job("racer", "commit race/x.txt");
    moveMain();
    writeFileSync(join(base, "race-once"), "");
    const r = await aleph(["land", "racer"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "land.log")).toContain("## main moved; merging again");
    expect(runsOf("racer").map((x) => x.kind)).toEqual(["agent", "land"]);
    expect(sh(base, "git", "--git-dir", remote, "log", "-2", "--format=%s", "main")).toBe("add race/x.txt\nrace");
  });

  test("a to-do write during the checks goes to the work store and leaves the land's main alone", async () => {
    await job("patient", "commit todo-race/patient.txt");
    moveMain();
    const before = remoteHead();
    writeFileSync(join(base, "todo-once"), "");
    const l = await aleph(["land", "patient"]);
    const s = state(l.json.run);
    expect(s).toMatchObject({ state: "landed" });
    expect(sh(base, "git", "--git-dir", remote, "rev-parse", `${s.commit}~1`)).toBe(before);
    expect(sh(base, "git", "--git-dir", itemsRemote, "show", "main:demo/backlog/tasks/demo-1.md")).toContain("during the land");
  }, 30_000);

  test("two lands at once in one repo both reach main, neither undoing the other", async () => {
    await job("left", "commit pair/left.txt");
    await job("right", "commit pair/right.txt");
    const [l, r] = await Promise.all([aleph(["land", "left"]), aleph(["land", "right"])]);
    expect([state(l.json.run).state, state(r.json.run).state]).toEqual(["landed", "landed"]);
    expect(sh(base, "git", "--git-dir", remote, "ls-tree", "--name-only", "main:pair").split("\n")).toEqual(["left.txt", "right.txt"]);
    expect(sh(base, "git", "--git-dir", remote, "log", "-2", "--format=%s", "main").split("\n").sort()).toEqual(["add pair/left.txt", "add pair/right.txt"]);
  }, 30_000);

  test("a land changes no checkout: the main checkout's HEAD, index and working tree stay as they were", async () => {
    await job("still", "commit still.txt");
    writeFileSync(join(repo, "README"), "local edit\n");
    const before = [sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")];
    const r = await aleph(["land", "still"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).reason).toBeUndefined();
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain"), sh(repo, "git", "diff")]).toEqual(before);
    sh(repo, "git", "checkout", "README");
  });
});
