import { afterAll, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEvents } from "../../../lib/layout.ts";
import { gpuSlot } from "../gates/factory-status.ts";
import { setModel } from "../routing/models.ts";
import { cutTitle, fit, writeLine, writeTitle } from "./title.ts";

const dir = mkdtempSync(join(tmpdir(), "aleph-title-"));
const KEYS = ["ALEPH_RULE_CMD", "ALEPH_JOBS_DIR", "XDG_RUNTIME_DIR"];
const savedKeys = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
// The GPU slot reads the live runs and a lock: both stay in the temp folder.
Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run") });
afterAll(() => { for (const k of KEYS) if (savedKeys[k] === undefined) delete process.env[k]; else process.env[k] = savedKeys[k]; rmSync(dir, { recursive: true, force: true }); });

const SOURCE = `Check run-42: ${"the gate drops a test that the worker changed and nobody sees it ".repeat(3).trim()}.`;

test("writeTitle and fit cut the title mechanically and never call the model", async () => {
  const calls = join(dir, "calls");
  const f = join(dir, "stub");
  writeFileSync(f, `#!/bin/sh\necho call >> ${calls}\nprintf '%s' '{"type":"result","is_error":false,"result":"A title from the model"}'\n`, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = f;
  expect(await writeTitle(SOURCE)).toBe(cutTitle(SOURCE));
  expect(await writeTitle(SOURCE)).toBe("the gate drops a test that the worker changed and nobody");
  expect(await fit("[G] ", SOURCE)).toBe("[G] " + cutTitle(SOURCE, 56));
  expect(existsSync(calls)).toBe(false);
});

test("when the GPU slot stays taken past the rule writer's time box, the line comes from Claude and an event records the fallback", async () => {
  const saved = process.env.ALEPH_FACTORY_DIR;
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory-busy");
  const f = join(dir, "record-busy");
  writeFileSync(f, `#!/bin/sh\necho "$@" > ${join(dir, "args-busy")}\nprintf '%s' '{"type":"result","is_error":false,"result":"A rule from Claude"}'\n`, { mode: 0o755 });
  process.env.ALEPH_RULE_CMD = f;
  const T0 = Date.parse("2026-11-04T00:00:00Z");
  setSystemTime(T0);
  const release = (await gpuSlot(0))!;
  try {
    expect(setModel("title", { model: "gpt-oss-20b" })).toBeNull();
    const line = writeLine("Write a rule.", "a quote", 200);
    setSystemTime(T0 + 31_000); // the 30 s box ends while the slot stays taken
    expect(await line).toBe("A rule from Claude");
    expect(readFileSync(join(dir, "args-busy"), "utf8")).toContain("--model haiku");
    expect(readEvents().find((e) => e.action === "gpu")?.note).toContain("the call falls back to Claude");
  } finally {
    release();
    setSystemTime();
    if (saved === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = saved;
  }
});
