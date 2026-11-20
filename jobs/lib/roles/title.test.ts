import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cutTitle, fit, writeTitle } from "./title.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-title-"));
const saved = process.env.ALEPH_JUDGE_CMD;
afterAll(() => { if (saved === undefined) delete process.env.ALEPH_JUDGE_CMD; else process.env.ALEPH_JUDGE_CMD = saved; rmSync(dir, { recursive: true, force: true }); });

const SOURCE = `Check run-42: ${"the gate drops a test that the worker changed and nobody sees it ".repeat(3).trim()}.`;

test("writeTitle and fit cut the title mechanically and never call the model", async () => {
  const calls = join(dir, "calls");
  const f = join(dir, "stub");
  writeFileSync(f, `#!/bin/sh\necho call >> ${calls}\nprintf '%s' '{"type":"result","is_error":false,"result":"A title from the model"}'\n`, { mode: 0o755 });
  process.env.ALEPH_JUDGE_CMD = f;
  expect(await writeTitle(SOURCE)).toBe(cutTitle(SOURCE));
  expect(await writeTitle(SOURCE)).toBe("the gate drops a test that the worker changed and nobody");
  expect(await fit("[G] ", SOURCE)).toBe("[G] " + cutTitle(SOURCE, 56));
  expect(existsSync(calls)).toBe(false);
});
