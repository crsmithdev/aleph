import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { parseOutdated, propose } from "./deps.ts";
import { type Repo } from "./ledger.ts";

const TABLE = `
| Package          | Current | Update | Latest |
|------------------|---------|--------|--------|
| left-pad         | 1.0.0   | 1.0.0  | 1.2.0  |
| typescript (dev) | 5.8.3   | 5.9.2  | 5.9.2  |
| same             | 2.0.0   | 2.0.0  | 2.0.0  |
`;

test("a bun outdated table gives one proposal per package whose latest is newer", () => {
  expect(parseOutdated(TABLE)).toEqual([
    { name: "left-pad", current: "1.0.0", latest: "1.2.0" },
    { name: "typescript", current: "5.8.3", latest: "5.9.2" },
  ]);
});

test("the box-drawing table parses the same, and noise gives nothing", () => {
  expect(parseOutdated("│ Package │ Current │ Update │ Latest │\n│ a │ 1.9.0 │ 1.9.0 │ 1.10.0 │\n")).toEqual([{ name: "a", current: "1.9.0", latest: "1.10.0" }]);
  expect(parseOutdated("bun outdated v1.4.2\nnothing to do\n")).toEqual([]);
});

describe("propose", () => {
  const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const keys = ["ALEPH_ITEMS", "ALEPH_FACTORY_DIR", ...Object.keys(gitEnv)];
  const saved: Record<string, string | undefined> = {};
  let base: string;
  const sh = (cwd: string, ...args: string[]) => {
    const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  };

  const commits = () => {
    const p = Bun.spawnSync(["git", "--git-dir", join(base, "items.git"), "rev-list", "--count", "main"], { stdout: "pipe" });
    return Number(p.stdout.toString().trim());
  };

  beforeAll(() => {
    for (const k of keys) saved[k] = process.env[k];
    base = mkdtempSync(join(tmpdir(), "aleph-deps-"));
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
    sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
    sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(join(base, "items"), "git", "push", "-q", "origin", "main");
    Object.assign(process.env, gitEnv, { ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory") });
  });
  afterAll(() => {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(base, { recursive: true, force: true });
  });

  test("files a proposal once, and an item with the same title is reused, not filed again", () => {
    const repo = { key: "dp1" } as Repo;
    writeList(repo, "start", (doc) => { todos.add(doc, "Update left-pad 1.0.0 to 1.2.0", {}); return true; }, true);
    const found = [{ name: "left-pad", current: "1.0.0", latest: "1.2.0" }, { name: "a", current: "1.9.0", latest: "1.10.0" }];
    expect(propose(repo, found)).toEqual(["dp1-1 Update left-pad 1.0.0 to 1.2.0", "dp1-2 Update a 1.9.0 to 1.10.0"]);
    expect(readList(repo)!.items.map((i) => i.title)).toEqual(["Update left-pad 1.0.0 to 1.2.0", "Update a 1.9.0 to 1.10.0"]);
    const before = commits();
    expect(propose(repo, found)).toEqual([]);
    expect(readList(repo)!.items).toHaveLength(2);
    expect(commits()).toBe(before);
  });
});
