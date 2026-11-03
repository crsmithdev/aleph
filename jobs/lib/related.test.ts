import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChecks, buildTests, importMap, relatedTests, type ImportMap } from "./related.ts";
import type { Repo } from "./ledger.ts";

let dir: string;
let commit: string;
const sh = (...args: string[]) => Bun.spawnSync(args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).stdout.toString().trim();
const TESTS = ["**/*.test.ts"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-related-"));
  sh("git", "init", "-q", "-b", "main");
  const files: Record<string, string> = {
    "lib/a.ts": "export const a = 1;\n",
    "lib/b.ts": `import { a } from "./a";\nexport const b = a;\n`,
    "lib/b.test.ts": `import { b } from "./b.ts";\n`,
    "lib/dyn.test.ts": `const m = await import("../lib/a.ts");\n`,
    "cli.ts": `import "./lib/b.ts";\n`,
    "ui/cli.test.ts": `Bun.spawn(["bun", "cli.ts"]);\n`,
    "lib/c.ts": "export {};\n",
    "lib/c.test.ts": `import "./c.ts";\n`,
    "fixture.json": "{}\n",
    "tools/run.ts": "export {};\n",
    "lib/joined.test.ts": `Bun.spawn(["bun", join(import.meta.dir, "..", "tools", "run.ts")]);\n`,
    "bunfig.toml": `[test]\npreload = ["./tests/preload.ts"]\n`,
    "tests/preload.ts": `import "../lib/p.ts";\n`,
    "lib/p.ts": "export {};\n",
    "lib/lone.ts": "export {};\n",
  };
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), t); }
  sh("git", "add", ".");
  sh("git", "commit", "-qm", "seed");
  commit = sh("git", "rev-parse", "HEAD");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the tests that reach a file through imports, dynamic imports and spawned paths, and no others", () => {
  expect(relatedTests(dir, commit, ["lib/a.ts"], TESTS)).toEqual(["lib/b.test.ts", "lib/dyn.test.ts", "ui/cli.test.ts"]);
  expect(relatedTests(dir, commit, ["lib/c.ts"], TESTS)).toEqual(["lib/c.test.ts"]);
});

test("a test file that is a target is related to itself", () => {
  expect(relatedTests(dir, commit, ["lib/c.test.ts"], TESTS)).toEqual(["lib/c.test.ts"]);
});

test("a target that is not a module, or is not in the tree, gives null", () => {
  expect(relatedTests(dir, commit, ["fixture.json"], TESTS)).toBeNull();
  expect(relatedTests(dir, commit, ["lib/gone.ts"], TESTS)).toBeNull();
});

test("a path that join(import.meta.dir, ...) writes in parts is a dependency, and bunfig's preload is read", () => {
  expect(relatedTests(dir, commit, ["tools/run.ts"], TESTS)).toEqual(["lib/joined.test.ts"]);
  expect(importMap(dir, commit).preload).toEqual(["tests/preload.ts"]);
});

/** a.ts <- b.ts <- b.test.ts; c.ts <- c.test.ts; p.ts <- preload.ts. */
const MAP: ImportMap = {
  files: new Set(["a.ts", "b.ts", "b.test.ts", "c.ts", "c.test.ts", "p.ts", "preload.ts", "lone.ts"]),
  dependents: new Map([["a.ts", new Set(["b.ts"])], ["b.ts", new Set(["b.test.ts"])], ["c.ts", new Set(["c.test.ts"])], ["p.ts", new Set(["preload.ts"])]]),
  preload: ["preload.ts"],
};

test.each([
  ["a module gives the tests that reach it transitively", ["a.ts"], ["b.test.ts"]],
  ["a changed test file is in the list", ["c.test.ts", "a.ts"], ["b.test.ts", "c.test.ts"]],
  ["a removed test file drops out", ["gone.test.ts", "c.ts"], ["c.test.ts"]],
  ["a module that no test reaches gives no tests", ["lone.ts"], []],
  ["a file that is not a module gives the full suite", ["a.ts", "package.json"], "full"],
  ["bunfig.toml gives the full suite", ["bunfig.toml"], "full"],
  ["a removed module gives the full suite", ["gone.ts"], "full"],
  ["the preload gives the full suite", ["preload.ts"], "full"],
  ["a module the preload reaches gives the full suite", ["p.ts"], "full"],
] as const)("buildTests: %s", (_, changed, want) => {
  expect(buildTests([...changed], MAP, TESTS)).toEqual(want as string[] | "full");
});

test("buildChecks narrows only a bun test check, drops it when no test is reached, and keeps it whole for the full suite", () => {
  const repo = { path: dir, checks: [{ name: "tests", run: "bun run test", tests: TESTS }, { name: "app", run: "bun test app" }, { name: "types", run: "bunx tsc" }] } as unknown as Repo;
  const narrow = buildChecks(repo, commit, ["lib/c.ts"]);
  expect(narrow.checks.map((c) => c.run)).toEqual(["bun run test './lib/c.test.ts'", "bun test app", "bunx tsc"]);
  expect([...narrow.tests]).toEqual([["tests", ["lib/c.test.ts"]]]);
  expect(buildChecks(repo, commit, ["tools/none.md"]).checks.map((c) => c.run)).toEqual(["bun run test", "bun test app", "bunx tsc"]);
  expect(buildChecks(repo, commit, ["lib/p.ts"]).checks.map((c) => c.run)).toEqual(["bun run test", "bun test app", "bunx tsc"]);
  const none = buildChecks({ ...repo, checks: [{ name: "tests", run: "bun test" }] } as Repo, commit, ["lib/lone.ts"]);
  expect(none.checks).toEqual([]);
  expect([...none.tests]).toEqual([["tests", []]]);
});
