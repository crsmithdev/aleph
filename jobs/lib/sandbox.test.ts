import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunFolder } from "./sandbox.ts";

const base = mkdtempSync(join(tmpdir(), "aleph-sandbox-"));
process.env.ALEPH_RUNS_DIR = join(base, "runs");
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a run folder's Claude Code settings keep auto memory off", () => {
  const dir = makeRunFolder("r1");
  const settings = JSON.parse(readFileSync(join(dir, "home/.claude/settings.json"), "utf8"));
  expect(settings.autoMemoryEnabled).toBe(false);
});
