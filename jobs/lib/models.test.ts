import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverArgs } from "./gpt-oss-start.ts";
import { LOCAL, LOCAL_ENV, readModels, setModel, SLOTS } from "./models.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "models-")); process.env.ALEPH_FACTORY_DIR = dir; });
afterEach(() => { delete process.env.ALEPH_FACTORY_DIR; rmSync(dir, { recursive: true, force: true }); });

test("a missing file gives claude for all five slots", () => {
  expect(SLOTS).toHaveLength(5);
  for (const s of SLOTS) expect(readModels()[s]).toBe("claude");
});

test("a slot set to local reads back local and the others stay claude", () => {
  expect(setModel("merge", "local")).toBeNull();
  const m = readModels();
  expect(m.merge).toBe("local");
  for (const s of SLOTS.filter((s) => s !== "merge")) expect(m[s]).toBe("claude");
  expect(setModel("intake", "local")).toContain("unknown slot");
  expect(setModel("merge", "gpu")).toContain("unknown backend");
});

test("the local entry names gpt-oss-20b and the base URL", () => {
  expect(LOCAL.model).toBe("gpt-oss-20b");
  expect(LOCAL.baseUrl).toBe("http://127.0.0.1:8012");
});

test("the compact window fits the server's context and leaves a usable threshold", () => {
  const a = serverArgs("/h", null);
  const ctx = Number(a[a.indexOf("--ctx-size") + 1]);
  const window = Number(LOCAL_ENV.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const maxOut = Number(LOCAL_ENV.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? 32000);
  expect(window).toBeGreaterThan(0);
  expect(window).toBeLessThanOrEqual(ctx);
  expect(window - Math.min(maxOut, 20000) - 13000).toBeGreaterThanOrEqual(20000);
});
