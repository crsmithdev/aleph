// Archived goal tests from jobs/cli.factory.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, remote, repo, sh, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  test("the land pushes the tested tree with Issue and Job trailers, and the clean main checkout follows", async () => {
    const id = (await aleph(["issue", "add", "fac", "a factory item"])).json.added;
    const j = await fjob("fitem", "commit fitem.txt", {}, ["--on", String(id)]);
    const s0 = state(j.json.run);
    expect(s0).toMatchObject({ kind: "build", on: `fac-${id}`, condition: "passed" });
    expect(s0.todo).toBeUndefined();
    expect(j.json.run).toEndWith("-build");
    // An item with no hidden files runs the plain checks and writes no hidden.log.
    expect(s0.checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
    expect(existsSync(join(jobsDir, j.json.run, "hidden.log"))).toBe(false);
    const r = await aleph(["land", "fitem"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", condition: "landed", on: `fac-${id}` });
    const shown = (await aleph(["report"])).stdout;
    expect(shown).toContain("delivered:");
    expect(shown).toContain("checked by: tests");
    expect(shown).toMatch(/look: about \d+ min \(estimate\)/);
    expect(remoteGit("log", "-1", "--format=%B", "main").trim()).toBe(`add fitem.txt\n\nIssue: fac-${id}\nJob: ${j.json.job}`);
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main").trim()).toBe(`Issue: fac-${id}\nJob: ${j.json.job}`);
    expect(readFileSync(join(base, "trees"), "utf8").trim().split("\n").at(-1)).toBe(remoteGit("rev-parse", "main^{tree}"));
    expect([sh(repo, "git", "rev-parse", "HEAD"), sh(repo, "git", "status", "--porcelain")]).toEqual([remoteGit("rev-parse", "main"), ""]);
    expect(factoryBranch("fitem")).toBe(false);
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect((await aleph(["status", `fac-${id}`])).stdout).toContain("done");
    expect(runsLeft()).toEqual([]);
  });

});
