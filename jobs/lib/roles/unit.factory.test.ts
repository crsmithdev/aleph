import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeLog, file, repo, sh, state, told, setup, teardown, worktree } from "../../cli.testkit";
import { actionJob, drop, issueList } from "../../flow.testkit.ts";
import { conn } from "../../../lib/db.ts";
import { flakes } from "../gates/tables.ts";
import { AGENT_SETTINGS } from "../routing/models.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string) => actionJob(name, action, {}, "fac");
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  /** The worktrees of the repo outside its .worktrees folder: the detached ones of the checks and the reviewer. */
  const detached = () => sh(repo, "git", "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ") && !l.includes("/.worktrees/") && l !== `worktree ${repo}`);

  test("the worker commits on its branch in the job's worktree; the checks and the reviewer run in worktrees that go after", async () => {
    const r = await fjob("fpass", "commit fpass.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ role: "build", state: "passed", branch: "factory/fpass", worktree: worktree("fpass"), cost: 0.01, defaults: [] });
    expect(factoryBranch("fpass")).toBe(true);
    expect(sh(worktree("fpass"), "git", "symbolic-ref", "--short", "HEAD")).toBe("factory/fpass");
    expect(sh(repo, "git", "log", "-1", "--format=%s", "factory/fpass")).toBe("add fpass.txt");
    expect(detached()).toEqual([]);
    expect(file(r.json.run, "prompt.md")).toContain(`in \`${worktree("fpass")}\`, branch \`factory/fpass\`.\nWork only there.`);
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain(`--disable-slash-commands --settings ${AGENT_SETTINGS} --output-format stream-json --verbose --tools Read Write Edit Bash Grep Glob`);
    expect(s.checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
    for (const c of s.checks) expect(c).toMatchObject({ ok: true, seconds: expect.any(Number) });
  });

  test("the worker's environment cannot push to github or reach gh, and has no API key", () => {
    const env = readFileSync(join(fakeLog, "env"), "utf8");
    expect(env).toContain("GIT_CONFIG_VALUE_0=git@github.com:\n");
    expect(env).toMatch(/^GH_CONFIG_DIR=.*\/gh$/m);
    expect(env).not.toMatch(/^(ANTHROPIC_API_KEY|GH_TOKEN|GITHUB_TOKEN|CLAUDECODE)=./m);
  });

  test("an error result, no result, or no commit ends failed", async () => {
    const ferr = await fjob("ferr", "error");
    expect(state(ferr.json.run)).toMatchObject({ state: "failed", reason: "API Error: 500" });
    expect(state((await fjob("fnone", "noresult")).json.run)).toMatchObject({ state: "failed", reason: expect.stringContaining('"type":"assistant"') });
    expect(state((await fjob("fidle", "none")).json.run)).toMatchObject({ state: "failed", reason: "no commit" });
    expect(state((await fjob("fnoout", "nostructured")).json.run)).toMatchObject({ state: "failed", reason: "worker: no structured output" });
    expect(readFileSync(join(fakeLog, "args"), "utf8")).toContain("--json-schema");
    expect(told).toContain(`${ferr.json.run} failed other`);
    for (const n of ["ferr", "fnone", "ftrail", "fidle", "fnoout"]) await drop(n);
  });
});

describe("a worker's follow-ups and flakes", () => {
  test("each follow-up is a row in suggestions and each flake line a row in flaky, and no issue is filed", async () => {
    const before = ((await issueList("fac")).json as any[]).length;
    const r = await actionJob("fsugg", "flake", {}, "fac");
    expect(r.code, r.stderr).toBe(0);
    expect(conn().query("SELECT repo, run, who, title, location, saw, why, impact, risk, effort FROM suggestions WHERE run = 'fsugg'").all()).toEqual([
      { repo: "fac", run: "fsugg", who: "worker", title: "mend the gate", location: "a.ts:3", saw: "it fails", why: "it breaks a run", impact: 3, risk: 2, effort: 3 },
    ]);
    expect(flakes().filter((f) => f.run === "fsugg")).toMatchObject([{ repo: "fac", check: "worker", tests: ["a.test.ts > slow one: timed out, passed alone"] }]);
    expect(((await issueList("fac")).json as any[]).length).toBe(before);
    await drop("fsugg");
  }, 60_000);
});
