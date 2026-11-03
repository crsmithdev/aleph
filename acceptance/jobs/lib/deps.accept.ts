// Archived goal tests from jobs/lib/deps.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { readList, writeList } from "../../../todo/lib/store.ts";
import { outdatedScript, parseOutdated, propose } from "../../../jobs/lib/deps.ts";
import { type Repo } from "../../../jobs/lib/ledger.ts";
import { storeRepos } from "../../../tests/git-fixture.ts";


test("the box-drawing table parses the same, and noise gives nothing", () => {
  expect(parseOutdated("│ Package │ Current │ Update │ Latest │\n│ a │ 1.9.0 │ 1.9.0 │ 1.10.0 │\n")).toEqual([{ name: "a", current: "1.9.0", latest: "1.10.0" }]);
  expect(parseOutdated("bun outdated v1.4.2\nnothing to do\n")).toEqual([]);
});

describe("propose", () => {
  const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const keys = ["ALEPH_ISSUES", "ALEPH_FACTORY_DIR", ...Object.keys(gitEnv)];
  const saved: Record<string, string | undefined> = {};
  let base: string;

  const commits = () => {
    const p = Bun.spawnSync(["git", "--git-dir", join(base, "items.git"), "rev-list", "--count", "main"], { stdout: "pipe" });
    return Number(p.stdout.toString().trim());
  };

  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    base = mkdtempSync(join(tmpdir(), "aleph-deps-"));
    storeRepos(base);
    Object.assign(process.env, gitEnv, { ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") });
  });
  afterAll(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(base, { recursive: true, force: true });
  });

  test("files a proposal once, and an item with the same title is reused, not filed again", () => {
    const repo = { key: "dp1" } as Repo;
    writeList(repo, "start", (doc) => { issues.add(doc, "Update left-pad 1.0.0 to 1.2.0", {}); return true; }, true);
    const found = [{ name: "left-pad", current: "1.0.0", latest: "1.2.0" }, { name: "a", current: "1.9.0", latest: "1.10.0" }];
    expect(propose(repo, found)).toEqual(["dp1-1 Update left-pad to 1.2.0", "dp1-2 Update a to 1.10.0"]);
    expect(readList(repo)!.items.map((i) => i.title)).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update a to 1.10.0"]);
    const filed = readList(repo)!.items[1];
    expect(filed.fm).toMatchObject({ kind: "proposal", source: "deps", areas: [], ask: "approval", reason: "proposal" });
    expect(filed.fm.labels).toBeUndefined();
    const before = commits();
    expect(propose(repo, found)).toEqual([]);
    expect(readList(repo)!.items).toHaveLength(2);
    expect(commits()).toBe(before);
  });
});

test("the deps prelude carries both NO_SUBMODULES lines", async () => {
  const { NO_SUBMODULES } = await import("../../../jobs/lib/git.ts");
  const script = outdatedScript({ key: "k", main: "main", setup: [] } as unknown as Repo, "refs/remotes/origin/main");
  expect(script.split("\n")[0]).toContain(`git init -q . && ${NO_SUBMODULES.join(" && ")} && git fetch`);
});
