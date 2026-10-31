import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, env, fakeLog, file, jobsDir, until, remote, repo, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  test("a change to an existing test goes to the reviewer; its hold needs a review; drop leaves the item open", async () => {
    const id = (await aleph(["issue", "add", "fac", "tests"])).json.added;
    const r = await aleph(["job", "fac", "ftest", "--spec", specFile("Goal: ftest REVIEW:hold\nACTION: commit old.test.ts\n"), "--todo", String(id)], { ALEPH_FIX_ROUNDS: "0" });
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "review", reason: expect.stringMatching(/^reviewer: hold|^reviewer: tests do not/) });
    expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).toContain("The diff changes the test old.test.ts");
    expect((await aleph(["drop", "ftest"])).code).toBe(0);
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("open");
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
    expect(file(run, "review2.md")).toContain("VERDICT: chris decide the held path");
    expect((await aleph(["jobs", "fheld"])).json.review2).toEqual({ verdict: "chris", reason: "decide the held path" });
    const before = remoteGit("rev-parse", "main");
    expect(remoteGit("rev-parse", "main")).toBe(before);
    const l = await aleph(["land", "fheld"]);
    expect(state(l.json.run)).toMatchObject({ state: "landed", held: true });
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
  });

  test("a held run landed with the firefighter as lander gets Held-by: firefighter, not Chris", async () => {
    const r = await fjob("fheldff", "commit held/y.txt");
    expect(state(r.json.run)).toMatchObject({ state: "needs-you", needs: "held" });
    const run = r.json.run;
    for (let i = 0; i < 100 && !file(run, "review2.md").includes("VERDICT"); i++) await Bun.sleep(100);
    const code = `import { land } from "${join(import.meta.dir, "lib/transitions.ts")}"; const s = await land("fheldff", { lander: "firefighter" }, { output: "ignore" }); await s.child?.exited;`;
    const p = Bun.spawn(["bun", "-e", code], { cwd: base, env: env(), stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    const landRun = readdirSync(jobsDir).filter((d) => d.endsWith("-land") || existsSync(join(jobsDir, d, "state.json"))).map((d) => state(d)).filter((x) => x.kind === "land" && x.name === "fheldff").at(-1);
    expect(landRun).toMatchObject({ state: "landed", held: true, lander: "firefighter" });
    const trailers = remoteGit("log", "-1", "--format=%(trailers:only)", "main");
    expect(trailers).toContain("Held-by: firefighter");
    expect(trailers).not.toContain("Held-by: Chris");
  });

  test("a review2 back goes to the worker as a fix round; after the last round the run needs Chris", async () => {
    const r = await fjob("fback", "commit held/back.txt REVIEW2:back");
    // A run's folder exists a moment before its state.json.
    const runs = () => readdirSync(jobsDir).filter((d) => d.includes("-fac-fback-") && existsSync(join(jobsDir, d, "state.json"))).sort().map((d) => ({ id: d, ...state(d) }));
    // The last run's reason is written after its review2 ends, so it is what to wait for.
    await until(() => runs().length === 3 && /^the reviewer sent it back/.test(runs()[2].reason ?? ""));
    const rs = runs();
    expect(rs.map((x) => x.state)).toEqual(["stuck", "stuck", "needs-you"]);
    expect(rs[0]).toMatchObject({ reason: "fix the held path", failed: "review", next: "worker", round: 0 });
    expect(rs[1]).toMatchObject({ failed: "review", round: 1 });
    expect(rs[2]).toMatchObject({ needs: "held", reason: "the reviewer sent it back twice: fix the held path" });
    expect(rs[2].next).toBeUndefined();
    expect(readFileSync(join(fakeLog, "prompt"), "utf8")).toContain("The reviewer sent this branch back: fix the held path");
    expect(r.json.run).toBe(rs[0].id);
    await aleph(["drop", "fback"]);
  }, 60_000);

  test("DEFAULT lines and the cost reach the report once; FOLLOWUP lines go to the log and file nothing", async () => {
    const r = await fjob("fdefault", "defaults");
    expect(state(r.json.run)).toMatchObject({ state: "passed", cost: 0.25, defaults: ["which colour? -> blue"] });
    const items = (await aleph(["issue", "list", "fac", "--label", "followup", "--json"])).json;
    expect(items.map((i: any) => i.title)).not.toContain("paint the fence");
    expect(readFileSync(join(base, "factory", "followups.log"), "utf8")).toContain("paint the fence");
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

  test("FLAKE lines become notes on the flake tracker; FOLLOWUP lines still go to the log", async () => {
    const before = (await aleph(["issue", "list", "fac", "--json"])).json.length;
    const r = await fjob("fflake", "flake");
    expect(state(r.json.run)).toMatchObject({ state: "passed" });
    const items = (await aleph(["issue", "list", "fac", "--json"])).json;
    expect(items.length).toBe(before + 1);
    expect((await aleph(["issue", "list", "fac", "--label", "followup", "--json"])).json.map((i: any) => i.title)).not.toContain("paint the fence");
    const tracker = (await aleph(["issue", "list", "fac", "--label", "flakes", "--json"])).json;
    expect(tracker).toHaveLength(1);
    const full = (await aleph(["issue", "show", "fac", String(tracker[0].id), "--json"])).json;
    expect(JSON.stringify(full)).toContain("job fflake: a.test.ts > slow one: timed out, passed alone");
    // An open tracker with fresh notes is a health line, so close it before the hook test wants silence.
    await aleph(["issue", "done", "fac", String(tracker[0].id), "test over"]);
    expect(readFileSync(join(base, "factory", "followups.log"), "utf8")).toContain("paint the fence");
    await aleph(["drop", "fflake"]);
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
});
