import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inProject, traceIn } from "./api/scope.ts";
import { withEnv } from "./test-server.ts";

let dir: string, restore: () => void;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "scope-"));
  writeFileSync(join(dir, "repos.json"), JSON.stringify({ alpha: { path: "/repos/alpha" }, "alpha-ui": { path: "/repos/alpha-ui" } }));
  restore = withEnv({ ALEPH_REPOS: join(dir, "repos.json") });
});
afterAll(() => { restore(); rmSync(dir, { recursive: true, force: true }); });

test("an item belongs to the project that parseId gives as its repo", () => {
  expect(inProject("alpha-ui-3", "alpha-ui")).toBe(true);
  expect(inProject("alpha-ui-3", "alpha")).toBe(false);
  expect(inProject("alpha-3", "alpha")).toBe(true);
  expect(inProject("alpha-3", "zeta")).toBe(false);
  expect(inProject("zeta-3", "zeta")).toBe(false);
});

test("a trace belongs by cwd under the registry path, else by its project tag", () => {
  expect(traceIn({ metadata: { cwd: "/repos/alpha/sub" } }, "alpha")).toBe(true);
  expect(traceIn({ metadata: { cwd: "/other/alpha" } }, "alpha")).toBe(false);
  expect(traceIn({ metadata: {}, tags: ["project:alpha"] }, "alpha")).toBe(true);
  expect(traceIn({ metadata: {}, tags: ["project:zeta"] }, "zeta")).toBe(false);
  expect(traceIn({ metadata: { cwd: "/repos/alpha" } }, "zeta")).toBe(false);
});
