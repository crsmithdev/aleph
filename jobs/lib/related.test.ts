import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relatedTests } from "./related.ts";

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
